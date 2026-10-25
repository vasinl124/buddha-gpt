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
			routes(func(context.Context) error { return tc.ping }).ServeHTTP(rec, httptest.NewRequest("GET", "/healthz", nil))
			if got := strings.TrimSpace(rec.Body.String()); rec.Code != tc.code || got != tc.body {
				t.Fatalf("got %d %s, want %d %s", rec.Code, got, tc.code, tc.body)
			}
		})
	}
}
