/**
 * Provider-agnostic full-loop test — exercises the REAL lib/llm/ provider
 * code (not a reimplementation like the earlier Ollama-only test scripts),
 * against the real Supabase catalog, for whichever LLM_PROVIDER is set.
 * This is as close to the real orchestrator as a test gets without also
 * involving Razorpay.
 *
 * Run: LLM_PROVIDER=gemini npx tsx scripts/test-provider-full-loop.ts
 *      LLM_PROVIDER=ollama npx tsx scripts/test-provider-full-loop.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { getLLMProvider, type ConvMessage } from "../lib/llm";
import { SYSTEM_PROMPT, TOOLS } from "../lib/claude";
import { getSupabaseAdmin } from "../lib/supabase";
import { searchCatalog, getCatalogByIds } from "../lib/catalog";

const MAX_ITERATIONS = 6;

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

async function main() {
  const providerName = process.env.LLM_PROVIDER || "ollama";
  const userMessage = process.argv[2] || "Give me two masala chai and a samosa, and yes go ahead and pay";

  console.log(`Provider: ${providerName}`);
  console.log(`User: "${userMessage}"\n`);

  const provider = getLLMProvider();
  const history: ConvMessage[] = [{ role: "user", content: userMessage }];

  const start = Date.now();
  let calledProposeCart = false;
  let calledCreateOrder = false;
  let calledSearchBeforeCart = false;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const turnStart = Date.now();
    const turn = await provider.runTurn({ systemPrompt: SYSTEM_PROMPT, tools: TOOLS, history });
    const turnMs = Date.now() - turnStart;

    history.push({ role: "assistant", content: turn.textReply, toolCalls: turn.toolCalls });

    if (turn.toolCalls.length === 0) {
      console.log(`[turn ${i}, ${(turnMs / 1000).toFixed(1)}s] final text reply: "${turn.textReply}"`);
      break;
    }

    const results: { toolCallId: string; toolName: string; content: string }[] = [];
    for (const call of turn.toolCalls) {
      console.log(`[turn ${i}, ${(turnMs / 1000).toFixed(1)}s] tool_call: ${call.name}(${JSON.stringify(call.input)})`);
      if (call.name === "search_catalog") calledSearchBeforeCart = true;
      if (call.name === "propose_cart") calledProposeCart = true;
      if (call.name === "create_order") calledCreateOrder = true;

      const result = await executeTool(call.name, call.input);
      console.log(`  -> ${result.slice(0, 250)}`);
      results.push({ toolCallId: call.id, toolName: call.name, content: result });
    }

    history.push({ role: "tool_results", results });
  }

  const totalMs = Date.now() - start;
  console.log("\n--- Analysis ---");
  console.log(`Total wall-clock time: ${(totalMs / 1000).toFixed(1)}s`);
  console.log(`Searched before building cart: ${calledSearchBeforeCart}`);
  console.log(`Called propose_cart: ${calledProposeCart}`);
  console.log(`Called create_order: ${calledCreateOrder}`);
  console.log(
    `VERDICT: ${
      calledCreateOrder && calledProposeCart
        ? "PASS — completed the correct sequence"
        : calledCreateOrder && !calledProposeCart
        ? "FAIL — jumped to create_order without building a cart"
        : "INCOMPLETE — never reached create_order"
    }`
  );
}

main();
