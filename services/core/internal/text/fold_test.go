package text

import "testing"

func TestFold(t *testing.T) {
	for in, want := range map[string]string{
		"Anattā":                "anatta",
		"  Saṃyutta\n\tNikāya ": "samyutta nikaya",
		"Ñāṇa ṭhāna ḍ ḷ ṅ ṁ":    "nana thana d l n m",
		"Birth is stressful":    "birth is stressful",
		"ทุกข์ คือ อะไร":        "ทุกข์ คือ อะไร", // Thai marks survive until Phase 4
	} {
		if got := Fold(in); got != want {
			t.Errorf("Fold(%q) = %q, want %q", in, got, want)
		}
	}
}
