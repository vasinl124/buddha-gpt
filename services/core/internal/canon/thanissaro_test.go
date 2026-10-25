package canon

import (
	"os"
	"strings"
	"testing"
)

const snPage = `<html><body><main><div id="sutta">
<h1 id="SN56.11">Setting the Wheel of Dhamma in Motion<br>
  Dhammacakkappavattana Sutta  (SN 56:11)</h1>
<p><em>According to Mahāvagga I.6, this was the first discourse.</em></p>
<p class="stars">* * *</p>
<p>I have heard that on one occasion the Blessed One was staying near Vārāṇasī.</p>
<div class="block"><p>“Now this, monks, is the noble truth of stress<span class="fn"><a href="#n1">1</a></span>: Birth is stressful.”</p></div>
<div class="verse"><p>Line one,</p><p class="v2">line two.</p></div>
<p class="stars">* * *</p>
<p>After the second break.</p>
<div class="note"><p class="notetitle">Note</p><p id="sn56.11note01">1. A note.</p></div>
<p class="seealso">See also: MN 141.</p>
</div></main></body></html>`

// AN 5:191's shape: an italic introduction with upright Pali terms and no "* * *" after it
const italicIntroPage = `<div id="sutta"><h1>The Dog Discourse<br>Soṇa Sutta (AN 5:191)</h1>
<p><em>An example of the Buddha’s humor, contrasting tranquility</em> (samatha) <em>with the brahmans of his day.</em></p>
<p>“Monks, these five ancient brahmanical traditions are now observed among dogs.”</p>
</div>`

// DN 16's shape: no "* * *", an Introduction section, then the translation under its own heading
const introPage = `<div id="sutta"><h1>The Great Total Unbinding Discourse<br>Mahā Parinibbāna Sutta (DN 16)</h1>
<h2>Introduction</h2><p>Nibbāna originally was the Pali word for the extinguishing of a fire.</p>
<div class="block"><p>A quoted passage inside the essay.</p></div>
<h2>[ I ]</h2><p>I have heard that on one occasion the Blessed One was staying near Rājagaha.</p>
</div>`

const dhpPage = `<div id="sutta"><div id="DhpCh1"><h1>Dhp I : Pairs</h1>
<div class="verse" id="dhp001"><p>Phenomena are</p><p class="v6">preceded by the heart,</p></div>
<div class="verse" id="dhp002"><p>Phenomena are</p><p class="v6">ruled by the heart.</p></div>
</div></div>`

func TestParseThanissaro(t *testing.T) {
	s, paras, err := ParseThanissaro(strings.NewReader(snPage), ThanissaroID("/suttas/SN/SN56_11.html"))
	if err != nil {
		t.Fatal(err)
	}
	if s.ID != "sn56.11" || s.Collection != "SN" || s.TitleEn != "Setting the Wheel of Dhamma in Motion" || s.TitlePali != "Dhammacakkappavattana Sutta" {
		t.Errorf("sutta = %+v", s)
	}
	want := []string{
		"I have heard that on one occasion the Blessed One was staying near Vārāṇasī.",
		"“Now this, monks, is the noble truth of stress: Birth is stressful.”",
		"Line one,\nline two.",
		"After the second break.",
	}
	if len(paras) != len(want) {
		t.Fatalf("got %d paragraphs: %+v", len(paras), paras)
	}
	for i, w := range want {
		if paras[i].Text != w || paras[i].ID != "sn56.11#en"+string(rune('1'+i)) || paras[i].Lang != "en" {
			t.Errorf("para %d = %s %q, want %q", i, paras[i].ID, paras[i].Text, w)
		}
	}

	_, paras, err = ParseThanissaro(strings.NewReader(italicIntroPage), ThanissaroID("/suttas/AN/AN5_191.html"))
	if err != nil {
		t.Fatal(err)
	}
	if len(paras) != 1 || !strings.HasPrefix(paras[0].Text, "“Monks, these five") {
		t.Fatalf("italic introduction not dropped: %+v", paras)
	}

	s, paras, err = ParseThanissaro(strings.NewReader(introPage), ThanissaroID("/suttas/DN/DN16.html"))
	if err != nil {
		t.Fatal(err)
	}
	if len(paras) != 1 || !strings.HasPrefix(paras[0].Text, "I have heard") || s.TitlePali != "Mahā Parinibbāna Sutta" {
		t.Fatalf("Introduction section not dropped: %+v %+v", s, paras)
	}

	s, paras, err = ParseThanissaro(strings.NewReader(dhpPage), ThanissaroID("/suttas/KN/Dhp/Ch01.html"))
	if err != nil {
		t.Fatal(err)
	}
	if s.ID != "dhp1-2" || len(paras) != 2 || paras[1].ID != "dhp1-2#en2" || paras[1].Text != "Phenomena are\nruled by the heart." {
		t.Fatalf("Dhammapada: %+v %+v", s, paras)
	}

	for path, want := range map[string]string{
		"/suttas/MN/MN10.html":         "mn10",
		"/suttas/AN/AN4_62.html":       "an4.62",
		"/suttas/KN/StNp/StNp1_8.html": "snp1.8",
		"/suttas/DN/DN22.html":         "dn22",
	} {
		if got := ThanissaroID(path); got != want {
			t.Errorf("ThanissaroID(%s) = %s, want %s", path, got, want)
		}
	}
}

// TestThanissaroPage parses one saved page: BUDDHA_PAGE=/abs/SN56_11.html go test -run ThanissaroPage -v
func TestThanissaroPage(t *testing.T) {
	path := os.Getenv("BUDDHA_PAGE")
	if path == "" {
		t.Skip("set BUDDHA_PAGE to a saved dhammatalks.org page")
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	s, paras, err := ParseThanissaro(f, ThanissaroID(path))
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("%+v: %d paragraphs", s, len(paras))
	for _, p := range paras {
		t.Logf("%s %.90q", p.ID, p.Text)
	}
}
