package store

import (
	"strings"
	"testing"
)

func TestFuse(t *testing.T) {
	vector := []Hit{{ID: "a"}, {ID: "b"}, {ID: "c"}}
	lexical := []Hit{{ID: "c"}, {ID: "d"}}
	got := Fuse(3, vector, lexical)
	// c is in both lists, so it beats a, the top of only one; d is cut by k
	want := []string{"c", "a", "b"}
	if len(got) != len(want) {
		t.Fatalf("got %d hits", len(got))
	}
	for i, w := range want {
		if got[i].ID != w {
			t.Errorf("rank %d = %s, want %s (all: %+v)", i+1, got[i].ID, w, got)
		}
	}
	if got := Fuse(8, nil, lexical); len(got) != 2 || got[0].ID != "c" {
		t.Errorf("one empty leg: %+v", got)
	}
}

func TestPerSutta(t *testing.T) {
	hits := []Hit{
		{ID: "1", SuttaID: "an3.62", Text: "a"}, {ID: "2", SuttaID: "an3.62", Text: "b"}, {ID: "3", SuttaID: "an3.62", Text: "c"},
		{ID: "4", SuttaID: "dn22", Text: "refrain"}, {ID: "5", SuttaID: "dn22", Text: "refrain"}, {ID: "6", SuttaID: "dn16", Text: "d"},
	}
	got := perSutta(hits, 2, 8)
	// two per sutta, and dn22's repeated refrain only once
	var ids []string
	for _, h := range got {
		ids = append(ids, h.ID)
	}
	if strings.Join(ids, " ") != "1 2 4 6" {
		t.Errorf("perSutta kept %v", ids)
	}
	if got := perSutta(nil, 2, 8); got == nil {
		t.Error("no hits must be an empty list, not nil (JSON null)")
	}
}

func TestVectorLiteral(t *testing.T) {
	if got := vectorLiteral([]float32{0.5, -1, 0.25}); got != "[0.5,-1,0.25]" {
		t.Errorf("vectorLiteral = %s", got)
	}
}
