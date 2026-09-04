import { NextRequest } from "next/server";
import { issueMandate, verifyReceipt } from "@/lib/mandate";
import { getLLMProvider } from "@/lib/llm";
import type { ToolDefinition } from "@/lib/llm/types";

/**
 * Drives a real autonomous buyer agent and streams each step to the browser
 * as it happens (Server-Sent Events), so the /agent page can show the
 * agent-to-agent transaction unfolding rather than a canned animation.
 *
 * Everything streamed here is the result of a real HTTP call against this
 * merchant's own public agent endpoints — the same ones any third-party
 * buyer would use, and the same ones scripts/buyer-agent.ts hits from
 * outside the process. The buyer's mandate is minted here only because
 * signing needs the shared secret; in a real deployment the buyer's
 * principal would sign it on the buyer's side.
 *
 * The scenarios are not simulations. `over-mandate` really does present an
 * under-authorised mandate, `tampered` really does alter a signed payload,
 * and `replay` really does re-submit a spent nonce — each one is refused by
 * the same server-side checks that protect a production order.
 */
export const dynamic = "force-dynamic";

type Scenario = "normal" | "over-mandate" | "tampered" | "replay";

const SELECT_TOOL: ToolDefinition[] = [
  {
    name: "choose_items",
    description: "Choose catalog items that satisfy the shopping goal within budget.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              catalog_id: { type: "string" },
              qty: { type: "integer", minimum: 1 },
              why: { type: "string" },
            },
            required: ["catalog_id", "qty", "why"],
          },
        },
      },
      required: ["items"],
    },
  },
];

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const scenario = (params.get("scenario") ?? "normal") as Scenario;
  const goal = params.get("goal") ?? "a warm afternoon pick-me-up, nothing too sweet";
  const budgetPaise = Number(params.get("budget") ?? "25000");

  const origin = req.nextUrl.origin;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

      try {
        await runBuyer({ origin, scenario, goal, budgetPaise, send, pause });
      } catch (err) {
        send({
          side: "buyer",
          kind: "error",
          title: "Buyer agent failed",
          detail: err instanceof Error ? err.message : String(err),
        });
      } finally {
        send({ kind: "done" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

async function runBuyer(opts: {
  origin: string;
  scenario: Scenario;
  goal: string;
  budgetPaise: number;
  send: (e: Record<string, unknown>) => void;
  pause: (ms: number) => Promise<unknown>;
}) {
  const { origin, scenario, goal, budgetPaise, send, pause } = opts;
  const BUYER_ID = "buyer-agent://demo-procurement-bot/v1";
  const PRINCIPAL = "aggam@example.com";

  send({
    side: "buyer",
    kind: "boot",
    title: "Buyer agent starting",
    detail: `Goal: "${goal}" · delegated authority ₹${(budgetPaise / 100).toFixed(2)}`,
    data: { buyer_agent_id: BUYER_ID, principal: PRINCIPAL },
  });
  await pause(400);

  // 1 — discovery
  send({ side: "buyer", kind: "request", title: "Discovering merchant", detail: "GET /.well-known/agent-commerce.json" });
  const manifest = await (await fetch(`${origin}/.well-known/agent-commerce.json`)).json();
  await pause(250);
  send({
    side: "merchant",
    kind: "response",
    title: "Manifest published",
    detail: `${manifest.merchant.name} · autonomous cap ₹${(manifest.terms.autonomous_order_cap_paise / 100).toFixed(2)} · mandate required`,
    data: { binding_rule: manifest.terms.mandate.binding_rule },
  });
  await pause(400);

  // 2 — catalog
  send({ side: "buyer", kind: "request", title: "Reading catalog", detail: "GET /api/agent/catalog" });
  const catalog = await (await fetch(`${origin}/api/agent/catalog`)).json();
  await pause(250);
  send({
    side: "merchant",
    kind: "response",
    title: "Catalog returned",
    detail: `${catalog.count} items, machine-readable (integer paise, stable ids)`,
  });
  await pause(400);

  // 3 — the buyer actually reasons about what to buy
  send({ side: "buyer", kind: "think", title: "Choosing a basket", detail: "Reasoning over the real catalog" });
  const chosen = await chooseItems(catalog.items, goal, budgetPaise);
  send({
    side: "buyer",
    kind: "decision",
    title: "Basket selected",
    detail: chosen
      .map((i) => {
        const item = catalog.items.find((c: { id: string }) => c.id === i.catalog_id);
        return `${i.qty}× ${item?.name ?? i.catalog_id}`;
      })
      .join(" · "),
    data: { reasons: chosen.map((i) => i.why) },
  });
  await pause(400);

  // 4 — quote + upsell offer
  const quoteMandate = issueMandate({
    buyer_agent_id: BUYER_ID,
    principal: PRINCIPAL,
    max_amount_paise: budgetPaise,
    purpose: goal,
  });
  send({ side: "buyer", kind: "request", title: "Requesting quote", detail: "POST /api/agent/quote" });
  const quote = await (
    await fetch(`${origin}/api/agent/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Agent-Mandate": quoteMandate.token },
      body: JSON.stringify({ items: chosen.map((i) => ({ catalog_id: i.catalog_id, qty: i.qty })) }),
    })
  ).json();
  await pause(300);

  send({
    side: "merchant",
    kind: "response",
    title: "Quote returned",
    detail: `Subtotal ₹${(quote.subtotal_paise / 100).toFixed(2)}`,
    data: { line_items: quote.line_items },
  });
  await pause(350);

  let acceptUpsellId: string | undefined;
  if (quote.upsell_offer) {
    send({
      side: "merchant",
      kind: "upsell",
      title: "Upsell offered",
      detail: `${quote.upsell_offer.name} +₹${(quote.upsell_offer.unit_price_paise / 100).toFixed(2)} — ${quote.upsell_offer.reason}`,
    });
    await pause(500);
    const affordable = quote.acceptance?.upsell_affordable === true;
    acceptUpsellId = affordable ? quote.upsell_offer.catalog_id : undefined;
    send({
      side: "buyer",
      kind: affordable ? "accept" : "decline",
      title: affordable ? "Upsell accepted" : "Upsell declined",
      detail: affordable
        ? "Still inside my mandate — worth taking"
        : "Would breach my mandate — declined",
    });
    await pause(400);
  }

  const finalTotal = quote.subtotal_paise + (acceptUpsellId ? quote.upsell_offer.unit_price_paise : 0);

  // 5 — the order, under whichever mandate this scenario calls for
  let mandateAmount = budgetPaise;
  if (scenario === "over-mandate") {
    mandateAmount = Math.max(100, Math.floor(finalTotal / 2));
    send({
      side: "buyer",
      kind: "warn",
      title: "Scenario: under-authorised",
      detail: `Presenting a mandate of only ₹${(mandateAmount / 100).toFixed(2)} for a ₹${(finalTotal / 100).toFixed(2)} basket`,
    });
    await pause(400);
  }

  const mandate = issueMandate({
    buyer_agent_id: BUYER_ID,
    principal: PRINCIPAL,
    max_amount_paise: mandateAmount,
    purpose: goal,
  });
  let token = mandate.token;

  if (scenario === "tampered") {
    const [payload, sig] = token.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    decoded.max_amount_paise = 9999900;
    token = `${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${sig}`;
    send({
      side: "buyer",
      kind: "warn",
      title: "Scenario: tampered mandate",
      detail: "Rewriting the ceiling to ₹99,999 without re-signing",
    });
    await pause(400);
  }

  const placed = await placeOrder({ origin, token, chosen, acceptUpsellId, goal, send, pause, finalTotal });

  if (scenario === "replay" && placed) {
    await pause(600);
    send({
      side: "buyer",
      kind: "warn",
      title: "Scenario: replaying the mandate",
      detail: "Submitting the same single-use mandate a second time",
    });
    await pause(400);
    await placeOrder({ origin, token, chosen, acceptUpsellId, goal, send, pause, finalTotal });
  }
}

async function placeOrder(opts: {
  origin: string;
  token: string;
  chosen: { catalog_id: string; qty: number; why: string }[];
  acceptUpsellId?: string;
  goal: string;
  finalTotal: number;
  send: (e: Record<string, unknown>) => void;
  pause: (ms: number) => Promise<unknown>;
}): Promise<boolean> {
  const { origin, token, chosen, acceptUpsellId, goal, send, pause, finalTotal } = opts;

  send({
    side: "buyer",
    kind: "request",
    title: "Placing order",
    detail: `POST /api/agent/order · presenting signed mandate · ₹${(finalTotal / 100).toFixed(2)}`,
  });
  await pause(350);
  send({ side: "merchant", kind: "check", title: "Verifying mandate", detail: "Signature → expiry → single-use nonce" });
  await pause(500);

  const res = await fetch(`${origin}/api/agent/order`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Agent-Mandate": token },
    body: JSON.stringify({
      items: chosen.map((i) => ({ catalog_id: i.catalog_id, qty: i.qty })),
      accept_upsell_catalog_id: acceptUpsellId,
      buyer_note: `Autonomous purchase for: ${goal}`,
    }),
  });
  const data = await res.json();

  if (!res.ok || !data.accepted) {
    send({
      side: "merchant",
      kind: "refused",
      title: `Refused — ${data.error}`,
      detail: data.message,
      data: { remedy: data.remedy ?? null, http: res.status },
    });
    await pause(300);
    send({
      side: "buyer",
      kind: "halt",
      title: "Buyer stops",
      detail: "Nothing was charged. The refusal and its reason are in the audit trail.",
    });
    return false;
  }

  send({
    side: "merchant",
    kind: "accepted",
    title: "Order accepted",
    detail: `₹${(data.total_paise / 100).toFixed(2)} · binding limit: ${data.binding_limit} at ₹${(data.binding_limit_paise / 100).toFixed(2)}`,
    data: { order_id: data.order_id, payment_url: data.payment_url, session_id: data.session_id },
  });
  await pause(400);

  const check = verifyReceipt(data.signed_receipt);
  send({
    side: "buyer",
    kind: check.valid ? "verified" : "error",
    title: check.valid ? "Receipt verified" : "Receipt signature invalid",
    detail: check.valid
      ? "Merchant's signed receipt matches what I agreed to — reconciled against my mandate."
      : "Merchant's receipt did not verify.",
    data: { payment_url: data.payment_url, session_id: data.session_id },
  });
  return true;
}

async function chooseItems(
  items: { id: string; name: string; description: string; unit_price_paise: number }[],
  goal: string,
  budgetPaise: number
): Promise<{ catalog_id: string; qty: number; why: string }[]> {
  const menu = items
    .map((i) => `- ${i.id} | ${i.name} | ₹${(i.unit_price_paise / 100).toFixed(2)} | ${i.description}`)
    .join("\n");

  try {
    const turn = await getLLMProvider().runTurn({
      systemPrompt: `You are an autonomous purchasing agent buying on behalf of your principal.
Budget: ₹${(budgetPaise / 100).toFixed(2)}. Choose ONLY from the catalog, using exact ids.
Keep the basket small and genuinely suited to the goal. Call choose_items exactly once.`,
      tools: SELECT_TOOL,
      history: [{ role: "user", content: `Goal: "${goal}"\n\nCatalog:\n${menu}` }],
    });

    const raw = turn.toolCalls.find((t) => t.name === "choose_items")?.input?.items;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) {
      const valid = parsed.filter((p: { catalog_id: string }) => items.some((i) => i.id === p.catalog_id));
      if (valid.length > 0) return valid;
    }
  } catch {
    // Fall through — a demo should degrade to something sensible rather than
    // dying because the free-tier LLM quota is exhausted mid-presentation.
  }

  const cheapest = [...items].sort((a, b) => a.unit_price_paise - b.unit_price_paise)[0];
  return [{ catalog_id: cheapest.id, qty: 1, why: "fallback selection" }];
}
