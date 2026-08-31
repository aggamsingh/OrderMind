/**
 * Full multi-turn test — not just "first call looks reasonable" like
 * test-ollama-toolcalling.ts, but does the model actually complete a real
 * order end-to-end: search -> propose_cart (with a reason per item) ->
 * create_order? Executes tool calls against the REAL Supabase catalog
 * (read-only queries, same as the real orchestrator would), so this is as
 * close to the real thing as we can get without spending Anthropic credit.
 *
 * Run: npx tsx scripts/test-ollama-full-loop.ts <model-name>
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { TOOLS, SYSTEM_PROMPT } from "../lib/claude";
import { getSupabaseAdmin } from "../lib/supabase";
import { searchCatalog, getCatalogByIds } from "../lib/catalog";

const OLLAMA_URL = "http://localhost:11434/api/chat";
const MAX_ITERATIONS = 6;

function toOllamaTools() {
  return TOOLS.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

type OllamaMessage = {
  role: string;
  content: string;
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
};

async function callOllama(model: string, messages: OllamaMessage[]) {
  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, tools: toOllamaTools(), stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.message as OllamaMessage;
}

// Executes against the REAL Supabase catalog — read-only, same lib/catalog.ts
// functions the real orchestrator uses. No Razorpay calls (that needs the
// full orchestrator's guardrail path, out of scope for this local-model test).
async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  const supabase = getSupabaseAdmin();

  if (name === "search_catalog") {
    const items = await searchCatalog(supabase, args.query as string, args.category as string | undefined);
    return JSON.stringify(
      items.map((i) => ({ id: i.id, name: i.name, price_paise: i.price_paise, pairs_well_with: i.pairs_well_with }))
    );
  }

  if (name === "propose_cart") {
    let items = args.items;
    // Known bug from llama3.1:8b: items sent as a JSON string instead of array.
    if (typeof items === "string") {
      try {
        items = JSON.parse(items);
      } catch {
        return "ERROR: items field was a string and not valid JSON either.";
      }
    }
    if (!Array.isArray(items)) return "ERROR: items field is not an array.";

    const ids = (items as { catalog_id: string }[]).map((i) => i.catalog_id).filter(Boolean);
    const catalogMap = await getCatalogByIds(supabase, ids);
    const resolved = (items as { catalog_id: string; qty: number; reason: string }[]).map((i) => ({
      catalog_id: i.catalog_id,
      name: catalogMap.get(i.catalog_id)?.name ?? "UNKNOWN_ID",
      qty: i.qty,
      reason: i.reason,
      found_in_catalog: catalogMap.has(i.catalog_id),
    }));
    return JSON.stringify({ cart: resolved });
  }

  if (name === "create_order") {
    return JSON.stringify({ note: "TEST MODE: create_order would run guardrail checks + Razorpay here. Not executed in this test." });
  }

  return "ERROR: unknown tool";
}

function analyzeCart(messages: OllamaMessage[]) {
  const proposeCartCall = messages.find(
    (m) => m.tool_calls?.some((tc) => tc.function.name === "propose_cart")
  );
  const createOrderCall = messages.find(
    (m) => m.tool_calls?.some((tc) => tc.function.name === "create_order")
  );
  return {
    calledProposeCart: Boolean(proposeCartCall),
    calledCreateOrder: Boolean(createOrderCall),
    calledCreateOrderBeforePropose:
      Boolean(createOrderCall) &&
      !Boolean(proposeCartCall) ,
  };
}

async function main() {
  const model = process.argv[2];
  if (!model) {
    console.error("Usage: npx tsx scripts/test-ollama-full-loop.ts <model-name>");
    process.exit(1);
  }

  const userMessage = "Give me two masala chai and a samosa, and yes go ahead and pay";
  console.log(`Model: ${model}`);
  console.log(`User: "${userMessage}"\n`);

  const messages: OllamaMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const reply = await callOllama(model, messages);
    messages.push(reply);

    if (!reply.tool_calls || reply.tool_calls.length === 0) {
      console.log(`[turn ${i}] final text reply: "${reply.content}"`);
      break;
    }

    for (const call of reply.tool_calls) {
      console.log(`[turn ${i}] tool_call: ${call.function.name}(${JSON.stringify(call.function.arguments)})`);
      const result = await executeTool(call.function.name, call.function.arguments);
      console.log(`[turn ${i}]   -> ${result.slice(0, 300)}`);
      messages.push({ role: "tool", content: result } as OllamaMessage);
    }
  }

  const analysis = analyzeCart(messages);
  console.log("\n--- Analysis ---");
  console.log(`Called propose_cart at any point: ${analysis.calledProposeCart}`);
  console.log(`Called create_order at any point: ${analysis.calledCreateOrder}`);
  console.log(
    `VERDICT: ${
      analysis.calledCreateOrder && !analysis.calledProposeCart
        ? "FAIL - jumped to create_order without ever building a cart with reasons"
        : analysis.calledCreateOrder && analysis.calledProposeCart
        ? "PASS - completed the correct sequence (cart built, then order created)"
        : "INCOMPLETE - never reached create_order within iteration limit"
    }`
  );
}

main();
