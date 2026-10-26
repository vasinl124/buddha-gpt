import type { AgentHealth, Status } from "@buddha-gpt/shared";
import cors from "cors";
import express from "express";
import { accounts, origins, signedIn } from "./accounts.ts";
import { chat, type BuddhaMessage } from "./chat.ts";
import { counter } from "./limit.ts";

// Longer than the core's 1 s database probe, so a slow database shows as db "down", not core "down".
const CORE_TIMEOUT_MS = 2000;
const MAX_CHARS = 2000; // the longest message the web input allows
// Chat turns from one address in an hour, for a guest and for someone signed in. Each turn costs
// model calls, so a hosted demo can't be run up; eval runs aren't counted.
const GUEST_TURNS = 30;
const MEMBER_TURNS = 100;
const turns = counter(60 * 60_000);

export const app = express();

// Behind a reverse proxy, TRUST_PROXY says which hops to believe for the client's address and
// protocol: Express's "trust proxy", a hop count such as 1 or addresses such as loopback.
const trust = process.env.TRUST_PROXY;
if (trust) app.set("trust proxy", /^\d+$/.test(trust) ? Number(trust) : trust);

// credentials: the account routes carry the session cookie
app.use(cors({ origin: origins(), credentials: true }));
app.use(accounts);

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
  if (!body.eval) {
    const address = req.ip ?? "";
    const used = turns.used(address);
    // the core is asked who's signed in only once a guest's share is used up
    const member = used >= GUEST_TURNS && used < MEMBER_TURNS && (await signedIn(req));
    if (used >= MEMBER_TURNS || (used >= GUEST_TURNS && !member)) {
      res.status(429).json({
        error: used >= MEMBER_TURNS
          ? "You've reached this hour's limit. Ask again a little later."
          : "You've reached this hour's limit for guests. Sign in for more, or ask again a little later.",
      });
      return;
    }
    turns.count(address);
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
