import type { Lang } from "@buddha-gpt/shared";

/** "sn56.11" → "SN 56.11", "dhp1-20" → "Dhp 1–20", "snp1.8" → "Snp 1.8". */
export function displayRef(suttaId: string): string {
  const m = suttaId.match(/^([a-z]+)(.*)$/);
  if (!m) return suttaId;
  const name = { dhp: "Dhp", snp: "Snp" }[m[1]] ?? m[1].toUpperCase();
  return `${name} ${m[2].replace("-", "–")}`;
}

/** An element id for a card, unique per reply: ("m1", "sn56.11#en5") → "card-m1-sn56-11-en5".
 * Two replies can cite the same passage, so the reply's message id is part of it. */

export const suttaCentralUrl = (suttaId: string) => `https://suttacentral.net/${suttaId}`;

export const LANGS: { lang: Lang; label: string; credit: string }[] = [
  { lang: "pi", label: "Pali", credit: "Chaṭṭha Saṅgāyana edition (VRI)" },
  { lang: "th", label: "Thai", credit: "Royal translation (ฉบับหลวง)" },
  { lang: "en", label: "English", credit: "Ṭhānissaro Bhikkhu (CC BY-NC 4.0)" },
];
