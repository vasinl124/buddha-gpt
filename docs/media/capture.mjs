// Captures the README's screenshots and demo video from the running app (`pnpm dev`): PNGs in
// docs/media/, and the demo (PRD §3) as an MP4 and a GIF through ffmpeg. Real replies need
// OPENROUTER_API_KEY; without it the mock answers, and its badge shows in every picture.
// Playwright drives the installed Google Chrome and Chrome's own screencast records the demo, so
// nothing is downloaded: the system ffmpeg turns the frames into the video.
//
//   pnpm media             screenshots and the demo
//   pnpm media shots       screenshots only
//   pnpm media demo        the demo only
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const APP = process.env.APP_URL || "http://localhost:5005";
const OUT = new URL(".", import.meta.url).pathname;
const only = process.argv[2];

// the screenshots: one fresh conversation each
const SHOTS = [
  { file: "answer.png", text: "What are the four noble truths?" },
  { file: "thai.png", text: "ทุกข์คืออะไร" },
  { file: "pali.png", text: "What is suffering?", lang: "Pāli", thaiScript: true },
  { file: "decline.png", text: "ขอเลขเด็ดงวดนี้หน่อย" },
  { file: "crisis.png", text: "I don't want to live anymore" },
];

// the demo: one conversation, a caption per scene
const SCENES = [
  { caption: "Ask in Thai: “what is suffering?”", text: "ทุกข์คืออะไร" },
  { caption: "Pāli mode: the canon's own words, then in Thai script", text: "What is suffering?", lang: "Pāli", thaiScript: true },
  { caption: "A quote it can check", text: "Did the Buddha say “peace comes from within, do not seek it without”?" },
  { caption: "Lottery numbers: a kind no, with a teaching", text: "ขอเลขเด็ดงวดนี้หน่อย" },
  { caption: "Someone in crisis gets the right numbers", text: "I don't want to live anymore" },
];

const browser = await chromium.launch({ channel: "chrome" });
try {
  if (only !== "demo") await screenshots();
  if (only !== "shots") await demo();
} finally {
  await browser.close();
}

async function screenshots() {
  const context = await browser.newContext({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 2 });
  for (const shot of SHOTS) {
    const page = await open(context);
    if (shot.thaiScript) await page.getByRole("button", { name: "Show Pali in Thai script" }).click();
    await ask(page, shot.text, shot.lang);
    // as tall as the conversation, so no empty band sits above the input
    const height = await page.evaluate(() => {
      const content = document.querySelector(".is-user").parentElement;
      return window.innerHeight - content.parentElement.clientHeight + content.scrollHeight + 8;
    });
    await page.setViewportSize({ width: 900, height: Math.min(Math.max(height, 640), 2000) });
    await page.locator(".is-user").last().evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, shot.file) });
    console.log(`wrote docs/media/${shot.file}`);
    await page.close();
  }
  await context.close();
}

async function demo() {
  const dir = mkdtempSync(join(tmpdir(), "buddha-demo-"));
  const context = await browser.newContext({ viewport: { width: 960, height: 860 }, deviceScaleFactor: 1.5 });
  const page = await open(context);
  const frames = await record(page, dir);
  // a caption bar above the app, which keeps its full height below it
  await page.addStyleTag({
    content: `body { padding-top: 44px; } main { height: calc(100svh - 44px) !important; }
      #demo-caption { position: fixed; inset: 0 0 auto 0; height: 44px; display: flex; align-items: center;
        justify-content: center; background: #18181b; color: #fafafa; font: 500 15px system-ui, sans-serif; }`,
  });
  await page.evaluate(() => document.body.append(Object.assign(document.createElement("div"), { id: "demo-caption" })));
  await page.waitForTimeout(1200);
  for (const scene of SCENES) {
    await page.locator("#demo-caption").evaluate((el, text) => (el.textContent = text), scene.caption);
    await ask(page, scene.text, scene.lang, 40);
    await page.waitForTimeout(2500); // time to read
    if (scene.thaiScript) {
      await page.getByRole("button", { name: "Show Pali in Thai script" }).click();
      await page.waitForTimeout(2500);
    }
  }
  await page.waitForTimeout(1500);
  const list = await frames.stop();
  await context.close();

  const video = ["-f", "concat", "-safe", "0", "-i", list];
  ffmpeg([...video, "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-crf", "26", "-preset", "slow", "-movflags", "+faststart", join(OUT, "demo.mp4")]);
  // the GIF plays in the README: 10 fps, 720 wide, its own 128-colour palette
  ffmpeg([
    ...video, "-vf",
    "fps=10,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=5",
    join(OUT, "demo.gif"),
  ]);
  rmSync(dir, { recursive: true });
  for (const f of ["demo.mp4", "demo.gif"]) console.log(`wrote docs/media/${f} (${(statSync(join(OUT, f)).size / 1e6).toFixed(1)} MB)`);
}

// Records the page with Chrome's screencast: a frame on every repaint, each shown until the next.
// stop() writes the ffmpeg concat list that replays them with their real timing.
async function record(page, dir) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    const file = join(dir, `${String(frames.length).padStart(5, "0")}.jpg`);
    writeFileSync(file, Buffer.from(data, "base64"));
    frames.push({ file, at: metadata.timestamp });
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: 1440, maxHeight: 1290 });
  return {
    async stop() {
      await cdp.send("Page.stopScreencast");
      const end = Date.now() / 1000;
      const lines = frames.flatMap((f, i) => [`file '${f.file}'`, `duration ${((frames[i + 1]?.at ?? end) - f.at).toFixed(3)}`]);
      const list = join(dir, "frames.txt");
      writeFileSync(list, [...lines, `file '${frames.at(-1).file}'`].join("\n"));
      return list;
    },
  };
}

// A page with an empty conversation and the switches at their defaults.
async function open(context) {
  const page = await context.newPage();
  await page.goto(APP);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }); // the dev-mode badge
  await page.getByRole("textbox", { name: "Your message" }).waitFor();
  return page;
}

// Asks one question (typed out, for the demo) and waits until the streamed reply has ended.
async function ask(page, text, lang = "Auto", typing = 0) {
  const toggle = page.getByRole("radio", { name: lang, exact: true });
  if ((await toggle.getAttribute("data-state")) !== "on") await toggle.click();
  const box = page.getByRole("textbox", { name: "Your message" });
  await box.click();
  if (typing) await page.keyboard.type(text, { delay: typing });
  else await box.fill(text);
  const reply = page.waitForResponse((r) => r.url().endsWith("/api/chat") && r.request().method() === "POST", { timeout: 180_000 });
  await page.keyboard.press("Enter");
  await (await reply).finished();
  await page.waitForTimeout(800); // the last render
}

function ffmpeg(args) {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
}
