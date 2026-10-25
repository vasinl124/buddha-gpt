// The checks every sentence of a reply passes before it reaches the browser (PRD §9): citations
// must point at passages retrieved in this turn, quoted words must be copied from one, and blocked
// words (the risk names) never show. An answer is held back until its first valid citation, so
// nothing ungrounded is ever shown.
import { CITE } from "@buddha-gpt/shared";

/** Folds text for comparison: no diacritics, one quote style, lowercase, single spaces. */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[“”„«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** True when more than 30% of the letters are Thai (PRD §5.1). */
export function isThai(s: string): boolean {
  const letters = s.match(/\p{L}/gu) ?? [];
  const thai = s.match(/[฀-๿]/g) ?? [];
  return letters.length > 0 && thai.length / letters.length > 0.3;
}

const QUOTED = /"([^"]{12,})"/g; // a quoted span long enough to be a claim, on folded text
// a run of Pali: words with Pali diacritics, at most one other word between them. Three or more
// words of it must be copied from a passage (PRD §5.1); single terms are fine.
const DIACRITIC = String.raw`[\p{L}’']*[āīūṃṅñṭḍṇḷ][\p{L}’']*`;
const GAP = String.raw`[\s,;–-]+`;
const PALI_RUN = new RegExp(`${DIACRITIC}(?:${GAP}(?:[\\p{L}’']+${GAP})?${DIACRITIC})+`, "giu");
// English between Pali words ("Ānanda and Sāriputta"), or several capitals (a list of names), means
// it isn't a run of Pali
const ENGLISH = new Set("and or the of in at to with from by for on as is was are a an but his her its this that".split(" "));
const lettersOnly = (s: string) => fold(s).replace(/[^\p{L}]+/gu, " ").trim();

function isPaliRun(run: string): boolean {
  const words = run.split(/[\s,;–-]+/).filter(Boolean);
  return (
    words.length >= 3 &&
    words.filter((w) => /^\p{Lu}/u.test(w)).length <= 1 &&
    !words.some((w) => ENGLISH.has(w.toLowerCase()))
  );
}
const ABBREV = /\b(ven|mt|dr|st|e\.g|i\.e|cf|vs|etc|no)\.$/i;

// The end of a sentence: . ? ! or …, closing quotes, then any citation markers, then a space
// before the next sentence begins.
const END = /[.?!…]["”’')\]]*(?:\s*\[\[cite:[^\]\s]+\]\])*(\s+)(?=[^\s[])/g;

/** Where the first complete sentence in buf ends (after its trailing space), or -1. */
export function sentenceEnd(buf: string): number {
  END.lastIndex = 0;
  for (let m = END.exec(buf); m; m = END.exec(buf)) {
    const before = buf.slice(0, m.index + 1);
    if (!ABBREV.test(before)) return m.index + m[0].length;
  }
  const para = buf.indexOf("\n\n");
  if (para >= 0) return para + 2;
  // Thai has no full stops: a space after Thai text ends a sentence, once it's a useful length
  if (isThai(buf) && buf.length > 60) {
    const space = buf.lastIndexOf(" ");
    if (space > 30) return space + 1;
  }
  return -1;
}

export interface GateEnd {
  released: string[]; // sentences to show now (the held ones, once grounded)
  cited: string[]; // valid citation IDs in order of first use
  grounded: boolean;
  dropped: string[]; // sentences removed for a quote that matches no passage
}

export interface GateOptions {
  /** Hold the reply until its first valid citation: answers do, crisis, decline and chat don't. */
  requireCite?: boolean;
  /** The reply language: a sentence in the other one is dropped (PRD §9). */
  lang?: "en" | "th";
  /** Drop any sentence whose folded text matches (risk names; numbers and links on a crisis turn). */
  blocked?: RegExp;
}

export class SentenceGate {
  private buf = "";
  private held: string[] = [];
  private grounded: boolean;
  private cited: string[] = [];
  readonly dropped: string[] = [];
  readonly strippedIds: string[] = [];

  /** known maps each passage ID retrieved this turn to its folded text; tools add to it. */
  constructor(
    private known: Map<string, string>,
    private opts: GateOptions = {},
  ) {
    this.grounded = opts.requireCite === false;
  }

  /** Adds streamed text and returns the sentences now safe to show. */
  push(delta: string): string[] {
    this.buf += delta;
    const out: string[] = [];
    for (let end = sentenceEnd(this.buf); end > 0; end = sentenceEnd(this.buf)) {
      out.push(...this.take(this.buf.slice(0, end)));
      this.buf = this.buf.slice(end);
    }
    return out;
  }

  /** Flushes the last sentence. If nothing was ever cited, the held text stays held. */
  end(): GateEnd {
    const last = this.buf.trim() ? this.take(this.buf) : [];
    this.buf = "";
    return { released: last, cited: this.cited, grounded: this.grounded, dropped: this.dropped };
  }

  /** The text held back so far, uncited: a caller may still show it (a short greeting). */
  heldText(): string {
    return this.held.join("");
  }

  /** A model step ended. The next step starts a new paragraph, and if the step ended in tool calls,
   * its uncited text was a preamble ("Let me look into that"), so it's dropped. */
  endStep(toolCalls: boolean): string[] {
    const out = this.push("\n\n");
    if (toolCalls && !this.grounded) this.held = [];
    return out;
  }

  private take(raw: string): string[] {
    const sentence = this.check(raw);
    if (sentence === null) return [];
    if (!this.grounded) {
      this.held.push(sentence);
      if (!this.hasCite(sentence)) return [];
      this.grounded = true;
      const all = this.held;
      this.held = [];
      return all;
    }
    return [sentence];
  }

  private hasCite(s: string): boolean {
    return [...s.matchAll(CITE)].length > 0;
  }

  // Strips citations of passages not retrieved this turn, and drops the sentence if it quotes
  // words that aren't in any retrieved passage.
  private check(raw: string): string | null {
    const ids: string[] = [];
    const s = raw.replace(CITE, (marker, id: string) => {
      if (!this.known.has(id)) {
        this.strippedIds.push(id);
        return "";
      }
      ids.push(id);
      return marker;
    });
    const plain = fold(s.replace(CITE, ""));
    const wrongLang = this.opts.lang && /\p{L}{5}/u.test(plain) && isThai(plain) !== (this.opts.lang === "th");
    const madePali = [...s.replace(CITE, "").matchAll(PALI_RUN)].some(
      ([run]) => isPaliRun(run) && ![...this.known.values()].some((text) => lettersOnly(text).includes(lettersOnly(run))),
    );
    if (this.opts.blocked?.test(plain) || wrongLang || madePali) {
      this.dropped.push(raw.trim());
      return null;
    }
    for (const [, quote] of plain.matchAll(QUOTED)) {
      const q = quote.replace(/^[,.;:\s]+|[,.;:\s]+$/g, "");
      if (![...this.known.values()].some((text) => text.includes(q))) {
        this.dropped.push(raw.trim());
        return null;
      }
    }
    // only now: a dropped sentence's citations get no card, so the cards keep the chips' numbering
    for (const id of ids) if (!this.cited.includes(id)) this.cited.push(id);
    return s;
  }
}
