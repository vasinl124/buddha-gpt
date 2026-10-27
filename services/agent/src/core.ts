// Client for the Go Retrieval API (services/core).
import type { Card } from "@buddha-gpt/shared";

export interface Passage {
  id: string;
  sutta_id: string;
  lang: string;
  text: string;
  score: number;
}

/** A search: the fused hits, plus each leg's top raw score for the don't-know and quote checks. */
export interface Result {
  hits: Passage[];
  top_cosine: number; // 0 when search is lexical only
  top_lexical: number; // trigram word similarity; 0 when nothing matched the words
}

/** A line a quote lookup scored: its paragraph, the line, and how close it is by words and by meaning. */
export interface QuoteLine extends Passage {
  line: string;
  words: number; // trigram word similarity: how much of the quote's words the line holds
  cosine: number; // 0 when the lookup is by words only
}

/** A quote lookup: the lines closest in meaning, best first and one per paragraph, and the line that
 * holds the most of the quote's words. */
export interface QuoteResult {
  lines: QuoteLine[];
  words: QuoteLine | null;
}

const base = () => process.env.RETRIEVAL_URL || "http://localhost:7890";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10_000), // the core's own embedding call retries inside this
  });
  if (!res.ok) throw new Error(`core ${path}: ${res.status}`);
  return (await res.json()) as T;
}

/** exclude lists sutta IDs to leave out: the risk filter (PRD §6). */
export async function search(query: string, k = 8, exclude: string[] = []): Promise<Result> {
  return call<Result>("/v1/search", { method: "POST", body: JSON.stringify({ query, k, exclude }) });
}

/** Words someone attributes to the Buddha, looked up line by line (PRD §6). */
export async function quote(text: string, exclude: string[] = []): Promise<QuoteResult> {
  return call<QuoteResult>("/v1/quote", { method: "POST", body: JSON.stringify({ quote: text, exclude }) });
}

export async function passage(id: string, window = 1): Promise<Passage[]> {
  return (await call<{ passage: Passage[] }>(`/v1/passages/${encodeURIComponent(id)}?window=${window}`)).passage;
}

/** A sutta's paragraphs in one language, in order: the Pali that Pali mode can quote. With near (a
 * paragraph of that sutta), the window is centred where it falls. */
export async function paragraphs(suttaId: string, lang: string, limit = 12, near = ""): Promise<Passage[]> {
  const q = `lang=${lang}&limit=${limit}&near=${encodeURIComponent(near)}`;
  return (await call<{ paragraphs: Passage[] }>(`/v1/suttas/${encodeURIComponent(suttaId)}/paragraphs?${q}`)).paragraphs;
}

export async function cards(ids: string[]): Promise<Card[]> {
  if (ids.length === 0) return [];
  return (await call<{ cards: Card[] }>("/v1/cards", { method: "POST", body: JSON.stringify({ ids }) })).cards;
}
