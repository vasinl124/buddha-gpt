package text

import "testing"

func TestFold(t *testing.T) {
	for in, want := range map[string]string{
		"Anattā":                "anatta",
		"  Saṃyutta\n\tNikāya ": "samyutta nikaya",
		"Ñāṇa ṭhāna ḍ ḷ ṅ ṁ":    "nana thana d l n m",
		"Birth is stressful":    "birth is stressful",
		"ทุกข์ คือ อะไร":        "ทุกขคืออะไร", // Thai: no tone marks, no spaces between Thai
		"ข้าพเจ้า ได้\nสดับ":    "ขาพเจาไดสดับ",
		"อนัตตา anattā":         "อนัตตา anatta", // a space between Thai and Latin stays
	} {
		if got := Fold(in); got != want {
			t.Errorf("Fold(%q) = %q, want %q", in, got, want)
		}
	}
}
