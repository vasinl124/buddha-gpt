// Captures the README's screenshots and demo video from the running app (`pnpm dev`): PNGs in
// docs/media/, and the demo (PRD §3) as an MP4 and a GIF through ffmpeg. Real replies need
// OPENROUTER_API_KEY; without it the mock answers, and its badge shows in every picture.
// Playwright drives the installed Google Chrome and Chrome's own screencast records the demo, so
// nothing is downloaded: the system ffmpeg turns the frames into the video.
//
//   pnpm media                  screenshots and the demo
//   pnpm media shots            screenshots only
//   pnpm media shots answer     only the named screenshots
//   pnpm media demo             the demo only
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const APP = process.env.APP_URL || "http://localhost:5005";
const OUT = new URL(".", import.meta.url).pathname;
const [only, ...names] = process.argv.slice(2);

// the screenshots: one fresh conversation each
const SHOTS = [
  { file: "answer.png", text: "What are the four noble truths?", sources: true },
  { file: "thai.png", text: "ทุกข์คืออะไร" },
  { file: "pali.png", text: "ทุกข์คืออะไร ขอเป็นภาษาบาลี" },
  { file: "quote.png", text: "Did the Buddha say “peace comes from within, do not seek it without”?" },
  { file: "decline.png", text: "ขอเลขเด็ดงวดนี้หน่อย" },
  { file: "crisis.png", text: "I don't want to live anymore" },
];
// the history: three conversations in the sidebar at a laptop's width, the newest open
const HISTORY = ["ทุกข์คืออะไร", "How do I stop being angry?", "What are the four noble truths?"];

// the demo: one conversation, a caption per scene
const SCENES = [
  { caption: "Ask in Thai: “what is suffering?”, then open the sources", text: "ทุกข์คืออะไร", sources: true },
  { caption: "Ask for the Pali: the canon's own words, in Thai script", text: "ทุกข์คืออะไร ขอเป็นภาษาบาลี" },
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
  // the chat column is 672 px wide: frame it, not the empty page around it
  const context = await browser.newContext({ viewport: { width: 704, height: 1200 }, deviceScaleFactor: 2 });
  for (const shot of SHOTS.filter((s) => !names.length || names.includes(s.file.replace(".png", "")))) {
    const page = await open(context);
    await ask(page, shot.text);
    if (shot.sources) await page.locator("summary").last().click();
    // as tall as the conversation, so no empty band sits above the input
    const height = await page.evaluate(() => {
      const content = document.querySelector(".is-user").parentElement;
      return window.innerHeight - content.parentElement.clientHeight + content.scrollHeight + 8;
    });
    await page.setViewportSize({ width: 704, height: Math.min(Math.max(height, 640), 1500) }); // a long reply is cut, as on screen
    await page.waitForTimeout(800); // the chat scrolls itself to the bottom after a resize: let it finish
    // a wheel turn up stops it following the bottom, or opened sources would pull it back down
    await page.locator("[role=log] > div").first().dispatchEvent("wheel", { deltaY: -1 });
    await page.locator(".is-user").last().evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, shot.file) });
    console.log(`wrote docs/media/${shot.file}`);
    await page.close();
  }
  await context.close();
  if (!names.length || names.includes("history")) await history();
}

async function history() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await open(context);
  for (const [i, text] of HISTORY.entries()) {
    if (i) await page.getByRole("button", { name: "New conversation" }).first().click();
    await ask(page, text);
  }
  await page.mouse.move(0, 0); // no list item left in its hover state
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, "history.png") });
  console.log("wrote docs/media/history.png");

  // then a clip of the sidebar at work: open the others, start anew, go back, delete one
  const dir = mkdtempSync(join(tmpdir(), "buddha-history-"));
  const frames = await record(page, dir, { maxWidth: 1280, maxHeight: 800 });
  const item = (title) => page.locator("[data-sidebar=menu-item]", { hasText: title });
  const pause = () => page.waitForTimeout(2200);
  await pause();
  for (const title of HISTORY.slice(0, 2).reverse()) {
    await item(title).getByRole("button", { name: title }).click();
    await pause();
  }
  await page.getByRole("button", { name: "New conversation" }).first().click();
  await pause();
  await item(HISTORY[2]).getByRole("button", { name: HISTORY[2] }).click();
  await pause();
  await item(HISTORY[1]).getByRole("button", { name: "Delete conversation" }).click(); // asks once more
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Delete this conversation" }).click();
  await pause();
  const list = await frames.stop();
  ffmpeg([
    "-f", "concat", "-safe", "0", "-i", list, "-vf",
    "fps=8,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=5",
    join(OUT, "history.gif"),
  ]);
  rmSync(dir, { recursive: true });
  console.log(`wrote docs/media/history.gif (${(statSync(join(OUT, "history.gif")).size / 1e6).toFixed(1)} MB)`);
  await context.close();
}

async function demo() {
  const dir = mkdtempSync(join(tmpdir(), "buddha-demo-"));
  const context = await browser.newContext({ viewport: { width: 720, height: 900 } });
  const page = await open(context);
  const frames = await record(page, dir);
  // a caption bar above the app, which keeps its full height below it
  await page.addStyleTag({
    content: `body { padding-top: 44px; } [data-slot=sidebar-wrapper] { height: calc(100svh - 44px) !important; min-height: 0 !important; }
      #demo-caption { position: fixed; inset: 0 0 auto 0; height: 44px; display: flex; align-items: center;
        justify-content: center; background: #18181b; color: #fafafa; font: 500 15px system-ui, sans-serif; }`,
  });
  await page.evaluate(() => document.body.append(Object.assign(document.createElement("div"), { id: "demo-caption" })));
  await page.waitForTimeout(1200);
  const chat = page.locator("[role=log] > div").first(); // the chat's scrolling element
  for (const scene of SCENES) {
    await page.locator("#demo-caption").evaluate((el, text) => (el.textContent = text), scene.caption);
    // back to the bottom with the (hidden) scroll-down button, so the chat follows the next reply
    await page.locator("[role=log] button.rounded-full.absolute").evaluateAll((buttons) => buttons.forEach((b) => b.click()));
    await ask(page, scene.text, 40);
    // a fast reply and its cards scroll past at once: a wheel turn up stops the chat following its
    // bottom, as it would for a person, and the question goes back to the top to read the reply
    await chat.dispatchEvent("wheel", { deltaY: -1 });
    await page.locator(".is-user").last().evaluate((el) => el.scrollIntoView({ block: "start", behavior: "smooth" }));
    await page.waitForTimeout(4000); // time to read
    if (scene.sources) {
      await page.locator("summary").last().click();
      await page.waitForTimeout(3000);
    }
  }
  await page.waitForTimeout(1500);
  const list = await frames.stop();
  await context.close();

  const video = ["-f", "concat", "-safe", "0", "-i", list];
  ffmpeg([...video, "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-crf", "26", "-preset", "slow", "-movflags", "+faststart", join(OUT, "demo.mp4")]);
  // the GIF plays in the README: at double speed (real replies take a while; the MP4 keeps real
  // time), 8 fps, at its 720 px width, with its own 128-colour palette
  ffmpeg([
    ...video, "-vf",
    "setpts=PTS/2,fps=8,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=5",
    join(OUT, "demo.gif"),
  ]);
  rmSync(dir, { recursive: true });
  for (const f of ["demo.mp4", "demo.gif"]) console.log(`wrote docs/media/${f} (${(statSync(join(OUT, f)).size / 1e6).toFixed(1)} MB)`);
}

// Records the page with Chrome's screencast: a frame on every repaint, each shown until the next.
// stop() writes the ffmpeg concat list that replays them with their real timing.
async function record(page, dir, size = { maxWidth: 720, maxHeight: 900 }) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    const file = join(dir, `${String(frames.length).padStart(5, "0")}.jpg`);
    writeFileSync(file, Buffer.from(data, "base64"));
    frames.push({ file, at: metadata.timestamp });
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, ...size });
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

// A page with an empty conversation.
async function open(context) {
  const page = await context.newPage();
  await page.goto(APP);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  // the dev-mode badge, and the scroll-down button that floats over a long reply
  await page.addStyleTag({ content: "nextjs-portal, [role=log] button.rounded-full.absolute { display: none !important; }" });
  await page.getByRole("textbox", { name: "Your message" }).waitFor();
  return page;
}

// Asks one question (typed out, for the demo) and waits until the streamed reply has ended.
async function ask(page, text, typing = 0) {
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
