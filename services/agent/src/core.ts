// Client for the Go Retrieval API (services/core).
import type { Card } from "@buddha-gpt/shared";

export interface Passage {
  id: string;
  sutta_id: string;
  lang: string;
  text: string;
  score: number;
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

export async function search(query: string, k = 8): Promise<Passage[]> {
  return (await call<{ hits: Passage[] }>("/v1/search", { method: "POST", body: JSON.stringify({ query, k }) })).hits;
}

export async function passage(id: string, window = 1): Promise<Passage[]> {
  return (await call<{ passage: Passage[] }>(`/v1/passages/${encodeURIComponent(id)}?window=${window}`)).passage;
}

export async function cards(ids: string[]): Promise<Card[]> {
  if (ids.length === 0) return [];
  return (await call<{ cards: Card[] }>("/v1/cards", { method: "POST", body: JSON.stringify({ ids }) })).cards;
}
