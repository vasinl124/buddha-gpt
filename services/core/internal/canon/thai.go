package canon

import (
	"bytes"
	"html"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

// The Royal Thai translation (ฉบับหลวง) comes as one PDF per volume, read as text by pdftotext
// (PRD §8.2). Its ข้อ numbers ([๑๒]) don't say which sutta they belong to, so each sutta's start is
// found by its opening words, taken from SuttaCentral's ID-keyed copy of the same translation
// (sc-data). That copy is used for nothing else: no sc-data text is stored or shown.

// ThaiVolume is one volume and the suttas it holds: DN and MN by sutta number, SN and AN by
// saṃyutta or nipāta number.
type ThaiVolume struct {
	N           int
	Prefix      string // "dn", "mn", "sn", "an"
	First, Last int
}

// ThaiVolumes are the MVP's volumes (PRD §4). The Dhammapada and Sutta Nipāta (volume 25) aren't in
// sc-data's Thai, so they need their own crosswalk.
var ThaiVolumes = []ThaiVolume{
	{9, "dn", 1, 13}, {10, "dn", 14, 23}, {11, "dn", 24, 34},
	{12, "mn", 1, 50}, {13, "mn", 51, 100}, {14, "mn", 101, 152},
	{15, "sn", 1, 11}, {16, "sn", 12, 21}, {17, "sn", 22, 34}, {18, "sn", 35, 44}, {19, "sn", 45, 56},
	{20, "an", 1, 3}, {21, "an", 4, 4}, {22, "an", 5, 6}, {23, "an", 7, 9}, {24, "an", 10, 11},
}

// thaiPUA maps the private-use glyphs Thai fonts use for shifted marks back to standard Thai.
var thaiPUA = map[rune]rune{
	0xF700: 'ฐ', 0xF701: 'ิ', 0xF702: 'ี', 0xF703: 'ึ', 0xF704: 'ื', 0xF705: '่', 0xF706: '้', 0xF707: '๊',
	0xF708: '๋', 0xF709: '์', 0xF70A: '่', 0xF70B: '้', 0xF70C: '๊', 0xF70D: '๋', 0xF70E: '์', 0xF70F: 'ญ',
	0xF710: 'ั', 0xF711: 'ํ', 0xF712: '็', 0xF713: '่', 0xF714: '้', 0xF715: '๊', 0xF716: '๋', 0xF717: '์',
	0xF718: 'ุ', 0xF719: 'ู', 0xF71A: 'ฺ',
}

// ThaiGlyphs maps private-use glyphs (U+F700–U+F71A) back to standard Thai and rejoins a sara am
// that came out as nikhahit + sara aa (ํา → ำ).
func ThaiGlyphs(s string) string {
	s = strings.Map(func(r rune) rune {
		if t, ok := thaiPUA[r]; ok {
			return t
		}
		return r
	}, s)
	return strings.ReplaceAll(s, "ํา", "ำ")
}

// thaiFold keeps only Thai letters and vowels, so the PDF's text and sc-data's compare equal
// whatever their spaces, line breaks, tone marks, digits and punctuation.
func thaiFold(s string) string {
	var b strings.Builder
	for _, r := range s {
		if (r >= 'ก' && r <= 'ฮ') || (r >= 'ะ' && r <= 'ฺ') || (r >= 'เ' && r <= 'ๅ') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// ThaiRef is a sutta expected in a volume, with its opening words folded by thaiFold.
type ThaiRef struct {
	ID      string
	Opening string
}

var (
	scArticle = regexp.MustCompile(`<article id='`)
	scPara    = regexp.MustCompile(`(?s)<p[^>]*>(.*?)</p>`)
	scTag     = regexp.MustCompile(`<[^>]+>`)
	idNumbers = regexp.MustCompile(`\d+`)
)

// ThaiRefs reads the suttas of volume v from sc-data's Thai folder, in canonical order.
func ThaiRefs(scDir string, v ThaiVolume) ([]ThaiRef, error) {
	var refs []ThaiRef
	root := filepath.Join(scDir, "html_text", "th", "pli", "sutta", v.Prefix)
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".html") {
			return err
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if !scArticle.Match(data) {
			return nil
		}
		// the file name is the ID: an article's own id can be wrong (an4.178.html says an4.177)
		id := strings.TrimSuffix(filepath.Base(path), ".html")
		if k := idKey(id); len(k) == 0 || k[0] < v.First || k[0] > v.Last {
			return nil
		}
		if i := bytes.Index(data, []byte("</header>")); i >= 0 {
			data = data[i:] // the heading and subtitle aren't in the body text
		}
		var open strings.Builder
		for _, p := range scPara.FindAllSubmatch(data, -1) {
			text := strings.TrimSpace(html.UnescapeString(scTag.ReplaceAllString(string(p[1]), "")))
			if homage(text) { // the volume's opening homage, which thaiLines drops from the PDF too
				continue
			}
			open.WriteString(thaiFold(text))
			if utf8.RuneCountInString(open.String()) > 700 {
				break
			}
		}
		refs = append(refs, ThaiRef{ID: id, Opening: open.String()})
		return nil
	})
	sort.Slice(refs, func(i, j int) bool {
		a, b := idKey(refs[i].ID), idKey(refs[j].ID)
		for k := 0; k < len(a) && k < len(b); k++ {
			if a[k] != b[k] {
				return a[k] < b[k]
			}
		}
		return len(a) < len(b)
	})
	return refs, err
}

// idKey is the numbers in a sutta ID, for canonical order: "sn22.59" → [22 59], "an1.1-10" → [1 1 10].
func idKey(id string) []int {
	var out []int
	for _, s := range idNumbers.FindAllString(id, -1) {
		n, _ := strconv.Atoi(s)
		out = append(out, n)
	}
	return out
}

var (
	pageHeader = regexp.MustCompile(`- หน้าที่ \d+\s*$`)
	separator  = regexp.MustCompile(`^[-_=.\s]{5,}$`)
	khorMark   = regexp.MustCompile(`^[-_\s]*\[([๐-๙]+)\]\s*`)
	// a heading on its own line: "๑. มูลปริยายสูตร", "โอฆตรณสูตรที่ ๑", "นฬวรรคที่ ๑", "เทวตาสังยุต", "๑. ปาฏิกสูตร (๒๔)"
	thaiHeading = regexp.MustCompile(`^(?:[๐-๙]+\.? ?)?\S+(?:สูตร|วรรค|สังยุต|สังยุตต์|นิบาต|ปัณณาสก์)(?:\s*ที่\s*[๐-๙]+)?(?: \([๐-๙]+\))?\.?$`)
	// the end of a sutta or a chapter: "จบสูตรที่ ๑", "จบ สีหนาทวรรค ที่ ๒"
	endMark = regexp.MustCompile(`^จบ.{0,40}(?:สูตร|วรรค|ปัณณาสก์|สังยุต|นิบาต|เปยยาล)\S*(?:\s*ที่\s*[๐-๙]+)?\.?$`)
	// a list or a count of what a chapter or book holds: "รวมสังยุตที่มีในมหาวารวรรคนี้ คือ"
	summary = regexp.MustCompile(`^(?:รวม(?:พระ)?(?:สูตร|สังยุต|วรรค)|พระสูตรที่รวมอยู่ใน)`)
	// a chapter's list of its suttas: "๑. จูฬสีหนาทสูตร ๒. มหาสีหนาทสูตร ..."
	suttaList = regexp.MustCompile(`[๐-๙]+\. ?\S+สูตร.*[๐-๙]+\. ?\S+สูตร`)
)

// thaiLine is one line of a cleaned volume: khor is the ข้อ number it starts (or 0), and at is
// where its folded text begins in the folded volume.
type thaiLine struct {
	text string
	khor int
	at   int
}

// thaiLines cleans a volume's text: glyphs fixed, and page headers, separators, headings,
// subtitles, end marks and sutta lists dropped.
func thaiLines(text string) []thaiLine {
	var kept []string
	afterHeading := false // the short lines right after a heading are its subtitles
	for _, l := range strings.FieldsFunc(ThaiGlyphs(text), func(r rune) bool { return r == '\n' || r == '\f' }) {
		l = strings.TrimSpace(l)
		if !khorMark.MatchString(l) {
			l = strings.TrimLeft(l, "-_ ") // a separator glued to the next line's text
		}
		switch {
		case l == "", pageHeader.MatchString(l), separator.MatchString(l), endMark.MatchString(l), suttaList.MatchString(l),
			summary.MatchString(l), homage(l):
			continue
		case thaiHeading.MatchString(l):
			afterHeading = true
			continue
		case afterHeading && !khorMark.MatchString(l) && utf8.RuneCountInString(l) < 60:
			continue
		}
		afterHeading = false
		kept = append(kept, l)
	}

	var lines []thaiLine
	at := 0
	for i, l := range kept {
		// a short line between a finished paragraph and a ข้อ is a section heading, not text
		if i > 0 && i+1 < len(kept) && khorMark.MatchString(kept[i+1]) && !khorMark.MatchString(l) &&
			utf8.RuneCountInString(l) < 50 && strings.ContainsAny(lastRune(kept[i-1]), "ฯ.:?") && !strings.ContainsAny(lastRune(l), "ฯ.:?") {
			continue
		}
		khor := 0
		if m := khorMark.FindStringSubmatch(l); m != nil {
			khor = thaiNumber(m[1])
			l = l[len(m[0]):]
		}
		lines = append(lines, thaiLine{text: l, khor: khor, at: at})
		at += len(thaiFold(l))
	}
	return lines
}

// keptOffset is the byte offset in s of the rune that thaiFold keeps as its n-th (from 0); len(s)
// when there are fewer.
func keptOffset(s string, n int) int {
	seen := 0
	for i, r := range s {
		if thaiFold(string(r)) != "" {
			if seen*3 == n { // every rune thaiFold keeps is Thai: 3 bytes in UTF-8
				return i
			}
			seen++
		}
	}
	return len(s)
}

// homage is the line that opens a volume: "ขอนอบน้อมแด่พระผู้มีพระภาค…".
func homage(s string) bool {
	return strings.HasPrefix(s, "ขอนอบน้อมแด่") || strings.HasPrefix(s, "ขอน้อมแด่")
}

func lastRune(s string) string {
	r, _ := utf8.DecodeLastRuneInString(s)
	return string(r)
}

// thaiNumber reads Thai digits: "๑๒" → 12.
func thaiNumber(s string) int {
	n := 0
	for _, r := range s {
		n = n*10 + int(r-'๐')
	}
	return n
}

// ParseThai splits one volume's text into its suttas' paragraphs (one per ข้อ, and a new one
// wherever a sutta starts). refs are the suttas the volume holds, in canonical order. It returns
// the IDs it left out: a sutta whose opening wasn't found, and the sutta before it, whose end is
// then unknown. Leaving them out is safer than showing Thai text under the wrong sutta.
func ParseThai(text string, refs []ThaiRef) ([]Sutta, []Para, []string) {
	lines := thaiLines(text)
	var b strings.Builder
	for _, l := range lines {
		b.WriteString(thaiFold(l.text))
	}
	folded := b.String()
	pos := locate(folded, refs)

	skip := make([]bool, len(refs))
	for i := range refs {
		if pos[i] < 0 {
			skip[i] = true
			if i > 0 {
				skip[i-1] = true
			}
		}
	}
	// a cut is where a sutta starts: a line, and the byte in it where its opening begins, since
	// a sutta can start partway through a line
	type cut struct{ line, off int }
	cutAt := func(p int) cut {
		k := sort.Search(len(lines), func(k int) bool { return lines[k].at > p }) - 1
		return cut{k, keptOffset(lines[k].text, p-lines[k].at)}
	}

	var suttas []Sutta
	var out []Para
	var left []string
	for i, r := range refs {
		var from, to cut
		if !skip[i] {
			from, to = cutAt(pos[i]), cut{len(lines), 0}
			for j := i + 1; j < len(refs); j++ {
				if pos[j] >= 0 {
					to = cutAt(pos[j])
					break
				}
			}
		}
		if skip[i] || to.line < from.line || (to.line == from.line && to.off <= from.off) {
			left = append(left, r.ID) // not found, or the next sutta starts where this one does
			continue
		}
		var texts, cur []string
		for k := from.line; k <= to.line && k < len(lines); k++ {
			text := lines[k].text
			if k == to.line {
				text = text[:to.off]
			}
			if k == from.line {
				text = text[from.off:]
			}
			if strings.TrimSpace(text) == "" {
				continue
			}
			if k != from.line && lines[k].khor > 0 && len(cur) > 0 {
				texts, cur = append(texts, clean(strings.Join(cur, " "))), nil
			}
			cur = append(cur, text)
		}
		texts = append(texts, clean(strings.Join(cur, " ")))
		for k, t := range texts {
			out = append(out, paras(r.ID, "th", "royal", k+1, t)...)
		}
		suttas = append(suttas, Sutta{ID: r.ID, Collection: collectionOf(r.ID)})
	}
	return suttas, out, left
}

// locate finds where each ref's opening starts in the folded volume, or -1. Openings found exactly
// once are anchors; the largest set of anchors in increasing order is kept (one wrong match far
// ahead can't hide the rest); the others are searched for between their neighbours, with shorter
// openings, since many suttas begin with the same words. The first match in that window is taken
// only when the sutta before was placed and the opening is long enough to be specific; otherwise
// the match has to be the only one in the window.
func locate(folded string, refs []ThaiRef) []int {
	pos := make([]int, len(refs))
	for i, r := range refs {
		pos[i] = -1
		for _, n := range []int{400, 200, 120} {
			if needle, ok := runePrefix(r.Opening, n); ok && strings.Count(folded, needle) == 1 {
				pos[i] = strings.Index(folded, needle)
				break
			}
		}
	}
	keepIncreasing(pos)
	for i, r := range refs {
		if pos[i] >= 0 {
			continue
		}
		lo, hi := 0, len(folded)
		for j := i - 1; j >= 0; j-- {
			if pos[j] >= 0 {
				lo = pos[j] + 1
				break
			}
		}
		for j := i + 1; j < len(refs); j++ {
			if pos[j] >= 0 {
				hi = pos[j]
				break
			}
		}
		for _, n := range []int{400, 200, 120, 60, 30, 15} {
			needle, ok := runePrefix(r.Opening, n)
			if !ok || lo >= hi {
				continue
			}
			window := folded[lo:hi]
			first := (i == 0 || pos[i-1] >= 0) && n >= 60
			if k := strings.Index(window, needle); k >= 0 && (first || strings.Count(window, needle) == 1) {
				pos[i] = lo + k
				break
			}
		}
	}
	return pos
}

// keepIncreasing sets to -1 every position outside the longest increasing run of found ones.
func keepIncreasing(pos []int) {
	var tails, tailAt []int // tails[k]: the smallest last position of a run of length k+1
	prev := map[int]int{}
	for i, p := range pos {
		if p < 0 {
			continue
		}
		k := sort.SearchInts(tails, p)
		prev[i] = -1
		if k > 0 {
			prev[i] = tailAt[k-1]
		}
		if k == len(tails) {
			tails, tailAt = append(tails, p), append(tailAt, i)
		} else {
			tails[k], tailAt[k] = p, i
		}
	}
	keep := map[int]bool{}
	if len(tailAt) > 0 {
		for i := tailAt[len(tailAt)-1]; i >= 0; i = prev[i] {
			keep[i] = true
		}
	}
	for i := range pos {
		if !keep[i] {
			pos[i] = -1
		}
	}
}

// runePrefix returns the first n runes of s, and false when s is shorter.
func runePrefix(s string, n int) (string, bool) {
	i := 0
	for k := 0; k < n; k++ {
		if i >= len(s) {
			return "", false
		}
		_, size := utf8.DecodeRuneInString(s[i:])
		i += size
	}
	return s[:i], true
}
