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
