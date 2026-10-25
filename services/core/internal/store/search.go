package store

import (
	"context"
	"fmt"
	"sort"

	"github.com/jackc/pgx/v5"

	"github.com/vasinl124/buddha-gpt/services/core/internal/text"
)

// Hit is one paragraph a search found.
type Hit struct {
	ID      string  `json:"id"`
	SuttaID string  `json:"sutta_id"`
	Lang    string  `json:"lang"`
	Text    string  `json:"text"`
	Score   float64 `json:"score"` // fused (RRF) score in a Result; raw similarity in a single leg
}

// Result is a hybrid search. The top raw scores of each leg feed the don't-know threshold
// (PRD §4.6), which needs real similarities, not fused ranks.
type Result struct {
	Hits       []Hit   `json:"hits"`
	TopCosine  float64 `json:"top_cosine"`
	TopLexical float64 `json:"top_lexical"`
}

// Embedder turns a query into a vector with the same model the paragraphs were embedded with.
type Embedder func(ctx context.Context, query string) ([]float32, error)

const (
	legLimit    = 50 // candidates from each leg before fusion
	rrfK        = 60 // the usual Reciprocal Rank Fusion constant
	maxPerSutta = 2  // so one long sutta can't fill every slot the model sees
)

// perSutta keeps at most max hits from any one sutta, skips a sutta's repeated refrains (the same
// text twice adds nothing), then keeps the first k.
func perSutta(hits []Hit, max, k int) []Hit {
	count := map[string]int{}
	seen := map[string]bool{}
	out := []Hit{} // never nil, so JSON says [] rather than null
	for _, h := range hits {
		key := h.SuttaID + "\x00" + h.Text
		if count[h.SuttaID] < max && !seen[key] && len(out) < k {
			count[h.SuttaID]++
			seen[key] = true
			out = append(out, h)
		}
	}
	return out
}

// Search runs the vector and lexical legs and fuses them with RRF. embed may be nil (no embedding
// model configured): the search is then lexical only. Suttas in exclude are left out of both legs
// (the risk filter, PRD §6).
func (s *Store) Search(ctx context.Context, query string, k int, model string, embed Embedder, exclude []string) (Result, error) {
	exclude = append([]string{}, exclude...) // never nil: "not (x = any(null))" would drop every row
	lex, err := s.lexical(ctx, text.Fold(query), legLimit, exclude)
	if err != nil {
		return Result{}, fmt.Errorf("lexical: %w", err)
	}
	var vec []Hit
	if embed != nil {
		v, err := embed(ctx, query)
		if err != nil {
			return Result{}, fmt.Errorf("embed query: %w", err)
		}
		if vec, err = s.vector(ctx, model, v, legLimit, exclude); err != nil {
			return Result{}, fmt.Errorf("vector: %w", err)
		}
	}
	r := Result{Hits: perSutta(Fuse(legLimit, vec, lex), maxPerSutta, k)}
	if len(vec) > 0 {
		r.TopCosine = vec[0].Score
	}
	if len(lex) > 0 {
		r.TopLexical = lex[0].Score
	}
	return r, nil
}

// Fuse merges ranked lists with Reciprocal Rank Fusion: each list adds 1/(60+rank) to a paragraph,
// so one found high in both legs beats one found by only one.
func Fuse(k int, lists ...[]Hit) []Hit {
	score := map[string]float64{}
	hit := map[string]Hit{}
	for _, list := range lists {
		for rank, h := range list {
			score[h.ID] += 1 / float64(rrfK+rank+1)
			if _, ok := hit[h.ID]; !ok {
				hit[h.ID] = h
			}
		}
	}
	out := make([]Hit, 0, len(hit))
	for id, h := range hit {
		h.Score = score[id]
		out = append(out, h)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		return out[i].ID < out[j].ID
	})
	if len(out) > k {
		out = out[:k]
	}
	return out
}

// lexical finds paragraphs containing the query's words (trigram word similarity on the folded
// text, so "anatta" finds "anattā"). Many paragraphs match a phrase exactly, so ties go to full
// paragraphs over abbreviated repetitions ("…pe…"), then to the one the query fills most of.
// ponytail: hand-tuned order and a 40-character floor for stubs; let the Phase 5 evals tune it.
func (s *Store) lexical(ctx context.Context, folded string, limit int, exclude []string) ([]Hit, error) {
	rows, err := s.Pool.Query(ctx, `select id, sutta_id, lang, text, word_similarity($1, lex) as score
		from paras where $1 <% lex and length(lex) >= 40 and not (sutta_id = any($3))
		order by score desc, lex like '%…pe…%', similarity($1, lex) desc, id limit $2`, folded, limit, exclude)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Hit])
}

// vector finds the paragraphs nearest the query vector by cosine. The production model uses its
// HNSW index (the cast must match the index expression); other models scan.
func (s *Store) vector(ctx context.Context, model string, v []float32, limit int, exclude []string) ([]Hit, error) {
	q := `select p.id, p.sutta_id, p.lang, p.text, 1 - (x.v <=> $1::vector) as score
		from para_vecs x join paras p on p.id = x.para_id
		where x.model = $3 and not (p.sutta_id = any($4)) order by x.v <=> $1::vector limit $2`
	if model == "baai/bge-m3" {
		q = `select p.id, p.sutta_id, p.lang, p.text, 1 - ((x.v::vector(1024)) <=> $1::vector(1024)) as score
			from para_vecs x join paras p on p.id = x.para_id
			where x.model = $3 and not (p.sutta_id = any($4)) order by (x.v::vector(1024)) <=> $1::vector(1024) limit $2`
	}
	rows, err := s.Pool.Query(ctx, q, vectorLiteral(v), limit, model, exclude)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Hit])
}
