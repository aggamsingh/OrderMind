/**
 * Provider-agnostic conversation format. lib/orchestrator.ts and the
 * `sessions.messages` column store history in THIS shape, never in a
 * provider's own wire format — that's what makes swapping providers
 * (Ollama <-> Claude) a config change instead of a data migration.
 * See DECISIONS.md D-3.
 */

export type ToolCallRequest = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  // Opaque, provider-specific data that must round-trip unchanged when this
  // tool call is echoed back into history on the next request — e.g.
  // Gemini's thoughtSignature (see gemini-provider.ts). Other providers
  // ignore it. Never inspect or mutate the contents from orchestrator.ts.
  providerMeta?: Record<string, unknown>;
};

export type ConvMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls: ToolCallRequest[] }
  | { role: "tool_results"; results: { toolCallId: string; toolName: string; content: string }[] };

// JSON-schema tool definitions, in Anthropic's shape — this is the project's
// one canonical tool-schema format (lib/claude.ts TOOLS); each provider
// adapter converts it to its own wire format internally.
export type ToolDefinition = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type ModelTurnResult = {
  textReply: string;
  toolCalls: ToolCallRequest[];
};

export interface LLMProvider {
  runTurn(params: {
    systemPrompt: string;
    tools: ToolDefinition[];
    history: ConvMessage[];
  }): Promise<ModelTurnResult>;
}
