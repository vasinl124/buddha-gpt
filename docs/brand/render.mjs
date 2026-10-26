// Renders the brand's PNGs from the wheel (mark.svg, icon.svg): the README's lockups, the link
// preview and GitHub's social preview, and the app's icons. Playwright drives the installed Chrome,
// so the type is the app's own (Noto Serif, Noto Sans); ImageMagick packs the favicon.
//
//   pnpm brand
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const BRAND = new URL(".", import.meta.url).pathname;
const APP = new URL("../../apps/web/src/app/", import.meta.url).pathname;
const COLORS = { cream: "#FEFCF3", ink: "#24180B", muted: "#72604A", amber: "#D48E00", night: "#150E06", moon: "#F6F2E3" };
const mark = readFileSync(`${BRAND}mark.svg`, "utf8");
const icon = readFileSync(`${BRAND}icon.svg`, "utf8");

const FONTS = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;500&family=Noto+Serif:ital,wght@0,500;1,400&display=block">`;
const page = (body, css = "") =>
  `<!doctype html><html><head>${FONTS}<style>*{margin:0}body{font-family:"Noto Sans",sans-serif}
  .serif{font-family:"Noto Serif",serif}${css}</style></head><body>${body}</body></html>`;

// the mark beside the name, for the README's header in light and dark mode
const lockup = (text) =>
  page(
    `<div class="l"><div class="m">${mark}</div><span class="serif">Buddha GPT</span></div>`,
    `.l{display:inline-flex;align-items:center;gap:22px;padding:8px 12px}.m{width:84px;height:84px}
    .l span{font-size:60px;font-weight:500;letter-spacing:-0.01em;white-space:nowrap;color:${text}}`,
  );

// the card a shared link shows: the mark, the name, what it does, and a line of goodwill
const card = (w, h) =>
  page(
    `<div class="c"><div class="m">${mark}</div><div class="t">
      <h1 class="serif">Buddha GPT</h1>
      <p>Talk with the Buddha in English, Thai or Pali.<br>Every quote is real, from the Pali Canon.</p>
      <div class="rule"></div><p class="pi serif">Sabbasattā bhavantu sukhitattā</p></div></div>`,
    `.c{width:${w}px;height:${h}px;background:${COLORS.cream};display:flex;align-items:center;gap:64px;padding:0 88px;box-sizing:border-box}
    .m{width:260px;height:260px;flex:none}.t h1{font-size:94px;font-weight:500;letter-spacing:-0.015em;color:${COLORS.ink};line-height:1.05}
    .t p{font-size:29px;line-height:1.5;color:${COLORS.muted};margin-top:22px;white-space:nowrap}.rule{width:56px;height:3px;background:${COLORS.amber};margin-top:34px}
    .t .pi{font-style:italic;color:${COLORS.amber};font-size:30px;margin-top:18px}`,
  );

// the home-screen icon: the seal's wheel, full bleed, since the phone rounds the corners
const touch = page(
  `<div class="a">${icon.replace(/<circle cx="24" cy="24" r="24"[^>]*\/>/, "")}</div>`,
  `.a{width:180px;height:180px;background:${COLORS.amber};display:grid;place-items:center}.a svg{width:150px;height:150px}`,
);

const shots = [
  { html: lockup(COLORS.ink), out: `${BRAND}lockup-light.png`, transparent: true },
  { html: lockup(COLORS.moon), out: `${BRAND}lockup-dark.png`, transparent: true },
  { html: card(1200, 630), out: `${APP}opengraph-image.png`, size: [1200, 630] },
  { html: card(1200, 630), out: `${APP}twitter-image.png`, size: [1200, 630] },
  { html: card(1280, 640), out: `${BRAND}social.png`, size: [1280, 640] },
  { html: touch, out: `${APP}apple-icon.png`, size: [180, 180] },
];

const browser = await chromium.launch({ channel: "chrome" });
try {
  for (const s of shots) {
    const [width, height] = s.size ?? [1200, 400]; // a lockup is cut to its own size
    const p = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: s.size ? 1 : 2 });
    await p.setContent(s.html, { waitUntil: "networkidle" });
    await p.evaluate(() => document.fonts.ready);
    const target = s.size ? p : p.locator("body > *").first();
    await target.screenshot({ path: s.out, omitBackground: !!s.transparent });
    console.log(`wrote ${s.out.replace(/.*\/(docs|apps)\//, "$1/")}`);
    await p.close();
  }
} finally {
  await browser.close();
}

// the favicon: the seal at 16, 32 and 48 px in one .ico
const sizes = [16, 32, 48].map((n) => {
  const png = `/tmp/buddha-icon-${n}.png`;
  execFileSync("rsvg-convert", ["-w", String(n), "-h", String(n), `${BRAND}icon.svg`, "-o", png]);
  return png;
});
execFileSync("magick", [...sizes, `${APP}favicon.ico`]);
console.log("wrote apps/web/src/app/favicon.ico");
