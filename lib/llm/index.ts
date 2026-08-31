import type { LLMProvider } from "./types";
import { AnthropicProvider } from "./anthropic-provider";
import { OllamaProvider } from "./ollama-provider";
import { GeminiProvider } from "./gemini-provider";

export type { ConvMessage, ToolCallRequest, ToolDefinition, ModelTurnResult, LLMProvider } from "./types";

// Switching providers is a single env var — LLM_PROVIDER=ollama (default),
// "anthropic", or "gemini" — never a code change. See DECISIONS.md D-3.
export function getLLMProvider(): LLMProvider {
  const provider = (process.env.LLM_PROVIDER || "ollama").toLowerCase();

  if (provider === "anthropic") return new AnthropicProvider();
  if (provider === "ollama") return new OllamaProvider();
  if (provider === "gemini") return new GeminiProvider();

  throw new Error(`Unknown LLM_PROVIDER "${provider}" — expected "ollama", "anthropic", or "gemini".`);
}
