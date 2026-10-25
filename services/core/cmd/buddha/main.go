// Command buddha is the Go side of buddha-gpt: the Retrieval API, ingest and evals.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/vasinl124/buddha-gpt/services/core/internal/canon"
	"github.com/vasinl124/buddha-gpt/services/core/internal/embed"
	"github.com/vasinl124/buddha-gpt/services/core/internal/fetch"
	"github.com/vasinl124/buddha-gpt/services/core/internal/store"
)

const addr = ":7890"

func main() {
	loadEnvFile("../../.env") // the repo-root .env; the root scripts run this from services/core
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: buddha <serve|sync|search|eval>")
		os.Exit(2)
	}
	ctx := context.Background()
	var err error
	switch os.Args[1] {
	case "serve":
		err = serve(ctx)
	case "sync":
		err = runSync(ctx)
	case "search":
		err = runSearch(ctx, os.Args[2:])
	case "eval":
		err = runEval(ctx, os.Args[2:])
	default:
		fmt.Fprintf(os.Stderr, "buddha: unknown command %q\n", os.Args[1])
		os.Exit(2)
	}
	if err != nil {
		log.Fatal(err)
	}
}

func dbURL() string {
	return env("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/buddha_gpt")
}

func serve(ctx context.Context) error {
	st, err := store.Open(ctx, dbURL())
	if err != nil {
		return err
	}
	defer st.Close()
	emb := embed.FromEnv()
	if !emb.Ready() {
		log.Print("no OPENROUTER_API_KEY: search is lexical only")
	}
	log.Printf("Retrieval API listening on %s", addr)
	return http.ListenAndServe(addr, routes(newLive(st, emb)))
}

// backend is what the HTTP routes need: the store implements it, the tests fake it.
type backend interface {
	Ping(ctx context.Context) error
	Search(ctx context.Context, query string, k int, exclude []string) (store.Result, error)
	Cards(ctx context.Context, ids []string) ([]store.Card, error)
	Passage(ctx context.Context, id string, window int) ([]store.Hit, error)
	Paragraphs(ctx context.Context, suttaID, lang, near string, limit int) ([]store.Hit, error)
}

type live struct {
	st    *store.Store
	model string
	embed store.Embedder // nil when no embedding model is configured: search is lexical only
}

func newLive(st *store.Store, emb *embed.Client) live {
	l := live{st: st, model: emb.Model}
	if emb.Ready() {
		l.embed = func(ctx context.Context, q string) ([]float32, error) {
			v, err := emb.Embed(ctx, []string{q})
			if err != nil {
				return nil, err
			}
			return v[0], nil
		}
	}
	return l
}

func (l live) Ping(ctx context.Context) error { return l.st.Pool.Ping(ctx) }
func (l live) Search(ctx context.Context, q string, k int, exclude []string) (store.Result, error) {
	return l.st.Search(ctx, q, k, l.model, l.embed, exclude)
}
func (l live) Cards(ctx context.Context, ids []string) ([]store.Card, error) {
	return l.st.Cards(ctx, ids)
}
func (l live) Passage(ctx context.Context, id string, window int) ([]store.Hit, error) {
	return l.st.Passage(ctx, id, window)
}
func (l live) Paragraphs(ctx context.Context, suttaID, lang, near string, limit int) ([]store.Hit, error) {
	return l.st.Paragraphs(ctx, suttaID, lang, near, limit)
}

func routes(b backend) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), time.Second)
		defer cancel()
		db, code := "up", http.StatusOK
		if err := b.Ping(ctx); err != nil {
			db, code = "down", http.StatusServiceUnavailable
		}
		writeJSON(w, code, map[string]any{"ok": code == http.StatusOK, "db": db})
	})
	// cards for the paragraphs a reply cites, filled verbatim from the database
	mux.HandleFunc("POST /v1/cards", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			IDs []string `json:"ids"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&req); err != nil || len(req.IDs) == 0 || len(req.IDs) > 20 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "send {\"ids\": [\"sn56.11#en5\"]} (1 to 20)"})
			return
		}
		cards, err := b.Cards(r.Context(), req.IDs)
		if err != nil {
			log.Printf("cards: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "cards failed"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"cards": cards})
	})
	// one paragraph and its neighbours: the get_passage tool
	mux.HandleFunc("GET /v1/passages/{id}", func(w http.ResponseWriter, r *http.Request) {
		window := 1
		if v := r.URL.Query().Get("window"); v != "" {
			n, err := strconv.Atoi(v)
			if err != nil || n < 0 || n > 5 {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "window is 0 to 5"})
				return
			}
			window = n
		}
		hits, err := b.Passage(r.Context(), r.PathValue("id"), window)
		if err != nil {
			log.Printf("passage: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "passage failed"})
			return
		}
		if len(hits) == 0 {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such paragraph"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"passage": hits})
	})
	// a sutta's paragraphs in one language, for Pali mode: ?lang=pi&limit=12&near=sn56.11%23en5
	mux.HandleFunc("GET /v1/suttas/{id}/paragraphs", func(w http.ResponseWriter, r *http.Request) {
		lang := r.URL.Query().Get("lang")
		limit, err := strconv.Atoi(r.URL.Query().Get("limit"))
		if r.URL.Query().Get("limit") == "" {
			limit, err = 12, nil
		}
		if (lang != "pi" && lang != "th" && lang != "en") || err != nil || limit < 1 || limit > 50 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "lang is pi, th or en; limit is 1 to 50"})
			return
		}
		hits, err := b.Paragraphs(r.Context(), r.PathValue("id"), lang, r.URL.Query().Get("near"), limit)
		if err != nil {
			log.Printf("paragraphs: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "paragraphs failed"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"paragraphs": hits})
	})
	mux.HandleFunc("POST /v1/search", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Query   string   `json:"query"`
			K       int      `json:"k"`
			Exclude []string `json:"exclude"` // sutta IDs to leave out: the risk filter
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&req); err != nil || strings.TrimSpace(req.Query) == "" || len(req.Exclude) > 50 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "send {\"query\": \"…\"}, with at most 50 suttas to exclude"})
			return
		}
		if req.K <= 0 || req.K > 50 {
			req.K = 8 // the number the model sees (PRD §8.5)
		}
		res, err := b.Search(r.Context(), req.Query, req.K, req.Exclude)
		if err != nil {
			log.Printf("search: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "search failed"})
			return
		}
		writeJSON(w, http.StatusOK, res)
	})
	return mux
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

// runSync downloads the sources, parses them, loads Postgres and embeds what's new.
func runSync(ctx context.Context) error {
	st, err := store.Open(ctx, dbURL())
	if err != nil {
		return err
	}
	defer st.Close()
	data := env("DATA_DIR", "../../data")

	// Pali: VRI's Chaṭṭha Saṅgāyana XML
	var files []string
	for _, b := range canon.VRIBooks {
		files = append(files, b.File)
	}
	dir, err := fetch.VRI(ctx, data, files)
	if err != nil {
		return err
	}
	var suttas []canon.Sutta
	var paras []canon.Para
	for _, b := range canon.VRIBooks {
		s, p, err := canon.ReadVRIFile(filepath.Join(dir, b.File), b)
		if err != nil {
			return err
		}
		suttas, paras = append(suttas, s...), append(paras, p...)
	}
	if err := load(ctx, st, "vri", suttas, paras); err != nil {
		return err
	}

	// English: Ṭhānissaro Bhikkhu's translations from dhammatalks.org
	pages, err := fetch.Thanissaro(ctx, data)
	if err != nil {
		return err
	}
	paths := make([]string, 0, len(pages))
	for p := range pages {
		paths = append(paths, p)
	}
	sort.Strings(paths)
	suttas, paras = nil, nil
	for _, path := range paths {
		f, err := os.Open(pages[path])
		if err != nil {
			return err
		}
		s, p, err := canon.ParseThanissaro(f, canon.ThanissaroID(path))
		f.Close()
		if err != nil {
			log.Printf("skip %s: %v", path, err)
			continue
		}
		suttas, paras = append(suttas, s), append(paras, p...)
	}
	if err := load(ctx, st, "thanissaro", suttas, paras); err != nil {
		return err
	}

	// Thai: the Royal translation, one PDF per volume, with each sutta's start found by its
	// opening words in sc-data's ID-keyed copy
	var vols []int
	for _, v := range canon.ThaiVolumes {
		vols = append(vols, v.N)
	}
	pdfs, err := fetch.Thai(ctx, data, vols)
	if err != nil {
		return err
	}
	sc, err := fetch.SCData(ctx, data)
	if err != nil {
		return err
	}
	suttas, paras = nil, nil
	for _, v := range canon.ThaiVolumes {
		text, err := pdfText(ctx, pdfs[v.N])
		if err != nil {
			return err
		}
		refs, err := canon.ThaiRefs(sc, v)
		if err != nil {
			return err
		}
		s, p, left := canon.ParseThai(text, refs)
		log.Printf("thai volume %d: %d of %d suttas, %d paragraphs", v.N, len(s), len(refs), len(p))
		if len(left) > 0 {
			log.Printf("thai volume %d: left out %s (opening not found, or the sutta after it wasn't)", v.N, strings.Join(left, " "))
		}
		suttas, paras = append(suttas, s...), append(paras, p...)
	}
	if err := load(ctx, st, "royal", suttas, paras); err != nil {
		return err
	}
	return embedMissing(ctx, st, embed.FromEnv())
}

// pdfText reads a PDF's text with pdftotext (poppler), which maps Thai through the PDF's own
// character maps.
func pdfText(ctx context.Context, path string) (string, error) {
	out, err := exec.CommandContext(ctx, "pdftotext", "-enc", "UTF-8", path, "-").Output()
	if errors.Is(err, exec.ErrNotFound) {
		return "", errors.New("pdftotext not found: install poppler (brew install poppler, or apt install poppler-utils)")
	}
	return string(out), err
}

func load(ctx context.Context, st *store.Store, source string, suttas []canon.Sutta, paras []canon.Para) error {
	suttas, paras, unmatched := canon.Normalize(suttas, paras)
	l, err := st.Load(ctx, source, suttas, paras)
	if err != nil {
		return fmt.Errorf("load %s: %w", source, err)
	}
	log.Printf("%s: %d suttas, %d paragraphs (%d new or changed, %d removed)", source, len(suttas), l.Paras, l.Changed, l.Removed)
	if len(unmatched) > 0 {
		sort.Strings(unmatched)
		log.Printf("%s: %d IDs have no SuttaCentral match, kept as is: %s", source, len(unmatched), strings.Join(unmatched, " "))
	}
	return nil
}

// embedMissing embeds English paragraphs that have no vector for the configured model. Pali
// isn't embedded: models handle it poorly, so it's searched lexically (PRD §8.4).
func embedMissing(ctx context.Context, st *store.Store, emb *embed.Client) error {
	if !emb.Ready() {
		log.Print("no OPENROUTER_API_KEY: skipping embeddings, so search stays lexical until you add one")
		return nil
	}
	langs := []string{"en"}
	done := 0
	for {
		batch, err := st.MissingVectors(ctx, emb.Model, langs, 64)
		if err != nil || len(batch) == 0 {
			if err == nil {
				have, total, _ := st.CountVectors(ctx, emb.Model, langs)
				log.Printf("embeddings (%s): %d of %d paragraphs", emb.Model, have, total)
			}
			return err
		}
		texts, ids := make([]string, len(batch)), make([]string, len(batch))
		for i, p := range batch {
			texts[i], ids[i] = p.Text, p.ID
		}
		vecs, err := emb.Embed(ctx, texts)
		if err != nil {
			return err
		}
		if err := st.SaveVectors(ctx, emb.Model, ids, vecs); err != nil {
			return err
		}
		if done += len(batch); done%1024 < len(batch) {
			log.Printf("embedded %d paragraphs…", done)
		}
	}
}

// runSearch is the Phase 1 demo: buddha search "four noble truths".
func runSearch(ctx context.Context, args []string) error {
	fs := flag.NewFlagSet("search", flag.ExitOnError)
	k := fs.Int("k", 8, "number of results")
	fs.Parse(args)
	query := strings.Join(fs.Args(), " ")
	if query == "" {
		return fmt.Errorf(`usage: buddha search [-k 8] "four noble truths"`)
	}
	st, err := store.Open(ctx, dbURL())
	if err != nil {
		return err
	}
	defer st.Close()
	emb := embed.FromEnv()
	res, err := newLive(st, emb).Search(ctx, query, *k, nil)
	if err != nil {
		return err
	}
	for i, h := range res.Hits {
		fmt.Printf("%2d. %-16s %s  %.4f  %.100s\n", i+1, h.SuttaID, h.Lang, h.Score, strings.ReplaceAll(h.Text, "\n", " / "))
	}
	mode := "hybrid, " + emb.Model
	if !emb.Ready() {
		mode = "lexical only"
	}
	fmt.Printf("(%s; top cosine %.3f, top lexical %.3f)\n", mode, res.TopCosine, res.TopLexical)
	return nil
}

// loadEnvFile sets KEY=VALUE lines from path without overriding variables that are already set.
// A missing file is fine: every setting has a local default.
// ponytail: no quotes, `export` or multi-line values; switch to godotenv if .env ever needs them.
func loadEnvFile(path string) {
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(data), "\n") {
		key, value, ok := strings.Cut(strings.TrimSpace(line), "=")
		if !ok || strings.HasPrefix(key, "#") {
			continue
		}
		if _, set := os.LookupEnv(key); !set {
			os.Setenv(key, value)
		}
	}
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
