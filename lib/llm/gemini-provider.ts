import { GoogleGenAI, FunctionCallingConfigMode, type Content, type FunctionDeclaration } from "@google/genai";
import type { ConvMessage, LLMProvider, ModelTurnResult, ToolDefinition } from "./types";

// gemini-3.6-flash's free tier is only 20 requests/DAY (confirmed by hitting
// the real quota-exhausted error — see BUILD_LOG.md). CORRECTION (2026-08-31,
// see DECISIONS.md D-5): flash-lite-latest was previously assumed to have "a
// separate, much larger quota pool" than 3.6-flash — the AI Studio rate-limit
// dashboard disproves that: both models plateaued at the same ~20-22
// requests/day and dropped together, not flash-lite outlasting 3.6-flash.
// Kept as the default anyway (still free, still connects live as of this
// correction) but the daily-budget headroom this comment used to claim is
// NOT confirmed — re-check aistudio.google.com/rate-limit before assuming
// slack is available during a live demo.
const MODEL = "gemini-flash-lite-latest";

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

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: toGeminiContents(params.history),
      config: {
        systemInstruction: params.systemPrompt,
        tools: [{ functionDeclarations: toGeminiTools(params.tools) }],
        toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
      },
    });

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
