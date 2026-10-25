import assert from "node:assert/strict";
import { test } from "node:test";
import { toThaiScript } from "./pali";

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
