// Accounts and the conversations they keep, for the browser. The Go core keeps them (PRD §8.6);
// the agent is the door. It holds the session token in an HttpOnly cookie, out of reach of the
// page's scripts, and hands it to the core as a bearer token.
import express, { type Request, type Response } from "express";

const COOKIE = "buddha_session";
const TRIES = 20; // sign-ins and sign-ups from one address in a window
const WINDOW_MS = 15 * 60_000;

/** The web app's origins: CORS lets them read the agent's answers, and only they may change an account. */
export const origins = () => (process.env.CORS_ORIGINS || "http://localhost:5005").split(",");
const core = () => process.env.RETRIEVAL_URL || "http://localhost:7890";

export const accounts = express.Router();

// A cookie rides along with any request from the same site, other localhost ports included, so a
// change has to come from the web app itself.
accounts.use(["/api/auth", "/api/chats"], (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method) || origins().includes(req.get("origin") ?? "")) return next();
  res.status(403).json({ error: "Only the web app can do that." });
});

// Each address's counted tries. Behind a proxy, TRUST_PROXY makes req.ip the client's (app.ts).
// ponytail: counted in this process's memory; a shared store if the agent runs as several instances
const tries = new Map<string, number[]>();
const recent = (address: string, now = Date.now()) => (tries.get(address) ?? []).filter((t) => now - t < WINDOW_MS);
function count(address: string) {
  const now = Date.now();
  tries.set(address, [...recent(address, now), now]);
  if (tries.size > 10_000) for (const [k, v] of tries) if (now - (v.at(-1) ?? 0) > WINDOW_MS) tries.delete(k);
}

// Calls the core as whoever the cookie says is signed in, if anyone.
function ask(req: Request, path: string, init: RequestInit = {}) {
  const token = req.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`))?.[1];
  return fetch(`${core()}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) },
    signal: AbortSignal.timeout(10_000),
  });
}

// Hands the core's answer on as it came.
async function pass(res: Response, answer: globalThis.Response) {
  res.status(answer.status);
  if (answer.status === 204) res.end();
  else res.type("json").send(await answer.text());
}

const route = (fn: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
  try {
    await fn(req, res);
  } catch {
    res.status(502).json({ error: "Accounts can't be reached right now." });
  }
};

// Signs up or in through the core, then keeps the session in the cookie, Secure over HTTPS. Every
// sign-up counts against the address, so it can't make accounts in bulk; a sign-in counts when it fails.
const enter = (path: string, countEvery: boolean) =>
  route(async (req, res) => {
    const address = req.ip ?? "";
    if (recent(address).length >= TRIES) {
      res.status(429).json({ error: "Too many tries. Wait a few minutes." });
      return;
    }
    const answer = await ask(req, path, { method: "POST", body: JSON.stringify(req.body ?? {}) });
    if (countEvery || !answer.ok) count(address);
    if (!answer.ok) return pass(res, answer);
    const { user, token, expires } = (await answer.json()) as { user: unknown; token: string; expires: number };
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: req.secure, path: "/api", expires: new Date(expires) });
    res.status(answer.status).json({ user });
  });

const chat = (req: Request) => `/v1/chats/${encodeURIComponent(String(req.params.id))}`;

accounts.post("/api/auth/signup", express.json(), enter("/v1/users", true));
accounts.post("/api/auth/login", express.json(), enter("/v1/sessions", false));
accounts.post(
  "/api/auth/logout",
  route(async (req, res) => {
    await ask(req, "/v1/sessions", { method: "DELETE" });
    res.clearCookie(COOKIE, { path: "/api" }).status(204).end();
  }),
);
accounts.get("/api/auth/me", route(async (req, res) => pass(res, await ask(req, "/v1/me"))));

accounts.get("/api/chats", route(async (req, res) => pass(res, await ask(req, "/v1/chats"))));
accounts.get("/api/chats/:id", route(async (req, res) => pass(res, await ask(req, chat(req)))));
accounts.put(
  "/api/chats/:id",
  express.json({ limit: "2mb" }),
  route(async (req, res) => pass(res, await ask(req, chat(req), { method: "PUT", body: JSON.stringify(req.body) }))),
);
accounts.delete("/api/chats/:id", route(async (req, res) => pass(res, await ask(req, chat(req), { method: "DELETE" }))));
