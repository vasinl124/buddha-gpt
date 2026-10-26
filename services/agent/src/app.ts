import type { AgentHealth, Status } from "@buddha-gpt/shared";
import cors from "cors";
import express from "express";
import { chat, type BuddhaMessage } from "./chat.ts";

// Longer than the core's 1 s database probe, so a slow database shows as db "down", not core "down".
const CORE_TIMEOUT_MS = 2000;
const MAX_CHARS = 2000; // the longest message the web input allows

export const app = express();

app.use(cors({ origin: (process.env.CORS_ORIGINS || "http://localhost:5005").split(",") }));

// One chat turn, streamed back as the AI SDK's UI message stream (SSE).
app.post("/api/chat", express.json({ limit: "1mb" }), async (req, res) => {
  const body = (req.body ?? {}) as { messages?: BuddhaMessage[]; eval?: boolean };
  const { messages } = body;
  if (!Array.isArray(messages) || !messages.some((m) => m.role === "user")) {
    res.status(400).json({ error: "send {messages: [...]} with at least one user message" });
    return;
  }
  const latest = messages.findLast((m) => m.role === "user")?.parts ?? [];
  if (latest.reduce((n, p) => n + (p.type === "text" ? p.text.length : 0), 0) > MAX_CHARS) {
    res.status(413).json({ error: `keep a message under ${MAX_CHARS} characters` });
    return;
  }
  if (body.eval && process.env.EVAL_MODE !== "1") {
    res.status(403).json({ error: "eval mode is off: set EVAL_MODE=1 for buddha eval" });
    return;
  }
  await chat(messages, res, body.eval === true);
});

// Liveness, plus what the agent can reach: the Go core and, through it, Postgres.
app.get("/healthz", async (_req, res) => {
  const retrieval = process.env.RETRIEVAL_URL || "http://localhost:7890";
  let core: Status = "down";
  let db: Status = "unknown";
  try {
    const r = await fetch(`${retrieval}/healthz`, { signal: AbortSignal.timeout(CORE_TIMEOUT_MS) });
    const body = (await r.json()) as { db: Status };
    core = "up";
    db = body.db;
  } catch {
    // the core is unreachable, so the database status is unknown
  }
  res.json({ ok: true, core, db } satisfies AgentHealth);
});
