# Buddha GPT

Talk with the Buddha in English, Thai or Pali. He answers in plain speech, and Sources under each reply opens the real passages he drew on, in Pali, Thai and English. He never invents scripture.

![A Thai question, the same question asked in Pali, a popular quote checked, a lottery request and a crisis message](docs/media/demo.gif)

[Watch the demo as a video](docs/media/demo.mp4). The design and the plan are in [docs/PRD.md](docs/PRD.md).

| Sources opens the passages behind an answer, here in Pali, Thai and English | Ask in Thai, and he answers in Thai |
|---|---|
| ![An answer about the four noble truths, with its sources open](docs/media/answer.png) | ![A Thai question answered in Thai with the noble truth of suffering, its sources folded below](docs/media/thai.png) |
| **Ask for the Pali, and he answers in the canon's own words, here in Thai script** | **A popular quote, checked: a similar teaching, in different words** |
| ![Asked for the Pali, the reply is the canon's own Pali, shown in Thai script](docs/media/pali.png) | ![Asked whether the Buddha said a popular quote, the app checks the texts and says what they hold](docs/media/quote.png) |
| **Lottery numbers get a kind no, with a teaching** | **A crisis message gets the right numbers at once** |
| ![A Thai lottery request gets a kind no, its source folded below](docs/media/decline.png) | ![A crisis message answered with Thailand's hotline numbers](docs/media/crisis.png) |

**Past conversations stay in a sidebar (a drawer on a phone), kept in this browser only**

![Three conversations in the sidebar, grouped under Today, with the newest open](docs/media/history.png)

[See the sidebar at work](docs/media/history.gif): opening conversations, starting a new one and deleting one.

These replies come from DeepSeek V4 Flash, the default model. Real replies need an `OPENROUTER_API_KEY`; without one, a mock model shows the whole flow. `pnpm media` re-captures these pictures and the demo from the running app.

![Every service and how it talks to the others](docs/services.svg)

## Run it locally

You need Node 22+, pnpm 10, Go 1.26 and Docker, plus git and poppler's `pdftotext` for `pnpm sync` (`brew install poppler`).

```bash
pnpm install
cp .env.example .env
docker compose up -d db
pnpm dev
```

Open <http://localhost:5005>. The dot in the top bar shows whether the agent, the Go core and Postgres are up; hover it to see each. If something else already uses port 5432, set `POSTGRES_PORT` in `.env` and change the port in `DATABASE_URL` to match.

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

`evals/cases/*.jsonl` holds 42 cases, half in Thai: doctrine, life situations, follow-ups, Pali mode, a reply language asked for in the message, fake quotes, declines, crisis, don't-know and prompt injection. `buddha eval` plays them against the agent and checks the gates in PRD §10:

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
