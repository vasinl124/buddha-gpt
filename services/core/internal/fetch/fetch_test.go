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

func TestThai(t *testing.T) {
	hits := map[string]int{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits[r.URL.Path]++
		switch {
		case strings.HasPrefix(r.URL.Path, "/home/"):
			w.Write([]byte(`<a href="/app/download/7450763486/Tri45_12+%E0%B8%A1.pdf?t=1">12</a>
				<a href="/app/download/7312421286/TriPali_12+x.pdf?t=1">pali</a>`))
		case strings.HasPrefix(r.URL.Path, "/app/download/7450763486/Tri45_12"):
			w.Write([]byte("%PDF-1.4"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	thaiSite, thaiDelay = srv.URL, 0

	dir := t.TempDir()
	for run := 1; run <= 2; run++ {
		vols, err := Thai(context.Background(), dir, []int{12})
		if err != nil {
			t.Fatal(err)
		}
		if data, _ := os.ReadFile(vols[12]); string(data) != "%PDF-1.4" {
			t.Fatalf("run %d: saved %q", run, data)
		}
	}
	if _, err := Thai(context.Background(), dir, []int{13}); err == nil {
		t.Error("a volume the page doesn't link should fail the sync")
	}
	pdfs := 0
	for path, n := range hits {
		if strings.HasPrefix(path, "/app/") {
			pdfs += n
		}
	}
	if pdfs != 1 {
		t.Errorf("the PDF was requested %d times, want once: %v", pdfs, hits)
	}
}
