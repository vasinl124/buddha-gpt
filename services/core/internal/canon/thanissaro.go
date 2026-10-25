package canon

import (
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"

	"golang.org/x/net/html"
)

// ThanissaroID maps a dhammatalks.org page path to its sutta ID: /suttas/SN/SN56_11.html → sn56.11,
// /suttas/KN/StNp/StNp1_8.html → snp1.8. Dhammapada chapter pages (…/Dhp/Ch01.html) return "" and
// take their ID from their verse range.
func ThanissaroID(path string) string {
	name := strings.TrimSuffix(path[strings.LastIndexByte(path, '/')+1:], ".html")
	switch {
	case strings.HasPrefix(name, "StNp"):
		return "snp" + strings.Replace(strings.TrimPrefix(name, "StNp"), "_", ".", 1)
	case strings.Contains(path, "/Dhp/"):
		return ""
	}
	return strings.ToLower(strings.Replace(name, "_", ".", 1))
}

var (
	verseID   = regexp.MustCompile(`^dhp(\d+)$`)
	citeParen = regexp.MustCompile(`\(.*\)\s*$`)
)

// ParseThanissaro reads one dhammatalks.org page. It keeps only the translation: the
// introduction before the "* * *" line, footnote markers and the notes are not his translation
// of the text, so they're dropped. id comes from ThanissaroID.
func ParseThanissaro(r io.Reader, id string) (Sutta, []Para, error) {
	doc, err := html.Parse(r)
	if err != nil {
		return Sutta{}, nil, err
	}
	root := find(doc, func(n *html.Node) bool { return attrOf(n, "id") == "sutta" })
	if root == nil {
		return Sutta{}, nil, fmt.Errorf("no div#sutta")
	}
	s := Sutta{ID: id}
	if h1 := find(root, func(n *html.Node) bool { return n.Data == "h1" }); h1 != nil {
		var lines []string // English title, then "Dhammacakkappavattana Sutta  (SN 56:11)"
		for _, l := range strings.Split(textOf(h1, "\n"), "\n") {
			if l = strings.TrimSpace(l); l != "" {
				lines = append(lines, l)
			}
		}
		if len(lines) > 0 {
			s.TitleEn = lines[0]
		}
		if len(lines) > 1 {
			s.TitlePali = strings.TrimSpace(citeParen.ReplaceAllString(lines[1], ""))
		}
	}

	type block struct {
		text   string
		verse  int  // Dhammapada verse number, from div.verse id="dhp001"
		italic bool // a paragraph wholly in <em>: how his introductions are set
	}
	var blocks []block
	starsAt := -1    // blocks before the first "* * *"
	front := false   // a heading or a note before that line: the part above it is front matter
	inIntro := false // inside an "Introduction" section, which runs to the next heading or "* * *"
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			if c.Type != html.ElementNode {
				continue
			}
			class := attrOf(c, "class")
			switch {
			case c.Data == "h1" || c.Data == "h2" || c.Data == "h3" || hasClass(class, "note") ||
				hasClass(class, "seealso") || hasClass(class, "notetitle") || hasClass(class, "suttaCite"):
				// titles, notes and cross-references; one above the first "* * *" ("Introduction",
				// "Note on the translation") marks that part as front matter
				if starsAt < 0 && c.Data != "h1" {
					front = true
				}
				if c.Data == "h2" || c.Data == "h3" {
					inIntro = strings.Contains(strings.ToLower(textOf(c, " ")), "introduction")
				}
			case hasClass(class, "stars"):
				if starsAt < 0 {
					starsAt = len(blocks)
				}
				inIntro = false
			case inIntro:
				// his introduction essay
			case c.Data == "div" && hasClass(class, "verse"):
				var lines []string
				for l := c.FirstChild; l != nil; l = l.NextSibling {
					if l.Type == html.ElementNode {
						if t := clean(textOf(l, " ")); t != "" {
							lines = append(lines, t)
						}
					}
				}
				v := 0
				if m := verseID.FindStringSubmatch(attrOf(c, "id")); m != nil {
					v, _ = strconv.Atoi(m[1])
				}
				if len(lines) > 0 {
					blocks = append(blocks, block{text: strings.Join(lines, "\n"), verse: v})
				}
			case c.Data == "p":
				if t := clean(textOf(c, " ")); t != "" {
					blocks = append(blocks, block{text: t, italic: share(c, "em") >= 0.8})
				}
			default:
				walk(c) // div.block, div.iblock, the chapter div of a Dhammapada page
			}
		}
	}
	walk(root)
	// Above the first "* * *" sits front matter when a heading or a note is there too. A page whose
	// first "* * *" is only a section break keeps everything.
	if starsAt > 0 && front {
		blocks = blocks[starsAt:]
	}
	// Leading italic paragraphs are his introduction, with or without a "* * *" after them. At
	// least one paragraph stays, in case a page's text itself opens in italics.
	lead := 0
	for lead < len(blocks) && blocks[lead].italic {
		lead++
	}
	if lead < len(blocks) {
		blocks = blocks[lead:]
	}

	var out []Para
	if id == "" { // a Dhammapada chapter: dhp<first verse>-<last verse>
		lo, hi := 0, 0
		for _, b := range blocks {
			if b.verse > 0 && (lo == 0 || b.verse < lo) {
				lo = b.verse
			}
			if b.verse > hi {
				hi = b.verse
			}
		}
		if lo == 0 {
			return Sutta{}, nil, fmt.Errorf("Dhammapada page without verse ids")
		}
		s.ID = fmt.Sprintf("dhp%d-%d", lo, hi)
		s.TitlePali, s.TitleEn = "", strings.TrimSpace(s.TitleEn)
	}
	s.Collection = collectionOf(s.ID)
	ord := 0
	for _, b := range blocks {
		if s.Collection == "Dhp" && b.verse == 0 {
			continue // only the numbered verses
		}
		ord++
		out = append(out, paras(s.ID, "en", "thanissaro", ord, b.text)...)
	}
	return s, out, nil
}

// clean drops footnote numbers glued to words and collapses whitespace.
func clean(s string) string { return strings.Join(strings.Fields(s), " ") }

// textOf returns n's text, skipping footnote markers and screen-reader-only spans; a <br>
// becomes sep.
func textOf(n *html.Node, sep string) string {
	var b strings.Builder
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		switch {
		case n.Type == html.TextNode:
			b.WriteString(n.Data)
		case n.Type == html.ElementNode && n.Data == "br":
			b.WriteString(sep)
		case n.Type == html.ElementNode && (hasClass(attrOf(n, "class"), "fn") || hasClass(attrOf(n, "class"), "visually-hidden")):
			return
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(n)
	return b.String()
}

// share returns the fraction of p's visible letters inside <tag> elements. His introductions are
// italic but set Pali terms upright ("…tranquility (samatha) and insight…"), so most, not all.
func share(p *html.Node, tag string) float64 {
	inside, total := 0, 0
	var walk func(n *html.Node, in bool)
	walk = func(n *html.Node, in bool) {
		if n.Type == html.TextNode {
			k := len(strings.Join(strings.Fields(n.Data), ""))
			total += k
			if in {
				inside += k
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c, in || (c.Type == html.ElementNode && c.Data == tag))
		}
	}
	walk(p, false)
	if total == 0 {
		return 0
	}
	return float64(inside) / float64(total)
}

func find(n *html.Node, match func(*html.Node) bool) *html.Node {
	if n.Type == html.ElementNode && match(n) {
		return n
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if f := find(c, match); f != nil {
			return f
		}
	}
	return nil
}

func attrOf(n *html.Node, key string) string {
	for _, a := range n.Attr {
		if a.Key == key {
			return a.Val
		}
	}
	return ""
}

func hasClass(class, want string) bool {
	for _, c := range strings.Fields(class) {
		if c == want {
			return true
		}
	}
	return false
}
