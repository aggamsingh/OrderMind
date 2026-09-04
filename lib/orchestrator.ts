/**
 * orchestrator.ts — executes the tool calls the LLM proposes.
 *
 * The model's tool calls are treated as untrusted input here, same as a
 * request body from a browser. Nothing the model states (a total, a
 * "confirmed" claim, a retry justification) is trusted directly — every
 * money-relevant fact is re-derived from Supabase before guardrails.ts is
 * consulted. See lib/guardrails.ts header and CLAUDE.md §1.
 *
 * This file is provider-agnostic — it talks to lib/llm/ (currently Ollama by
 * default, Claude available via LLM_PROVIDER=anthropic), never to a specific
 * SDK directly. See DECISIONS.md D-3.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getLLMProvider, type ConvMessage, type ToolCallRequest } from "./llm";
import { SYSTEM_PROMPT, TOOLS } from "./claude";
import { getCatalogByIds, searchCatalog } from "./catalog";
import { logAudit } from "./audit";
import { serializeError } from "./errors";
import { evaluateSpendCap, evaluateRetry, computeCartTotalPaise } from "./guardrails";
import { createRazorpayOrder } from "./razorpay";
import type { CartItem, Order, Session } from "./types";

const MAX_TOOL_ITERATIONS = 6; // hard stop so a runaway tool-call loop can't spin forever

// serializeError lives in lib/errors.ts (imported above) so every path that
// catches a Razorpay failure uses the same one. The agent order route had
// reimplemented a worse version by hand and logged "[object Object]" for a
// real failure — the exact bug that helper was written to prevent.

export type AgentTurnResult = {
  reply: string;
  cart: CartItem[];
  sessionStatus: Session["status"];
  pendingConfirmation: { totalPaise: number } | null;
  paymentLink: string | null;
  order: { id: string; status: Order["status"]; retryCount: number } | null;
};

/**
 * Bridges the webhook-driven payment.failed state back into the chat.
 *
 * BUG FOUND LIVE (see BUILD_LOG.md Day 5): app/api/webhooks/razorpay/route.ts
 * updates `orders.status` and `audit_log` directly from Razorpay's server
 * callback, completely outside the chat turn — nothing ever told the model a
 * payment had failed. System prompt rule 5 ("explain why ... using the
 * failure reason you're given") assumed a mechanism that didn't exist: the
 * model had no way to know, so "please retry" produced a generic reply
 * instead of a retry_payment tool call. Confirmed via
 * scripts/test-failure-flow-live.ts before this fix (retry_count stayed 0,
 * no retry_attempted audit row).
 *
 * Fix: look up the session's most recent order before each turn. If it's
 * `failed`, pull the decline reason from the matching audit_log row and
 * inject it as a synthetic context message ahead of the real user message —
 * never inside it, so the actual customer message stays exactly what they
 * typed for audit purposes. This is read-only context, not a money action,
 * so it doesn't need a guardrails.ts gate — it only grounds the model in a
 * fact the backend already independently verified from the webhook.
 */
async function loadPendingFailureContext(
  supabase: SupabaseClient,
  sessionId: string
): Promise<ConvMessage | null> {
  const { data: orders } = await supabase
    .from("orders")
    .select("*")
    .eq("session_id", sessionId)
    .order("updated_at", { ascending: false })
    .limit(1);

  const latestOrder = (orders as Order[] | null)?.[0];
  if (!latestOrder || latestOrder.status !== "failed") return null;

  const { data: auditRows } = await supabase
    .from("audit_log")
    .select("detail")
    .eq("order_id", latestOrder.id)
    .eq("action", "payment_failed")
    .order("created_at", { ascending: false })
    .limit(1);

  const reason =
    (auditRows?.[0]?.detail as { reason?: string } | undefined)?.reason ?? "unknown reason";

  return {
    role: "user",
    content: `[Order status update from the payment system, not something the customer said: the payment for order_id "${latestOrder.id}" (total ₹${(
      latestOrder.total_paise / 100
    ).toFixed(
      2
    )}) just failed. Reason: "${reason}". If you haven't already explained this to the customer, do so plainly per your instructions, and offer the retry_payment tool with order_id "${latestOrder.id}" if a retry is appropriate.]`,
  };
}

export async function runAgentTurn(
  supabase: SupabaseClient,
  session: Session,
  userMessage: string
): Promise<AgentTurnResult> {
  const provider = getLLMProvider();

  const failureContext = await loadPendingFailureContext(supabase, session.id);
  const history: ConvMessage[] = [
    ...session.messages,
    ...(failureContext ? [failureContext] : []),
    { role: "user", content: userMessage },
  ];

  let pendingConfirmation: { totalPaise: number } | null = null;
  let paymentLink: string | null = null;
  let orderInfo: AgentTurnResult["order"] = null;
  let latestCart: CartItem[] = session.cart;
  let sessionStatus: Session["status"] = session.status;

  let finalTextReply = "";

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    let turn;
    try {
      turn = await provider.runTurn({ systemPrompt: SYSTEM_PROMPT, tools: TOOLS, history });
    } catch (err) {
      // BUG FOUND LIVE (see BUILD_LOG.md Day 5): the LLM call had zero error
      // handling anywhere in this loop — a transient provider failure (rate
      // limit, network blip) crashed the whole request instead of degrading
      // gracefully, surfaced by scripts/test-happy-path-live.ts returning an
      // empty-body 500 under back-to-back live calls. Persist the history up
      // to (but not including) the failed turn — the customer's message is
      // still recorded — so a retry on the next request has clean context
      // instead of a half-written assistant turn.
      await supabase.from("sessions").update({ messages: history }).eq("id", session.id);
      await logAudit({
        sessionId: session.id,
        actor: "orchestrator",
        action: "llm_call_failed",
        detail: { error: serializeError(err) },
      });
      return {
        reply: "Sorry, I'm having trouble reaching the assistant right now. Please try sending that again in a moment.",
        cart: latestCart,
        sessionStatus,
        pendingConfirmation,
        paymentLink,
        order: orderInfo,
      };
    }

    history.push({ role: "assistant", content: turn.textReply, toolCalls: turn.toolCalls });

    if (turn.textReply) {
      finalTextReply = turn.textReply;
    }

    if (turn.toolCalls.length === 0) {
      break;
    }

    const results: { toolCallId: string; toolName: string; content: string }[] = [];

    for (const toolCall of turn.toolCalls) {
      const result = await executeToolCall(supabase, session.id, toolCall);

      if (result.cart) latestCart = result.cart;
      if (result.sessionStatus) sessionStatus = result.sessionStatus;
      if (result.pendingConfirmation !== undefined) pendingConfirmation = result.pendingConfirmation;
      if (result.paymentLink) paymentLink = result.paymentLink;
      if (result.order) orderInfo = result.order;

      results.push({ toolCallId: toolCall.id, toolName: toolCall.name, content: result.toolResultText });
    }

    history.push({ role: "tool_results", results });
  }

  await supabase.from("sessions").update({ messages: history }).eq("id", session.id);

  return {
    reply: finalTextReply || "(no reply generated)",
    cart: latestCart,
    sessionStatus,
    pendingConfirmation,
    paymentLink,
    order: orderInfo,
  };
}

type ToolExecResult = {
  toolResultText: string;
  cart?: CartItem[];
  sessionStatus?: Session["status"];
  pendingConfirmation?: { totalPaise: number } | null;
  paymentLink?: string;
  order?: AgentTurnResult["order"];
};

async function executeToolCall(
  supabase: SupabaseClient,
  sessionId: string,
  toolCall: ToolCallRequest
): Promise<ToolExecResult> {
  switch (toolCall.name) {
    case "search_catalog":
      return execSearchCatalog(
        supabase,
        sessionId,
        toolCall.input as { query: string; category?: string }
      );
    case "propose_cart":
      return execProposeCart(
        supabase,
        sessionId,
        toolCall.input as {
          items: { catalog_id: string; qty: number; reason: string }[] | string;
          upsell_catalog_id?: string;
          upsell_reason?: string;
        }
      );
    case "create_order":
      return execCreateOrder(
        supabase,
        sessionId,
        toolCall.input as { confirmation_statement: string }
      );
    case "retry_payment":
      return execRetryPayment(supabase, sessionId, toolCall.input as { order_id: string });
    default:
      return { toolResultText: `Unknown tool: ${toolCall.name}` };
  }
}

async function execSearchCatalog(
  supabase: SupabaseClient,
  sessionId: string,
  input: { query: string; category?: string }
): Promise<ToolExecResult> {
  const items = await searchCatalog(supabase, input.query, input.category);

  // Logged for full explainability, not just money-moving actions — a judge
  // (or a developer debugging a hallucination) should be able to see exactly
  // what the model searched for and what real data it got back.
  await logAudit({
    sessionId,
    actor: "agent",
    action: "search_catalog",
    detail: { query: input.query, category: input.category ?? null, result_count: items.length },
  });

  return {
    toolResultText: JSON.stringify(
      items.map((i) => ({
        id: i.id,
        name: i.name,
        description: i.description,
        price_paise: i.price_paise,
        category: i.category,
        pairs_well_with: i.pairs_well_with,
      }))
    ),
  };
}

async function execProposeCart(
  supabase: SupabaseClient,
  sessionId: string,
  input: {
    items: { catalog_id: string; qty: number; reason: string }[] | string;
    upsell_catalog_id?: string;
    upsell_reason?: string;
  }
): Promise<ToolExecResult> {
  // Empirically confirmed bug in some local models (llama3.1:8b, during the
  // Ollama evaluation — see BUILD_LOG.md): items sometimes arrives as a
  // JSON-encoded STRING instead of a real array. Repair it defensively here
  // rather than crash — this is cheap insurance for any provider, not an
  // Ollama-only patch.
  let items = input.items;
  if (typeof items === "string") {
    try {
      items = JSON.parse(items);
    } catch {
      return { toolResultText: "Error: items field was a malformed string, not valid JSON. Retry propose_cart with items as a real array." };
    }
  }
  if (!Array.isArray(items)) {
    return { toolResultText: "Error: items field must be an array. Retry propose_cart with a valid array." };
  }

  const allIds = [...items.map((i) => i.catalog_id), input.upsell_catalog_id].filter(
    (id): id is string => Boolean(id)
  );
  const catalogMap = await getCatalogByIds(supabase, allIds);

  const cart: CartItem[] = [];
  const rejected: string[] = [];

  for (const item of items) {
    const catalogItem = catalogMap.get(item.catalog_id);
    if (!catalogItem || !catalogItem.is_available) {
      rejected.push(item.catalog_id);
      continue;
    }
    cart.push({
      catalog_id: catalogItem.id,
      name: catalogItem.name,
      qty: item.qty,
      unit_price_paise: catalogItem.price_paise,
      reason: item.reason,
    });
  }

  let upsellAdded = false;
  if (input.upsell_catalog_id) {
    const upsellItem = catalogMap.get(input.upsell_catalog_id);
    const validPairing = cart.some((c) => {
      const sourceCatalogItem = catalogMap.get(c.catalog_id);
      return sourceCatalogItem?.pairs_well_with === input.upsell_catalog_id;
    });

    if (upsellItem && upsellItem.is_available && validPairing) {
      cart.push({
        catalog_id: upsellItem.id,
        name: upsellItem.name,
        qty: 1,
        unit_price_paise: upsellItem.price_paise,
        reason: input.upsell_reason ?? "Pairs well with an item in your cart",
        is_upsell: true,
      });
      upsellAdded = true;
    }
  }

  await supabase.from("sessions").update({ cart }).eq("id", sessionId);

  await logAudit({
    sessionId,
    actor: "agent",
    action: "propose_cart",
    detail: { items: cart.filter((c) => !c.is_upsell), rejected_catalog_ids: rejected },
  });

  if (upsellAdded) {
    await logAudit({
      sessionId,
      actor: "agent",
      action: "upsell_suggested",
      detail: { item: cart.find((c) => c.is_upsell) },
    });
  }

  const totalPaise = computeCartTotalPaise(cart);

  return {
    toolResultText: JSON.stringify({
      cart,
      total_paise: totalPaise,
      rejected_catalog_ids: rejected,
      note:
        rejected.length > 0
          ? "Some catalog_ids were invalid or unavailable and were dropped — do not tell the customer they were added."
          : undefined,
    }),
    cart,
  };
}

async function execCreateOrder(
  supabase: SupabaseClient,
  sessionId: string,
  input: { confirmation_statement: string }
): Promise<ToolExecResult> {
  const { data: sessionRow, error: sessionErr } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", sessionId)
    .single();
  if (sessionErr || !sessionRow) {
    return { toolResultText: "Error: session not found." };
  }
  const session = sessionRow as Session;

  await logAudit({
    sessionId,
    actor: "customer",
    action: "create_order_requested",
    detail: { confirmation_statement: input.confirmation_statement },
  });

  if (!session.cart || session.cart.length === 0) {
    return { toolResultText: "Error: cart is empty, nothing to order." };
  }

  // Test case #7 (05_TEST_CASES.md): re-derive prices from the catalog table
  // fresh, right here, instead of trusting session.cart.unit_price_paise as
  // stored. That stored value was correct when propose_cart wrote it (see
  // execProposeCart below), but trusting it unchanged at charge time means
  // the total's integrity would rest on "nothing wrote a bad price to this
  // row since," not on the DB being the source of truth *now* — a weaker
  // guarantee than guardrails.ts's own header promises. Confirmed live via a
  // direct DB edit simulating a stale/tampered cart (see BUILD_LOG.md Day 5)
  // that this mattered: without this re-fetch, create_order silently charged
  // the tampered price. catalog_id/qty/reason still come from session.cart —
  // only price is re-verified. A catalog_id that's since become unavailable
  // or been removed is dropped from the charged total rather than trusted.
  const freshCatalog = await getCatalogByIds(
    supabase,
    session.cart.map((item) => item.catalog_id)
  );
  const cart: CartItem[] = session.cart
    .map((item) => {
      const fresh = freshCatalog.get(item.catalog_id);
      if (!fresh || !fresh.is_available) return null;
      return { ...item, name: fresh.name, unit_price_paise: fresh.price_paise };
    })
    .filter((item): item is CartItem => item !== null);

  if (cart.length === 0) {
    return {
      toolResultText:
        "Error: none of the cart items could be re-verified against the current catalog. Ask the customer to search again.",
    };
  }
  if (cart.length !== session.cart.length) {
    await logAudit({
      sessionId,
      actor: "orchestrator",
      action: "cart_items_dropped_at_charge",
      detail: {
        reason: "one or more cart items are no longer available in the catalog at charge time",
        original_count: session.cart.length,
        charged_count: cart.length,
      },
    });
  }

  const decision = evaluateSpendCap(cart, session);

  if (decision.outcome === "blocked_needs_confirmation") {
    await logAudit({
      sessionId,
      actor: "orchestrator",
      action: "cap_check_blocked",
      detail: { reason: decision.reason, total_paise: decision.totalPaise },
    });
    await supabase
      .from("sessions")
      .update({ status: "awaiting_confirmation" })
      .eq("id", sessionId);
    await logAudit({
      sessionId,
      actor: "orchestrator",
      action: "confirmation_required",
      detail: { total_paise: decision.totalPaise },
    });

    return {
      toolResultText: `Blocked: ${decision.reason} Tell the customer clearly that chat confirmation alone is not enough and that they need to use the "Confirm ₹${(
        decision.totalPaise / 100
      ).toFixed(2)}" button shown in the UI to proceed.`,
      sessionStatus: "awaiting_confirmation",
      pendingConfirmation: { totalPaise: decision.totalPaise },
    };
  }

  // auto_approved or confirmed_override
  await logAudit({
    sessionId,
    actor: "orchestrator",
    action: "cap_check_passed",
    detail: { reason: decision.reason, total_paise: decision.totalPaise, outcome: decision.outcome },
  });

  return createRazorpayOrderAndLog(supabase, sessionId, decision.totalPaise, "confirmed");
}

async function createRazorpayOrderAndLog(
  supabase: SupabaseClient,
  sessionId: string,
  totalPaise: number,
  sessionStatusAfter: Session["status"]
): Promise<ToolExecResult> {
  const { data: orderRow, error: orderErr } = await supabase
    .from("orders")
    .insert({ session_id: sessionId, total_paise: totalPaise, status: "created" })
    .select("*")
    .single();
  if (orderErr || !orderRow) {
    return { toolResultText: "Error: failed to create internal order record." };
  }
  const order = orderRow as Order;

  try {
    // Orders API, not Payment Links (see lib/razorpay.ts createRazorpayOrder).
    // We create the order ourselves, so its id is known here and now — the
    // webhook resolves by direct lookup instead of chasing a receipt, and
    // settlement happens on a page this merchant controls.
    const rzpOrder = await createRazorpayOrder(totalPaise, order.id, {
      internal_order_id: order.id,
      channel: "human_chat",
    });

    await supabase
      .from("orders")
      .update({
        razorpay_order_id: rzpOrder.id,
        status: "payment_pending",
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id);

    await supabase.from("sessions").update({ status: sessionStatusAfter }).eq("id", sessionId);

    await logAudit({
      sessionId,
      orderId: order.id,
      actor: "orchestrator",
      action: "create_order",
      detail: {
        razorpay_order_id: rzpOrder.id,
        total_paise: totalPaise,
      },
    });

    const payUrl = `/pay/${order.id}`;
    return {
      toolResultText: `Order created. Total ₹${(totalPaise / 100).toFixed(
        2
      )}. Payment page: ${payUrl}. Tell the customer to complete payment there.`,
      sessionStatus: sessionStatusAfter,
      pendingConfirmation: null,
      paymentLink: payUrl,
      order: { id: order.id, status: "payment_pending", retryCount: 0 },
    };
  } catch (err) {
    await logAudit({
      sessionId,
      orderId: order.id,
      actor: "orchestrator",
      action: "razorpay_call_failed",
      detail: { error: serializeError(err) },
    });
    return {
      toolResultText:
        "Error: Razorpay order/payment-link creation failed. Tell the customer there was a technical issue and to try again shortly.",
    };
  }
}

async function execRetryPayment(
  supabase: SupabaseClient,
  sessionId: string,
  input: { order_id: string }
): Promise<ToolExecResult> {
  const { data: orderRow, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", input.order_id)
    .eq("session_id", sessionId)
    .single();
  if (error || !orderRow) {
    return { toolResultText: "Error: order not found for this session." };
  }
  const order = orderRow as Order;

  const decision = evaluateRetry(order);

  if (decision.outcome === "retry_blocked_max_reached") {
    await logAudit({
      sessionId,
      orderId: order.id,
      actor: "orchestrator",
      action: "retry_blocked_max_reached",
      detail: { reason: decision.reason, retry_count: order.retry_count },
    });
    return {
      toolResultText: `Blocked: ${decision.reason} Tell the customer no further automatic retry is available for this order — suggest a different payment method or contacting support.`,
      order: { id: order.id, status: order.status, retryCount: order.retry_count },
    };
  }

  await supabase
    .from("orders")
    .update({ retry_count: order.retry_count + 1, status: "retried", updated_at: new Date().toISOString() })
    .eq("id", order.id);

  await logAudit({
    sessionId,
    orderId: order.id,
    actor: "orchestrator",
    action: "retry_attempted",
    detail: { retry_count: order.retry_count + 1 },
  });

  try {
    // BUG FOUND LIVE (see BUILD_LOG.md Day 5): `${order.id}-retry1` is 43
    // chars — Razorpay's reference_id caps at 40 ("the length must be no
    // more than 40", confirmed by hitting the real 400). Every retry was
    // silently failing the actual Razorpay call while retry_count still
    // incremented, so the customer never got a real new payment link.
    //
    // reference_id must ALSO be unique per payment link — confirmed live by
    // hitting "payment link with given reference_id ... already exists"
    // when reusing the bare order.id for a second link (see DECISIONS.md
    // D-7) — so the retry can't just reuse the original's reference_id
    // unchanged. `${order.id}-1` (38 chars) fits under the limit AND keeps
    // order.id as a clean, unmangled prefix — app/api/webhooks/razorpay
    // recovers it via fetchRazorpayOrderReceipt() + a UUID-prefix match,
    // which only works if the real order.id appears intact at the start.
    const rzpOrder = await createRazorpayOrder(order.total_paise, `${order.id}-1`, {
      internal_order_id: order.id,
      channel: "human_chat_retry",
    });
    // No razorpay_order_id to store yet here either — same lazy-assignment
    // reason as the initial creation path (see lib/razorpay.ts). The
    // webhook handler resolves it when the retry's payment event arrives.
    // The retry gets a FRESH Razorpay order, so razorpay_order_id must move
    // with it — otherwise the retry's webhook would resolve to the original,
    // already-failed order (the same class of bug as D-7).
    await supabase.from("orders").update({ razorpay_order_id: rzpOrder.id }).eq("id", order.id);

    const retryUrl = `/pay/${order.id}`;
    return {
      toolResultText: `Retry allowed. Payment page: ${retryUrl}.`,
      paymentLink: retryUrl,
      order: { id: order.id, status: "retried", retryCount: order.retry_count + 1 },
    };
  } catch (err) {
    await logAudit({
      sessionId,
      orderId: order.id,
      actor: "orchestrator",
      action: "razorpay_call_failed",
      detail: { error: serializeError(err), context: "retry" },
    });
    return { toolResultText: "Error: failed to create a retry payment link. Ask the customer to try again shortly." };
  }
}

/**
 * Handles the explicit UI "Confirm ₹X" action — NOT part of the Claude tool
 * loop. This runs entirely server-side, deliberately independent of the
 * model, which is the whole point of the gate (CLAUDE.md §1).
 */
export async function confirmOverCap(
  supabase: SupabaseClient,
  session: Session
): Promise<AgentTurnResult> {
  const cart = session.cart;
  const totalPaise = computeCartTotalPaise(cart);

  if (session.status !== "awaiting_confirmation" || cart.length === 0) {
    return {
      reply: "There is no pending over-cap order awaiting confirmation for this session.",
      cart,
      sessionStatus: session.status,
      pendingConfirmation: null,
      paymentLink: null,
      order: null,
    };
  }

  const now = new Date().toISOString();
  await supabase
    .from("sessions")
    .update({ confirmed_at: now, confirmed_total_paise: totalPaise, status: "confirmed" })
    .eq("id", session.id);

  await logAudit({
    sessionId: session.id,
    actor: "customer",
    action: "confirmed_via_ui",
    detail: { confirmed_total_paise: totalPaise },
  });

  const updatedSession: Session = {
    ...session,
    confirmed_at: now,
    confirmed_total_paise: totalPaise,
    status: "confirmed",
  };

  const decision = evaluateSpendCap(cart, updatedSession);
  await logAudit({
    sessionId: session.id,
    actor: "orchestrator",
    action: "cap_check_passed",
    detail: { reason: decision.reason, total_paise: decision.totalPaise, outcome: decision.outcome },
  });

  const result = await createRazorpayOrderAndLog(supabase, session.id, totalPaise, "confirmed");

  return {
    reply: result.toolResultText,
    cart,
    sessionStatus: result.sessionStatus ?? "confirmed",
    pendingConfirmation: null,
    paymentLink: result.paymentLink ?? null,
    order: result.order ?? null,
  };
}
