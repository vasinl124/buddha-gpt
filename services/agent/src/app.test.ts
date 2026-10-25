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

test("healthz reports the core and its database", async () => {
  const agent = createServer(app);
  const core = createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, db: "up" }));
  });
  const agentUrl = await listen(agent);
  try {
    process.env.RETRIEVAL_URL = await listen(core);
    const up = await fetch(`${agentUrl}/healthz`);
    assert.deepEqual(await up.json(), { ok: true, core: "up", db: "up" });

    process.env.RETRIEVAL_URL = "http://127.0.0.1:9"; // nothing listens on the discard port
    const down = await fetch(`${agentUrl}/healthz`);
    assert.deepEqual(await down.json(), { ok: true, core: "down", db: "unknown" });
  } finally {
    agent.close();
    core.close();
  }
});
