// Renders the brand's PNGs from the wheel (mark.svg, icon.svg): the README's lockups, the link
// preview and GitHub's social preview, and the app's icons. Playwright drives the installed Chrome,
// so the type is the app's own (Inter Tight, DM Serif Display); ImageMagick packs the favicon.
//
//   pnpm brand
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const BRAND = new URL(".", import.meta.url).pathname;
const APP = new URL("../../apps/web/src/app/", import.meta.url).pathname;
// the app's ink, muted ink and yellow (globals.css); moon is the wheel and name in GitHub's dark mode
const COLORS = { ink: "#1C1B15", muted: "#626055", yellow: "#FEF1A1", moon: "#F2F1EA" };
const mark = readFileSync(`${BRAND}mark.svg`, "utf8");
const icon = readFileSync(`${BRAND}icon.svg`, "utf8");

const FONTS = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;600&family=DM+Serif+Display&display=block">`;
const page = (body, css = "") =>
  `<!doctype html><html><head>${FONTS}<style>*{margin:0}body{font-family:"Inter Tight",sans-serif}
  .serif{font-family:"DM Serif Display",serif}${css}</style></head><body>${body}</body></html>`;

// the mark beside the name, for the README's header in light and dark mode
const lockup = (text) =>
  page(
    `<div class="l"><div class="m">${mark.replaceAll(COLORS.ink, text)}</div><span>Buddha GPT</span></div>`,
    `.l{display:inline-flex;align-items:center;gap:20px;padding:8px 12px}.m{width:84px;height:84px}
    .l span{font-size:64px;font-weight:600;letter-spacing:-0.045em;white-space:nowrap;color:${text}}`,
  );

// the card a shared link shows, on the welcome page's yellow: the mark, the name, what it does, and
// a line of goodwill
const card = (w, h) =>
  page(
    `<div class="c"><div class="m">${mark}</div><div class="t">
      <h1>Buddha GPT</h1>
      <p>Talk with the Buddha in English, Thai or Pali.<br>Every quote is real, from the Pali Canon.</p>
      <div class="rule"></div><p class="pi serif">Sabbasattā bhavantu sukhitattā</p></div></div>`,
    `.c{width:${w}px;height:${h}px;background:${COLORS.yellow};display:flex;align-items:center;gap:64px;padding:0 88px;box-sizing:border-box}
    .m{width:260px;height:260px;flex:none}.t h1{font-size:100px;font-weight:600;letter-spacing:-0.045em;color:${COLORS.ink};line-height:1.05}
    .t p{font-size:29px;line-height:1.5;color:${COLORS.muted};margin-top:22px;white-space:nowrap}.rule{width:56px;height:3px;background:${COLORS.ink};margin-top:34px}
    .t .pi{color:${COLORS.ink};font-size:34px;margin-top:18px}`,
  );

// the home-screen icon: the seal's wheel, full bleed, since the phone rounds the corners
const touch = page(
  `<div class="a">${icon.replace(/<circle cx="24" cy="24" r="24"[^>]*\/>/, "")}</div>`,
  `.a{width:180px;height:180px;background:${COLORS.yellow};display:grid;place-items:center}.a svg{width:150px;height:150px}`,
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
