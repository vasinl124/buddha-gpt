// Types shared by the web app and the agent. Add a type here only when both sides use it.

export type Status = "up" | "down" | "unknown";

/** GET /healthz on the agent: the agent itself, the Go core, and Postgres as the core sees it. */
export interface AgentHealth {
  ok: true;
  core: Status;
  db: Status;
}
