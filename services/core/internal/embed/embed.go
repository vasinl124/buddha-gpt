// Package embed calls an OpenAI-compatible embeddings endpoint: OpenRouter by default, or a local
// Ollama during development (EMBED_BASE_URL=http://localhost:11434/v1, EMBED_MODEL=nomic-embed-text).
package embed

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

const openRouter = "https://openrouter.ai/api/v1"

type Client struct {
	BaseURL string
	Key     string
	Model   string
	HTTP    *http.Client
}

// FromEnv reads EMBED_BASE_URL, EMBED_MODEL and OPENROUTER_API_KEY.
func FromEnv() *Client {
	c := &Client{BaseURL: os.Getenv("EMBED_BASE_URL"), Key: os.Getenv("OPENROUTER_API_KEY"),
		Model: os.Getenv("EMBED_MODEL"), HTTP: &http.Client{Timeout: 60 * time.Second}}
	if c.BaseURL == "" {
		c.BaseURL = openRouter
	}
	if c.Model == "" {
		c.Model = "baai/bge-m3"
	}
	return c
}

// Ready reports whether calls can work: OpenRouter needs a key, a local endpoint doesn't.
func (c *Client) Ready() bool { return c.Key != "" || c.BaseURL != openRouter }

// Embed returns one vector per input, in input order. Rate limits and server errors get two
// retries with a growing pause; any other error is returned at once.
func (c *Client) Embed(ctx context.Context, inputs []string) ([][]float32, error) {
	body, err := json.Marshal(map[string]any{"model": c.Model, "input": inputs})
	if err != nil {
		return nil, err
	}
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			select {
			case <-time.After(time.Duration(attempt) * 2 * time.Second):
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		vecs, retry, err := c.post(ctx, body, len(inputs))
		if err == nil {
			return vecs, nil
		}
		if !retry {
			return nil, err
		}
		lastErr = err
	}
	return nil, lastErr
}

func (c *Client) post(ctx context.Context, body []byte, n int) (vecs [][]float32, retry bool, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/embeddings", bytes.NewReader(body))
	if err != nil {
		return nil, false, err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.Key != "" {
		req.Header.Set("Authorization", "Bearer "+c.Key)
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, true, err // network trouble: worth another try
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
		return nil, true, fmt.Errorf("embeddings: %s: %.200s", resp.Status, data)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, false, fmt.Errorf("embeddings: %s: %.200s", resp.Status, data)
	}
	var out struct {
		Data []struct {
			Index     int       `json:"index"`
			Embedding []float32 `json:"embedding"`
		} `json:"data"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, false, fmt.Errorf("embeddings: %w", err)
	}
	if out.Error != nil {
		return nil, true, fmt.Errorf("embeddings: %s", out.Error.Message)
	}
	if len(out.Data) != n {
		return nil, false, fmt.Errorf("embeddings: got %d vectors for %d inputs", len(out.Data), n)
	}
	vecs = make([][]float32, n)
	for _, d := range out.Data {
		if d.Index < 0 || d.Index >= n || vecs[d.Index] != nil {
			return nil, false, fmt.Errorf("embeddings: bad index %d", d.Index)
		}
		vecs[d.Index] = d.Embedding
	}
	return vecs, false, nil
}
