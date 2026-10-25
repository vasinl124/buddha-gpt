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

// Cards fills one card per known ID, in the order given. Where a sutta's paragraphs line up
// across languages (lineUp), the card has the cited paragraph in each; otherwise it has only the
// cited language and the UI links to the whole sutta.
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
		// per language: the length of each of the sutta's paragraphs, in order, and the text of
		// paragraph ord
		rows, err := s.Pool.Query(ctx, `select lang, sum(length(text)),
			string_agg(text, ' ' order by part) filter (where ord = $2)
			from paras where sutta_id = $1 group by lang, ord order by lang, ord`, c.SuttaID, ord)
		if err != nil {
			return nil, err
		}
		lens := map[string][]int{}
		texts := map[string]*string{}
		for rows.Next() {
			var l string
			var n int
			var t *string
			if err := rows.Scan(&l, &n, &t); err != nil {
				rows.Close()
				return nil, err
			}
			lens[l] = append(lens[l], n)
			if t != nil {
				texts[l] = t
			}
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
		c.Texts = map[string]string{}
		for l := range lens {
			if t := texts[l]; t != nil && (l == lang || lineUp(lens[l], lens[lang])) {
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

// lineUp reports whether two languages' paragraphs of a sutta, given as their lengths in order,
// pair up one to one: as many of them, and each one's share of the sutta within a factor of two
// of its partner's. A count can match by chance: MN 10 has 94 paragraphs in Pali and in English,
// which drift apart midway, and pairing them would put the wrong translation on a card.
func lineUp(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	var ta, tb int
	for i := range a {
		ta, tb = ta+a[i], tb+b[i]
	}
	for i := range a {
		// a[i]/ta against b[i]/tb, cross-multiplied
		if x, y := a[i]*tb, b[i]*ta; x > 2*y || y > 2*x {
			return false
		}
	}
	return true
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

// Paragraphs returns up to limit of a sutta's paragraphs in one language, in order, each with its
// parts joined under its first part's ID: the Pali that Pali mode can quote (PRD §5.1). With near,
// a paragraph of the same sutta in any language, the window is centred where that paragraph falls,
// in proportion to each language's length, so the relevant part of a long sutta is in it.
func (s *Store) Paragraphs(ctx context.Context, suttaID, lang, near string, limit int) ([]Hit, error) {
	center := 0
	if near != "" {
		err := s.Pool.QueryRow(ctx, `select coalesce(round(n.ord::numeric
			* (select max(x.ord) from paras x where x.sutta_id = n.sutta_id and x.lang = $2)
			/ nullif((select max(x.ord) from paras x where x.sutta_id = n.sutta_id and x.lang = n.lang), 0)), 0)::int
			from paras n where n.id = $1 and n.sutta_id = $3`, near, lang, suttaID).Scan(&center)
		if err != nil && err != pgx.ErrNoRows {
			return nil, err
		}
	}
	rows, err := s.Pool.Query(ctx, `select (array_agg(id order by part))[1], sutta_id, lang,
		string_agg(text, ' ' order by part), 0::float8
		from paras where sutta_id = $1 and lang = $2 and ord >= $4
		group by sutta_id, lang, ord order by ord limit $3`, suttaID, lang, limit, max(center-limit/2, 0))
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Hit])
}
