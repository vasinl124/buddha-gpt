// The verdict on words someone attributes to the Buddha (PRD §6). Code looks them up line by line, and
// a line holding the same words means he said them. Otherwise the lines closest in meaning go to a
// second check, where a small model says which of them, if any, makes the same point. The check can only
// turn "close" into "I don't recall", never into "those words", and when it fails the verdict is "I don't
// recall": that he taught something close is the claim that needs proving.
import { readFileSync } from "node:fs";
import { generateText, Output } from "ai";
import { z } from "zod";
import * as core from "./core.ts";
import { guardModel } from "./model.ts";
import { policy } from "./policy.ts";

const PROMPT = readFileSync(new URL("../../../prompts/quote.md", import.meta.url), "utf8");

export interface Verdict {
  kind: "quoteFound" | "quoteSimilar" | "quoteNone";
  line?: core.QuoteLine; // the line it rests on: the same words, or the same point
}

/** Which of the passages, numbered from 1, makes the same point as the quote, or 0 for none. */
export type Judge = (quote: string, passages: string[]) => Promise<number>;

export async function verdict(quote: string, exclude: string[], judge: Judge = byModel): Promise<Verdict> {
  return decide(quote, await core.quote(quote, exclude), judge);
}

/** The verdict from a lookup's result; the judge is passed in so tests can stand in for the model. */
export async function decide(quote: string, r: core.QuoteResult, judge: Judge): Promise<Verdict> {
  const q = policy.quotes;
  if (r.words && r.words.words >= q.same_words) return { kind: "quoteFound", line: r.words };
  const close = r.lines.filter((l) => l.cosine >= q.similar_cosine || l.words >= q.similar_words).slice(0, q.candidates);
  if (!close.length) return { kind: "quoteNone" };
  const n = await judge(
    quote,
    close.map((l) => excerpt(l.text, l.line)),
  ).catch((err) => {
    console.error("quote check:", err);
    return 0;
  });
  return Number.isInteger(n) && n >= 1 && n <= close.length ? { kind: "quoteSimilar", line: close[n - 1] } : { kind: "quoteNone" };
}

// The quote's point comes first, so the model weighs the claim, not the words, before it picks a line.
/** The line with what's said around it, up to `room` characters, so the check reads a saying whole: its
 * second half is often the next sentence. */
export function excerpt(text: string, line: string, room = 360): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= room) return t;
  const at = t.indexOf(line);
  if (at < 0) return line;
  const extra = Math.max(0, room - line.length);
  let end = Math.min(t.length, at + line.length + Math.ceil(extra / 2));
  let start = Math.max(0, end - line.length - extra);
  end = Math.min(t.length, start + line.length + extra);
  // whole words at the cut ends
  if (start > 0) start = t.indexOf(" ", start) + 1 || start;
  if (end < t.length) end = Math.max(at + line.length, t.lastIndexOf(" ", end));
  return `${start > 0 ? "…" : ""}${t.slice(start, end)}${end < t.length ? "…" : ""}`;
}

const Answer = z.object({
  point: z.string().describe("what the quote claims, in a few words"),
  match: z.number().int().describe("the number of the passage that makes that point, or 0"),
});

// The check, as one small structured-output call, set up like the guard's but at temperature 0, so the
// same quote gets the same verdict, and asked twice if the first call fails: the model sometimes returns
// nothing. With no key there's nothing to check with, so no passage counts as close.
async function byModel(quote: string, passages: string[]): Promise<number> {
  const model = guardModel();
  if (!model) return 0;
  const ask = async () =>
    (
      await generateText({
        model,
        instructions: PROMPT,
        prompt: [`Quote: ${quote}`, "", ...passages.map((p, i) => `${i + 1}. ${p}`)].join("\n"),
        output: Output.object({ schema: Answer }),
        temperature: 0,
        maxOutputTokens: 300,
        providerOptions: { openrouter: { reasoning: { enabled: false } } },
        abortSignal: AbortSignal.timeout(6_000),
      })
    ).output.match;
  return ask().catch((err) => {
    console.warn("quote check, asking again:", err?.name ?? err);
    return ask();
  });
}
