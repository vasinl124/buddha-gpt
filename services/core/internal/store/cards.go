package store

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// Card is what the UI shows under a reply for one cited paragraph: the paragraph itself, plus the
// same paragraph in the other languages when they line up (PRD §8.3).
type Card struct {
	ID         string            `json:"id"` // the cited paragraph
	SuttaID    string            `json:"sutta_id"`
	Collection string            `json:"collection"`
	TitlePali  string            `json:"title_pi,omitempty"`
	TitleEn    string            `json:"title_en,omitempty"`
	Texts      map[string]string `json:"texts"` // lang → whole paragraph, verbatim from the source
	// Whole holds a short sutta's full text in a language whose paragraphs don't line up with
	// the cited one, so the card can still show it, labelled as the whole sutta.
	Whole map[string]string `json:"whole,omitempty"`
}

// wholeMax is the longest sutta a card shows whole: about one long paragraph.
const wholeMax = 1500

// Cards fills one card per known ID, in the order given. A sutta's paragraphs line up across
// languages when both have the same number of them; otherwise the card has only the cited
// language and the UI links to the whole sutta.
func (s *Store) Cards(ctx context.Context, ids []string) ([]Card, error) {
	out := []Card{}
	for _, id := range ids {
		var c Card
		var lang string
		var ord int
		err := s.Pool.QueryRow(ctx, `select p.id, p.sutta_id, p.lang, p.ord, s.collection,
			coalesce(s.title_pi, ''), coalesce(s.title_en, '')
			from paras p join suttas s on s.id = p.sutta_id where p.id = $1`, id).
			Scan(&c.ID, &c.SuttaID, &lang, &ord, &c.Collection, &c.TitlePali, &c.TitleEn)
		if err == pgx.ErrNoRows {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("card %s: %w", id, err)
		}
		// per language: how many paragraphs the sutta has, and the text of paragraph ord
		rows, err := s.Pool.Query(ctx, `select lang, max(ord),
			string_agg(text, ' ' order by part) filter (where ord = $2)
			from paras where sutta_id = $1 group by lang`, c.SuttaID, ord)
		if err != nil {
			return nil, err
		}
		count := map[string]int{}
		texts := map[string]*string{}
		for rows.Next() {
			var l string
			var n int
			var t *string
			if err := rows.Scan(&l, &n, &t); err != nil {
				rows.Close()
				return nil, err
			}
			count[l], texts[l] = n, t
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
		c.Texts = map[string]string{}
		for l, t := range texts {
			if t != nil && (l == lang || count[l] == count[lang]) {
				c.Texts[l] = *t
				continue
			}
			var whole string
			var size int
			if err := s.Pool.QueryRow(ctx, `select string_agg(text, E'\n\n' order by ord, part), sum(length(text))
				from paras where sutta_id = $1 and lang = $2`, c.SuttaID, l).Scan(&whole, &size); err != nil {
				return nil, err
			}
			if size <= wholeMax {
				if c.Whole == nil {
					c.Whole = map[string]string{}
				}
				c.Whole[l] = whole
			}
		}
		out = append(out, c)
	}
	return out, nil
}

// Passage returns paragraph id with up to window paragraphs either side, in the same sutta and
// language, in reading order. Parts of a split paragraph come back together.
func (s *Store) Passage(ctx context.Context, id string, window int) ([]Hit, error) {
	rows, err := s.Pool.Query(ctx, `select p.id, p.sutta_id, p.lang, p.text, 0::float8
		from paras p join paras c on c.id = $1
		where p.sutta_id = c.sutta_id and p.lang = c.lang and p.ord between c.ord - $2 and c.ord + $2
		order by p.ord, p.part`, id, window)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Hit])
}
