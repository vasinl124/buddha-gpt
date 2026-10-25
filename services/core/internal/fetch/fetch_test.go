package fetch

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
)

func TestThanissaro(t *testing.T) {
	var mu sync.Mutex
	hits := map[string]int{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		hits[r.URL.Path]++
		mu.Unlock()
		switch {
		case r.URL.Path == "/suttas/SN/index.html":
			// links we want, a duplicate, and ones we don't (nav, notes, other collections)
			w.Write([]byte(`<a href="/suttas/SN/SN56_11.html">a</a><a href="/suttas/SN/SN56_11.html">a</a>
				<a href="/chant_index.html">x</a><a href="/suttas/SN/SN56_11.html#note1">n</a><a href="/suttas/MN/MN10.html">m</a>`))
		case strings.HasSuffix(r.URL.Path, "index.html") || strings.HasSuffix(r.URL.Path, "/"):
			w.Write([]byte(`<p>no links</p>`))
		case r.URL.Path == "/suttas/SN/SN56_11.html" || r.URL.Path == "/suttas/MN/MN10.html":
			w.Write([]byte(`<div id="sutta">…</div>`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	site = srv.URL

	dir := t.TempDir()
	for run := 1; run <= 2; run++ {
		pages, err := Thanissaro(context.Background(), dir)
		if err != nil {
			t.Fatal(err)
		}
		if len(pages) != 2 || pages["/suttas/SN/SN56_11.html"] == "" {
			t.Fatalf("run %d: pages = %v", run, pages)
		}
		if data, _ := os.ReadFile(pages["/suttas/SN/SN56_11.html"]); string(data) != `<div id="sutta">…</div>` {
			t.Fatalf("run %d: saved %q", run, data)
		}
	}
	// pages come down once and are reused; indexes are refreshed on every sync
	if hits["/suttas/SN/SN56_11.html"] != 1 || hits["/suttas/SN/index.html"] != 2 {
		t.Errorf("requests = %v", hits)
	}
}
