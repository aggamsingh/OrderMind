/**
 * Empirical test — not a guess — of whether a local Ollama model can handle
 * this project's actual tool schema reliably and fast enough for a live demo.
 *
 * Converts lib/claude.ts's TOOLS (Anthropic format) to OpenAI/Ollama function-
 * calling format, sends a handful of realistic customer messages against
 * Ollama's native /api/chat endpoint, and reports per-call latency plus
 * whether the tool call it produced is valid against our actual schema.
 *
 * Run: npx tsx scripts/test-ollama-toolcalling.ts <model-name>
 * e.g. npx tsx scripts/test-ollama-toolcalling.ts llama3.2:3b
 */
import { TOOLS, SYSTEM_PROMPT } from "../lib/claude";

const OLLAMA_URL = "http://localhost:11434/api/chat";

function toOllamaTools() {
  return TOOLS.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

const TEST_PROMPTS = [
  "I want something warm and not too sweet",
  "Give me two masala chai and a samosa, and yes go ahead and pay",
  "Can I get a burger and fries?", // not in catalog — tests hallucination resistance
];

type OllamaResponse = {
  message: {
    role: string;
    content: string;
    tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  };
  total_duration?: number; // nanoseconds
  eval_count?: number;
  eval_duration?: number;
};

async function callOllama(model: string, userMessage: string) {
  const start = Date.now();
  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      tools: toOllamaTools(),
      stream: false,
    }),
  });
  const wallClockMs = Date.now() - start;

  if (!res.ok) {
    throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as OllamaResponse;
  return { data, wallClockMs };
}

function validateToolCall(name: string, args: Record<string, unknown>): string[] {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return [`unknown tool name: ${name}`];

  const required = (tool.input_schema as { required?: string[] }).required ?? [];
  const problems: string[] = [];
  for (const field of required) {
    if (!(field in args)) problems.push(`missing required field '${field}'`);
  }
  return problems;
}

async function main() {
  const model = process.argv[2];
  if (!model) {
    console.error("Usage: npx tsx scripts/test-ollama-toolcalling.ts <model-name>");
    process.exit(1);
  }

  console.log(`Testing model: ${model}\n`);

  for (const prompt of TEST_PROMPTS) {
    console.log(`--- Prompt: "${prompt}" ---`);
    try {
      const { data, wallClockMs } = await callOllama(model, prompt);
      const toolsPerSec =
        data.eval_count && data.eval_duration
          ? (data.eval_count / (data.eval_duration / 1e9)).toFixed(1)
          : "n/a";

      console.log(`  wall-clock time: ${(wallClockMs / 1000).toFixed(1)}s | tokens/sec: ${toolsPerSec}`);

      if (data.message.tool_calls && data.message.tool_calls.length > 0) {
        for (const call of data.message.tool_calls) {
          const problems = validateToolCall(call.function.name, call.function.arguments);
          console.log(`  tool_call: ${call.function.name}(${JSON.stringify(call.function.arguments)})`);
          console.log(`  valid: ${problems.length === 0 ? "YES" : "NO - " + problems.join("; ")}`);
        }
      } else {
        console.log(`  NO tool call made. Text reply: "${data.message.content}"`);
      }
    } catch (err) {
      console.log(`  FAILED: ${err instanceof Error ? err.message : err}`);
    }
    console.log();
  }
}

main();
