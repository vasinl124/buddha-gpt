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

func TestSearchRoute(t *testing.T) {
	var gotQuery string
	var gotK int
	search := func(_ context.Context, q string, k int) (store.Result, error) {
		gotQuery, gotK = q, k
		return store.Result{Hits: []store.Hit{{ID: "sn56.11#en5", SuttaID: "sn56.11", Lang: "en"}}}, nil
	}
	h := routes(nil, search)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("POST", "/v1/search", strings.NewReader(`{"query":"four noble truths"}`)))
	if rec.Code != http.StatusOK || gotQuery != "four noble truths" || gotK != 8 || !strings.Contains(rec.Body.String(), `"sutta_id":"sn56.11"`) {
		t.Fatalf("got %d %s (query %q, k %d)", rec.Code, rec.Body, gotQuery, gotK)
	}

	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("POST", "/v1/search", strings.NewReader(`{"query":"  "}`)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("empty query: got %d", rec.Code)
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
			rec := httptest.NewRecorder()
			routes(func(context.Context) error { return tc.ping }, nil).ServeHTTP(rec, httptest.NewRequest("GET", "/healthz", nil))
			if got := strings.TrimSpace(rec.Body.String()); rec.Code != tc.code || got != tc.body {
				t.Fatalf("got %d %s, want %d %s", rec.Code, got, tc.code, tc.body)
			}
		})
	}
}
