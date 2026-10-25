// One chat turn (PRD §9): search first in code, then the model with tools, then every sentence
// through the checks, then the cards, filled verbatim from the database.
import { readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import type { ChatData } from "@buddha-gpt/shared";
import {
  convertToModelMessages,
  createUIMessageStream,
  isStepCount,
  pipeUIMessageStreamToResponse,
  streamText,
  tool,
  type ModelMessage,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { SentenceGate, fold, isThai } from "./checks.ts";
import * as core from "./core.ts";
import { chatModel } from "./model.ts";

export type BuddhaMessage = UIMessage<never, ChatData>;

const PROMPT = readFileSync(new URL("../../../prompts/buddha.md", import.meta.url), "utf8");
const HISTORY = 20; // the last 10 turns (PRD §9)
const MAX_STEPS = 4; // the last one has no tools, so the model has to answer

const DONT_KNOW = {
  en: "The discourses I can search don't cover this.",
  th: "พระสูตรที่เราค้นได้ไม่ได้กล่าวถึงเรื่องนี้",
};

export async function chat(messages: BuddhaMessage[], res: ServerResponse): Promise<void> {
  const history = messages.slice(-HISTORY).map(escapeUser);
  const question = textOf(history.findLast((m) => m.role === "user"));
  const lang = isThai(question) ? "th" : "en";

  // passages retrieved this turn, by ID: the only ones a reply may cite
  const known = new Map<string, string>();
  const order: string[] = [];
  const remember = (ps: core.Passage[]) => {
    for (const p of ps) {
      if (!known.has(p.id)) order.push(p.id);
      known.set(p.id, fold(p.text));
    }
    return ps.map(({ id, sutta_id, text }) => ({ id, sutta_id, text }));
  };

  let note = "Retrieval: ok.";
  let passages: core.Passage[] = [];
  try {
    passages = await core.search(question, 8);
  } catch (err) {
    console.error("search:", err);
    note = "Retrieval: unavailable right now. Say you can't recall the exact words, never that the texts are silent.";
  }
  remember(passages);

  const tools = {
    search_canon: tool({
      description: "Search the Pali Canon (English translations and the Pali) for passages you can cite by ID.",
      inputSchema: z.object({ query: z.string().describe("what to look for: a question, words or Pali terms") }),
      execute: async ({ query }) => remember(await core.search(query, 8)),
    }),
    get_passage: tool({
      description: "Read a passage with the paragraphs around it, by its ID.",
      inputSchema: z.object({ id: z.string(), window: z.number().int().min(0).max(3).optional() }),
      execute: async ({ id, window }) => remember(await core.passage(id, window ?? 1)),
    }),
  };

  const { model, mock } = chatModel(() => order);
  const turn = [
    `Reply in ${lang === "th" ? "Thai" : "English"}. ${note}`,
    `<passages nonce="${crypto.randomUUID().slice(0, 8)}">`,
    ...passages.map((p) => `[${p.id}] ${p.text}`),
    "</passages>",
  ].join("\n");

  const result = streamText({
    model,
    instructions: PROMPT, // stable, so it can be cached; this turn's passages ride on the message
    messages: withTurn(await convertToModelMessages(history), turn),
    tools,
    stopWhen: isStepCount(MAX_STEPS),
    prepareStep: ({ stepNumber }) => (stepNumber === MAX_STEPS - 1 ? { activeTools: [] } : {}),
    providerOptions: { openrouter: { reasoning: { effort: "low" } } },
  });

  const stream = createUIMessageStream<BuddhaMessage>({
    async execute({ writer }) {
      writer.write({ type: "start" });
      if (mock) writer.write({ type: "data-notice", data: "Mock model: add OPENROUTER_API_KEY for real answers." });
      const id = "reply";
      writer.write({ type: "text-start", id });
      const gate = new SentenceGate(known);
      for await (const part of result.stream) {
        if (part.type === "text-delta") {
          for (const s of gate.push(part.text)) writer.write({ type: "text-delta", id, delta: s });
        } else if (part.type === "finish-step") {
          for (const s of gate.endStep(part.finishReason === "tool-calls")) writer.write({ type: "text-delta", id, delta: s });
        } else if (part.type === "error") {
          throw part.error;
        }
      }
      const end = gate.end();
      for (const s of end.released) writer.write({ type: "text-delta", id, delta: s });
      if (!end.grounded) {
        // ponytail: until the guard routes greetings (Phase 3), a short uncited reply counts as chat
        const held = gate.heldText();
        const chatty = held.trim().split(/\s+/).length <= 40 && !held.includes("“") && !held.includes('"');
        writer.write({ type: "text-delta", id, delta: chatty ? held : DONT_KNOW[lang] });
      }
      writer.write({ type: "text-end", id });
      if (gate.dropped.length || gate.strippedIds.length) {
        console.warn(`checks: dropped ${gate.dropped.length} sentences, stripped ${gate.strippedIds.length} citations`);
      }
      writer.write({ type: "data-cards", data: await core.cards(end.cited).catch(() => []) });
      writer.write({ type: "finish" });
    },
    onError: (err) => {
      console.error("chat:", err);
      return lang === "th" ? "ขออภัย ตอนนี้ตอบไม่ได้ ลองใหม่อีกครั้ง" : "Sorry, I can't answer right now. Please try again.";
    },
  });
  await pipeUIMessageStreamToResponse({ response: res, stream });
}

// History comes from the browser, so user text can't open a tag or a citation marker (PRD §9).
function escapeUser(m: BuddhaMessage): BuddhaMessage {
  if (m.role !== "user") return m;
  const esc = (s: string) => s.replaceAll("[[", "[ [").replaceAll("]]", "] ]").replaceAll("<", "‹").replaceAll(">", "›");
  return { ...m, parts: m.parts.map((p) => (p.type === "text" ? { ...p, text: esc(p.text) } : p)) };
}

function textOf(m: BuddhaMessage | undefined): string {
  return (m?.parts ?? []).map((p) => (p.type === "text" ? p.text : "")).join(" ").trim();
}

// Adds this turn's note and passages to the last user message, after the stable history.
function withTurn(messages: ModelMessage[], turn: string): ModelMessage[] {
  const i = messages.findLastIndex((m) => m.role === "user");
  if (i < 0) return messages;
  const m = messages[i];
  const content = typeof m.content === "string" ? [{ type: "text" as const, text: m.content }] : m.content;
  const out = [...messages];
  out[i] = { role: "user", content: [...content, { type: "text", text: turn }] } as ModelMessage;
  return out;
}
