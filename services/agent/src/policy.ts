// The safety policy from policy.yaml at the repo root (PRD §6). Our own file, read once at startup.
import { readFileSync } from "node:fs";
import { parse } from "yaml";

interface Localized {
  en: string;
  th: string;
}

export interface Policy {
  crisis: {
    keywords: string[];
    hotlines: (Localized & { number: string })[];
    elsewhere: Localized & { url: string };
  };
  decline: Record<string, string | null>; // topic → the paragraph a kind no points to, or null
  risk: { suttas: string[]; names: string[] };
  dont_know: { min_cosine: number };
  quotes: { same_words: number; similar_cosine: number; similar_words: number; candidates: number };
}

export const policy: Policy = parse(readFileSync(new URL("../../../policy.yaml", import.meta.url), "utf8"));
