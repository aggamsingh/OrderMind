import type { ConvMessage, LLMProvider, ModelTurnResult, ToolDefinition } from "./types";

type OllamaWireMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
};

type OllamaChatResponse = {
  message: OllamaWireMessage;
};

function toOllamaTools(tools: ToolDefinition[]) {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

function toOllamaMessages(systemPrompt: string, history: ConvMessage[]): OllamaWireMessage[] {
  const messages: OllamaWireMessage[] = [{ role: "system", content: systemPrompt }];

  for (const m of history) {
    if (m.role === "user") {
      messages.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      messages.push({
        role: "assistant",
        content: m.content,
        tool_calls: m.toolCalls.map((tc) => ({ function: { name: tc.name, arguments: tc.input } })),
      });
    } else if (m.role === "tool_results") {
      // Ollama expects one message per tool result, not a combined block.
      for (const r of m.results) {
        messages.push({ role: "tool", content: r.content });
      }
    }
  }

  return messages;
}

function getOllamaBaseUrl() {
  return process.env.OLLAMA_BASE_URL || "http://localhost:11434";
}

function getOllamaModel() {
  const model = process.env.OLLAMA_MODEL;
  if (!model) {
    throw new Error("Missing OLLAMA_MODEL in .env.local (e.g. 'qwen2:7b').");
  }
  return model;
}

export class OllamaProvider implements LLMProvider {
  async runTurn(params: {
    systemPrompt: string;
    tools: ToolDefinition[];
    history: ConvMessage[];
  }): Promise<ModelTurnResult> {
    const res = await fetch(`${getOllamaBaseUrl()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: getOllamaModel(),
        messages: toOllamaMessages(params.systemPrompt, params.history),
        tools: toOllamaTools(params.tools),
        stream: false,
      }),
    });

    if (!res.ok) {
      throw new Error(`Ollama request failed: HTTP ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as OllamaChatResponse;
    const rawToolCalls = data.message.tool_calls ?? [];

    return {
      textReply: data.message.content ?? "",
      toolCalls: rawToolCalls.map((tc, i) => ({
        // Ollama doesn't assign tool_call ids the way Anthropic does — we
        // mint one so the rest of the orchestrator (which correlates tool
        // results back by id) doesn't need to know which provider ran.
        id: `ollama-call-${Date.now()}-${i}`,
        name: tc.function.name,
        input: tc.function.arguments,
      })),
    };
  }
}
