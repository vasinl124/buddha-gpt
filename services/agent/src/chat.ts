// One chat turn (PRD §9): the guard routes it, code searches, the model replies (with tools when it
// answers), every sentence passes the checks, and the cards are filled verbatim from the database.
import { readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import type { Card, ChatData, Crisis } from "@buddha-gpt/shared";
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
import { crisisKeyword, guard, type Guard, type Route } from "./guard.ts";
import { chatModel, modelId } from "./model.ts";
import { policy } from "./policy.ts";

export type BuddhaMessage = UIMessage<never, ChatData>;
type Lang = "en" | "th";

const PROMPT = readFileSync(new URL("../../../prompts/buddha.md", import.meta.url), "utf8");
const QUOTE = /\[\[quote:([^\]\s]+)\]\]/g; // Pali mode names a passage this way; code writes it out
const HISTORY = 20; // the last 10 turns (PRD §9)
const MAX_STEPS = 4; // the last one has no tools, so the model has to answer
// per call: a reply is under 120 words, and the rest is room for low-effort reasoning. Without a cap,
// OpenRouter reserves the model's whole output limit (65,536 tokens) against the account's credit.
const MAX_OUTPUT = 2000;

// The replies code writes itself, in his voice. "I don't recall" is honest: a search that finds
// nothing doesn't show that the texts are silent.
const TEXT = {
  dontKnow: { en: "I don't recall teaching about this.", th: "เรานึกไม่ออกว่าเคยแสดงธรรมเรื่องนี้ไว้" },
  // retrieval is down: honest about the failure, never claiming the texts are silent (PRD §9)
  cantRecall: {
    en: "I can't recall the exact words right now. Please ask again in a little while.",
    th: "ตอนนี้เรายังนึกถ้อยคำที่แน่ชัดไม่ออก ลองถามใหม่อีกสักครู่",
  },
  // a crisis turn whose reply failed: the hotlines still show (PRD §9)
  crisis: {
    en: "I'm here with you. You don't have to carry this alone. Please reach out now to one of the people below.",
    th: "เราอยู่ตรงนี้กับท่าน ท่านไม่ต้องแบกเรื่องนี้ไว้ลำพัง โปรดติดต่อผู้ที่ช่วยได้ด้านล่างนี้ทันที",
  },
  crisisTitle: { en: "If you might be in danger, please reach out now", th: "หากท่านอาจตกอยู่ในอันตราย โปรดติดต่อทันที" },
  quoteFound: { en: "Yes, those words are among my teachings.", th: "ใช่ ถ้อยคำนั้นอยู่ในคำสอนของเรา" },
  quoteSimilar: { en: "Not in those words, but I taught something close.", th: "ไม่ใช่ด้วยถ้อยคำนั้น แต่เราเคยสอนเรื่องที่ใกล้เคียงกัน" },
  quoteNone: { en: "I don't recall saying those words.", th: "เรานึกไม่ออกว่าเคยกล่าวถ้อยคำนั้น" },
};

// What the reply model is told for each route, in this turn's note.
const NOTE: Record<Route, string> = {
  crisis:
    "Route: crisis. The person may be in danger. Reply in plain, warm words, with no simile, no teaching and no citation. " +
    "Don't write phone numbers or links: the app shows the right ones under your reply.",
  decline: "Route: decline. In one or two kind sentences, say you won't do what was asked. If a passage is given, point to its teaching and cite it.",
  redirect: "Route: redirect. In one line, say what you can help with: the teachings, and what weighs on the person.",
  chat: "Route: chat. Reply briefly and warmly, in one or two sentences, with no citation.",
  answer: "Route: answer.",
};

/** evalMode answers with one JSON object (the reply, its cards, and a debug block) instead of a
 * stream, for `buddha eval` (PRD §10). */
export async function chat(messages: BuddhaMessage[], res: ServerResponse, evalMode = false): Promise<void> {
  const history = untrusted(messages);
  const latest = textOf(history.findLast((m) => m.role === "user"));
  const modelMessages = await convertToModelMessages(history);

  // crisis words skip the guard, so the hotlines show without waiting for a model call
  const g: Guard = crisisKeyword(latest)
    ? { route: "crisis", decline_topic: null, search_query: latest, quote: "", reply_lang: null }
    : await guard(modelMessages, latest);
  const route: Route = g.route;
  // the reply language (PRD §5.1): the one the person asked for, else the message's own. Pali mode
  // keeps the person's language for everything that isn't a quote
  const asked = g.reply_lang;
  const lang: Lang = asked === "en" || asked === "th" ? asked : isThai(latest) ? "th" : "en";
  const pali = asked === "pi" && route === "answer"; // crisis, decline and don't-know are never in Pali
  // Risk stays on once any turn showed it (PRD §9): this route, an earlier reply's risk flag, or
  // crisis words anywhere in the history. Then search leaves out the risk suttas.
  const risk =
    route === "crisis" ||
    messages.some((m) => m.parts?.some((p) => p.type === "data-risk")) ||
    history.some((m) => m.role === "user" && crisisKeyword(textOf(m)));
  const exclude = risk ? policy.risk.suttas : [];
  const blocked = [
    ...(risk ? [`\\b(?:${policy.risk.names.map((n) => fold(n)).join("|")})\\b`] : []),
    ...(route === "crisis" ? [String.raw`\d{3,}|https?:|www\.`] : []), // code owns every number and link
  ];

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

  let note = NOTE[route];
  let passages: core.Passage[] = [];
  let pinned = ""; // a card code shows even if it isn't cited: a decline's teaching, a quote's match
  let opening = ""; // a sentence code writes before the reply: the verdict on a quote
  let fixed = ""; // a reply code writes instead of the model's
  let searched: string[] = [];
  const paliText = new Map<string, string>(); // Pali mode: what each quotable passage says, verbatim
  if (route === "decline") {
    const id = g.decline_topic ? policy.decline[g.decline_topic] : null;
    if (id) {
      passages = (await core.passage(id, 0).catch(() => [])).filter((p) => p.id === id);
      pinned = passages.length ? id : "";
    } else {
      note += " Give a plain, kind no, with no teaching and no citation.";
    }
  } else if (route === "answer") {
    try {
      const r = await core.search(g.search_query || latest, 8, exclude);
      passages = r.hits;
      searched = r.hits.map((h) => h.id);
      if (!(r.top_lexical > 0 || r.top_cosine >= policy.dont_know.min_cosine)) fixed = TEXT.dontKnow[lang];
      if (g.quote) {
        // the words someone attributes to the Buddha are looked up in code (PRD §6)
        const q = await core.search(g.quote, 3, exclude);
        const same = q.top_lexical >= policy.quotes.same_words;
        const similar = !same && (q.top_lexical > 0 || q.top_cosine >= policy.quotes.similar_cosine);
        opening = TEXT[same ? "quoteFound" : similar ? "quoteSimilar" : "quoteNone"][lang];
        if ((same || similar) && q.hits[0]) {
          passages = [q.hits[0], ...passages];
          pinned = q.hits[0].id;
        }
        note += ` The person attributed these words to the Buddha: "${escapeTags(g.quote)}". Your reply's first sentence is already written: "${opening}" Write only what follows it, and never claim you said those words.`;
      }
      if (pali && !fixed) {
        // the Pali of the suttas search found, around where each one's best hit falls: the model
        // picks from it by ID, code writes it out
        const best = new Map<string, string>(); // sutta → its best hit
        for (const h of passages) if (!best.has(h.sutta_id)) best.set(h.sutta_id, h.id);
        const suttas = [...best.keys()].slice(0, 3);
        const pi = (await Promise.all(suttas.map((s) => core.paragraphs(s, "pi", 12, best.get(s))))).flat();
        for (const p of pi) paliText.set(p.id, p.text);
        passages = [...passages.slice(0, 4), ...pi];
        if (!pi.length) fixed = TEXT.dontKnow[lang];
        note +=
          " Pali mode: reply with only the IDs of the one to three Pali passages (IDs with #pi) that best answer," +
          " each written as [[quote:ID]], and nothing else. The app writes out their words.";
      }
    } catch (err) {
      console.error("search:", err);
      fixed = TEXT.cantRecall[lang];
    }
  }
  remember(passages);

  const tools = {
    search_canon: tool({
      description: "Search the Pali Canon (English translations and the Pali) for passages you can cite by ID.",
      inputSchema: z.object({ query: z.string().describe("what to look for: a question, words or Pali terms") }),
      execute: async ({ query }) => remember((await core.search(query, 8, exclude)).hits),
    }),
    get_passage: tool({
      description: "Read a passage with the paragraphs around it, by its ID.",
      inputSchema: z.object({ id: z.string(), window: z.number().int().min(0).max(3).optional() }),
      execute: async ({ id, window }) => (exclude.includes(id.split("#")[0]) ? [] : remember(await core.passage(id, window ?? 1))),
    }),
  };

  const { model, mock } = chatModel(() => (pali ? order.filter((id) => paliText.has(id)) : order), pali);
  // what happened this turn, for eval mode
  const debug = {
    route,
    query: g.search_query, // what the guard searched for
    lang: pali ? "pi" : lang,
    risk,
    searched, // the first search's hits, best first
    retrieved: order, // every passage the reply could cite
    cited: [] as string[],
    dropped: [] as string[],
    stripped: [] as string[],
    model: mock ? "mock" : modelId(),
    mock,
    tokens: { input: 0, output: 0 },
  };
  const count = async (usage: PromiseLike<{ inputTokens?: number; outputTokens?: number }>) => {
    const u = await usage;
    debug.tokens.input += u.inputTokens ?? 0;
    debug.tokens.output += u.outputTokens ?? 0;
  };
  const nonce = crypto.randomUUID().slice(0, 8);
  const turn = (extra: string) =>
    [
      `Reply in ${lang === "th" ? "Thai" : "English"}. ${note}${extra}`,
      `<passages nonce="${nonce}">`,
      ...passages.map((p) => `[${p.id}] ${p.text}`),
      "</passages>",
    ].join("\n");

  // One attempt at the reply, streamed through a fresh gate sentence by sentence.
  async function attempt(write: (delta: string) => void, extra = "") {
    const gate = new SentenceGate(known, {
      requireCite: route === "answer",
      lang,
      blocked: blocked.length ? new RegExp(blocked.join("|")) : undefined,
      shown: opening,
    });
    const result = streamText({
      model,
      instructions: PROMPT, // stable, so it can be cached; this turn's passages ride on the message
      messages: withTurn(modelMessages, turn(extra)),
      tools,
      stopWhen: isStepCount(MAX_STEPS),
      maxOutputTokens: MAX_OUTPUT,
      // only answers use tools, and never on the last step, so the model has to reply
      prepareStep: ({ stepNumber }) => (route !== "answer" || stepNumber === MAX_STEPS - 1 ? { activeTools: [] } : {}),
      providerOptions: { openrouter: { reasoning: { effort: "low" } } },
    });
    for await (const part of result.stream) {
      if (part.type === "text-delta") gate.push(part.text).forEach(write);
      else if (part.type === "finish-step") gate.endStep(part.finishReason === "tool-calls").forEach(write);
      else if (part.type === "error") throw part.error;
    }
    const end = gate.end();
    end.released.forEach(write);
    await count(result.totalUsage);
    debug.dropped.push(...gate.dropped);
    debug.stripped.push(...gate.strippedIds);
    if (gate.dropped.length || gate.strippedIds.length) {
      console.warn(`checks: dropped ${gate.dropped.length} sentences, stripped ${gate.strippedIds.length} citations`);
    }
    return end;
  }

  // Pali mode (PRD §5.1): the model names up to three passages; code writes out their words.
  async function quote(write: (delta: string) => void): Promise<string[]> {
    const result = streamText({
      model,
      instructions: PROMPT,
      messages: withTurn(modelMessages, turn("")),
      maxOutputTokens: MAX_OUTPUT,
      providerOptions: { openrouter: { reasoning: { effort: "low" } } },
    });
    const named = [...(await result.text).matchAll(QUOTE)].map((m) => m[1]);
    await count(result.totalUsage);
    const ids = [...new Set(named)].filter((id) => paliText.has(id)).slice(0, 3);
    if (!ids.length) write(TEXT.dontKnow[lang]);
    for (const id of ids) write(`${paliText.get(id)} [[cite:${id}]]\n\n`);
    return ids;
  }

  const stream = createUIMessageStream<BuddhaMessage>({
    async execute({ writer }) {
      const id = "reply";
      let shown = 0;
      const write = (delta: string) => {
        shown += delta.trim().length;
        writer.write({ type: "text-delta", id, delta });
      };
      writer.write({ type: "start" });
      if (mock) writer.write({ type: "data-notice", data: "Mock model: add OPENROUTER_API_KEY for real answers." });
      if (route === "crisis") writer.write({ type: "data-crisis", data: crisis(lang) }); // first, so the numbers show at once
      writer.write({ type: "text-start", id });
      if (opening) write(pali ? `${opening}\n\n` : `${opening} `); // Pali mode: the quotes follow as paragraphs
      let cited: string[] = [];
      if (fixed) {
        if (!opening) write(fixed);
      } else if (pali) {
        cited = await quote(write);
      } else {
        try {
          let end = await attempt(write);
          if (route === "answer" && !end.grounded) {
            // nothing has been shown yet: one redraft, then the don't-know reply (PRD §9)
            end = await attempt(write, "\nYour last draft cited no passage. Answer from the passages, citing an ID in your first or second sentence.");
            if (!end.grounded && !opening) write(TEXT.dontKnow[lang]);
          }
          cited = end.cited;
        } catch (err) {
          if (route !== "crisis") throw err;
          console.error("chat (crisis):", err);
        }
        if (route === "crisis" && !shown) write(TEXT.crisis[lang]); // failed or empty: never just the numbers
      }
      writer.write({ type: "text-end", id });
      if (risk) writer.write({ type: "data-risk", data: true });
      if (pali && cited.length) writer.write({ type: "data-pali", data: true });
      // cited cards first, in the order of the reply's numbered chips; then a pinned one if uncited
      const ids = [...new Set([...cited, ...(pinned ? [pinned] : [])])];
      debug.cited = ids;
      const cards = await core.cards(ids).catch((err) => {
        console.error("cards:", err);
        return [];
      });
      writer.write({ type: "data-cards", data: cards });
      writer.write({ type: "finish" });
    },
    onError: (err) => {
      console.error("chat:", err);
      return lang === "th" ? "ขออภัย ตอนนี้ตอบไม่ได้ ลองใหม่อีกครั้ง" : "Sorry, I can't answer right now. Please try again.";
    },
  });
  if (!evalMode) {
    // no-transform: a proxy in front, such as the hosted web app's, mustn't gzip the stream, which
    // would hold the words back until the reply ends
    await pipeUIMessageStreamToResponse({ response: res, stream, headers: { "Cache-Control": "no-cache, no-transform" } });
    return;
  }
  const out = { reply: "", cards: [] as Card[], crisis: null as Crisis | null, error: "" };
  for await (const chunk of stream) {
    if (chunk.type === "text-delta") out.reply += chunk.delta;
    else if (chunk.type === "data-cards") out.cards = chunk.data;
    else if (chunk.type === "data-crisis") out.crisis = chunk.data;
    else if (chunk.type === "error") out.error = chunk.errorText;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ...out, debug }));
}

// The hotlines under a crisis reply, from policy.yaml: the model never writes a number.
function crisis(lang: Lang): Crisis {
  return {
    title: TEXT.crisisTitle[lang],
    lines: [
      ...policy.crisis.hotlines.map((h) => ({ label: h[lang], number: h.number })),
      { label: policy.crisis.elsewhere[lang], url: policy.crisis.elsewhere.url },
    ],
  };
}

// Text from the browser can't open a tag or a citation marker.
function escapeTags(s: string): string {
  return s.replaceAll("[[", "[ [").replaceAll("]]", "] ]").replaceAll("<", "‹").replaceAll(">", "›");
}

// History comes from the browser, so it's untrusted (PRD §9): only user and assistant turns, only
// their text, and user text escaped.
function untrusted(messages: BuddhaMessage[]): BuddhaMessage[] {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-HISTORY)
    .map((m) => ({
      ...m,
      parts: (m.parts ?? []).flatMap((p) => (p.type === "text" ? [{ ...p, text: m.role === "user" ? escapeTags(p.text) : p.text }] : [])),
    }))
    .filter((m) => m.parts.length > 0);
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
