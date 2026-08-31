import { GoogleGenAI, FunctionCallingConfigMode, type Content, type FunctionDeclaration } from "@google/genai";
import type { ConvMessage, LLMProvider, ModelTurnResult, ToolDefinition } from "./types";

/**
 * Model fallback chain — the fix for this project's single biggest live-demo
 * risk (DECISIONS.md D-9).
 *
 * The free tier caps at 15 requests per MINUTE per model (confirmed from a
 * real 429 body — D-5), and one customer turn can burn 2-4 calls because of
 * the tool loop. A judge sending a few messages in quick succession could
 * therefore stall the demo for ~55 seconds. That is unacceptable for a live
 * pitch and cannot be fixed by hoping.
 *
 * The lever is a fact this project established empirically rather than
 * assumed: Gemini quotas are enforced PER MODEL. So exhausting one model
 * does not exhaust the next, and rotating on 429 multiplies the effective
 * budget by the length of this chain.
 *
 * Every model listed here was verified callable against the real API before
 * being added — no plausible-looking guesses (this project has been burned by
 * an invented model name before, see BUILD_LOG.md Day 2). Order is best
 * capability first: only fall back when actually forced to.
 */
const MODEL_CHAIN = ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-3.6-flash"] as const;

/** True for the quota-exhaustion error specifically, not any failure. */
function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED");
}

function toGeminiTools(tools: ToolDefinition[]): FunctionDeclaration[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parametersJsonSchema: t.input_schema,
  }));
}

function toGeminiContents(history: ConvMessage[]): Content[] {
  const contents: Content[] = [];

  for (const m of history) {
    if (m.role === "user") {
      contents.push({ role: "user", parts: [{ text: m.content }] });
    } else if (m.role === "assistant") {
      const parts: Content["parts"] = [];
      if (m.content) parts!.push({ text: m.content });
      for (const tc of m.toolCalls) {
        // thoughtSignature must be echoed back byte-for-byte on the Part
        // that carries the functionCall, or Gemini rejects the next request
        // with "Function call is missing a thought_signature" — confirmed
        // by hitting that exact error. See ToolCallRequest.providerMeta.
        parts!.push({
          functionCall: { id: tc.id, name: tc.name, args: tc.input },
          thoughtSignature: tc.providerMeta?.thoughtSignature as string | undefined,
        });
      }
      contents.push({ role: "model", parts });
    } else if (m.role === "tool_results") {
      // Gemini's Content.role is only "user" or "model" (no separate "tool"
      // role) — function responses go back as a "user" turn, confirmed
      // directly from @google/genai's own type definitions (the public docs
      // were inconsistent on this point).
      contents.push({
        role: "user",
        parts: m.results.map((r) => ({
          functionResponse: { id: r.toolCallId, name: r.toolName, response: { output: r.content } },
        })),
      });
    }
  }

  return contents;
}

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY in .env.local.");
  }
  return new GoogleGenAI({ apiKey });
}

export class GeminiProvider implements LLMProvider {
  async runTurn(params: {
    systemPrompt: string;
    tools: ToolDefinition[];
    history: ConvMessage[];
  }): Promise<ModelTurnResult> {
    const ai = getGeminiClient();
    const request = {
      contents: toGeminiContents(params.history),
      config: {
        systemInstruction: params.systemPrompt,
        tools: [{ functionDeclarations: toGeminiTools(params.tools) }],
        toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
      },
    };

    // Walk the chain on quota exhaustion only. Any other failure (a bad
    // request, an auth problem, a malformed tool schema) is a real bug and
    // must surface immediately rather than being retried three times against
    // three models and reported as the last model's error.
    let response;
    let lastQuotaError: unknown;
    for (const model of MODEL_CHAIN) {
      try {
        response = await ai.models.generateContent({ model, ...request });
        break;
      } catch (err) {
        if (!isQuotaError(err)) throw err;
        lastQuotaError = err;
        console.warn(`[gemini] ${model} is rate-limited; falling back to the next model in the chain.`);
      }
    }

    if (!response) {
      throw new Error(
        `All Gemini models in the fallback chain are rate-limited (${MODEL_CHAIN.join(", ")}). ` +
          `Last error: ${lastQuotaError instanceof Error ? lastQuotaError.message : String(lastQuotaError)}`
      );
    }

    // Read raw parts, not the response.functionCalls convenience getter —
    // that getter strips thoughtSignature, which lives on the Part
    // alongside functionCall, not on FunctionCall itself.
    const rawParts = response.candidates?.[0]?.content?.parts ?? [];
    const toolCalls = rawParts
      .filter((p) => p.functionCall)
      .map((p, i) => ({
        // Gemini's FunctionCall.id is optional and often absent — mint one
        // when missing so the orchestrator always has something to
        // correlate the tool_result back to, same as ollama-provider.ts.
        id: p.functionCall!.id ?? `gemini-call-${Date.now()}-${i}`,
        name: p.functionCall!.name ?? "unknown",
        input: (p.functionCall!.args ?? {}) as Record<string, unknown>,
        providerMeta: p.thoughtSignature ? { thoughtSignature: p.thoughtSignature } : undefined,
      }));

    return {
      textReply: response.text ?? "",
      toolCalls,
    };
  }
}
