package canon

import (
	"strings"
	"testing"
)

func TestThaiGlyphs(t *testing.T) {
	// as pdftotext gives them: private-use marks, and sara am split in two
	got := ThaiGlyphs("พระสุตตันตปฎก เลม ๔ ธาตุนํา")
	if want := "พระสุตตันตปิฎก เล่ม ๔ ธาตุน้ำ"; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

// A small volume with the noise the real ones have: page headers, the homage, chapter and sutta
// headings, subtitles, a section heading, a sutta that starts before its first ข้อ, end marks
// and a chapter's list of suttas.
const volume = `พระสุตตันตปิฎก เล่ม ๔ มัชฌิมนิกาย มูลปัณณาสก์ - หน้าที่ 1
ขอน้อมแด่พระผู้มีพระภาคอรหันตสัมมาสัมพุทธเจ้าพระองค์นั้น
มูลปริยายวรรค
๑. มูลปริยายสูตร
ว่าด้วยมูลเหตุแห่งธรรมทั้งปวง
[๑] ข้าพเจ้าได้สดับมาอย่างนี้
สมัยหนึ่ง พระผู้มีพระภาคประทับอยู่ ณ โคนไม้พญารัง ในสุภควัน เขตเมืองอุกกัฏฐา
ภิกษุเหล่านั้นทูลรับ อย่างนั้น พระเจ้าข้า.
กำหนดภูมินัยที่ ๑ ด้วยสามารถปุถุชน
[๒] ปุถุชนในโลกนี้ ไม่ได้สดับ ย่อมรู้ธาตุดินโดยความเป็นธาตุดิน
` + "\f" + `พระสุตตันตปิฎก เล่ม ๔ มัชฌิมนิกาย มูลปัณณาสก์ - หน้าที่ 2
ย่อมสำคัญธาตุดิน ฯ
จบ มูลปริยายสูตร ที่ ๑
๒. มหาสุทัสสนสูตร (๑๗)
ดูกรอานนท์ แต่ปางก่อน มีพระเจ้าจักรพรรดิ ทรงพระนามว่า มหาสุทัสสนะ เป็นกษัตริย์ได้มุรธาภิเษกแล้ว
[๓] ดูกรอานนท์ พระเจ้ามหาสุทัสสนะ สมบูรณ์ด้วยแก้ว ๗ ประการ ฯ
๓. ชนวสภสูตร (๑๘)
-------------------[๔] ข้าพเจ้าได้สดับมาอย่างนี้ สมัยหนึ่ง พระผู้มีพระภาคประทับอยู่ ณ บ้านนาทิกะ
๔. ปายาสิสูตร
[๕] สมัยหนึ่ง ท่านพระกุมารกัสสปะ เที่ยวจาริกไปในแคว้นโกศล ฯ
______________________
รวมพระสูตรที่มีในวรรคนี้ คือ
๑. มูลปริยายสูตร ๒. มหาสุทัสสนสูตร ๓. ชนวสภสูตร ๔. ปายาสิสูตร
`

func TestParseThai(t *testing.T) {
	refs := []ThaiRef{
		{"mn1", thaiFold("ข้าพเจ้าได้สดับมาอย่างนี้ สมัยหนึ่ง พระผู้มีพระภาคประทับอยู่ ณ โคนไม้พญารัง")},
		{"dn17", thaiFold("ดูกรอานนท์ แต่ปางก่อน มีพระเจ้าจักรพรรดิ")},
		{"dn18", thaiFold("ข้อความที่ไม่มีในเล่มนี้เลยแม้แต่น้อย")}, // its opening isn't in the volume
		{"dn23", thaiFold("สมัยหนึ่ง ท่านพระกุมารกัสสปะ เที่ยวจาริกไปในแคว้นโกศล")},
	}
	suttas, paras, left := ParseThai(volume, refs)

	if strings.Join(left, " ") != "dn17 dn18" { // dn18 wasn't found, so dn17's end is unknown
		t.Errorf("left out %v, want dn17 dn18", left)
	}
	if len(suttas) != 2 || suttas[0].ID != "mn1" || suttas[1].ID != "dn23" {
		t.Fatalf("suttas = %v", suttas)
	}
	var got []string
	for _, p := range paras {
		got = append(got, p.ID+" "+p.Text)
	}
	want := []string{
		"mn1#th1 ข้าพเจ้าได้สดับมาอย่างนี้ สมัยหนึ่ง พระผู้มีพระภาคประทับอยู่ ณ โคนไม้พญารัง ในสุภควัน เขตเมืองอุกกัฏฐา ภิกษุเหล่านั้นทูลรับ อย่างนั้น พระเจ้าข้า.",
		"mn1#th2 ปุถุชนในโลกนี้ ไม่ได้สดับ ย่อมรู้ธาตุดินโดยความเป็นธาตุดิน ย่อมสำคัญธาตุดิน ฯ",
		"dn23#th1 สมัยหนึ่ง ท่านพระกุมารกัสสปะ เที่ยวจาริกไปในแคว้นโกศล ฯ",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Errorf("paragraphs:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

func TestParseThaiOpeningBeforeFirstKhor(t *testing.T) {
	// DN 17 begins with text before its first ข้อ: that text is its first paragraph
	refs := []ThaiRef{
		{"mn1", thaiFold("ข้าพเจ้าได้สดับมาอย่างนี้ สมัยหนึ่ง พระผู้มีพระภาคประทับอยู่ ณ โคนไม้พญารัง")},
		{"dn17", thaiFold("ดูกรอานนท์ แต่ปางก่อน มีพระเจ้าจักรพรรดิ")},
		{"dn18", thaiFold("ข้าพเจ้าได้สดับมาอย่างนี้ สมัยหนึ่ง พระผู้มีพระภาคประทับอยู่ ณ บ้านนาทิกะ")},
		{"dn23", thaiFold("สมัยหนึ่ง ท่านพระกุมารกัสสปะ")},
	}
	_, paras, left := ParseThai(volume, refs)
	if len(left) != 0 {
		t.Fatalf("left out %v", left)
	}
	var dn17 []string
	for _, p := range paras {
		if p.SuttaID == "dn17" {
			dn17 = append(dn17, p.ID)
		}
	}
	if strings.Join(dn17, " ") != "dn17#th1 dn17#th2" {
		t.Errorf("dn17 paragraphs = %v", dn17)
	}
}
