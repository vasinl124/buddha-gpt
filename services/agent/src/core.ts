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

export async function passage(id: string, window = 1): Promise<Passage[]> {
  return (await call<{ passage: Passage[] }>(`/v1/passages/${encodeURIComponent(id)}?window=${window}`)).passage;
}

/** A sutta's paragraphs in one language, in order: the Pali that Pali mode can quote. */
export async function paragraphs(suttaId: string, lang: string, limit = 12): Promise<Passage[]> {
  return (await call<{ paragraphs: Passage[] }>(`/v1/suttas/${encodeURIComponent(suttaId)}/paragraphs?lang=${lang}&limit=${limit}`)).paragraphs;
}

export async function cards(ids: string[]): Promise<Card[]> {
  if (ids.length === 0) return [];
  return (await call<{ cards: Card[] }>("/v1/cards", { method: "POST", body: JSON.stringify({ ids }) })).cards;
}
