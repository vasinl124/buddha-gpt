package main

import (
	"strings"
	"testing"

	"github.com/vasinl124/buddha-gpt/services/core/internal/store"
)

func TestScore(t *testing.T) {
	card := store.Card{ID: "sn56.11#en4", Texts: map[string]string{"en": "“Now this, monks, is the noble truth of stress: Birth is stressful.”"}}
	answer := func(reply string) evalReply {
		var r evalReply
		r.Reply, r.Cards = reply, []store.Card{card}
		r.Debug.Route, r.Debug.Searched = "answer", []string{"sn56.11#en4"}
		r.Debug.Retrieved, r.Debug.Cited = []string{"sn56.11#en4"}, []string{"sn56.11#en4"}
		return r
	}
	var four evalCase
	four.Expect.Route, four.Expect.Sutta, four.Expect.Reply = "answer", "sn56.11", "en"

	ok := evalResult{Case: four, Reply: answer(`I taught that "birth is stressful." [[cite:sn56.11#en4]]`)}
	score(&ok)
	if len(ok.Problems) != 0 || !*ok.Recall {
		t.Errorf("a good answer has problems: %v", ok.Problems)
	}

	// a short quoted word, then a quote from the card: nothing between them reads as a quote
	words := evalResult{Case: four, Reply: answer(`Do not call it "self", for it is not lasting. As I taught, "birth is stressful." [[cite:sn56.11#en4]]`)}
	score(&words)
	if len(words.Problems) != 0 {
		t.Errorf("a short quoted word made problems: %v", words.Problems)
	}

	bad := evalResult{Case: four, Reply: answer(`I said "peace comes from within, do not seek it without."`)}
	bad.Reply.Debug.Searched = []string{"mn22#en1"}
	bad.Reply.Debug.Cited = append(bad.Reply.Debug.Cited, "mn999#en1")
	score(&bad)
	for _, want := range []string{"sn56.11 not in the top 8", "cited mn999#en1", "fabricated"} {
		if !strings.Contains(strings.Join(bad.Problems, "; "), want) {
			t.Errorf("missing problem %q in %v", want, bad.Problems)
		}
	}

	var crisis evalCase
	crisis.Expect.Route, crisis.Expect.Reply = "crisis", "th"
	c := evalResult{Case: crisis, Reply: answer("เราอยู่ตรงนี้กับท่าน")}
	c.Reply.Debug.Route = "crisis"
	c.Reply.Crisis = &struct {
		Lines []struct {
			Number string `json:"number"`
		} `json:"lines"`
	}{Lines: []struct {
		Number string `json:"number"`
	}{{"1323"}, {"1669"}, {"1300"}, {"1387"}}}
	score(&c)
	if strings.Join(c.Problems, "; ") != "crisis: no 191" {
		t.Errorf("crisis problems = %v", c.Problems)
	}

	report, pass := summarize([]evalResult{ok, bad, c}, false)
	if pass || !strings.Contains(report, "| Retrieval Recall@8 | 0.50 (1/2) | ≥ 0.85 | **fail** |") {
		t.Errorf("report:\n%s", report)
	}
}

func TestReplyLang(t *testing.T) {
	for s, want := range map[string]string{
		"Birth is stressful, and so is aging.":            "en",
		"ความเกิดก็เป็นทุกข์ [[cite:sn56.11#th2]]":        "th",
		"‘‘Idaṃ kho pana, bhikkhave, dukkhaṃ ariyasaccaṃ": "pi",
	} {
		if got := replyLang(s); got != want {
			t.Errorf("replyLang(%q) = %s, want %s", s, got, want)
		}
	}
}
