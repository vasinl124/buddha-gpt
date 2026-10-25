// Package text normalizes text for matching. The lexical index and every quote check use Fold.
package text

import (
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// Fold lowercases s, strips Latin diacritics (ā→a, ṃ→m, ñ→n) and collapses whitespace, so
// "Anattā" and "anatta" match. For Thai, which has no spaces between words and whose PDF line
// breaks lose theirs, it drops the spaces between Thai letters and the tone marks (PRD §8.5), so
// a typed phrase matches the printed text however either was spaced or marked.
func Fold(s string) string {
	var b strings.Builder
	space, thai := false, false // a space is pending; the last rune written was Thai
	for _, r := range norm.NFD.String(s) {
		switch {
		case r >= 0x0300 && r <= 0x036F: // combining marks used on Latin letters only
			continue
		case r >= 0x0E47 && r <= 0x0E4E: // Thai tone marks and the other marks above the line
			continue
		case unicode.IsSpace(r):
			space = b.Len() > 0
			continue
		}
		isThai := r >= 0x0E00 && r <= 0x0E7F
		if space && !(thai && isThai) {
			b.WriteByte(' ')
		}
		space, thai = false, isThai
		b.WriteRune(unicode.ToLower(r))
	}
	return norm.NFC.String(b.String())
}
