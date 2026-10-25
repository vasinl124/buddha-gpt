// Which model answers: OpenRouter when there's a key, otherwise a mock that cites the top passages,
// so the whole turn (search, checks, cards, UI) can be tried before a key exists.
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { simulateReadableStream, type LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";

export const modelId = () => process.env.AGENT_MODEL || "deepseek/deepseek-v4-flash-0731";

/** The OpenRouter model, or null without a key. */
export function guardModel(): LanguageModel | null {
  const apiKey = process.env.OPENROUTER_API_KEY;
  // require_parameters: route only to providers that honour tools and schemas, never drop them silently
  return apiKey ? createOpenRouter({ apiKey })(modelId(), { provider: { require_parameters: true } }) : null;
}

/** quote: Pali mode, where the reply names passages as [[quote:ID]] instead of citing them. */
export function chatModel(topIds: () => string[], quote = false): { model: LanguageModel; mock: boolean } {
  const model = guardModel();
  return model ? { model, mock: false } : { model: mockModel(topIds, quote), mock: true };
}

// The mock replies with fixed sentences, in the language the turn asks for, that cite (or in Pali
// mode quote) the first two passages retrieved this turn.
function mockModel(topIds: () => string[], quote: boolean): LanguageModel {
  return new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      const [a, b] = topIds();
      const thai = JSON.stringify(prompt).includes("Reply in Thai.");
      const text = quote
        ? [a, b].filter(Boolean).map((id) => `[[quote:${id}]]`).join(" ")
        : !a
          ? thai
            ? "นี่คือคำตอบจำลอง และไม่พบข้อความที่ตรงกับคำถามของท่าน"
            : "This is a mock reply, and no passage matched your question."
          : thai
            ? `นี่คือคำตอบจำลอง เพิ่ม OPENROUTER_API_KEY ในไฟล์ .env เพื่อคำตอบจริง ข้อความด้านล่างคือข้อความที่คำถามของท่านค้นพบ [[cite:${a}]]` +
              (b ? ` และข้อความนี้ด้วย [[cite:${b}]]` : "")
            : `This is a mock reply: add OPENROUTER_API_KEY to .env for a real one. ` +
              `The passages below are the ones your question found. [[cite:${a}]]` +
              (b ? ` Read this one too. [[cite:${b}]]` : "");
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
