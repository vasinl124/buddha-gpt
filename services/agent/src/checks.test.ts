import assert from "node:assert/strict";
import { test } from "node:test";
import { SentenceGate, fold, isThai, sentenceEnd } from "./checks.ts";

const known = () =>
  new Map([
    ["sn56.11#en4", fold("“Now this, monks, is the noble truth of stress: Birth is stressful, aging is stressful.”")],
    ["sn22.59#en3", fold("“Consciousness is not self.”")],
  ]);

test("holds the answer until its first valid citation, then releases it all", () => {
  const g = new SentenceGate(known());
  assert.deepEqual(g.push("Friend, you ask about suffering. "), []);
  assert.deepEqual(g.push("Birth is stressful. [[cite:sn56.11#en4]] What do you"), [
    "Friend, you ask about suffering. ",
    "Birth is stressful. [[cite:sn56.11#en4]] ",
  ]);
  const end = g.end();
  assert.deepEqual(end.released, ["What do you"]);
  assert.deepEqual(end.cited, ["sn56.11#en4"]);
  assert.equal(end.grounded, true);
});

test("strips citations to passages that weren't retrieved", () => {
  const g = new SentenceGate(known());
  const out = g.push("Consciousness is not self. [[cite:sn22.59#en3]] [[cite:mn999#en1]] And so it is. ");
  assert.deepEqual(out, ["Consciousness is not self. [[cite:sn22.59#en3]]  "]);
  // the last sentence waits: a citation marker could still follow it
  assert.deepEqual(g.end().released, ["And so it is. "]);
  assert.deepEqual(g.strippedIds, ["mn999#en1"]);
});

test("drops a sentence that quotes words no passage contains, keeps an exact quote", () => {
  const g = new SentenceGate(known());
  const out = g.push(
    'I taught that "birth is stressful, aging is stressful." [[cite:sn56.11#en4]] ' +
      'I also said "peace comes from within, do not seek it without." [[cite:sn22.59#en3]] Reflect on it. ',
  );
  assert.equal(out.length, 1);
  assert.match(out[0], /birth is stressful/);
  const end = g.end();
  assert.deepEqual(end.released, ["Reflect on it. "]);
  assert.deepEqual(end.cited, ["sn56.11#en4"]); // the dropped sentence's citation gets no card
  assert.equal(g.dropped.length, 1);
  assert.match(g.dropped[0], /peace comes from within/);
});

test("an uncited reply is never released", () => {
  const g = new SentenceGate(known());
  assert.deepEqual(g.push("All things change. "), []);
  const end = g.end();
  assert.equal(end.grounded, false);
  assert.deepEqual(end.released, []);
  assert.equal(g.heldText(), "All things change. ");
});

test("drops an uncited preamble before a tool call, and keeps steps apart", () => {
  const g = new SentenceGate(known());
  assert.deepEqual(g.push("Let me look into that."), []);
  assert.deepEqual(g.endStep(true), []);
  assert.deepEqual(g.push("Birth is stressful. [[cite:sn56.11#en4]] Reflect."), ["Birth is stressful. [[cite:sn56.11#en4]] "]);
  assert.deepEqual(g.end().released, ["Reflect."]);
});

test("without requireCite, sentences show at once; blocked words drop the sentence", () => {
  const g = new SentenceGate(known(), { requireCite: false, blocked: /\bvakkali\b|\d{3,}/ });
  assert.deepEqual(g.push("You are not alone. Ven. Vakkāli was ill too. Call 1323 now. Breathe. "), ["You are not alone. "]);
  assert.deepEqual(g.end().released, ["Breathe. "]);
  assert.equal(g.dropped.length, 2);
});

test("a sentence in the other language is dropped", () => {
  const g = new SentenceGate(known(), { requireCite: false, lang: "th" });
  assert.deepEqual(g.push("This one is English. ความเกิดเป็นทุกข์ [[cite:sn56.11#en4]] "), []);
  assert.deepEqual(g.end().released, ["ความเกิดเป็นทุกข์ [[cite:sn56.11#en4]] "]);
});

test("three Pali words in a row must come from a passage", () => {
  const pali = new Map([["sn56.11#pi3", fold("Idaṃ kho pana, bhikkhave, dukkhaṃ ariyasaccaṃ – jātipi dukkhā, jarāpi dukkhā")]]);
  const g = new SentenceGate(pali, { requireCite: false });
  // copied (punctuation aside) is kept; a line no passage has is dropped
  assert.deepEqual(g.push("As it says, jātipi dukkhā jarāpi dukkhā. Sabbe sattā bhavantu sukhitattā. Be well. "), [
    "As it says, jātipi dukkhā jarāpi dukkhā. ",
  ]);
  assert.deepEqual(g.end().released, ["Be well. "]);
  assert.equal(g.dropped.length, 1);
  // names aren't a run of Pali
  const names = new SentenceGate(pali, { requireCite: false });
  const shown = [
    ...names.push("Ānanda and Sāriputta went with Moggallāna. Sāriputta, Moggallāna, Ānanda: all three listened. "),
    ...names.end().released,
  ];
  assert.equal(shown.length, 2);
  assert.equal(names.dropped.length, 0);
});

test("sentence boundaries", () => {
  assert.equal(sentenceEnd("Then Ven. Ānanda went. Next"), "Then Ven. Ānanda went. ".length);
  assert.equal(sentenceEnd("No end yet"), -1);
  assert.equal(sentenceEnd("Done. [[cite:a#en1]] Next"), "Done. [[cite:a#en1]] ".length);
});

test("isThai", () => {
  assert.equal(isThai("ทุกข์คืออะไร"), true);
  assert.equal(isThai("What is dukkha?"), false);
});
