import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { app } from "./app.ts";

async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

// A stand-in for the Go core's /healthz that answers after `delayMs`.
function fakeCore(db: "up" | "down", delayMs = 0) {
  return createServer((_req, res) => {
    setTimeout(() => {
      res.statusCode = db === "up" ? 200 : 503;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: db === "up", db }));
    }, delayMs);
  });
}

const hits = [
  { id: "sn56.11#en4", sutta_id: "sn56.11", lang: "en", text: "Now this, monks, is the noble truth of stress.", score: 1 },
  { id: "dhp1-20#en1", sutta_id: "dhp1-20", lang: "en", text: "Phenomena are preceded by the heart.", score: 0.9 },
];

// A stand-in for the Go core's /v1 routes that records what the agent asked for. The quote lookup finds
// nothing for "peace comes from within", the fake quote.
function fakeRetrieval() {
  const seen = { searches: [] as { query: string; exclude: string[] }[], quotes: [] as string[], passages: [] as string[], cards: [] as string[][], near: [] as string[] };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      const path = new URL(req.url ?? "", "http://core").pathname;
      if (path === "/v1/me") {
        const known = req.headers.authorization === "Bearer t0ken";
        res.statusCode = known ? 200 : 401;
        return res.end(JSON.stringify(known ? { user: { username: "max" } } : { error: "Sign in first." }));
      }
      if (path === "/v1/search") {
        const { query, exclude } = JSON.parse(body);
        seen.searches.push({ query, exclude });
        const none = query === "peace comes from within";
        return res.end(JSON.stringify(none ? { hits: [], top_cosine: 0, top_lexical: 0 } : { hits, top_cosine: 0, top_lexical: 1 }));
      }
      if (path === "/v1/quote") {
        const { quote } = JSON.parse(body);
        seen.quotes.push(quote);
        return res.end(JSON.stringify({ lines: [], words: null }));
      }
      if (path.startsWith("/v1/suttas/")) {
        const sutta = decodeURIComponent(path.split("/")[3]);
        seen.near.push(new URL(req.url ?? "", "http://core").searchParams.get("near") ?? "");
        return res.end(JSON.stringify({ paragraphs: [{ id: `${sutta}#pi1`, sutta_id: sutta, lang: "pi", text: `Idaṃ kho pana, bhikkhave (${sutta}).`, score: 0 }] }));
      }
      if (path.startsWith("/v1/passages/")) {
        const id = decodeURIComponent(path.slice("/v1/passages/".length));
        seen.passages.push(id);
        return res.end(JSON.stringify({ passage: [{ id, sutta_id: id.split("#")[0], lang: "en", text: "The contemplative Gotama abstains from wrong livelihood.", score: 0 }] }));
      }
      const { ids } = JSON.parse(body);
      seen.cards.push(ids);
      res.end(JSON.stringify({ cards: ids.map((id: string) => ({ id, sutta_id: id.split("#")[0], collection: "SN", texts: { en: "…" } })) }));
    });
  });
  return { server, seen };
}

type Seen = ReturnType<typeof fakeRetrieval>["seen"];

// Runs fn against a live agent (mock model, no key) and a fake core.
async function withAgent(fn: (post: (messages: unknown[]) => Promise<Turn>, seen: Seen, url: string) => Promise<void>) {
  delete process.env.OPENROUTER_API_KEY;
  const core = fakeRetrieval();
  const agent = createServer(app);
  try {
    process.env.RETRIEVAL_URL = await listen(core.server);
    const url = await listen(agent);
    await fn((messages) => post(url, messages), core.seen, url);
  } finally {
    agent.close();
    core.server.close();
  }
}

interface Turn {
  status: number;
  text: string;
  data: (type: string) => any;
}

async function post(url: string, messages: unknown[]): Promise<Turn> {
  const res = await fetch(`${url}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages }) });
  const chunks = (await res.text())
    .split("\n")
    .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => JSON.parse(l.slice(6)));
  return {
    status: res.status,
    text: chunks.filter((c) => c.type === "text-delta").map((c) => c.delta).join(""),
    data: (type) => chunks.find((c) => c.type === type)?.data,
  };
}

const user = (text: string, id = "u1") => ({ id, role: "user", parts: [{ type: "text", text }] });

test("a chat turn streams a cited reply and its cards (mock model, no key)", () =>
  withAgent(async (post, seen) => {
    const turn = await post([user("What is suffering?")]);
    assert.equal(turn.status, 200);
    assert.match(turn.text, /\[\[cite:sn56\.11#en4\]\]/);
    assert.match(turn.text, /\[\[cite:dhp1-20#en1\]\]/);
    assert.deepEqual(seen.cards, [["sn56.11#en4", "dhp1-20#en1"]]); // cards for exactly the cited passages
    assert.equal(turn.data("data-cards").length, 2);
    assert.match(turn.data("data-notice"), /Mock model/);
    assert.equal(turn.data("data-risk"), undefined);
    assert.deepEqual(seen.searches[0].exclude, []);
  }));

test("a crisis message gets the hotlines first and turns risk on, without a search", () =>
  withAgent(async (post, seen) => {
    const turn = await post([user("I want to kill myself")]);
    assert.equal(turn.status, 200);
    const numbers = turn.data("data-crisis").lines.map((l: { number?: string }) => l.number);
    assert.deepEqual(numbers.slice(0, 5), ["1323", "1669", "1300", "1387", "191"]);
    assert.equal(turn.data("data-risk"), true);
    assert.equal(seen.searches.length, 0);
  }));

test("risk stays on: later turns search without the risk suttas", () =>
  withAgent(async (post, seen) => {
    const flagged = { id: "a1", role: "assistant", parts: [{ type: "text", text: "I'm here with you." }, { type: "data-risk", data: true }] };
    const turn = await post([user("hello"), flagged, user("What is suffering?", "u2")]);
    assert.deepEqual(seen.searches[0].exclude, ["sn22.87", "sn35.87", "sn4.23", "sn54.9"]);
    assert.equal(turn.data("data-risk"), true);
  }));

test("a lottery request gets a kind no with DN 1's card, not a search", () =>
  withAgent(async (post, seen) => {
    const turn = await post([user("Give me lucky lottery numbers")]);
    assert.deepEqual(seen.passages, ["dn1#en64"]);
    assert.equal(seen.searches.length, 0);
    assert.deepEqual(seen.cards, [["dn1#en64"]]);
    assert.match(turn.text, /\[\[cite:dn1#en64\]\]/);
  }));

test("words the texts don't contain get the honest verdict first", () =>
  withAgent(async (post, seen) => {
    const turn = await post([user('Did the Buddha say "peace comes from within"?')]);
    assert.ok(turn.text.startsWith("I don't recall saying those words. "), turn.text);
    assert.deepEqual(seen.quotes, ["peace comes from within"]);
  }));

test("asked for the Pali, it quotes the canon verbatim: the model names passages, code writes them out", () =>
  withAgent(async (post, seen) => {
    const turn = await post([user("What is suffering? Answer in Pali.")]);
    assert.ok(turn.text.startsWith("Idaṃ kho pana, bhikkhave (sn56.11). [[cite:sn56.11#pi1]]"), turn.text);
    assert.deepEqual(seen.cards, [["sn56.11#pi1", "dhp1-20#pi1"]]);
    assert.deepEqual(seen.near, ["sn56.11#en4", "dhp1-20#en1"]); // each sutta's Pali around its best hit
    assert.equal(turn.data("data-pali"), true);
  }));

test("a reply is in the message's language, or the one it asks for", () =>
  withAgent(async (post) => {
    assert.match((await post([user("ทุกข์คืออะไร")])).text, /นี่คือคำตอบจำลอง.*\[\[cite:sn56\.11#en4\]\]/);
    assert.match((await post([user("ทุกข์คืออะไร ตอบเป็นภาษาอังกฤษ")])).text, /^This is a mock reply/);
    assert.match((await post([user("What is suffering? Answer in Thai.")])).text, /^นี่คือคำตอบจำลอง/);
    assert.equal((await post([user("ทุกข์คืออะไร ขอเป็นภาษาบาลี")])).data("data-pali"), true);
  }));

test("eval mode answers in JSON with a debug block, and only when EVAL_MODE is on", async () => {
  delete process.env.OPENROUTER_API_KEY;
  const core = fakeRetrieval();
  const agent = createServer(app);
  try {
    process.env.RETRIEVAL_URL = await listen(core.server);
    const url = await listen(agent);
    const ask = () =>
      fetch(`${url}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [user("What is suffering?")], eval: true }),
      });
    delete process.env.EVAL_MODE;
    assert.equal((await ask()).status, 403);
    process.env.EVAL_MODE = "1";
    const r = (await (await ask()).json()) as any;
    assert.match(r.reply, /\[\[cite:sn56\.11#en4\]\]/);
    assert.equal(r.debug.route, "answer");
    assert.deepEqual(r.debug.searched, ["sn56.11#en4", "dhp1-20#en1"]);
    assert.deepEqual(r.debug.cited, ["sn56.11#en4", "dhp1-20#en1"]);
    assert.ok(r.debug.cited.every((id: string) => r.debug.retrieved.includes(id)));
    assert.equal(r.cards.length, 2);
    assert.equal(r.debug.mock, true);
  } finally {
    delete process.env.EVAL_MODE;
    agent.close();
    core.server.close();
  }
});

test("bad requests: no user message, or a message over the length limit", () =>
  withAgent(async (post) => {
    assert.equal((await post([])).status, 400);
    assert.equal((await post([user("x".repeat(2001))])).status, 413);
  }));

test("healthz reports the core and its database", async () => {
  const agent = createServer(app);
  const healthyCore = fakeCore("up");
  const slowDbCore = fakeCore("down", 1200); // the core's own database probe gives up after 1 s
  const agentUrl = await listen(agent);
  const health = async () => (await fetch(`${agentUrl}/healthz`)).json();
  try {
    process.env.RETRIEVAL_URL = await listen(healthyCore);
    assert.deepEqual(await health(), { ok: true, core: "up", db: "up" });

    process.env.RETRIEVAL_URL = await listen(slowDbCore);
    assert.deepEqual(await health(), { ok: true, core: "up", db: "down" });

    process.env.RETRIEVAL_URL = "http://127.0.0.1:9"; // nothing listens on the discard port
    assert.deepEqual(await health(), { ok: true, core: "down", db: "unknown" });
  } finally {
    agent.close();
    healthyCore.close();
    slowDbCore.close();
  }
});

// A stand-in for the Go core's account routes that records the bearer token each call carried.
function fakeAccounts() {
  const seen: string[] = [];
  const server = createServer(async (req, res) => {
    seen.push(`${req.method} ${req.url} ${req.headers.authorization ?? "-"}`);
    res.setHeader("Content-Type", "application/json");
    if (req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      if (JSON.parse(body || "{}").password === "wrong") {
        res.statusCode = 401;
        return res.end(JSON.stringify({ error: "That username and password don't match." }));
      }
      res.statusCode = req.url === "/v1/users" ? 201 : 200;
      return res.end(JSON.stringify({ user: { username: "max" }, token: "t0ken", expires: Date.now() + 60_000 }));
    }
    if (req.method === "DELETE") {
      res.statusCode = 204;
      return res.end();
    }
    res.end(JSON.stringify({ chats: [] }));
  });
  return { server, seen };
}

test("accounts: the session lives in an HttpOnly cookie, and the core gets it as a bearer token", async () => {
  process.env.CORS_ORIGINS = "http://localhost:5005";
  const core = fakeAccounts();
  const agent = createServer(app);
  try {
    process.env.RETRIEVAL_URL = await listen(core.server);
    const url = await listen(agent);
    const web = { "Content-Type": "application/json", Origin: "http://localhost:5005" };
    const signUp = await fetch(`${url}/api/auth/signup`, { method: "POST", headers: web, body: JSON.stringify({ username: "max", password: "long enough" }) });
    assert.equal(signUp.status, 201);
    assert.deepEqual(await signUp.json(), { user: { username: "max" } }); // the token never reaches the page
    const cookie = signUp.headers.get("set-cookie") ?? "";
    assert.match(cookie, /^buddha_session=t0ken;/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);

    assert.equal((await fetch(`${url}/api/chats`, { headers: { Cookie: "buddha_session=t0ken" } })).status, 200);
    assert.equal(core.seen.at(-1), "GET /v1/chats Bearer t0ken");

    // a change from another origin, even another localhost port, never reaches the core
    const calls = core.seen.length;
    const forged = await fetch(`${url}/api/chats/c1`, { method: "DELETE", headers: { Cookie: "buddha_session=t0ken", Origin: "http://localhost:6666" } });
    assert.equal(forged.status, 403);
    assert.equal(core.seen.length, calls);

    const out = await fetch(`${url}/api/auth/logout`, { method: "POST", headers: { ...web, Cookie: "buddha_session=t0ken" } });
    assert.equal(out.status, 204);
    assert.equal(core.seen.at(-1), "DELETE /v1/sessions Bearer t0ken");
    assert.match(out.headers.get("set-cookie") ?? "", /^buddha_session=;/);

    // a sign-in that works doesn't count against the address; one that fails does, up to a limit
    const login = (password: string) => fetch(`${url}/api/auth/login`, { method: "POST", headers: web, body: JSON.stringify({ username: "max", password }) });
    for (let i = 0; i < 25; i++) assert.equal((await login("long enough")).status, 200);
    let status = 0;
    for (let i = 0; i < 25 && status !== 429; i++) status = (await login("wrong")).status;
    assert.equal(status, 429);
  } finally {
    agent.close();
    core.server.close();
  }
});

// Last, since it uses up this address's share of turns for the rest of the run.
test("chat turns are limited per address, more for someone signed in, and eval runs aren't counted", () =>
  withAgent(async (post, _seen, url) => {
    let turn = await post([user("What is suffering?")]);
    for (let i = 0; i < 40 && turn.status !== 429; i++) turn = await post([user("What is suffering?")]);
    assert.equal(turn.status, 429);
    const ask = (headers: Record<string, string>, extra = {}) =>
      fetch(`${url}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ messages: [user("What is suffering?")], ...extra }),
      });
    const refused = await ask({ Cookie: "buddha_session=forged" });
    assert.equal(refused.status, 429);
    assert.match(((await refused.json()) as { error: string }).error, /Sign in for more/);
    assert.equal((await ask({ Cookie: "buddha_session=t0ken" })).status, 200); // a live session has room left
    process.env.EVAL_MODE = "1";
    try {
      assert.equal((await ask({}, { eval: true })).status, 200);
    } finally {
      delete process.env.EVAL_MODE;
    }
  }));
