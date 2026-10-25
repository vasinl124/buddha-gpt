// Command buddha is the Go side of buddha-gpt: the Retrieval API, ingest and evals.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const addr = ":7890"

func main() {
	loadEnvFile("../../.env") // the repo-root .env; the root scripts run this from services/core
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: buddha <serve|sync|eval>")
		os.Exit(2)
	}
	switch os.Args[1] {
	case "serve":
		serve()
	case "sync", "eval":
		fmt.Fprintf(os.Stderr, "buddha %s: not built yet (see the plan in docs/PRD.md §12)\n", os.Args[1])
		os.Exit(1)
	default:
		fmt.Fprintf(os.Stderr, "buddha: unknown command %q\n", os.Args[1])
		os.Exit(2)
	}
}

func serve() {
	pool, err := pgxpool.New(context.Background(), env("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/buddha_gpt"))
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()
	log.Printf("Retrieval API listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, routes(pool.Ping)))
}

// routes takes the database check as a function so tests can stub it.
func routes(pingDB func(context.Context) error) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), time.Second)
		defer cancel()
		db, code := "up", http.StatusOK
		if err := pingDB(ctx); err != nil {
			db, code = "down", http.StatusServiceUnavailable
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		json.NewEncoder(w).Encode(map[string]any{"ok": code == http.StatusOK, "db": db})
	})
	return mux
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
