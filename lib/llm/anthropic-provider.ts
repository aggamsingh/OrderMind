import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient, CLAUDE_MODEL } from "../claude";
import type { ConvMessage, LLMProvider, ModelTurnResult, ToolDefinition } from "./types";

function toAnthropicMessages(history: ConvMessage[]): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [];

  for (const m of history) {
    if (m.role === "user") {
      messages.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      const content: Anthropic.ContentBlockParam[] = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls) {
        content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
      }
      messages.push({ role: "assistant", content });
    } else if (m.role === "tool_results") {
      // Anthropic requires every tool_result from one assistant turn to land
      // in a single user message — never split across multiple messages.
      messages.push({
        role: "user",
        content: m.results.map((r) => ({
          type: "tool_result" as const,
          tool_use_id: r.toolCallId,
          content: r.content,
        })),
      });
    }
  }

  return messages;
}

export class AnthropicProvider implements LLMProvider {
  async runTurn(params: {
    systemPrompt: string;
    tools: ToolDefinition[];
    history: ConvMessage[];
  }): Promise<ModelTurnResult> {
    const anthropic = getAnthropicClient();

    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system: [{ type: "text", text: params.systemPrompt, cache_control: { type: "ephemeral" } }],
      tools: params.tools as Anthropic.Tool[],
      messages: toAnthropicMessages(params.history),
    });

    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    return {
      textReply: textBlocks.map((b) => b.text).join("\n"),
      toolCalls: toolUseBlocks.map((b) => ({
        id: b.id,
        name: b.name,
        input: b.input as Record<string, unknown>,
      })),
    };
  }
}
