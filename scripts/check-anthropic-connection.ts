/**
 * One-off connectivity check for ANTHROPIC_API_KEY — sends the smallest
 * possible request to confirm the key is valid AND has billing/credit
 * behind it, before assuming the full orchestrator will work.
 *
 * Run: npx tsx scripts/check-anthropic-connection.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { getAnthropicClient, CLAUDE_MODEL } from "../lib/claude";

async function main() {
  const anthropic = getAnthropicClient();
  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 10,
      messages: [{ role: "user", content: "Reply with exactly: OK" }],
    });
    const text = response.content.find((b) => b.type === "text");
    console.log("CONNECTED to Anthropic API successfully.");
    console.log("Model replied:", text && "text" in text ? text.text : "(no text block)");
    console.log("Usage:", response.usage);
  } catch (err) {
    console.error("CONNECTION FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
