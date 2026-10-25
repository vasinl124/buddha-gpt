package canon

import (
	"encoding/xml"
	"fmt"
	"io"
	"os"
	"regexp"
	"strconv"
	"strings"

	"golang.org/x/text/encoding/unicode"

	"github.com/vasinl124/buddha-gpt/services/core/internal/text"
)

// VRIBook is one Chaṭṭha Saṅgāyana mūla file from VRI's tipitaka-xml (Roman script).
type VRIBook struct {
	File       string
	Collection string // DN, MN, SN, AN, Dhp, Snp
	// Base: suttas before this book (DN, MN), saṃyuttas before it (SN), or the nipāta (AN).
	Base int
}

// VRIBooks are the MVP collections (PRD §4). Numbering restarts in each DN and MN file and
// each SN book, hence the bases.
var VRIBooks = []VRIBook{
	{"s0101m.mul.xml", "DN", 0}, {"s0102m.mul.xml", "DN", 13}, {"s0103m.mul.xml", "DN", 23},
	{"s0201m.mul.xml", "MN", 0}, {"s0202m.mul.xml", "MN", 50}, {"s0203m.mul.xml", "MN", 100},
	{"s0301m.mul.xml", "SN", 0}, {"s0302m.mul.xml", "SN", 11}, {"s0303m.mul.xml", "SN", 21},
	{"s0304m.mul.xml", "SN", 34}, {"s0305m.mul.xml", "SN", 44},
	{"s0401m.mul.xml", "AN", 1}, {"s0402m1.mul.xml", "AN", 2}, {"s0402m2.mul.xml", "AN", 3},
	{"s0402m3.mul.xml", "AN", 4}, {"s0403m1.mul.xml", "AN", 5}, {"s0403m2.mul.xml", "AN", 6},
	{"s0403m3.mul.xml", "AN", 7}, {"s0404m1.mul.xml", "AN", 8}, {"s0404m2.mul.xml", "AN", 9},
	{"s0404m3.mul.xml", "AN", 10}, {"s0404m4.mul.xml", "AN", 11},
	{"s0502m.mul.xml", "Dhp", 0}, {"s0505m.mul.xml", "Snp", 0},
}

// ReadVRIFile parses one downloaded file. VRI ships UTF-16 LE with a BOM.
func ReadVRIFile(path string, book VRIBook) ([]Sutta, []Para, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, nil, err
	}
	defer f.Close()
	utf8 := unicode.UTF16(unicode.LittleEndian, unicode.UseBOM).NewDecoder().Reader(f)
	return ParseVRI(utf8, book)
}

// block is one <p> or <head>: its rend, its n attribute and its text.
type block struct{ rend, n, text string }

// ParseVRI reads UTF-8 TEI and returns the book's suttas and Pali paragraphs.
func ParseVRI(r io.Reader, book VRIBook) ([]Sutta, []Para, error) {
	blocks, err := vriBlocks(r)
	if err != nil {
		return nil, nil, fmt.Errorf("%s: %w", book.File, err)
	}
	p := &vriParser{book: book}
	for _, b := range blocks {
		p.add(b)
	}
	p.endGroup()
	return p.suttas, p.paras, nil
}

// vriBlocks flattens the TEI into blocks, dropping page breaks, variant-reading notes and
// the printed paragraph numbers.
func vriBlocks(r io.Reader) ([]block, error) {
	d := xml.NewDecoder(r)
	d.CharsetReader = func(_ string, r io.Reader) (io.Reader, error) { return r, nil } // already UTF-8
	var out []block
	var cur *block
	var text strings.Builder
	skip := 0 // depth inside <note> or a numbering <hi>
	for {
		tok, err := d.Token()
		if err == io.EOF {
			return out, nil
		}
		if err != nil {
			return nil, err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch {
			case skip > 0 || t.Name.Local == "note" || (t.Name.Local == "hi" && (attr(t, "rend") == "paranum" || attr(t, "rend") == "dot")):
				skip++
			case t.Name.Local == "p" || t.Name.Local == "head":
				cur = &block{rend: attr(t, "rend"), n: attr(t, "n")}
				text.Reset()
			}
		case xml.EndElement:
			switch {
			case skip > 0:
				skip--
			case cur != nil && (t.Name.Local == "p" || t.Name.Local == "head"):
				cur.text = strings.Join(strings.Fields(text.String()), " ")
				out = append(out, *cur)
				cur = nil
			}
		case xml.CharData:
			if cur != nil && skip == 0 {
				text.Write(t)
			}
		}
	}
}

func attr(t xml.StartElement, name string) string {
	for _, a := range t.Attr {
		if a.Name.Local == name {
			return a.Value
		}
	}
	return ""
}

// numbered matches a heading's leading number or range: "12. Saccasaṃyuttaṃ", "2-6. …", "4-5-6. …".
var numbered = regexp.MustCompile(`^(\d+)(?:-(\d+))*\.\s*(.*)$`)

// heading returns the first and last number of a heading and its name; ok is false when unnumbered.
func heading(s string) (first, last int, name string, ok bool) {
	m := numbered.FindStringSubmatch(s)
	if m == nil {
		return 0, 0, s, false
	}
	first, _ = strconv.Atoi(m[1])
	last = first
	if m[2] != "" { // a repeated group keeps its last match: "4-5-6" gives 6
		last, _ = strconv.Atoi(m[2])
	}
	return first, last, m[3], true
}

type vriParser struct {
	book   VRIBook
	suttas []Sutta
	paras  []Para

	cur       string   // ID of the sutta paragraphs go to
	ord       int      // paragraphs so far in this sutta
	count     int      // suttas so far in this saṃyutta, nipāta or vagga
	group     int      // the saṃyutta (SN) or vagga (Snp)
	verse     []string // gāthā lines being collected
	verseNo   int      // Dhammapada: the verse number from the last hangnum
	skipVerse bool     // inside a summary verse (uddāna), which isn't text

	// AN 1 and the Dhammapada have no sutta headings: each vagga becomes one ranged sutta
	// ("an1.1-10", "dhp1-20"), so its paragraphs wait until the vagga ends and the range is known.
	pending   []Para
	lo, hi    int
	groupName string
}

// ranged: the Dhammapada and AN 1–2 number their suttas (or verses) as paragraphs, not headings.
func (p *vriParser) ranged() bool {
	return p.book.Collection == "Dhp" || (p.book.Collection == "AN" && p.book.Base <= 2)
}

func (p *vriParser) add(b block) {
	if !strings.HasPrefix(b.rend, "gatha") {
		p.endVerse()
		p.skipVerse = false
	}
	switch b.rend {
	case "chapter", "title", "subhead":
		p.headingBlock(b)
	case "bodytext", "indent", "unindented":
		if isUddana(b.text) { // the verses after it list sutta names, an editor's summary
			p.skipVerse = true
			return
		}
		if p.book.Collection == "Dhp" { // prose in the Dhammapada is editorial (closing summaries)
			p.verseNo = 0
			return
		}
		n, _ := strconv.Atoi(strings.SplitN(b.n, "-", 2)[0]) // "232-246" covers suttas 232 to 246
		p.para(b.text, n)
	case "hangnum":
		if b.text == "" { // a bare verse number (Dhammapada)
			p.verseNo, _ = strconv.Atoi(b.n)
		} else {
			p.para(b.text, 0)
		}
	case "gatha1", "gatha2", "gatha3":
		if !p.skipVerse {
			p.verse = append(p.verse, b.text)
		}
	case "gathalast":
		if !p.skipVerse {
			p.verse = append(p.verse, b.text)
			if p.book.Collection != "Dhp" { // a Dhammapada verse can run past a gathalast; it ends at the next number
				p.endVerse()
			}
		}
	}
	// centre, trailer, nikaya and book lines are titles and end markers, not text
}

// isUddana spots the short line that opens a summary verse ("Tassuddānaṃ –", "Vagguddānaṃ –").
func isUddana(s string) bool {
	return len(s) < 60 && strings.Contains(text.Fold(s), "uddanam")
}

func (p *vriParser) headingBlock(b block) {
	first, last, name, ok := heading(b.text)
	c := p.book.Collection
	switch {
	case c == "DN" && b.rend == "chapter" && ok:
		p.start(fmt.Sprintf("dn%d", p.book.Base+first), name)
	case c == "MN" && b.rend == "subhead" && ok: // printed numbers restart in each vagga
		p.count++
		p.start(fmt.Sprintf("mn%d", p.book.Base+p.count), name)
	case p.ranged() && b.rend == "chapter":
		p.endGroup()
		p.groupName = name
	case c == "SN" && b.rend == "chapter" && ok:
		p.group, p.count = p.book.Base+first, 0
	case c == "Snp" && b.rend == "chapter" && ok:
		p.group, p.count = first, 0
	case c == "Snp" && b.rend == "subhead": // every Snp subhead is a sutta, numbered or not
		p.count++
		p.start(fmt.Sprintf("snp%d.%d", p.group, p.count), name)
	case (c == "SN" || c == "AN") && b.rend == "subhead" && !p.ranged():
		n := last - first + 1
		if !ok { // an unnumbered subhead counts only if it names a sutta
			if !strings.Contains(strings.ToLower(name), "sutta") {
				return
			}
			n = 1
		}
		prefix := fmt.Sprintf("sn%d", p.group)
		if c == "AN" {
			prefix = fmt.Sprintf("an%d", p.book.Base)
		}
		id := fmt.Sprintf("%s.%d", prefix, p.count+1)
		if n > 1 {
			id = fmt.Sprintf("%s-%d", id, p.count+n)
		}
		p.count += n
		p.start(id, name)
	}
	// other headings are sections inside a sutta, vaggas or paṇṇāsakas
}

func (p *vriParser) start(id, title string) {
	p.suttas = append(p.suttas, Sutta{ID: id, Collection: p.book.Collection, TitlePali: title})
	p.cur, p.ord = id, 0
}

// para adds a paragraph. n is VRI's paragraph number, which in AN 1 is the sutta number.
func (p *vriParser) para(text string, n int) {
	if text == "" {
		return
	}
	if p.ranged() {
		ord := n
		if p.book.Collection == "Dhp" {
			ord = p.verseNo
		}
		if ord == 0 {
			return
		}
		if p.lo == 0 || ord < p.lo {
			p.lo = ord
		}
		if ord > p.hi {
			p.hi = ord
		}
		p.pending = append(p.pending, paras("", "pi", "vri", ord, text)...)
		return
	}
	if p.cur == "" {
		return // text before the first sutta (a homage line)
	}
	p.ord++
	p.paras = append(p.paras, paras(p.cur, "pi", "vri", p.ord, text)...)
}

func (p *vriParser) endVerse() {
	if len(p.verse) > 0 {
		p.para(strings.Join(p.verse, "\n"), 0)
		p.verse = nil
	}
}

// endGroup closes a ranged vagga: now that its range is known, it gets its ID.
func (p *vriParser) endGroup() {
	p.endVerse()
	if !p.ranged() || len(p.pending) == 0 {
		return
	}
	prefix := "dhp"
	if p.book.Collection == "AN" {
		prefix = fmt.Sprintf("an%d.", p.book.Base)
	}
	id := fmt.Sprintf("%s%d-%d", prefix, p.lo, p.hi)
	p.suttas = append(p.suttas, Sutta{ID: id, Collection: p.book.Collection, TitlePali: p.groupName})
	for _, q := range p.pending {
		suffix := strings.TrimPrefix(q.ID, "#")
		q.ID, q.SuttaID = id+"#"+suffix, id
		p.paras = append(p.paras, q)
	}
	p.pending, p.lo, p.hi = nil, 0, 0
}
