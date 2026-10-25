// Package store owns the canon tables: migrations, loading paragraphs, vectors and search.
package store

import (
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"fmt"
	"io/fs"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vasinl124/buddha-gpt/services/core/internal/canon"
	"github.com/vasinl124/buddha-gpt/services/core/internal/text"
)

//go:embed migrations/*.sql
var migrations embed.FS

type Store struct{ Pool *pgxpool.Pool }

// Open connects and applies any new migrations.
func Open(ctx context.Context, url string) (*Store, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, err
	}
	s := &Store{pool}
	if err := s.migrate(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return s, nil
}

func (s *Store) Close() { s.Pool.Close() }

// migrate applies migrations/*.sql in name order, each once, under a lock so `serve` and `sync`
// starting together don't race.
func (s *Store) migrate(ctx context.Context) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext('buddha-migrate'));
		create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())`); err != nil {
		return err
	}
	names, _ := fs.Glob(migrations, "migrations/*.sql")
	sort.Strings(names)
	for _, name := range names {
		var done bool
		if err := tx.QueryRow(ctx, `select exists(select 1 from schema_migrations where version = $1)`, name).Scan(&done); err != nil {
			return err
		}
		if done {
			continue
		}
		sql, _ := migrations.ReadFile(name)
		if _, err := tx.Exec(ctx, string(sql)); err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
		if _, err := tx.Exec(ctx, `insert into schema_migrations (version) values ($1)`, name); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// Loaded reports what a Load changed.
type Loaded struct{ Paras, Changed, Removed int }

// Load replaces one source's paragraphs in a single transaction. A paragraph whose text changed
// loses its vectors (so the next embed redoes it), and paragraphs gone from the source are deleted.
func (s *Store) Load(ctx context.Context, source string, suttas []canon.Sutta, paras []canon.Para) (Loaded, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Loaded{}, err
	}
	defer tx.Rollback(ctx)

	b := &pgx.Batch{}
	for _, st := range suttas {
		b.Queue(`insert into suttas (id, collection, title_pi, title_en) values ($1, $2, nullif($3, ''), nullif($4, ''))
			on conflict (id) do update set collection = excluded.collection,
				title_pi = coalesce(excluded.title_pi, suttas.title_pi), title_en = coalesce(excluded.title_en, suttas.title_en)`,
			st.ID, st.Collection, st.TitlePali, st.TitleEn)
	}
	if err := tx.SendBatch(ctx, b).Close(); err != nil {
		return Loaded{}, fmt.Errorf("suttas: %w", err)
	}

	if _, err := tx.Exec(ctx, `create temp table incoming (like paras) on commit drop`); err != nil {
		return Loaded{}, err
	}
	rows := make([][]any, len(paras))
	for i, p := range paras {
		sum := sha256.Sum256([]byte(p.Text))
		rows[i] = []any{p.ID, p.SuttaID, p.Lang, p.Ord, p.Part, p.Source, p.Text, text.Fold(p.Text), hex.EncodeToString(sum[:8])}
	}
	cols := []string{"id", "sutta_id", "lang", "ord", "part", "source", "text", "lex", "hash"}
	if _, err := tx.CopyFrom(ctx, pgx.Identifier{"incoming"}, cols, pgx.CopyFromRows(rows)); err != nil {
		return Loaded{}, fmt.Errorf("copy: %w", err)
	}
	if _, err := tx.Exec(ctx, `delete from para_vecs v using paras p, incoming i
		where v.para_id = p.id and p.id = i.id and p.hash <> i.hash`); err != nil {
		return Loaded{}, err
	}
	up, err := tx.Exec(ctx, `insert into paras select * from incoming on conflict (id) do update set
		sutta_id = excluded.sutta_id, lang = excluded.lang, ord = excluded.ord, part = excluded.part,
		source = excluded.source, text = excluded.text, lex = excluded.lex, hash = excluded.hash
		where paras.hash <> excluded.hash`)
	if err != nil {
		return Loaded{}, fmt.Errorf("upsert: %w", err)
	}
	del, err := tx.Exec(ctx, `delete from paras p where p.source = $1
		and not exists (select 1 from incoming i where i.id = p.id)`, source)
	if err != nil {
		return Loaded{}, err
	}
	return Loaded{len(paras), int(up.RowsAffected()), int(del.RowsAffected())}, tx.Commit(ctx)
}

// MissingVectors returns up to limit paragraphs in langs with no vector for model yet.
func (s *Store) MissingVectors(ctx context.Context, model string, langs []string, limit int) ([]canon.Para, error) {
	rows, err := s.Pool.Query(ctx, `select p.id, p.text from paras p
		where p.lang = any($2) and not exists (select 1 from para_vecs v where v.para_id = p.id and v.model = $1)
		order by p.id limit $3`, model, langs, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (canon.Para, error) {
		var p canon.Para
		return p, r.Scan(&p.ID, &p.Text)
	})
}

// SaveVectors stores one vector per paragraph ID for model.
func (s *Store) SaveVectors(ctx context.Context, model string, ids []string, vecs [][]float32) error {
	b := &pgx.Batch{}
	for i, id := range ids {
		b.Queue(`insert into para_vecs (para_id, model, v) values ($1, $2, $3::vector)
			on conflict (para_id, model) do update set v = excluded.v`, id, model, vectorLiteral(vecs[i]))
	}
	return s.Pool.SendBatch(ctx, b).Close()
}

// CountVectors returns how many paragraphs have a vector for model, and how many could.
func (s *Store) CountVectors(ctx context.Context, model string, langs []string) (have, total int, err error) {
	err = s.Pool.QueryRow(ctx, `select
		(select count(*) from para_vecs v join paras p on p.id = v.para_id where v.model = $1 and p.lang = any($2)),
		(select count(*) from paras where lang = any($2))`, model, langs).Scan(&have, &total)
	return
}

// vectorLiteral formats v as pgvector's text input: [0.1,0.2,…].
func vectorLiteral(v []float32) string {
	var b strings.Builder
	b.WriteByte('[')
	for i, f := range v {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(strconv.FormatFloat(float64(f), 'g', -1, 32))
	}
	b.WriteByte(']')
	return b.String()
}
