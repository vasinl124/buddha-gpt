# Buddha GPT

Talk with the Buddha in English, Thai or Pali: a grounded RAG agent where every quote is real. The product and design live in [docs/PRD.md](docs/PRD.md).

## Architecture

- **The web app is a thin client.** The agent owns the chat turn (guard, retrieval, the model call, the checks), and the Go core owns the data (canon, vectors, search, and accounts with their conversations). Never put business logic in Next.js.
- **The model chooses, code quotes.** The model picks passage IDs; code fills every card and quote from the database. Model output never becomes scripture text.

```text
buddha-gpt/
├── apps/web/            Next.js 16 + shadcn/ui · pnpm: buddha-gpt-web                 :5005
├── services/agent/      Express 5 + AI SDK 7 · pnpm: buddha-gpt-agent                 :7891
├── services/core/       Go module, skipped by pnpm: one `buddha` binary
│                        (serve = Retrieval API :7890, sync, eval)
├── packages/shared/     @buddha-gpt/shared · TS types used by both web and agent
├── prompts/             buddha.md (the reply) and guard.md (the router), read by the agent at startup
├── policy.yaml          crisis words and hotlines, decline topics, risk lists, thresholds
├── docs/                PRD.md, diagrams (docs/archive/ is private and git-ignored)
└── docker-compose.yml   Postgres 18 + pgvector                                        :5432
```

`apps/*` are deployed apps, `services/*` are hosted backends, and `packages/*` are shared libraries. Add to `packages/shared` only what both the web app and the agent use. `evals/cases/*.jsonl` are the eval cases; reports go to `evals/reports/` (git-ignored).

## Stack

- **Web:** Next.js 16 (App Router, Cache Components), Tailwind 4, shadcn/ui (`radix-nova`), AI Elements for the chat parts
- **Agent:** Node 22, Express 5, AI SDK 7, OpenRouter
- **Core:** Go 1.26, `net/http`, pgx. SQL migrations in `services/core/migrations/` are applied on startup; no ORM.
- **Database:** Postgres 18 + pgvector + `pg_trgm`, through Docker Compose

These frameworks move fast. Next.js ships its own docs in `apps/web/node_modules/next/dist/docs/` (see `apps/web/AGENTS.md`); check current docs before writing framework code.

## Commands

```bash
docker compose up -d db   # Postgres + pgvector
pnpm dev                  # Go core + agent + web, through concurrently
pnpm dev:core             # or dev:agent, dev:web: one service
pnpm lint                 # ESLint, type checks, go vet
pnpm test                 # TypeScript tests (agent, web), then go test
pnpm sync                 # download, parse, load and embed the texts
pnpm search "anatta"      # the top passages for a query (hybrid, or lexical without a key)
pnpm eval                 # evals/cases against the agent, which must run with EVAL_MODE=1
pnpm diagram              # regenerate docs/services.svg
pnpm media                # re-capture the README screenshots and demo (docs/media/) from the running app
```

## Ports

| Service | Port |
|---|---|
| Web (Next.js) | 5005 |
| Agent (Express) | 7891 |
| Retrieval API (Go) | 7890 |
| Postgres | 5432 |

## Environment

One root `.env` (git-ignored), documented in `.env.example`: `OPENROUTER_API_KEY`, `AGENT_MODEL`, `POSTGRES_PORT`, `DATABASE_URL`, `RETRIEVAL_URL`, `NEXT_PUBLIC_API_URL`, `CORS_ORIGINS`, `EVAL_MODE`, `EMBED_MODEL`, `EMBED_BASE_URL`. The Go core, the agent and Docker Compose read it, and every setting has a local default. With no `OPENROUTER_API_KEY`, a mock model answers and search is lexical only. If port 5432 is taken, set `POSTGRES_PORT` and the port in `DATABASE_URL` to match.

## Rules

- Source texts are never committed. `buddha sync` downloads them into `data/`, which git ignores.
- `prompts/` and `policy.yaml` are public, so safety lives in code, never in a secret prompt.
- Every service answers `GET /healthz`.
- Never commit `docs/archive/`.
