import assert from "node:assert/strict";
import { test } from "node:test";
import { quotesToThaiScript, toThaiScript } from "./pali";

test("Roman Pali in Thai script", () => {
  for (const [roman, thai] of [
    ["Evaṃ me sutaṃ", "เอวํ เม สุตํ"],
    ["jātipi dukkhā", "ชาติปิ ทุกฺขา"],
    ["Buddhaṃ saraṇaṃ gacchāmi", "พุทฺธํ สรณํ คจฺฉามิ"],
    ["paññā, sekkha, tvaṃ", "ปญฺญา, เสกฺข, ตฺวํ"],
    ["‘‘Idaṃ kho pana, bhikkhave, dukkhaṃ ariyasaccaṃ", "‘‘อิทํ โข ปน, ภิกฺขเว, ทุกฺขํ อริยสจฺจํ"],
    ["nibbānaṃ [[cite:sn56.11#pi3]]", "นิพฺพานํ [[cite:sn56.11#pi3]]"],
  ]) {
    assert.equal(toThaiScript(roman), thai, roman);
  }
});

test("only the quoted Pali of a reply turns into Thai script", () => {
  const reply = "The texts I can search don't contain those words.\n\nEvaṃ me sutaṃ. [[cite:sn56.11#pi1]]\n\n";
  assert.equal(
    quotesToThaiScript(reply),
    "The texts I can search don't contain those words.\n\nเอวํ เม สุตํ. [[cite:sn56.11#pi1]]\n\n",
  );
});
