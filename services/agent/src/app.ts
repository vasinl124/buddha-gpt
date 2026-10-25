import type { AgentHealth, Status } from "@buddha-gpt/shared";
import cors from "cors";
import express from "express";

export const app = express();

app.use(cors({ origin: (process.env.CORS_ORIGINS ?? "http://localhost:5005").split(",") }));

// Liveness, plus what the agent can reach: the Go core and, through it, Postgres.
app.get("/healthz", async (_req, res) => {
  const retrieval = process.env.RETRIEVAL_URL ?? "http://localhost:7890";
  let core: Status = "down";
  let db: Status = "unknown";
  try {
    const r = await fetch(`${retrieval}/healthz`, { signal: AbortSignal.timeout(1000) });
    const body = (await r.json()) as { db: Status };
    core = "up";
    db = body.db;
  } catch {
    // the core is unreachable, so the database status is unknown
  }
  res.json({ ok: true, core, db } satisfies AgentHealth);
});
