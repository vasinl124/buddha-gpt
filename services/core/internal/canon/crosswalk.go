package canon

import (
	_ "embed"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// scids.txt lists every SuttaCentral sutta ID for DN, MN, SN, AN, the Dhammapada and the Sutta
// Nipāta: the file names in suttacentral/bilara-data (published branch), references only, no text.
//
//go:embed scids.txt
var scids string

type idRange struct {
	id         string
	start, end int
}

var (
	scSet    = map[string]bool{}
	scRanges = map[string][]idRange{} // by prefix: "sn56.", "an1.", "dn", "dhp"
	idParts  = regexp.MustCompile(`^([a-z]+\d*\.|[a-z]+)(\d+)(?:-(\d+))?$`)
)

func init() {
	for _, id := range strings.Fields(scids) {
		prefix, start, end, ok := parseID(id)
		if !ok {
			panic("canon: bad SuttaCentral ID " + id)
		}
		scSet[id] = true
		scRanges[prefix] = append(scRanges[prefix], idRange{id, start, end})
	}
}

// parseID splits "sn56.96-101" into "sn56.", 96, 101 and "dn2" into "dn", 2, 2.
func parseID(id string) (prefix string, start, end int, ok bool) {
	m := idParts.FindStringSubmatch(id)
	if m == nil {
		return "", 0, 0, false
	}
	start, _ = strconv.Atoi(m[2])
	end = start
	if m[3] != "" {
		end, _ = strconv.Atoi(m[3])
	}
	return m[1], start, end, true
}

// scID returns the SuttaCentral ID in prefix whose range contains n.
func scID(prefix string, n int) (string, bool) {
	for _, r := range scRanges[prefix] {
		if r.start <= n && n <= r.end {
			return r.id, true
		}
	}
	return "", false
}

// byParagraphNumber reports whether a sutta's paragraph Ord is the sutta number itself:
// true for AN 1 and AN 2, where each sutta is one numbered paragraph.
func byParagraphNumber(suttaID string) bool {
	return strings.HasPrefix(suttaID, "an1.") || strings.HasPrefix(suttaID, "an2.")
}

// Normalize moves paragraphs whose derived sutta ID isn't a SuttaCentral ID to the SuttaCentral
// sutta whose range holds their number, so every ID links to a real page. VRI and SuttaCentral
// group the repetitive (peyyāla) suttas differently in a few saṃyuttas and nipātas. Paragraphs
// are renumbered within each sutta. Unmatched IDs are kept and returned so sync can report them.
func Normalize(suttas []Sutta, paras []Para) ([]Sutta, []Para, []string) {
	titles := map[string]Sutta{}
	for _, s := range suttas {
		titles[s.ID] = s
	}
	var out []Para
	var order []string          // target suttas in order of first paragraph
	from := map[string]string{} // target → the derived sutta that names it
	unmatched := map[string]bool{}
	ord := map[string]int{} // paragraphs so far in each target sutta

	for _, p := range paras {
		target := p.SuttaID
		if !scSet[target] {
			prefix, start, _, ok := parseID(p.SuttaID)
			n := start
			if byParagraphNumber(p.SuttaID) {
				n = p.Ord
			}
			if id, found := scID(prefix, n); ok && found {
				target = id
			} else {
				unmatched[p.SuttaID] = true
			}
		}
		if _, ok := from[target]; !ok {
			from[target] = p.SuttaID
			order = append(order, target)
		}
		if p.Part == 1 { // a new source paragraph; later parts follow it directly
			ord[target]++
		}
		id := fmt.Sprintf("%s#%s%d", target, p.Lang, ord[target])
		if strings.Contains(p.ID[strings.IndexByte(p.ID, '#'):], "-") { // a part of a split paragraph
			id = fmt.Sprintf("%s-%d", id, p.Part)
		}
		p.ID, p.SuttaID, p.Ord = id, target, ord[target]
		out = append(out, p)
	}

	var outSuttas []Sutta // suttas without paragraphs are dropped
	for _, id := range order {
		s := titles[from[id]]
		s.ID = id
		if s.Collection == "" {
			s.Collection = collectionOf(id)
		}
		outSuttas = append(outSuttas, s)
	}
	var miss []string
	for id := range unmatched {
		miss = append(miss, id)
	}
	return outSuttas, out, miss
}

// collectionOf maps "sn56.11" to "SN", "dhp1-20" to "Dhp", "snp1.8" to "Snp".
func collectionOf(id string) string {
	switch {
	case strings.HasPrefix(id, "dhp"):
		return "Dhp"
	case strings.HasPrefix(id, "snp"):
		return "Snp"
	default:
		return strings.ToUpper(id[:2])
	}
}
