# Buddha GPT

Talk with the Buddha in English, Thai or Pali. Every teaching he relies on appears under his reply as the real passage, in Pali, Thai and English, with its source. He never invents scripture.

> **Status:** Phase 4: a chat in English or Thai, or in Pali mode, where every citation opens a card with the real passage in Pali, Thai and English, with guardrails: a crisis message gets hotline numbers, a lottery request gets a kind no, and a made-up quote gets an honest answer. The design and the plan are in [docs/PRD.md](docs/PRD.md).

![Every service and how it talks to the others](docs/services.svg)

## Run it locally

You need Node 22+, pnpm 10, Go 1.26 and Docker, plus git and poppler's `pdftotext` for `pnpm sync` (`brew install poppler`).

```bash
pnpm install
cp .env.example .env
docker compose up -d db
pnpm dev
```

Open <http://localhost:5005>. The page shows whether the agent, the Go core and Postgres are up. If something else already uses port 5432, set `POSTGRES_PORT` in `.env` and change the port in `DATABASE_URL` to match.

| Service | Health check |
|---|---|
| Web (Next.js) | <http://localhost:5005/healthz> |
| Agent (Express) | <http://localhost:7891/healthz> |
| Retrieval API (Go) | <http://localhost:7890/healthz> |

To load the texts and search them:

```bash
pnpm sync                          # about a minute the first time; embeddings need OPENROUTER_API_KEY
pnpm search "four noble truths"
```

Then ask a question on the page. Without `OPENROUTER_API_KEY`, a mock model answers by citing the top passages, so you can try the whole turn first, and search is keyword-only until the embeddings exist.

## Evals

`evals/cases/*.jsonl` holds 40 cases, half in Thai: doctrine, life situations, follow-ups, Pali mode, fake quotes, declines, crisis, don't-know and prompt injection. `buddha eval` plays them against the agent and checks the gates in PRD §10:

```bash
EVAL_MODE=1 pnpm dev   # eval mode answers in JSON with a debug block
pnpm eval              # writes evals/reports/<time>.md; exits 1 if a gate fails
```

On pull requests that touch the prompts, the policy, the agent or retrieval, GitHub Actions runs the same suite and comments the report. It needs two repository secrets: `OPENROUTER_API_KEY`, and `EVAL_DB_URL`, a private link to a dump of a synced database (`docker compose exec db pg_dump -U postgres -Fc buddha_gpt > buddha.dump`). Until both exist, the job skips.

The monorepo layout, commands and conventions are in [AGENTS.md](AGENTS.md).

## Texts and licences

The source texts aren't in this repo. `pnpm sync` downloads them:

- **Pali:** VRI's Chaṭṭha Saṅgāyana edition, free for non-commercial use with credit.
- **Thai:** the Royal translation (ฉบับหลวง), which carries no rights statement.
- **English:** Ṭhānissaro Bhikkhu (CC BY-NC 4.0), and public-domain translations from 1930 or earlier for the suttas he didn't translate.

Because of these terms, Buddha GPT is free and non-commercial.
