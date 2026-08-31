/**
 * Verifies every model in gemini-provider.ts's fallback chain is actually
 * callable right now.
 *
 * Worth its own script because a fallback chain is the kind of thing that
 * rots silently: Google deprecates model names regularly (this project has
 * already had `gemini-2.0-flash` and `gemini-2.5-flash-lite` go 404 mid-build),
 * and a chain whose backups have quietly become invalid provides exactly zero
 * protection — while still *looking* like a safety net right up until the
 * moment a live demo needs it.
 *
 * Run before a demo: npx tsx scripts/check-gemini-chain.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { GoogleGenAI } from "@google/genai";

// Kept in sync by hand with MODEL_CHAIN in lib/llm/gemini-provider.ts.
const MODEL_CHAIN = ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-3.6-flash"];

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Missing GEMINI_API_KEY in .env.local.");
    process.exit(1);
  }
  const ai = new GoogleGenAI({ apiKey });

  let healthy = 0;
  let quotaLimited = 0;
  let broken = 0;

  for (const model of MODEL_CHAIN) {
    try {
      const res = await ai.models.generateContent({ model, contents: "Reply with exactly: OK" });
      console.log(`  OK        ${model.padEnd(26)} → ${(res.text ?? "").trim().slice(0, 12)}`);
      healthy += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) {
        // Not a failure of the chain — this is exactly the case the chain exists for.
        console.log(`  QUOTA     ${model.padEnd(26)} → rate-limited right now, chain will skip it`);
        quotaLimited += 1;
      } else if (msg.includes("404") || msg.includes("NOT_FOUND")) {
        console.log(`  DEAD      ${model.padEnd(26)} → model no longer exists, REMOVE IT FROM THE CHAIN`);
        broken += 1;
      } else {
        console.log(`  ERROR     ${model.padEnd(26)} → ${msg.slice(0, 90)}`);
        broken += 1;
      }
    }
  }

  console.log(
    `\n${healthy} healthy · ${quotaLimited} rate-limited · ${broken} broken (of ${MODEL_CHAIN.length})`
  );

  if (broken > 0) {
    console.error("A model in the chain is dead or erroring — fix the chain before relying on it.");
    process.exit(1);
  }
  if (healthy === 0) {
    console.error("Every model is rate-limited right now. Wait ~60s before demoing.");
    process.exit(1);
  }
  console.log("Fallback chain is sound.");
}

main();
