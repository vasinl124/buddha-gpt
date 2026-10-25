// Package text normalizes text for matching. The lexical index and every quote check use Fold.
package text

import (
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// Fold lowercases s, strips Latin diacritics (ā→a, ṃ→m, ñ→n) and collapses whitespace,
// so "Anattā" and "anatta" match. Thai marks are left alone; Thai folding arrives in Phase 4.
func Fold(s string) string {
	var b strings.Builder
	space := false
	for _, r := range norm.NFD.String(s) {
		switch {
		case r >= 0x0300 && r <= 0x036F: // combining marks used on Latin letters only
			continue
		case unicode.IsSpace(r):
			space = b.Len() > 0
			continue
		}
		if space {
			b.WriteByte(' ')
			space = false
		}
		b.WriteRune(unicode.ToLower(r))
	}
	return norm.NFC.String(b.String())
}
