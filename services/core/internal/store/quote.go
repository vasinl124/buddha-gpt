package store

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/vasinl124/buddha-gpt/services/core/internal/text"
)

// Line is a sentence of a paragraph (or two in a row) scored against a quote.
type Line struct {
	Hit            // the paragraph it's in, whole
	Line   string  `json:"line"`
	Words  float64 `json:"words"`  // trigram word similarity: how much of the quote's words the line holds
	Cosine float64 `json:"cosine"` // the quote's cosine to the line; 0 when the lookup is by words only
}

// QuoteResult is the lines closest in meaning to a quote, best first and one per paragraph, and the
// line that holds the most of its words, wherever that one ranks.
type QuoteResult struct {
	Lines []Line `json:"lines"`
	Words *Line  `json:"words"` // nil when no line shares a word with the quote
}

// EmbedMany turns texts into vectors with the paragraphs' model, in input order.
type EmbedMany func(ctx context.Context, texts []string) ([][]float32, error)

const (
	quotePool   = 12              // candidate paragraphs from each leg
	quoteFloor  = 0.35            // word similarity that brings a paragraph in from the lexical leg
	quoteLines  = 300             // lines embedded at most, from the best-ranked paragraphs down
	quoteBatch  = 64              // lines per embedding request, several in flight at once
	quoteEmbed  = 8 * time.Second // a few hundred lines take longer to embed than one query
	quoteResult = 8               // lines returned
)

// Quote looks up words someone attributes to the Buddha (PRD §6), line by line. A paragraph is the
// wrong unit for it: a long verse holds one matching line among dozens, and both its trigram score
// and its vector drift toward the rest of it. So each leg gathers candidate paragraphs (the lexical
// one with a lower floor than Search's), and every sentence in them is scored on its own: by its
// words, and by its meaning when embed is set. Embedding failing or timing out leaves the words.
func (s *Store) Quote(ctx context.Context, quote, model string, embed EmbedMany, exclude []string) (QuoteResult, error) {
	exclude = append([]string{}, exclude...)
	folded := text.Fold(quote)
	lex, err := s.loose(ctx, folded, quotePool, exclude)
	if err != nil {
		return QuoteResult{}, fmt.Errorf("lexical: %w", err)
	}
	var qv []float32
	var vec []Hit
	ectx, cancel := context.WithTimeout(ctx, quoteEmbed)
	defer cancel()
	if embed != nil {
		if v, err := embed(ectx, []string{quote}); err != nil {
			log.Printf("quote: by words only, embedding the quote failed: %v", err)
		} else if vec, err = s.vector(ctx, model, v[0], quotePool, exclude); err != nil {
			return QuoteResult{}, fmt.Errorf("vector: %w", err)
		} else {
			qv = v[0]
		}
	}
	// the legs' paragraphs taken in turn, best first, so the embedding cap cuts the weakest
	var lines []Line
	seen := map[string]bool{}
	for i := 0; i < max(len(lex), len(vec)); i++ {
		for _, leg := range [][]Hit{lex, vec} {
			if i < len(leg) && !seen[leg[i].ID] {
				seen[leg[i].ID] = true
				for _, l := range Lines(leg[i].Text) {
					lines = append(lines, Line{Hit: leg[i], Line: l})
				}
			}
		}
	}
	if err := s.words(ctx, folded, lines); err != nil {
		return QuoteResult{}, fmt.Errorf("words: %w", err)
	}
	if qv != nil {
		if err := cosines(ectx, embed, qv, lines[:min(len(lines), quoteLines)]); err != nil {
			log.Printf("quote: by words only, embedding its lines failed: %v", err)
		}
	}
	return rank(lines), nil
}

// rank orders the lines by meaning (by words when none has a cosine), keeps each paragraph's best,
// and picks out the line holding the most of the quote's words.
func rank(lines []Line) QuoteResult {
	r := QuoteResult{Lines: []Line{}}
	for _, l := range lines {
		if l.Words > 0 && (r.Words == nil || l.Words > r.Words.Words) {
			r.Words = &l
		}
	}
	sort.SliceStable(lines, func(i, j int) bool {
		if lines[i].Cosine != lines[j].Cosine {
			return lines[i].Cosine > lines[j].Cosine
		}
		return lines[i].Words > lines[j].Words
	})
	seen := map[string]bool{}
	for _, l := range lines {
		if !seen[l.ID] && len(r.Lines) < quoteResult {
			seen[l.ID] = true
			r.Lines = append(r.Lines, l)
		}
	}
	return r
}

// loose is the lexical leg with a lower floor than Search's: a quote is often a loose paraphrase, and
// a long paragraph dilutes the one line that matches.
func (s *Store) loose(ctx context.Context, folded string, limit int, exclude []string) ([]Hit, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, fmt.Sprintf("set local pg_trgm.word_similarity_threshold = %g", quoteFloor)); err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx, `select id, sutta_id, lang, text, word_similarity($1, lex) as score
		from paras where $1 <% lex and length(lex) >= 40 and not (sutta_id = any($3))
		order by score desc, lex like '%…pe…%', id limit $2`, folded, limit, exclude)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Hit])
}

// words sets each line's trigram word similarity to the folded quote, in one query, with the same
// function the index uses.
func (s *Store) words(ctx context.Context, folded string, lines []Line) error {
	if len(lines) == 0 {
		return nil
	}
	texts := make([]string, len(lines))
	for i, l := range lines {
		texts[i] = text.Fold(l.Line)
	}
	rows, err := s.Pool.Query(ctx, `select word_similarity($1, t) from unnest($2::text[]) with ordinality as u(t, n) order by n`, folded, texts)
	if err != nil {
		return err
	}
	scores, err := pgx.CollectRows(rows, pgx.RowTo[float64])
	if err != nil {
		return err
	}
	for i := range lines {
		lines[i].Words = scores[i]
	}
	return nil
}

// cosines sets each line's cosine to the quote's vector, embedding the lines in batches at once.
func cosines(ctx context.Context, embed EmbedMany, qv []float32, lines []Line) error {
	var wg sync.WaitGroup
	errs := make([]error, (len(lines)+quoteBatch-1)/quoteBatch)
	for b := range errs {
		part := lines[b*quoteBatch : min((b+1)*quoteBatch, len(lines))]
		wg.Add(1)
		go func() {
			defer wg.Done()
			texts := make([]string, len(part))
			for i, l := range part {
				texts[i] = l.Line
			}
			vs, err := embed(ctx, texts)
			if err != nil {
				errs[b] = err
				return
			}
			for i := range part {
				part[i].Cosine = cosine(qv, vs[i])
			}
		}()
	}
	wg.Wait()
	return errors.Join(errs...)
}

func cosine(a, b []float32) float64 {
	var dot, na, nb float64
	for i := range a {
		dot += float64(a[i]) * float64(b[i])
		na += float64(a[i]) * float64(a[i])
		nb += float64(b[i]) * float64(b[i])
	}
	if na == 0 || nb == 0 {
		return 0
	}
	return dot / math.Sqrt(na*nb)
}

var (
	sentenceEnd = regexp.MustCompile(`[.!?;]["'’”)]*\s+`)
	thaiLetter  = regexp.MustCompile(`[\x{0E00}-\x{0E7F}]`)
)

// Lines splits a paragraph into sentences, and adds each two in a row, since a saying often runs
// across two. Verse line breaks count as spaces. Thai has no full stop, so its spaces end its
// phrases. A fragment under 12 characters joins the next.
func Lines(paragraph string) []string {
	s := strings.Join(strings.Fields(paragraph), " ")
	var parts []string
	if thaiLetter.MatchString(s) {
		parts = strings.Split(s, " ")
	} else {
		last := 0
		for _, m := range sentenceEnd.FindAllStringIndex(s, -1) {
			parts = append(parts, s[last:m[1]])
			last = m[1]
		}
		parts = append(parts, s[last:])
	}
	var sentences []string
	carry := ""
	for _, p := range parts {
		p = strings.TrimSpace(carry + " " + p)
		if len([]rune(p)) < 12 {
			carry = p
			continue
		}
		sentences, carry = append(sentences, p), ""
	}
	if carry != "" {
		if n := len(sentences); n > 0 {
			sentences[n-1] += " " + carry
		} else {
			sentences = []string{carry}
		}
	}
	out := append([]string{}, sentences...)
	for i := 0; i+1 < len(sentences); i++ {
		out = append(out, sentences[i]+" "+sentences[i+1])
	}
	return out
}
