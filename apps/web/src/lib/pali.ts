// Pali in Thai script (PRD §5.1), transliterated from VRI's Roman text the way Thai editions
// print Pali: phinthu ( ฺ) under a consonant with no vowel, nikhahit ( ํ) for ṃ, and e and o
// written before their consonant.

// aspirates first, so "kh" isn't read as k + h
const CONSONANTS: [string, string][] = [
  ["kh", "ข"], ["gh", "ฆ"], ["ch", "ฉ"], ["jh", "ฌ"], ["ṭh", "ฐ"], ["ḍh", "ฒ"], ["th", "ถ"], ["dh", "ธ"],
  ["ph", "ผ"], ["bh", "ภ"], ["k", "ก"], ["g", "ค"], ["ṅ", "ง"], ["c", "จ"], ["j", "ช"], ["ñ", "ญ"],
  ["ṭ", "ฏ"], ["ḍ", "ฑ"], ["ṇ", "ณ"], ["t", "ต"], ["d", "ท"], ["n", "น"], ["p", "ป"], ["b", "พ"],
  ["m", "ม"], ["y", "ย"], ["r", "ร"], ["l", "ล"], ["v", "ว"], ["s", "ส"], ["h", "ห"], ["ḷ", "ฬ"],
];

// each vowel after a consonant, and on its own
const VOWELS: Record<string, [string, string]> = {
  a: ["", "อ"], ā: ["า", "อา"], i: ["ิ", "อิ"], ī: ["ี", "อี"],
  u: ["ุ", "อุ"], ū: ["ู", "อู"], e: ["เ", "เอ"], o: ["โ", "โอ"],
};

/** A Pali-mode reply in Thai script: only its paragraphs that quote a Pali passage (they end in a
 * [[cite:…#pi…]] marker), so a verdict in English or Thai before them stays as it is. */
export function quotesToThaiScript(reply: string): string {
  return reply
    .split("\n\n")
    .map((p) => (/\[\[cite:[^\]]*#pi/.test(p) ? toThaiScript(p) : p))
    .join("\n\n");
}

/** "Evaṃ me sutaṃ" → "เอวํ เม สุตํ". Citation markers ([[cite:…]]) are left as they are. */
export function toThaiScript(roman: string): string {
  const s = roman.normalize("NFC").toLowerCase();
  let out = "";
  for (let i = 0; i < s.length; ) {
    if (s.startsWith("[[", i)) {
      const end = s.indexOf("]]", i);
      const stop = end < 0 ? s.length : end + 2;
      out += roman.normalize("NFC").slice(i, stop); // as written: IDs are case-sensitive
      i = stop;
      continue;
    }
    const consonant = CONSONANTS.find(([r]) => s.startsWith(r, i));
    if (consonant) {
      i += consonant[0].length;
      const vowel = VOWELS[s[i]];
      if (!vowel) {
        out += consonant[1] + "ฺ";
      } else {
        out += s[i] === "e" || s[i] === "o" ? vowel[0] + consonant[1] : consonant[1] + vowel[0];
        i++;
      }
      continue;
    }
    out += VOWELS[s[i]]?.[1] ?? (s[i] === "ṃ" || s[i] === "ṁ" ? "ํ" : s[i]);
    i++;
  }
  return out;
}
