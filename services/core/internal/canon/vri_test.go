package canon

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const snBook = `<?xml version="1.0" encoding="UTF-16"?>
<TEI.2><text><body>
<p rend="centre"> Namo tassa bhagavato</p>
<head rend="chapter">12. Saccasaṃyuttaṃ</head>
<p rend="title">1. Samādhivaggo</p>
<p rend="subhead">1. Samādhisuttaṃ</p>
<p rend="bodytext" n="1071"><hi rend="paranum">1071</hi><hi rend="dot">.</hi> Sāvatthinidānaṃ. <pb ed="M" n="3.0001" />“Samādhiṃ, <note>variant</note> bhikkhave, bhāvetha.”</p>
<p rend="subhead">2-3. Dutiyādisuttadvayaṃ</p>
<p rend="bodytext" n="1072">Peyyālo.</p>
<p rend="title">2. Dhammacakkappavattanavaggo</p>
<p rend="subhead">Ekasuttaṃ</p>
<p rend="subhead">Ariyasaccāni</p>
<p rend="gatha1">Yassa saccāni,</p>
<p rend="gathalast">so muni.</p>
<p rend="bodytext" n="1073">Tatiyo.</p>
<p rend="bodytext">Tassuddānaṃ –</p>
<p rend="gatha1">Samādhi dutiyo ceva,</p>
<p rend="gathalast">ekasuttaṃ ti.</p>
</body></text></TEI.2>`

const dhpBook = `<TEI.2><text><body>
<head rend="chapter">1. Yamakavaggo</head>
<p rend="hangnum" n="1"><hi rend="paranum">1</hi><hi rend="dot">.</hi></p>
<p rend="gatha1"> Manopubbaṅgamā dhammā,</p>
<p rend="gathalast">cakkaṃva vahato padaṃ.</p>
<p rend="hangnum" n="2"><hi rend="paranum">2</hi><hi rend="dot">.</hi></p>
<p rend="gatha1">Manopubbaṅgamā dhammā,</p>
<p rend="gathalast">chāyāva anapāyinī.</p>
<p rend="bodytext">(Ettāvatā yamakavagge cuddasa vatthūni)</p>
<p rend="gathalast">Satattayañca vatthūnaṃ.</p>
</body></text></TEI.2>`

func TestParseVRI(t *testing.T) {
	suttas, paras, err := ParseVRI(strings.NewReader(snBook), VRIBook{"s0305m.mul.xml", "SN", 44})
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, s := range suttas {
		ids = append(ids, s.ID)
	}
	// saṃyutta 12 of the book is SN 56; numbering runs on across vaggas, a range covers
	// two suttas, an unnumbered "…sutta" counts and a section heading doesn't
	if got := strings.Join(ids, " "); got != "sn56.1 sn56.2-3 sn56.4" {
		t.Fatalf("sutta IDs = %q", got)
	}
	want := []struct{ id, text string }{
		{"sn56.1#pi1", "Sāvatthinidānaṃ. “Samādhiṃ, bhikkhave, bhāvetha.”"},
		{"sn56.2-3#pi1", "Peyyālo."},
		{"sn56.4#pi1", "Yassa saccāni,\nso muni."},
		{"sn56.4#pi2", "Tatiyo."},
	}
	if len(paras) != len(want) {
		t.Fatalf("got %d paragraphs: %+v", len(paras), paras)
	}
	for i, w := range want {
		if paras[i].ID != w.id || paras[i].Text != w.text {
			t.Errorf("para %d = %s %q, want %s %q", i, paras[i].ID, paras[i].Text, w.id, w.text)
		}
	}

	suttas, paras, err = ParseVRI(strings.NewReader(dhpBook), VRIBook{"s0502m.mul.xml", "Dhp", 0})
	if err != nil {
		t.Fatal(err)
	}
	if len(suttas) != 1 || suttas[0].ID != "dhp1-2" || len(paras) != 2 || paras[1].ID != "dhp1-2#pi2" {
		t.Fatalf("Dhammapada: %+v %+v", suttas, paras)
	}
}

func TestSplit(t *testing.T) {
	s := strings.Repeat("Evaṃ me sutaṃ. ", 40) // 640 bytes
	parts := split(s, 100)
	for _, p := range parts {
		if len(p) > 100 || !strings.HasSuffix(p, ".") {
			t.Fatalf("bad part %q", p)
		}
	}
	if got := strings.Join(parts, " "); got != strings.TrimSpace(s) {
		t.Fatal("split lost or changed text")
	}
	if parts := split(`He said, “Go.” Then he left.`, 18); parts[0] != `He said, “Go.”` {
		t.Fatalf("closing quote not kept with its sentence: %q", parts)
	}
}

func TestNormalize(t *testing.T) {
	suttas := []Sutta{{ID: "an1.81-97", Collection: "AN", TitlePali: "Pamādādivaggo"}, {ID: "sn46.999", Collection: "SN"}}
	paras := []Para{
		{ID: "an1.81-97#pi81", SuttaID: "an1.81-97", Lang: "pi", Ord: 81, Part: 1, Text: "a"},
		{ID: "an1.81-97#pi82-1", SuttaID: "an1.81-97", Lang: "pi", Ord: 82, Part: 1, Text: "b1"},
		{ID: "an1.81-97#pi82-2", SuttaID: "an1.81-97", Lang: "pi", Ord: 82, Part: 2, Text: "b2"},
		{ID: "sn46.999#pi1", SuttaID: "sn46.999", Lang: "pi", Ord: 1, Part: 1, Text: "c"},
	}
	gotSuttas, got, unmatched := Normalize(suttas, paras)
	// SuttaCentral puts sutta 81 in an1.71-81 and 82 in an1.82-97; a split paragraph keeps its
	// parts; an ID outside every SuttaCentral range is kept and reported
	want := []string{"an1.71-81#pi1", "an1.82-97#pi1-1", "an1.82-97#pi1-2", "sn46.999#pi1"}
	for i, w := range want {
		if got[i].ID != w {
			t.Errorf("para %d = %s, want %s", i, got[i].ID, w)
		}
	}
	if len(gotSuttas) != 3 || gotSuttas[0].ID != "an1.71-81" || gotSuttas[0].TitlePali != "Pamādādivaggo" {
		t.Errorf("suttas = %+v", gotSuttas)
	}
	if len(unmatched) != 1 || unmatched[0] != "sn46.999" {
		t.Errorf("unmatched = %v", unmatched)
	}
}

// TestVRIFiles parses the real downloaded files:
// BUDDHA_VRI_DIR=/abs/path/data/vri/<sha> go test ./internal/canon -run VRIFiles -v
func TestVRIFiles(t *testing.T) {
	dir := os.Getenv("BUDDHA_VRI_DIR")
	if dir == "" {
		t.Skip("set BUDDHA_VRI_DIR to check the downloaded VRI files")
	}
	var allSuttas []Sutta
	var allParas []Para
	for _, b := range VRIBooks {
		suttas, paras, err := ReadVRIFile(filepath.Join(dir, b.File), b)
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("%s %s: %d suttas, %d paragraphs", b.File, b.Collection, len(suttas), len(paras))
		allSuttas, allParas = append(allSuttas, suttas...), append(allParas, paras...)
	}
	suttas, paras, unmatched := Normalize(allSuttas, allParas)
	seen := map[string]bool{}
	for _, p := range paras {
		if seen[p.ID] {
			t.Errorf("duplicate paragraph %s", p.ID)
		}
		seen[p.ID] = true
	}
	for _, s := range suttas {
		t.Logf("ID %s", s.ID)
	}
	t.Logf("after the crosswalk: %d suttas, %d paragraphs; unmatched: %v", len(suttas), len(paras), unmatched)
}
