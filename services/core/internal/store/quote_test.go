package store

import (
	"strings"
	"testing"
)

func TestLines(t *testing.T) {
	// verse breaks are spaces; a sentence ends at . ! ? or ; before a space, after any closing quote;
	// each two in a row are a line too
	got := Lines("Stilled right within,\na monk shouldn’t seek peace from another, from anything else. For one stilled right within, there’s nothing embraced; “Who knows?” he asked.")
	want := []string{
		"Stilled right within, a monk shouldn’t seek peace from another, from anything else.",
		"For one stilled right within, there’s nothing embraced;",
		"“Who knows?” he asked.",
		"Stilled right within, a monk shouldn’t seek peace from another, from anything else. For one stilled right within, there’s nothing embraced;",
		"For one stilled right within, there’s nothing embraced; “Who knows?” he asked.",
	}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Errorf("Lines:\n got %q\nwant %q", got, want)
	}
	// a fragment under 12 characters joins the next; Thai splits at its spaces
	if got := Lines("Thus. I have heard it said. Then"); strings.Join(got, "|") != "Thus. I have heard it said. Then" {
		t.Errorf("short fragments: %q", got)
	}
	if got := Lines("ภิกษุพึงสงบระงับภายในเท่านั้น ไม่พึงแสวงหาความสงบโดยทางอื่น"); len(got) != 3 {
		t.Errorf("Thai: %q", got)
	}
}

func TestRank(t *testing.T) {
	hit := func(id string) Hit { return Hit{ID: id, SuttaID: strings.Split(id, "#")[0]} }
	lines := []Line{
		{Hit: hit("dhp1#en1"), Line: "a", Words: 0.9, Cosine: 0.5},
		{Hit: hit("snp4.14#en1"), Line: "b", Words: 0.4, Cosine: 0.8},
		{Hit: hit("snp4.14#en1"), Line: "c", Words: 0.2, Cosine: 0.7},
		{Hit: hit("an5.27#en1"), Line: "d", Words: 0, Cosine: 0.6},
	}
	r := rank(lines)
	// by meaning, one line per paragraph; and the most words wherever they rank
	var got []string
	for _, l := range r.Lines {
		got = append(got, l.Line)
	}
	if strings.Join(got, " ") != "b d a" || r.Words == nil || r.Words.Line != "a" {
		t.Errorf("rank: lines %v, words %+v", got, r.Words)
	}
	if r := rank([]Line{{Hit: hit("x#en1"), Line: "x"}}); r.Words != nil || len(r.Lines) != 1 {
		t.Errorf("no shared words: %+v", r)
	}
}
