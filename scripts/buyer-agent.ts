/**
 * buyer-agent.ts — an autonomous AI BUYER that transacts with this merchant
 * end to end, with no human and no UI.
 *
 * This is the other half of Track 1. Everything else in this repo is the
 * seller's side; this script is a *separate party* that happens to run from
 * the same repo for demo convenience. It only ever touches the merchant
 * through public HTTP endpoints — never the database, never lib/orchestrator,
 * never a shared function. If it can do something, so could any third-party
 * agent that read /.well-known/agent-commerce.json.
 *
 * What it does, in order:
 *   1. Discovers the merchant from the well-known manifest alone.
 *   2. Reads the machine-readable catalog.
 *   3. Uses an LLM to decide what to buy from a plain-language goal.
 *   4. Gets a quote, and decides for itself whether to take the upsell.
 *   5. Presents a signed spend mandate and places a real order.
 *   6. Verifies the merchant's signed receipt against what it agreed to.
 *
 * Run:
 *   npx tsx scripts/buyer-agent.ts
 *   npx tsx scripts/buyer-agent.ts --goal "afternoon tea for two" --budget 30000
 *   npx tsx scripts/buyer-agent.ts --scenario over-mandate   # refusal demo
 *   npx tsx scripts/buyer-agent.ts --scenario replay         # single-use demo
 *   npx tsx scripts/buyer-agent.ts --scenario tampered       # signature demo
 *   npx tsx scripts/buyer-agent.ts --scenario revoked        # principal pulls authority
 *   npx tsx scripts/buyer-agent.ts --scenario compare        # shop across merchants
 *   npx tsx scripts/buyer-agent.ts --merchant https://ordermind-gamma.vercel.app
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { issueMandate, verifyReceipt } from "../lib/mandate";
import { getLLMProvider } from "../lib/llm";
import type { ToolDefinition } from "../lib/llm/types";

const args = process.argv.slice(2);
function arg(name: string, fallback?: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

const MERCHANT = arg("merchant", process.env.TEST_BASE_URL ?? "http://localhost:3000")!;
const GOAL = arg("goal", "a warm afternoon pick-me-up, nothing too sweet")!;
const BUDGET_PAISE = Number(arg("budget", "25000"));
const SCENARIO = arg("scenario", "normal")!;

const BUYER_AGENT_ID = "buyer-agent://demo-procurement-bot/v1";
const PRINCIPAL = "aggam@example.com";

// ---------- tiny presentation helpers (this is a demo script) ----------
const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};
const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;
let step = 0;
function say(title: string, detail?: string) {
  step += 1;
  console.log(`\n${c.bold(`[${step}] ${title}`)}`);
  if (detail) console.log(`    ${c.dim(detail)}`);
}

type ManifestTerms = {
  autonomous_order_cap_paise: number;
  mandate: { required: boolean; header: string; binding_rule: string };
  max_payment_retries: number;
};
type Manifest = {
  merchant: { id: string; name: string; currency: string };
  endpoints: Record<string, string>;
  terms: ManifestTerms;
};
type CatalogItem = {
  id: string;
  name: string;
  description: string;
  unit_price_paise: number;
  category: string;
};

const SELECT_TOOL: ToolDefinition[] = [
  {
    name: "choose_items",
    description:
      "Choose which catalog items to buy to satisfy the shopping goal, staying within the budget.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              catalog_id: { type: "string", description: "Exact id from the catalog provided" },
              qty: { type: "integer", minimum: 1 },
              why: { type: "string", description: "Why this item fits the goal" },
            },
            required: ["catalog_id", "qty", "why"],
          },
        },
      },
      required: ["items"],
    },
  },
];

/**
 * Comparison shopping: discover every merchant in the directory, price the
 * SAME goal at each, and buy from whichever is cheapest for what it can
 * actually supply.
 *
 * This is the part a single-merchant demo can never show. A buyer that can
 * only be pointed at one storefront isn't shopping — it's executing a
 * purchase someone else already decided. Here the agent reads each merchant's
 * own manifest (their caps genuinely differ), quotes both, and picks.
 */
async function compareAndBuy() {
  console.log(c.bold("\n══════ AUTONOMOUS BUYER AGENT — COMPARISON SHOPPING ══════"));
  console.log(`${c.dim("goal    ")} "${GOAL}"`);
  console.log(`${c.dim("budget  ")} ${rupees(BUDGET_PAISE)}`);

  say("Discovering the market", `GET ${MERCHANT}/api/agent/merchants`);
  const dir = (await (await fetch(`${MERCHANT}/api/agent/merchants`)).json()) as {
    merchants: { id: string; name: string; tagline: string }[];
  };
  console.log(`    ${dir.merchants.length} merchants available`);

  type Bid = {
    id: string;
    name: string;
    cap: number;
    subtotal: number;
    items: { catalog_id: string; qty: number; why: string }[];
  };
  const bids: Bid[] = [];

  for (const m of dir.merchants) {
    say(`Pricing at ${m.name}`, m.tagline);

    const manifest = (await (
      await fetch(`${MERCHANT}/.well-known/agent-commerce.json?merchant=${m.id}`)
    ).json()) as Manifest;
    const cap = manifest.terms.autonomous_order_cap_paise;
    console.log(`    autonomous cap: ${rupees(cap)}`);

    const catalog = (await (
      await fetch(`${MERCHANT}/api/agent/catalog?merchant=${m.id}`)
    ).json()) as { items: CatalogItem[] };

    if (catalog.items.length === 0) {
      console.log(`    ${c.yellow("no stock — skipping")}`);
      continue;
    }

    const chosen = await decideItems(catalog.items);
    const quoteRes = await fetch(`${MERCHANT}/api/agent/quote?merchant=${m.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: chosen.map((i) => ({ catalog_id: i.catalog_id, qty: i.qty })) }),
    });
    const quote = await quoteRes.json();
    if (!quoteRes.ok) {
      console.log(`    ${c.yellow(`could not quote: ${quote.error ?? quoteRes.status}`)}`);
      continue;
    }

    console.log(
      `    basket: ${chosen
        .map((i) => catalog.items.find((c2) => c2.id === i.catalog_id)?.name ?? i.catalog_id)
        .join(", ")}`
    );
    console.log(`    quoted: ${c.bold(rupees(quote.subtotal_paise))}`);
    bids.push({ id: m.id, name: m.name, cap, subtotal: quote.subtotal_paise, items: chosen });
  }

  if (bids.length === 0) {
    console.log(c.red("\nNo merchant could quote this goal."));
    return;
  }

  // Only consider merchants that can actually complete the order unattended:
  // one whose own cap sits below the basket would refuse it anyway.
  const viable = bids.filter((b) => b.subtotal <= b.cap && b.subtotal <= BUDGET_PAISE);
  say("Comparing offers");
  for (const b of bids) {
    const why =
      b.subtotal > BUDGET_PAISE
        ? c.red("over my mandate")
        : b.subtotal > b.cap
          ? c.red("over that merchant's autonomous cap")
          : c.green("viable");
    console.log(`    ${b.name.padEnd(24)} ${rupees(b.subtotal).padStart(9)}  ${why}`);
  }

  if (viable.length === 0) {
    console.log(c.red("\n    No merchant can serve this within both limits. Buying nothing."));
    return;
  }

  const winner = viable.sort((a, b) => a.subtotal - b.subtotal)[0];
  console.log(`\n    ${c.green("→ buying from")} ${c.bold(winner.name)} at ${rupees(winner.subtotal)}`);

  const mandate = issueMandate({
    buyer_agent_id: BUYER_AGENT_ID,
    principal: PRINCIPAL,
    max_amount_paise: BUDGET_PAISE,
    purpose: GOAL,
  });

  say("Placing order", `POST /api/agent/order?merchant=${winner.id}`);
  const res = await fetch(`${MERCHANT}/api/agent/order?merchant=${winner.id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Agent-Mandate": mandate.token },
    body: JSON.stringify({
      items: winner.items.map((i) => ({ catalog_id: i.catalog_id, qty: i.qty })),
      buyer_note: `Autonomous purchase for: ${GOAL}`,
    }),
  });
  const data = await res.json();

  if (!res.ok || !data.accepted) {
    console.log(`    ${c.red("REFUSED")} — ${data.message ?? data.error}`);
    return;
  }
  console.log(`    ${c.green("ACCEPTED")} — order ${data.order_id}`);
  console.log(`    total:   ${c.bold(rupees(data.total_paise))}`);
  console.log(`    pay at:  ${c.cyan(data.payment_link)}`);
  const check = verifyReceipt(data.signed_receipt);
  console.log(`    receipt: ${check.valid ? c.green("verified") : c.red("INVALID")}`);
  await watchSettlement(data.order_id, 2, 3000);
}

/**
 * The principal changes their mind mid-flight.
 *
 * A signed mandate is a bearer token, so the interesting question is not "can
 * the agent spend?" but "can the human stop it?". Here the agent obtains a
 * perfectly valid mandate, the principal revokes it, and the agent — holding
 * a token whose signature still verifies — is refused anyway.
 */
async function revokedRun() {
  console.log(c.bold("\n══════ AUTONOMOUS BUYER AGENT — REVOKED MID-FLIGHT ══════"));

  say("Principal grants authority", "POST /api/principal/mandates");
  const grantRes = await fetch(`${MERCHANT}/api/principal/mandates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      principal: PRINCIPAL,
      buyer_agent_id: BUYER_AGENT_ID,
      max_amount_paise: BUDGET_PAISE,
      purpose: GOAL,
    }),
  });
  const grant = await grantRes.json();
  if (!grantRes.ok) {
    console.error(c.red(`    could not grant: ${grant.message ?? grantRes.status}`));
    return;
  }
  console.log(`    granted ${rupees(BUDGET_PAISE)}, nonce ${c.dim(grant.mandate.nonce.slice(0, 18))}…`);

  const catalog = (await (await fetch(`${MERCHANT}/api/agent/catalog`)).json()) as {
    items: CatalogItem[];
  };
  const chosen = await decideItems(catalog.items);

  say("Principal changes their mind", "POST /api/principal/revoke");
  const revokeRes = await fetch(`${MERCHANT}/api/principal/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scope: "mandate",
      nonce: grant.mandate.nonce,
      reason: "Changed my mind — cancelled from the principal console.",
    }),
  });
  console.log(
    revokeRes.ok
      ? `    ${c.yellow("mandate revoked")} ${c.dim("(the token itself is unchanged and still verifies)")}`
      : c.red(`    revoke failed: ${revokeRes.status}`)
  );

  say("Agent tries to spend it anyway", "POST /api/agent/order");
  const res = await fetch(`${MERCHANT}/api/agent/order`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Agent-Mandate": grant.token },
    body: JSON.stringify({
      items: chosen.map((i) => ({ catalog_id: i.catalog_id, qty: i.qty })),
      buyer_note: `Autonomous purchase for: ${GOAL}`,
    }),
  });
  const data = await res.json();

  if (res.ok && data.accepted) {
    console.log(c.red(`    ACCEPTED — this is a BUG, a revoked mandate must never be honoured.`));
    return;
  }

  console.log(`    ${c.red("REFUSED")} (HTTP ${res.status}) — ${c.bold(data.error)}`);
  console.log(`    ${data.message}`);
  console.log(
    c.dim(
      "\n    The signature still verifies and the mandate has not expired. It was\n" +
        "    refused because the human who granted it took the authority back —\n" +
        "    which is what makes this delegation rather than a giveaway."
    )
  );
}

async function main() {
  if (SCENARIO === "compare") return compareAndBuy();
  if (SCENARIO === "revoked") return revokedRun();

  console.log(c.bold("\n══════ AUTONOMOUS BUYER AGENT ══════"));
  console.log(`${c.dim("agent   ")} ${BUYER_AGENT_ID}`);
  console.log(`${c.dim("principal")} ${PRINCIPAL}`);
  console.log(`${c.dim("goal    ")} "${GOAL}"`);
  console.log(`${c.dim("budget  ")} ${rupees(BUDGET_PAISE)}  ${c.dim("(delegated spend authority)")}`);
  console.log(`${c.dim("merchant")} ${MERCHANT}`);
  if (SCENARIO !== "normal") console.log(`${c.dim("scenario")} ${c.yellow(SCENARIO)}`);

  // ---- 1. Discovery: everything is learned from one well-known URL ----
  say("Discovering merchant", `GET ${MERCHANT}/.well-known/agent-commerce.json`);
  const manifestRes = await fetch(`${MERCHANT}/.well-known/agent-commerce.json`);
  if (!manifestRes.ok) {
    console.error(c.red(`Merchant is not agent-transactable (HTTP ${manifestRes.status}).`));
    process.exit(1);
  }
  const manifest = (await manifestRes.json()) as Manifest;
  console.log(`    merchant:      ${c.cyan(manifest.merchant.name)} (${manifest.merchant.currency})`);
  console.log(`    autonomous cap: ${rupees(manifest.terms.autonomous_order_cap_paise)}`);
  console.log(`    mandate:        ${manifest.terms.mandate.required ? "required" : "not required"} · ${manifest.terms.mandate.binding_rule}`);

  // A well-behaved buyer checks the merchant's terms against its own authority
  // BEFORE spending anything, rather than learning by being refused.
  if (BUDGET_PAISE > manifest.terms.autonomous_order_cap_paise) {
    console.log(
      c.yellow(
        `    note: my mandate (${rupees(BUDGET_PAISE)}) exceeds this merchant's autonomous cap — the cap will bind.`
      )
    );
  }

  // ---- 2. Read the catalog as data, not as a web page ----
  say("Reading catalog", `GET ${manifest.endpoints.catalog}`);
  const catalogRes = await fetch(`${MERCHANT}${manifest.endpoints.catalog}`);
  const catalog = (await catalogRes.json()) as { items: CatalogItem[] };
  console.log(`    ${catalog.items.length} items available`);

  // ---- 3. Decide what to buy, from a plain-language goal ----
  say("Deciding what to buy", "LLM selects from the real catalog — no invented items");
  const chosen = await decideItems(catalog.items);
  for (const item of chosen) {
    const cat = catalog.items.find((i) => i.id === item.catalog_id);
    console.log(`    ${item.qty}× ${c.cyan(cat?.name ?? item.catalog_id)} — ${c.dim(item.why)}`);
  }

  // ---- 4. Quote, including the merchant's upsell offer ----
  say("Requesting quote", `POST ${manifest.endpoints.quote}`);
  const mandateForQuote = issueMandate({
    buyer_agent_id: BUYER_AGENT_ID,
    principal: PRINCIPAL,
    max_amount_paise: BUDGET_PAISE,
    purpose: GOAL,
  });

  const quoteRes = await fetch(`${MERCHANT}${manifest.endpoints.quote}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Agent-Mandate": mandateForQuote.token },
    body: JSON.stringify({ items: chosen.map((i) => ({ catalog_id: i.catalog_id, qty: i.qty })) }),
  });
  const quote = await quoteRes.json();
  if (!quoteRes.ok) {
    console.error(c.red(`    quote failed: ${JSON.stringify(quote)}`));
    process.exit(1);
  }
  console.log(`    subtotal: ${c.bold(rupees(quote.subtotal_paise))}`);

  // The merchant upsells the machine. The machine decides on the merits —
  // it accepts only if the upsell still fits inside its own mandate.
  let acceptUpsellId: string | undefined;
  if (quote.upsell_offer) {
    const offer = quote.upsell_offer;
    const affordable = quote.acceptance?.upsell_affordable === true;
    console.log(
      `    upsell offered: ${c.cyan(offer.name)} +${rupees(offer.unit_price_paise)} — ${c.dim(offer.reason)}`
    );
    if (affordable) {
      acceptUpsellId = offer.catalog_id;
      console.log(`    ${c.green("→ accepted")} ${c.dim("(fits within my mandate)")}`);
    } else {
      console.log(`    ${c.yellow("→ declined")} ${c.dim("(would breach my mandate)")}`);
    }
  }

  // ---- 5. Place the real order under a signed mandate ----
  const finalTotal = quote.subtotal_paise + (acceptUpsellId ? quote.upsell_offer.unit_price_paise : 0);

  // Scenarios exist to demonstrate the merchant's refusal paths honestly,
  // by actually triggering them rather than describing them.
  let mandateAmount = BUDGET_PAISE;
  if (SCENARIO === "over-mandate") {
    // Deliberately under-authorise, so the basket breaches the buyer's own limit.
    mandateAmount = Math.max(100, Math.floor(finalTotal / 2));
    console.log(
      c.yellow(`\n    [scenario] presenting a mandate of only ${rupees(mandateAmount)} for a ${rupees(finalTotal)} basket`)
    );
  }

  const mandate = issueMandate({
    buyer_agent_id: BUYER_AGENT_ID,
    principal: PRINCIPAL,
    max_amount_paise: mandateAmount,
    purpose: GOAL,
  });

  let token = mandate.token;
  if (SCENARIO === "tampered") {
    // Raise the ceiling in the payload without re-signing — exactly what a
    // malicious or buggy buyer would try.
    const [payload, sig] = token.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    decoded.max_amount_paise = 99_999_00;
    token = `${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${sig}`;
    console.log(c.yellow(`\n    [scenario] tampering with the mandate to claim a ₹99,999 ceiling`));
  }

  say("Placing order", `POST ${manifest.endpoints.order}  ·  total ${rupees(finalTotal)}`);
  const result = await placeOrder(manifest, token, chosen, acceptUpsellId);

  if (SCENARIO === "replay" && result.accepted) {
    say("Replaying the same mandate", "a single-use mandate must not authorise a second order");
    await placeOrder(manifest, token, chosen, acceptUpsellId);
  }
}

async function placeOrder(
  manifest: Manifest,
  token: string,
  chosen: { catalog_id: string; qty: number; why: string }[],
  acceptUpsellId?: string
): Promise<{ accepted: boolean }> {
  const res = await fetch(`${MERCHANT}${manifest.endpoints.order}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Agent-Mandate": token },
    body: JSON.stringify({
      items: chosen.map((i) => ({ catalog_id: i.catalog_id, qty: i.qty })),
      accept_upsell_catalog_id: acceptUpsellId,
      buyer_note: `Autonomous purchase for: ${GOAL}`,
    }),
  });
  const data = await res.json();

  if (!res.ok || !data.accepted) {
    console.log(`    ${c.red("REFUSED")} (HTTP ${res.status}) — ${c.bold(data.error ?? "unknown")}`);
    console.log(`    ${data.message ?? ""}`);
    if (data.remedy) console.log(`    ${c.dim(`remedy: ${data.remedy}`)}`);
    console.log(
      c.dim(
        "\n    The merchant refused and logged why. Nothing was charged. This is the\n    outcome an unsupervised buyer agent should get when it exceeds its authority."
      )
    );
    return { accepted: false };
  }

  console.log(`    ${c.green("ACCEPTED")} — order ${data.order_id}`);
  console.log(`    total:   ${c.bold(rupees(data.total_paise))}`);
  console.log(`    binding: ${data.binding_limit} at ${rupees(data.binding_limit_paise)}`);
  console.log(`    pay at:  ${c.cyan(data.payment_link)}`);

  // ---- 6. Verify the merchant's receipt rather than taking its word ----
  const check = verifyReceipt(data.signed_receipt);
  if (!check.valid) {
    console.log(`    ${c.red("receipt signature INVALID")} — ${check.reason}`);
  } else {
    const receiptTotal = (check.receipt as { total_paise: number }).total_paise;
    const matches = receiptTotal === data.total_paise;
    console.log(
      `    receipt: ${matches ? c.green("verified") : c.red("MISMATCH")} ${c.dim(
        `signed by merchant for ${rupees(receiptTotal)}`
      )}`
    );
  }
  console.log(`    audit:   ${c.dim(`${MERCHANT}/audit?sessionId=${data.session_id}`)}`);

  await watchSettlement(data.order_id);
  return { accepted: true };
}

/**
 * Polls until the order reaches a terminal state, or gives up.
 *
 * This exists because "the merchant said yes" is not the same as "I was
 * charged", and an agent that cannot tell those apart cannot reconcile its own
 * spending against the mandate it was granted.
 *
 * The merchant declares in its manifest that capture happens on a hosted page
 * (Razorpay S2S is not enabled on a standard test account), so this will sit
 * at `payment_pending` until someone completes the link. That is the honest
 * shape of the current rail — the buyer watches rather than assumes, and the
 * moment settlement happens by any route, it finds out.
 */
async function watchSettlement(orderId: string, attempts = 3, intervalMs = 4000) {
  say("Watching for settlement", `GET /api/agent/order/${orderId.slice(0, 8)}…`);

  for (let i = 1; i <= attempts; i++) {
    const res = await fetch(`${MERCHANT}/api/agent/order/${orderId}`);
    if (!res.ok) {
      console.log(`    ${c.yellow(`status check failed (HTTP ${res.status})`)}`);
      return;
    }
    const status = (await res.json()) as { status: string; terminal: boolean };

    if (status.terminal) {
      const good = status.status === "paid";
      console.log(`    ${good ? c.green(`settled: ${status.status}`) : c.red(`settled: ${status.status}`)}`);
      return;
    }

    console.log(`    ${c.dim(`attempt ${i}/${attempts}: ${status.status} — not settled yet`)}`);
    if (i < attempts) await new Promise((r) => setTimeout(r, intervalMs));
  }

  console.log(
    c.dim(
      "    Still awaiting capture. The merchant's manifest declares capture as\n" +
        "    'hosted_redirect' — a human completes the payment link, and this agent\n" +
        "    would learn of it on the next poll. Nothing is assumed either way."
    )
  );
}

/**
 * Uses the shared LLM layer to turn a plain-language goal into a basket of
 * REAL catalog ids. Deliberately reuses lib/llm so the buyer is a genuine LLM
 * agent, not a hardcoded list pretending to be one.
 */
async function decideItems(
  items: CatalogItem[]
): Promise<{ catalog_id: string; qty: number; why: string }[]> {
  const menu = items
    .map((i) => `- ${i.id} | ${i.name} | ${rupees(i.unit_price_paise)} | ${i.description}`)
    .join("\n");

  const provider = getLLMProvider();
  const turn = await provider.runTurn({
    systemPrompt: `You are an autonomous purchasing agent buying on behalf of your principal.
Your budget is ${rupees(BUDGET_PAISE)} and you must not propose a basket exceeding it.
Choose items ONLY from the catalog given to you, using the exact catalog ids shown.
Prefer a small, sensible basket that genuinely satisfies the goal. Call choose_items exactly once.`,
    tools: SELECT_TOOL,
    history: [
      {
        role: "user",
        content: `Shopping goal: "${GOAL}"\n\nCatalog (id | name | price | description):\n${menu}`,
      },
    ],
  });

  const call = turn.toolCalls.find((t) => t.name === "choose_items");
  const raw = call?.input?.items;
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;

  if (Array.isArray(parsed) && parsed.length > 0) {
    // Trust nothing: keep only ids that genuinely exist in the catalog we read.
    const valid = parsed.filter((p: { catalog_id: string }) =>
      items.some((i) => i.id === p.catalog_id)
    );
    if (valid.length > 0) return valid;
    console.log(c.yellow("    (model returned unknown ids — falling back to cheapest item)"));
  } else {
    console.log(c.yellow("    (model did not return a selection — falling back to cheapest item)"));
  }

  const cheapest = [...items].sort((a, b) => a.unit_price_paise - b.unit_price_paise)[0];
  return [{ catalog_id: cheapest.id, qty: 1, why: "fallback selection" }];
}

main().catch((err) => {
  console.error(c.red(`\nBuyer agent failed: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});
