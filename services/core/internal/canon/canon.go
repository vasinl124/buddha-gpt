// Package canon turns the source texts into paragraphs keyed by SuttaCentral-style sutta IDs
// (mn10, sn56.11, dhp1-20). The IDs are standard references; no SuttaCentral text is used.
package canon

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

type Sutta struct {
	ID         string // "sn56.11"
	Collection string // "SN"
	TitlePali  string
	TitleEn    string
}

type Para struct {
	ID      string // "sn56.11#pi3", "sn56.11#en7-2"
	SuttaID string
	Lang    string // "pi" | "en"
	Ord     int    // paragraph number within the sutta (the verse number in the Dhammapada)
	Part    int    // piece of a long paragraph, from 1
	Source  string // "vri", "thanissaro", ...
	Text    string
}

// MaxChars is where a paragraph is split into parts: longer ones make imprecise vectors and
// cards too long to read (PRD §8.4).
const MaxChars = 1500

// paras builds the rows for one source paragraph, splitting it at sentence ends past MaxChars.
func paras(suttaID, lang, source string, ord int, text string) []Para {
	pieces := split(text, MaxChars)
	out := make([]Para, len(pieces))
	for i, p := range pieces {
		id := fmt.Sprintf("%s#%s%d", suttaID, lang, ord)
		if len(pieces) > 1 {
			id = fmt.Sprintf("%s-%d", id, i+1)
		}
		out[i] = Para{ID: id, SuttaID: suttaID, Lang: lang, Ord: ord, Part: i + 1, Source: source, Text: p}
	}
	return out
}

// split cuts s into pieces of about max bytes at most, preferring the last sentence end before
// the limit, then the last space, then a rune boundary.
func split(s string, max int) []string {
	var out []string
	for len(s) > max {
		cut := sentenceEnd(s, max)
		if cut <= max/3 { // no sentence end in a useful place
			cut = strings.LastIndexByte(s[:max], ' ')
		}
		if cut <= 0 { // no space either (unspaced script): cut at a rune boundary
			for cut = max; cut > 0 && !utf8.RuneStart(s[cut]); cut-- {
			}
		}
		out = append(out, strings.TrimSpace(s[:cut]))
		s = strings.TrimSpace(s[cut:])
	}
	return append(out, s)
}

// sentenceEnd returns the offset just past the last sentence end before max: a . ? ! plus any
// closing quotes, followed by whitespace. It returns -1 when there is none.
func sentenceEnd(s string, max int) int {
	for i := strings.LastIndexAny(s[:max], ".?!"); i > 0; i = strings.LastIndexAny(s[:i], ".?!") {
		end := len(s) - len(strings.TrimLeft(s[i+1:], "”’\"')"))
		if end == len(s) || s[end] == ' ' || s[end] == '\n' {
			return end
		}
	}
	return -1
}
