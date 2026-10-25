// Which model answers: OpenRouter when there's a key, otherwise a mock that cites the top passages,
// so the whole turn (search, checks, cards, UI) can be tried before a key exists.
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { simulateReadableStream, type LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";

export const modelId = () => process.env.AGENT_MODEL || "anthropic/claude-opus-5.5";

export function chatModel(topIds: () => string[]): { model: LanguageModel; mock: boolean } {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (apiKey) {
    // require_parameters: route only to providers that honour tools, never drop them silently
    return { model: createOpenRouter({ apiKey })(modelId(), { provider: { require_parameters: true } }), mock: false };
  }
  return { model: mockModel(topIds), mock: true };
}

// The mock replies with fixed sentences that cite the first two passages retrieved this turn.
function mockModel(topIds: () => string[]): LanguageModel {
  return new MockLanguageModelV4({
    doStream: async () => {
      const [a, b] = topIds();
      const text = a
        ? `This is a mock reply: add OPENROUTER_API_KEY to .env for a real one. ` +
          `The passages below are the ones your question found. [[cite:${a}]]` +
          (b ? ` Read this one too. [[cite:${b}]]` : "")
        : "This is a mock reply, and no passage matched your question.";
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "mock" },
            ...text.split(/(?<= )/).map((delta) => ({ type: "text-delta" as const, id: "mock", delta })),
            { type: "text-end", id: "mock" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: undefined },
              usage: {
                inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 0, text: 0, reasoning: undefined },
              },
            },
          ],
        }),
      };
    },
  });
}
