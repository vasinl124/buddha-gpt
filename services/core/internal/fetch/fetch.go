// Package fetch downloads the source texts into the data folder (git-ignored). Files already
// there are reused, so a second sync downloads nothing but the index pages.
package fetch

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	// VRICommit pins VipassanaTech/tipitaka-xml, so every sync reads the same Pali.
	VRICommit = "00a2b2b05cd64e6bec0eb0674f5cbefaa119dbd3"
	userAgent = "buddha-gpt-sync/0.1 (non-commercial; +https://github.com/vasinl124/buddha-gpt)"
)

var site = "https://www.dhammatalks.org" // a var so the test can point it at a fake server

var client = &http.Client{Timeout: 60 * time.Second}

// VRI downloads the named Roman-script files at VRICommit and returns their folder.
func VRI(ctx context.Context, dataDir string, files []string) (string, error) {
	dir := filepath.Join(dataDir, "vri", VRICommit)
	for _, f := range files {
		url := fmt.Sprintf("https://raw.githubusercontent.com/VipassanaTech/tipitaka-xml/%s/romn/%s", VRICommit, f)
		if err := download(ctx, url, filepath.Join(dir, f), false); err != nil {
			return "", err
		}
	}
	return dir, nil
}

// thanissaroIndexes link every translated sutta in the MVP collections (PRD §8.1).
var thanissaroIndexes = []string{
	"/suttas/DN/index.html", "/suttas/MN/index.html", "/suttas/SN/index.html",
	"/suttas/AN/index.html", "/suttas/KN/Dhp/", "/suttas/KN/StNp/",
}

var pageLink = regexp.MustCompile(`href="(/suttas/(?:DN/DN\d+|MN/MN\d+|SN/SN\d+_[\d-]+|AN/AN\d+_[\d-]+|KN/Dhp/Ch\d+|KN/StNp/StNp\d+_\d+)\.html)"`)

// Thanissaro downloads every sutta page the indexes link to, four at a time (dhammatalks.org's
// robots.txt allows /suttas/), and returns site path → local file. A page that fails is logged
// and left out; a failed index fails the sync.
func Thanissaro(ctx context.Context, dataDir string) (map[string]string, error) {
	dir := filepath.Join(dataDir, "thanissaro")
	seen := map[string]bool{}
	var paths []string
	for _, idx := range thanissaroIndexes {
		local := filepath.Join(dir, "index", strings.ReplaceAll(strings.Trim(idx, "/"), "/", "_")+".html")
		if err := download(ctx, site+idx, local, true); err != nil {
			return nil, err
		}
		html, err := os.ReadFile(local)
		if err != nil {
			return nil, err
		}
		for _, m := range pageLink.FindAllStringSubmatch(string(html), -1) {
			if !seen[m[1]] {
				seen[m[1]] = true
				paths = append(paths, m[1])
			}
		}
	}
	sort.Strings(paths)

	out := map[string]string{}
	var mu sync.Mutex
	jobs := make(chan string)
	var wg sync.WaitGroup
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for p := range jobs {
				local := filepath.Join(dir, filepath.FromSlash(p))
				if err := download(ctx, site+p, local, false); err != nil {
					log.Printf("skip %s: %v", p, err)
					continue
				}
				mu.Lock()
				out[p] = local
				mu.Unlock()
			}
		}()
	}
	for _, p := range paths {
		jobs <- p
	}
	close(jobs)
	wg.Wait()
	return out, ctx.Err()
}

// download saves url to dest. It skips a file that's already there unless refresh is set; a
// refresh that fails falls back to the copy on disk.
func download(ctx context.Context, url, dest string, refresh bool) error {
	if info, err := os.Stat(dest); err == nil && info.Size() > 0 && !refresh {
		return nil
	}
	err := get(ctx, url, dest)
	if err != nil && refresh {
		if info, statErr := os.Stat(dest); statErr == nil && info.Size() > 0 {
			log.Printf("using cached %s: %v", dest, err)
			return nil
		}
	}
	return err
}

func get(ctx context.Context, url, dest string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", userAgent)
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("GET %s: %s", url, resp.Status)
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}
	tmp := dest + ".part"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, resp.Body); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, dest)
}
