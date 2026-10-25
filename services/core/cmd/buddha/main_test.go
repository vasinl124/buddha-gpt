package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/vasinl124/buddha-gpt/services/core/internal/store"
)

func TestLoadEnvFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env")
	if err := os.WriteFile(path, []byte("# a=comment\n\nBUDDHA_A=from-file\nBUDDHA_B=from-file\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("BUDDHA_B", "from-env") // already set, so the file must not override it
	os.Unsetenv("BUDDHA_A")
	t.Cleanup(func() { os.Unsetenv("BUDDHA_A") })

	loadEnvFile(path)

	if a, b := os.Getenv("BUDDHA_A"), os.Getenv("BUDDHA_B"); a != "from-file" || b != "from-env" {
		t.Fatalf("got A=%q B=%q, want A=from-file B=from-env", a, b)
	}
	if _, set := os.LookupEnv("# a"); set {
		t.Fatal("a comment line was loaded")
	}
}

// fake is a backend with canned answers that records what it was asked.
type fake struct {
	ping    error
	query   string
	k       int
	ids     []string
	passage string
	window  int
}

func (f *fake) Ping(context.Context) error { return f.ping }
func (f *fake) Search(_ context.Context, q string, k int) (store.Result, error) {
	f.query, f.k = q, k
	return store.Result{Hits: []store.Hit{{ID: "sn56.11#en5", SuttaID: "sn56.11", Lang: "en"}}}, nil
}
func (f *fake) Cards(_ context.Context, ids []string) ([]store.Card, error) {
	f.ids = ids
	return []store.Card{{ID: ids[0], SuttaID: "sn56.11", Texts: map[string]string{"en": "Birth is stressful."}}}, nil
}
func (f *fake) Passage(_ context.Context, id string, window int) ([]store.Hit, error) {
	f.passage, f.window = id, window
	if id == "missing#en1" {
		return nil, nil
	}
	return []store.Hit{{ID: id}}, nil
}

func call(h http.Handler, method, path, body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(method, path, strings.NewReader(body)))
	return rec
}

func TestRoutes(t *testing.T) {
	f := &fake{}
	h := routes(f)

	if rec := call(h, "POST", "/v1/search", `{"query":"four noble truths"}`); rec.Code != http.StatusOK ||
		f.query != "four noble truths" || f.k != 8 || !strings.Contains(rec.Body.String(), `"sutta_id":"sn56.11"`) {
		t.Errorf("search: %d %s (query %q, k %d)", rec.Code, rec.Body, f.query, f.k)
	}
	if rec := call(h, "POST", "/v1/search", `{"query":"  "}`); rec.Code != http.StatusBadRequest {
		t.Errorf("empty query: %d", rec.Code)
	}

	if rec := call(h, "POST", "/v1/cards", `{"ids":["sn56.11#en5"]}`); rec.Code != http.StatusOK ||
		len(f.ids) != 1 || !strings.Contains(rec.Body.String(), `"texts":{"en":"Birth is stressful."}`) {
		t.Errorf("cards: %d %s", rec.Code, rec.Body)
	}
	if rec := call(h, "POST", "/v1/cards", `{"ids":[]}`); rec.Code != http.StatusBadRequest {
		t.Errorf("no ids: %d", rec.Code)
	}

	// IDs hold a '#', so clients percent-encode it
	if rec := call(h, "GET", "/v1/passages/sn56.11%23en5?window=2", ""); rec.Code != http.StatusOK || f.passage != "sn56.11#en5" || f.window != 2 {
		t.Errorf("passage: %d %s (id %q, window %d)", rec.Code, rec.Body, f.passage, f.window)
	}
	if rec := call(h, "GET", "/v1/passages/missing%23en1", ""); rec.Code != http.StatusNotFound {
		t.Errorf("missing passage: %d", rec.Code)
	}
	if rec := call(h, "GET", "/v1/passages/sn56.11%23en5?window=9", ""); rec.Code != http.StatusBadRequest {
		t.Errorf("window too big: %d", rec.Code)
	}
}

func TestHealthz(t *testing.T) {
	for _, tc := range []struct {
		name string
		ping error
		code int
		body string
	}{
		{"db up", nil, http.StatusOK, `{"db":"up","ok":true}`},
		{"db down", errors.New("connection refused"), http.StatusServiceUnavailable, `{"db":"down","ok":false}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := call(routes(&fake{ping: tc.ping}), "GET", "/healthz", "")
			if got := strings.TrimSpace(rec.Body.String()); rec.Code != tc.code || got != tc.body {
				t.Fatalf("got %d %s, want %d %s", rec.Code, got, tc.code, tc.body)
			}
		})
	}
}
