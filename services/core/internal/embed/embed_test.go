package embed

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEmbed(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 1 { // a rate limit first: the client must retry
			http.Error(w, "slow down", http.StatusTooManyRequests)
			return
		}
		var req struct {
			Model string   `json:"model"`
			Input []string `json:"input"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		if r.Header.Get("Authorization") != "Bearer k" || req.Model != "m" || len(req.Input) != 2 {
			t.Errorf("bad request: %q %+v", r.Header.Get("Authorization"), req)
		}
		// answer out of order: the client must sort by index
		w.Write([]byte(`{"data":[{"index":1,"embedding":[0,1]},{"index":0,"embedding":[1,0]}]}`))
	}))
	defer srv.Close()

	c := &Client{BaseURL: srv.URL, Key: "k", Model: "m", HTTP: srv.Client()}
	vecs, err := c.Embed(context.Background(), []string{"a", "b"})
	if err != nil {
		t.Fatal(err)
	}
	if calls != 2 || vecs[0][0] != 1 || vecs[1][1] != 1 {
		t.Fatalf("calls=%d vecs=%v", calls, vecs)
	}
	if (&Client{BaseURL: openRouter}).Ready() || !(&Client{BaseURL: "http://localhost:11434/v1"}).Ready() {
		t.Error("Ready: OpenRouter needs a key, a local endpoint doesn't")
	}
}
