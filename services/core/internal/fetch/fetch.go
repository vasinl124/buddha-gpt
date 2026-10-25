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
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	// VRICommit pins VipassanaTech/tipitaka-xml, so every sync reads the same Pali.
	VRICommit = "00a2b2b05cd64e6bec0eb0674f5cbefaa119dbd3"
	// SCDataCommit pins SuttaCentral's sc-data. Only its Thai sutta files are checked out, and only
	// to find where each sutta starts in the Thai volumes (PRD §8.3): none of its text is stored.
	SCDataCommit = "2d9ca8da858f94302ed6783e2717bf73d651881b"
	userAgent    = "buddha-gpt-sync/0.1 (non-commercial; +https://github.com/vasinl124/buddha-gpt)"
)

// vars so the tests can point them at a fake server
var (
	site      = "https://www.dhammatalks.org"
	thaiSite  = "https://www.thepathofpurity.com"
	thaiDelay = 5 * time.Second // the site's robots.txt asks for 5 seconds between requests
)

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

// SCData checks out sc-data's Thai sutta folders at SCDataCommit (a shallow, sparse clone without
// the other blobs) and returns its folder. A checkout already at that commit is reused.
func SCData(ctx context.Context, dataDir string) (string, error) {
	dir := filepath.Join(dataDir, "sc-data")
	git := func(args ...string) error {
		if out, err := exec.CommandContext(ctx, "git", append([]string{"-C", dir}, args...)...).CombinedOutput(); err != nil {
			return fmt.Errorf("git %s: %v: %s", strings.Join(args, " "), err, out)
		}
		return nil
	}
	if out, err := exec.CommandContext(ctx, "git", "-C", dir, "rev-parse", "HEAD").Output(); err == nil && strings.TrimSpace(string(out)) == SCDataCommit {
		return dir, nil
	}
	if err := os.RemoveAll(dir); err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	const th = "html_text/th/pli/sutta/"
	for _, step := range [][]string{
		{"init", "-q"},
		{"remote", "add", "origin", "https://github.com/suttacentral/sc-data.git"},
		{"sparse-checkout", "set", th + "dn", th + "mn", th + "sn", th + "an"},
		{"fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", SCDataCommit},
		{"checkout", "-q", "FETCH_HEAD"},
	} {
		if err := git(step...); err != nil {
			return "", err
		}
	}
	return dir, nil
}

// thaiPage lists the 45 volumes of the Royal Thai translation (ฉบับหลวง), one PDF each.
const thaiPage = "/home/%E0%B8%9E%E0%B8%A3%E0%B8%B0%E0%B9%84%E0%B8%95%E0%B8%A3%E0%B8%9B-%E0%B8%8E%E0%B8%81-pdf/" +
	"%E0%B9%81%E0%B8%9B%E0%B8%A5-%E0%B9%94%E0%B9%95-%E0%B9%80%E0%B8%A5-%E0%B8%A1-%E0%B8%89%E0%B8%9A-%E0%B8%9A%E0%B8%AB%E0%B8%A5%E0%B8%A7%E0%B8%87/"

var volumeLink = regexp.MustCompile(`/app/download/\d+/Tri45_(\d+)[^"'?<>]*\.pdf`)

// Thai downloads the given volumes of the Royal Thai translation (PRD §8.1), one at a time and
// thaiDelay apart, and returns volume → local PDF. Volumes already on disk aren't fetched again.
func Thai(ctx context.Context, dataDir string, vols []int) (map[int]string, error) {
	dir := filepath.Join(dataDir, "thai")
	index := filepath.Join(dir, "index.html")
	if err := download(ctx, thaiSite+thaiPage, index, true); err != nil {
		return nil, err
	}
	html, err := os.ReadFile(index)
	if err != nil {
		return nil, err
	}
	links := map[int]string{}
	for _, m := range volumeLink.FindAllStringSubmatch(string(html), -1) {
		n, _ := strconv.Atoi(m[1])
		links[n] = m[0]
	}
	out := map[int]string{}
	for _, v := range vols {
		link, ok := links[v]
		if !ok {
			return nil, fmt.Errorf("thai: volume %d isn't linked from %s", v, thaiSite+thaiPage)
		}
		local := filepath.Join(dir, fmt.Sprintf("Tri45_%02d.pdf", v))
		if info, err := os.Stat(local); err != nil || info.Size() == 0 {
			select {
			case <-time.After(thaiDelay):
			case <-ctx.Done():
				return nil, ctx.Err()
			}
			if err := download(ctx, thaiSite+link, local, false); err != nil {
				return nil, err
			}
		}
		out[v] = local
	}
	return out, nil
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
