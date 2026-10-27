import assert from "node:assert/strict";
import { test } from "node:test";
import type { QuoteLine, QuoteResult } from "./core.ts";
import { answerQuotes, attributed, type Guard } from "./guard.ts";
import { decide, excerpt, type Judge } from "./quote.ts";

const line = (id: string, text: string, words: number, cosine: number): QuoteLine => ({ id, sutta_id: id.split("#")[0], lang: "en", text, score: 0, line: text, words, cosine });
const stilled = line("snp4.14#en1-1", "Stilled right within, a monk shouldn't seek peace from another, from anything else.", 0.42, 0.69);
const fire = line("dhp197-208#en6", "There's no fire like passion, no loss like anger, no ease other than peace.", 0.15, 0.65);
const lookup = (lines: QuoteLine[], words: QuoteLine | null = null): QuoteResult => ({ lines, words });
// a judge that records what it was shown and answers n
const judge = (n: number) => {
  const shown: string[][] = [];
  const j: Judge = async (_quote, lines) => (shown.push(lines), n);
  return { j, shown };
};

test("the same words are found in code, without asking the model", async () => {
  const exact = line("dhp1-20#en5", "Hostilities aren't stilled through hostility, regardless.", 0.97, 0.9);
  const { j, shown } = judge(1);
  const v = await decide("Hostilities aren't stilled through hostility", lookup([exact], exact), j);
  assert.deepEqual([v.kind, v.line?.id, shown.length], ["quoteFound", "dhp1-20#en5", 0]);
});

test("a line close in meaning is 'close' only when the model says it makes the same point", async () => {
  const { j, shown } = judge(1);
  const v = await decide("peace comes from within, do not seek it without", lookup([stilled, fire]), j);
  assert.deepEqual([v.kind, v.line?.id], ["quoteSimilar", "snp4.14#en1-1"]);
  assert.deepEqual(shown, [[stilled.line, fire.line]]);
});

test("the model saying none, failing, or answering out of range all mean 'I don't recall'", async () => {
  const fails: Judge = async () => {
    throw new Error("down");
  };
  for (const j of [judge(0).j, fails, judge(3).j, judge(1.5).j]) {
    assert.equal((await decide("peace comes from within", lookup([stilled, fire]), j)).kind, "quoteNone");
  }
});

test("nothing close enough is 'I don't recall' without asking the model, and at most three lines are asked about", async () => {
  const far = line("an5.27#en5", "This concentration is peaceful, exquisite.", 0.21, 0.41);
  const none = judge(1);
  assert.equal((await decide("peace comes from within", lookup([far]), none.j)).kind, "quoteNone");
  assert.equal(none.shown.length, 0);
  const many = judge(0);
  await decide("peace comes from within", lookup([stilled, fire, stilled, fire, stilled]), many.j);
  assert.equal(many.shown[0].length, 3);
});

test("the check reads a passage around the line: all of a short paragraph, a window of a long one", () => {
  const short = "Hostilities aren't stilled through hostility, regardless. Hostilities are stilled through non-hostility: this, an unending truth.";
  assert.equal(excerpt(short, "Hostilities aren't stilled through hostility, regardless."), short);
  const line = "Stilled right within, a monk shouldn't seek peace from another.";
  const long = `${"Doing jhana, not footloose, he should refrain from restlessness. ".repeat(6)}${line} ${"For one stilled right within, there's nothing embraced. ".repeat(6)}`;
  const e = excerpt(long, line);
  assert.ok(e.includes(line) && e.length <= 362 && e.startsWith("…") && e.endsWith("…"), e);
});

test("words plainly put in his mouth are found even when the guard fails", () => {
  assert.equal(attributed('Did the Buddha say "peace comes from within"?'), "peace comes from within");
  assert.equal(attributed("Did the Buddha really say, “Be a lamp unto yourself”?"), "Be a lamp unto yourself");
  assert.equal(attributed("What did the Buddha teach about peace?"), "");
});

test("asking whether he said something isn't declined as role-play, but a real decline topic stands", () => {
  const g = (decline_topic: string | null, quote: string): Guard => ({ route: "decline", decline_topic, search_query: "q", quote, reply_lang: null });
  assert.equal(answerQuotes(g("roleplay", "Your work is to discover your work")).route, "answer");
  assert.equal(answerQuotes(g(null, "Your work is to discover your work")).route, "answer");
  assert.equal(answerQuotes(g("lottery", "the winning number is 7")).route, "decline");
  assert.equal(answerQuotes(g("roleplay", "")).route, "decline");
});
