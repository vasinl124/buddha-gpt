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

test("a chat turn streams a cited reply and its cards (mock model, no key)", async () => {
  delete process.env.OPENROUTER_API_KEY;
  const hits = [
    { id: "sn56.11#en4", sutta_id: "sn56.11", lang: "en", text: "Now this, monks, is the noble truth of stress.", score: 1 },
    { id: "dhp1-20#en1", sutta_id: "dhp1-20", lang: "en", text: "Phenomena are preceded by the heart.", score: 0.9 },
  ];
  let askedFor: string[] = [];
  const core = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/v1/search") return res.end(JSON.stringify({ hits }));
      askedFor = JSON.parse(body).ids;
      res.end(JSON.stringify({ cards: askedFor.map((id) => ({ id, sutta_id: id.split("#")[0], collection: "SN", texts: { en: "…" } })) }));
    });
  });
  const agent = createServer(app);
  const agentUrl = await listen(agent);
  try {
    process.env.RETRIEVAL_URL = await listen(core);
    const res = await fetch(`${agentUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "What is suffering?" }] }] }),
    });
    assert.equal(res.status, 200);
    const chunks = (await res.text())
      .split("\n")
      .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
      .map((l) => JSON.parse(l.slice(6)));
    const text = chunks.filter((c) => c.type === "text-delta").map((c) => c.delta).join("");
    assert.match(text, /\[\[cite:sn56\.11#en4\]\]/);
    assert.match(text, /\[\[cite:dhp1-20#en1\]\]/);
    assert.deepEqual(askedFor, ["sn56.11#en4", "dhp1-20#en1"]); // cards for exactly the cited passages
    assert.equal(chunks.find((c) => c.type === "data-cards")?.data.length, 2);
    assert.match(chunks.find((c) => c.type === "data-notice")?.data ?? "", /Mock model/);

    const bad = await fetch(`${agentUrl}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(bad.status, 400);
  } finally {
    agent.close();
    core.close();
  }
});

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
