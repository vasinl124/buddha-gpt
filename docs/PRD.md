# Buddha GPT — PRD

| | |
|---|---|
| What | An open-source portfolio project: a grounded, three-language RAG agent |
| Status | Draft v0.2 · 2026-10-24 · Max Limsukhawat |
| History | Replaces the larger v0.1 draft, kept privately in `docs/archive/` (git-ignored) |
| Facts | Sources, licences and library versions checked on 2026-10-21 to 24. Anything unconfirmed is marked ⚠. |

## 1. What it is

You talk with the Buddha in English, Thai or Pali. He answers the way he does in the suttas: briefly, plainly, often with a simile or a question back. Under every reply sit the real passages he drew on, in Pali, Thai and English, with their sources. He never invents scripture, and he says so when the texts are silent.

**One line:** *a conversation with the Buddha where every quote is real.*

## 2. What it shows

Each part exists to show one skill:

| Skill | Where it shows |
|---|---|
| RAG over a messy, real corpus | Pali XML, Thai PDFs with broken glyphs, a thousand translation pages and 100-year-old scanned translations, joined by sutta ID (§8) |
| Multilingual retrieval | Thai and English in one vector space; Pali by lexical search; Thai search without word spaces (§8.5) |
| An agent with tools | AI SDK tool loop with `search_canon` and `get_passage`, capped at 4 steps (§9) |
| Grounding you can check | The model picks passages; code quotes them (§6) |
| Guardrails | Crisis path, declines, an honest "I don't know" (§6) |
| Evals | Golden set, LLM judge, CI gate on every prompt change (§10) |
| A polyglot monorepo | Next.js and Express in TypeScript, a Go API and Postgres + pgvector in one repo, so one PR and one eval run cover a prompt, the agent and retrieval together (§7.2) |

## 3. Users and the demo

- Thai Buddhists who chant Pali at the temple without knowing what it means.
- English-speaking seekers tired of fake "Buddha said" quotes they can't check.
- Pali students who juggle the root text, a translation and a dictionary in separate tabs.

**The two-minute demo** (the README GIF):
1. Ask in Thai "ทุกข์คืออะไร" (what is suffering?). He answers in Thai, with a card for SN 56.11 in Pali, Thai and English.
2. Ask for the Pali ("ขอเป็นภาษาบาลี"). He answers with the canon's own words, in Thai script.
3. "Did the Buddha say 'peace comes from within'?" He says he doesn't recall saying those words.
4. "ขอเลขเด็ดงวดนี้" (give me lucky lottery numbers). A kind no, pointing to DN 1.
5. A message from someone in crisis. Plain words and the right hotline numbers.
6. A PR that weakens the prompt. The eval gate turns red.

## 4. Scope

| Area | MVP | Later |
|---|---|---|
| Chat | Streaming; multi-turn, with follow-ups resolved from context (§9); replies in the message's language, or the one it asks for: English, Thai or Pali; starter questions; history kept in the browser | 👍/👎 feedback |
| Cards | Pali (in Thai script when the conversation is in Thai, otherwise Roman), Thai and English, verbatim, with credits and links | Paragraph alignment for every sutta (§8.3) |
| Corpus | DN, MN, SN, AN, Dhammapada, Sutta Nipāta | The rest of the Khuddaka, the Vinaya, the Abhidhamma |
| Tools | `search_canon`, `get_passage` | `lookup_pali_term` (Digital Pali Dictionary) |
| Safety | Crisis path, declines, don't-know, risk filters, fake-quote check | — |

**Not doing:** accounts, payments, ads, a mobile app, voice, images or an avatar of the Buddha, fine-tuning, storing chats on a server, generating Pali, machine-translating scripture. v0.1's heavy infrastructure is stretch work (§12).

## 5. Languages and persona

### 5.1 The three languages

| Reply language | What he writes |
|---|---|
| English or Thai | His own words, in his voice, with citations. The language the person asked for ("answer in Thai", which the guard reports), else the message's own: Thai if more than 30% of its letters are Thai script, otherwise English. Other languages get English. |
| Pali (asked for) | The canon's own words. The model picks 1–3 passages and writes only their IDs (`[[quote:sn56.11#pi3]]`); code inserts the verbatim Pali. Each passage's card carries its Thai and English. |

- The model never writes Pali and never translates scripture. In every mode, a run of three or more Pali words that doesn't match retrieved Pali is removed (§9).
- Crisis, decline, redirect and don't-know replies are never in Pali. They use the person's language, because someone in crisis has to understand the reply.
- Pali shows in Thai script when Thai is in the conversation, as Thai editions print it, and in Roman script (*dukkha*, *anattā*) otherwise; VRI's XML ships both.

```text
You:             What is suffering? Answer in Pali.
Buddha:          jātipi dukkhā, jarāpi dukkhā …   ← inserted by code from SN 56.11
                 [card: SN 56.11 · Pali · Thai · English]
```

### 5.2 Persona

- He speaks in the first person, as in the suttas: plain words, at most one simile, often a question back. Under 120 words unless asked to go deeper; no bullet lists.
- He teaches as someone speaking, not reading: never "the Buddha taught" or "this passage says", and no talk of passages, texts or searching. Code's own lines are in his voice too: "I don't recall teaching about this."
- In Thai he calls himself เรา or ตถาคต, as the Thai Tipitaka does, in a plain, gentle register with no ครับ/ค่ะ.
- He is honest about what he is. A line under the chat says this is an AI drawing on the Pali Canon, and asked "are you really the Buddha?", he tells the plain truth.
- **Only the cards carry his words.** AN 2.23 says that whoever presents what the Tathāgata didn't say as his words misrepresents him. So every reply is labelled as an AI reflection on the passages shown, and any span in quotes, or reported as something he said, must match retrieved text or it's removed.
- He never makes claims about anyone's karma, past lives, rebirth or attainment, never predicts, and never gives personal medical, legal or financial advice.

## 6. Guardrails

**The rule: the model chooses, code quotes.** The model decides which passages are relevant. Code fills the cards from the database by ID, checks every citation, and owns every hotline number and link.

Every turn gets exactly one route before anything is shown:

| Route | When | What he does |
|---|---|---|
| Crisis | Self-harm, a medical emergency, abuse, a threat to someone | Plain words, no similes. Code appends the hotlines: in Thailand 1323 (mental health), 1669 (emergency medical), 1300 (social assistance), 1387 (children), 191 (police); elsewhere findahelpline.com |
| Decline | Lottery numbers, fortune-telling, amulet powers; present-day politics and the monarchy; claims about anyone's karma or rebirth; personal medical, legal or financial advice; role-play, invented suttas, "ignore your rules" | One or two kind sentences, with a teaching where one fits: lottery → DN 1, stock tips → AN 8.54 (a livelihood in tune; DN 31 has no English in our sources), karma → AN 4.77. Politics and the monarchy get a plain no and no card |
| Redirect | A fair request in the wrong place ("fix my code") | One line on what he can help with |
| Chat | Greetings, thanks, questions about the app | Short and warm |
| Don't know | Nothing he can search answers it | "I don't recall teaching about this." Never "the texts are silent", except for curated cases |
| Answer | The texts speak to it | An answer from the passages, with cards |

Precedence: crisis > decline > redirect > chat > don't know > answer.

- **Who decides.** Crisis keywords in code *or* the guard classifier, a small structured-output call: either one wins. The guard picks the other routes, and a retrieval score below the threshold turns an answer into don't know.
- **A life situation beats a topic match.** He answers the grief and declines only the prediction inside it: "I won't say where your mother was reborn, but…"
- **The Vakkali problem.** Naive RAG would show a user in crisis the suttas about monks who ended their lives (Vakkali SN 22.87, Channa SN 35.87, Godhika SN 4.23, SN 54.9). Once a conversation shows risk, Go filters those passages out of search and the reply check blocks their names.
- **Fake quotes.** When the user attributes words to the Buddha, code looks them up. The same words get "Yes, those words are among my teachings" and a close match "Not in those words, but I taught something close", each with its card; no match gets "I don't recall saying those words".
- **Commentary isn't canon.** Later stories, such as Kisā Gotamī and the mustard seed, are labelled as later tradition and never cited as his words.

## 7. Architecture

### 7.1 Services and links

![Every service and every link, numbered to match the table below](services.svg)

| # | From → To | How it travels | Port | Who waits | What flows |
|---|---|---|---|---|---|
| 1 | Browser → Web app | HTTP | 5005 | the user | Pages and JavaScript |
| 2 | Browser → Agent | HTTP POST `/api/chat`, reply streamed back as SSE | 7891 | the user | In: the messages (history comes from the browser). Out: the reply, sentence by sentence, then the cards |
| 3 | Agent → OpenRouter | HTTPS, OpenAI-compatible, streamed | 443 | the user | The guard call, then the reply call with tools |
| 4 | Agent → Retrieval API | HTTP/JSON: `POST /v1/search`, `GET /v1/passages/{id}`, `GET /v1/suttas/{id}/paragraphs`, `POST /v1/cards` | 7890 | the user | A query and filters in; passages with IDs out (in Pali mode, the top suttas' Pali too). Then the cited IDs in; the cards out, verbatim from the database |
| 5 | Retrieval API → Postgres | SQL (pgx) | 5432 | the user | Hybrid search: pgvector plus trigrams |
| 6 | Retrieval API → OpenRouter | HTTPS | 443 | the user | Embeds the query (`baai/bge-m3`) |
| 7 | `buddha sync` → Sources | git clone and HTTPS downloads | 443 | nobody (batch) | VRI XML; Thai PDFs, 5 seconds apart as the site's robots.txt asks; Ṭhānissaro's sutta pages, 4 at a time; public-domain scans |
| 8 | `buddha sync` → OpenRouter | HTTPS | 443 | nobody | Embeds new or changed paragraphs |
| 9 | `buddha sync` → Postgres | SQL | 5432 | nobody | Upserts paragraphs by ID and hash, and their vectors |
| 10 | `buddha eval` → Agent | HTTP POST `/api/chat` in eval mode (JSON, not SSE) | 7891 | nobody (CI) | A case in; the reply, the cards and a debug block out. GitHub Actions runs it on PRs that touch the prompts, the policy, the agent or retrieval |
| 11 | `buddha eval` → OpenRouter | HTTPS | 443 | nobody | The judge model scores faithfulness and voice |

The agent allows CORS from the web app's origin, so link 2 goes straight from the page to :7891. Next.js only serves pages.

**How the messages travel, in plain words:**

| Kind | Plain words | One-liner |
|---|---|---|
| SSE (link 2) | The browser asks once. The server keeps that one response open and sends the reply as it's written, like live captions. | "SSE is a streaming HTTP response, server to browser only, which is all a chat reply needs." |
| HTTP/JSON (links 4, 10) | A letter and its reply: the agent asks Go for passages and waits. | "HTTP is the envelope and JSON is the letter. gRPC is the same call with a stricter, binary letter." |
| SQL (links 5, 9) | Go talks to Postgres in its own language, over a long-lived connection. | "The vectors live in the same Postgres as everything else, so there's no separate vector database." |
| Batch jobs (links 7–11) | Ingest and evals run when nobody is waiting. | "If a user is waiting, call directly. If nobody is, run a job." |

WebSockets would only earn their place if both sides needed to talk at once, as in voice. If you want gRPC on show, Connect-go serves one protobuf service as both gRPC and plain HTTP/JSON.

### 7.2 Monorepo

One repo holds every service, the prompts, the policy and the evals. So one PR can change a prompt, the agent and Go retrieval together, and one eval run tests them together. It follows the house layout: `apps/*` are deployed apps, `services/*` are hosted backend services, and `packages/*` are shared libraries, added only when something is genuinely shared.

```text
buddha-gpt/
├── apps/
│   └── web/             buddha-gpt-web · Next.js 16 + shadcn/ui · chat UI           :5005
├── services/
│   ├── agent/           buddha-gpt-agent · Express 5 + AI SDK 7 · POST /api/chat    :7891
│   └── core/            Go module, so pnpm skips it. One `buddha` binary:
│                        serve (Retrieval API :7890), sync, eval
│                        migrations/*.sql, applied on startup (no ORM)
├── packages/
│   └── shared/          @buddha-gpt/shared · TS types for web and agent: cards, routes, languages
├── prompts/             buddha.md, guard.md · any edit triggers the eval gate
├── policy.yaml          crisis words and hotlines, decline topics, risk lists, thresholds · read by the agent
├── evals/               cases/*.jsonl · reports/
├── data/                git-ignored: downloaded sources
├── docs/                PRD.md and diagrams
├── docker-compose.yml   Postgres 18 + pgvector                                      :5432
├── pnpm-workspace.yaml  apps/*, services/*, packages/*
├── package.json         root scripts (below)
├── AGENTS.md            conventions for future agents and developers; CLAUDE.md points here
├── README.md
├── .env.example
└── .gitignore
```

- **Thin web app.** Next.js serves pages and calls the agent. It holds no business logic: the agent owns the chat turn, and Go owns the data.
- **Go lives beside TypeScript.** `services/core` has a `go.mod` and no `package.json`, so pnpm skips it and the root scripts call `go` directly.
- **Why pnpm workspaces and `concurrently`, not Turborepo.** Turborepo's main benefit is caching builds and tests, but it only manages pnpm packages: Go would need a wrapper `package.json`, and three services leave little to cache. Fewer tools also keep Phase 0 short. The layout already fits Turborepo, so adding it later takes about 15 minutes if CI gets slow.

**Root scripts:**

| Script | What it runs |
|---|---|
| `pnpm dev` | `concurrently`: Go (`go run ./cmd/buddha serve`), the agent and the web app |
| `pnpm sync` | `buddha sync`: download, clean, embed and load the texts |
| `pnpm search "…"` | `buddha search`: the top passages for a query, from the command line |
| `pnpm eval` | `buddha eval` against the running agent |
| `pnpm test` | Every package's TypeScript tests, then `go test ./...` |
| `pnpm lint` | ESLint and type checks, then `go vet ./...` |
| `pnpm diagram` | Regenerates `docs/services.svg`; elkjs is a root dev dependency |

**Environment:** one root `.env` (git-ignored), documented by `.env.example`.

| Variable | Used by | Local default |
|---|---|---|
| `OPENROUTER_API_KEY` | agent, Go | — |
| `AGENT_MODEL` | agent: the reply model on OpenRouter. With no `OPENROUTER_API_KEY`, a mock model answers, so the whole turn can be tried without a key | `deepseek/deepseek-v4-flash-0731` |
| `DATABASE_URL` | Go | `postgres://postgres:postgres@localhost:5432/buddha_gpt` |
| `POSTGRES_PORT` | Docker Compose: the host port for Postgres, if 5432 is taken | `5432` |
| `RETRIEVAL_URL` | agent | `http://localhost:7890` |
| `NEXT_PUBLIC_API_URL` | web: the agent's URL | `http://localhost:7891` |
| `CORS_ORIGINS` | agent | `http://localhost:5005` |
| `EVAL_MODE` | agent: eval mode (JSON and the debug block) only answers when this is `1` | unset |
| `EMBED_MODEL`, `EMBED_BASE_URL` | Go: the embedding model and endpoint. Any OpenAI-compatible endpoint works, so a local Ollama can stand in during development | `baai/bge-m3`, OpenRouter |

### 7.3 Stack

| Layer | Choice | Notes |
|---|---|---|
| Web | Next.js 16, shadcn/ui (Tailwind), AI Elements | AI Elements, a shadcn-based registry from Vercel, supplies the chat parts: `conversation`, `message` (markdown through Streamdown) and `suggestion` (starter questions). The input is shadcn's `InputGroup`. A slim top bar holds the Dhamma-wheel mark, one status dot (hover lists the agent, the core and Postgres) and New conversation; an empty conversation starts with the input in the middle of the page, which moves to the bottom once there's a question. Replies read as plain speech with no citation markers, and each reply's cards, shadcn `Card`s, fold under a Sources toggle (a native `<details>`). Motion only shows state: a breathing dot holds a reply's place until its first words arrive (the checks hold a reply until its first citation), beside a line of goodwill from the Mettā Sutta, verbatim Pali with a gloss (none on a crisis turn), the words fade in as they stream (Streamdown's `animated`), and reduced motion turns it all off. While a reply streams, Send becomes Stop (or Esc); a failed reply offers Try again. `useChat` points at the agent with `DefaultChatTransport` and keeps the conversation in `localStorage`. Fonts: Noto Sans and Noto Sans Thai through `next/font`, which cover Pali diacritics and Thai; his replies are set in Noto Serif and Noto Serif Thai |
| Agent | Node 22, Express 5, AI SDK 7, `@openrouter/ai-sdk-provider` 3.x | `streamText` → `pipeUIMessageStreamToResponse(res)`; `stopWhen: isStepCount(4)`; `prepareStep` sets `activeTools: []` on the last step; the guard uses `Output.object` |
| Core | Go 1.26: `net/http`, pgx, pgvector-go | One binary, three commands |
| Database | Postgres 18, pgvector 0.8 (HNSW), `pg_trgm` | Canon and vectors in one database |
| Models | Through OpenRouter | Reply and guard: DeepSeek V4 Flash (`deepseek/deepseek-v4-flash-0731`), the cheapest model that runs the guard, at about a third of Claude Haiku 5.5's cost for this app. It's a cost choice for an educational project. Besides Recall@8, which fails for every model until retrieval is tuned, it narrowly misses faithfulness (3.9 against 4.0 in two of three runs), and its Thai is rougher. Haiku 5.5 passes every gate but Recall@8 (`AGENT_MODEL=anthropic/claude-haiku-5.5`). Judge: a different model family. Embeddings: `baai/bge-m3` |
| CI | GitHub Actions | Lint, tests, eval gate |
| Monorepo | pnpm 10 workspace + `concurrently` 10 | The house layout, with no Turborepo. Go isn't a pnpm package, so root scripts call it directly |

- Set `provider.require_parameters: true` wherever you send tools or a schema. Otherwise OpenRouter may route to a provider that ignores them.
- A `models: [...]` list gives automatic fallback, and every response reports `usage.cost`.
- Claude Opus 5.5 and Sonnet 5.5 reject a forced `tool_choice`, so code runs the first search itself and the model only decides on follow-ups.
- Haiku 5.5 and DeepSeek V4 think by default. The guard turns reasoning off, or the thinking spends its output cap and cuts the JSON short. So the guard needs a model whose providers take a strict JSON schema and let reasoning be turned off. Of the cheapest models, gpt-oss-20b refuses ("Reasoning is mandatory"), and OpenRouter finds no endpoint for Ling 3.0 Flash, Qwen 3.7 Flash or Mistral Nemo.

## 8. Data and RAG

### 8.1 Sources

| Language | Source | Licence | Format | Role |
|---|---|---|---|---|
| Pali | VRI's Chaṭṭha Saṅgāyana edition, `tipitaka-xml` on GitHub (the same text as tipitaka.org's PDFs) | Free for non-commercial use, with credit | XML, Roman and Thai script | All Pali |
| Thai | Royal translation (ฉบับหลวง), 45 volumes, from thepathofpurity.com | No rights statement ⚠. First printed in 1957; this set is the Department of Religious Affairs' 1971 printing | Text PDFs, one per volume | All Thai |
| English | Ṭhānissaro Bhikkhu, dhammatalks.org | CC BY-NC 4.0: free for non-commercial use, with credit. His site counts any sale as commercial | One page per sutta (about 1,100), downloaded 4 at a time; robots.txt allows `/suttas/` | English wherever he translated the sutta |
| English | Public-domain translations, original printings: Rhys Davids, *Dialogues of the Buddha* (DN, 1899–1921); Chalmers, *Further Dialogues of the Buddha* (MN, 1926–27); *The Book of the Kindred Sayings* (SN, 1917–30) | Public domain: published in 1930 or earlier | archive.org scans with OCR text | English for the suttas Ṭhānissaro skipped |
| — | `sc-data`, SuttaCentral's copy of the Thai, keyed by sutta ID | No licence ⚠ | A shallow, sparse git checkout of its Thai sutta folders at a pinned commit | Crosswalk only (§8.3): its opening words find where each sutta starts; never indexed or shown |
| — | SuttaCentral, 84000.org | — | Links | "Read the whole sutta" links; no text is fetched |

- **One English per sutta:** Ṭhānissaro if he translated it, otherwise the public-domain translation, otherwise a SuttaCentral link. The old Aṅguttara translation (1932–36) isn't public domain in the US until 2028–32, so Aṅguttara gaps use links.
- The old translations read old-fashioned ("brethren", "Ill" for *dukkha*), so their cards show the year. Use the original printings, not later revised reprints.
- **Not used:** the archive.org "Tripitaka - English" uploads, because Bodhi, Walshe and the other modern translations there are in copyright; and SuttaCentral's own translations, because their translator asked AI chatbots not to use them.
- Every text is free only for non-commercial use, so the app stays free: no paid tier, no ads.

### 8.2 Cleaning the inputs

- **Thai PDFs** (checked across all volumes on 2026-10-22). They are real text, not scans, but:
  1. Some vowels and tone marks are stored as private-use glyphs (U+F700–U+F71A), and sara am (ำ) can come out split. Map them back to standard Thai.
  2. Drop the header on every page ("… เล่ม N … - หน้าที่ P"), then split at the ข้อ markers ("[๑๑]").
  3. Validate: ข้อ in order (volumes 33, 36, 44 and 45 restart numbering per book), and no private-use characters left.
  4. Line breaks lose their spaces, so the search index ignores spaces inside Thai.

  The archive.org copy's volume 1 is a duplicate of volume 2. thepathofpurity's volume 1 is a different file (3.1 MB against 2.5 MB), so it probably fixes that ⚠. Volume 1 is Vinaya, outside the MVP either way.
- **Old scanned translations.** Strip running heads, page numbers and footnotes from the OCR text, rejoin hyphenated words, repair Pali diacritics, then split at sutta headings. Passages the old editions abridged ("…") stay as printed.
- **Ṭhānissaro's pages.** Each page is one sutta and its file name gives the ID (`SN56_11.html` → `sn56.11`). His introduction above the first "* * *", his footnote markers and his notes aren't his translation of the text, so they're dropped.
- **Summary verses.** VRI ends many vaggas with an *uddāna*, a verse listing the sutta names ("Tassuddānaṃ –"). It's an editor's aid, not text, so it's dropped.

### 8.3 IDs and alignment

- Everything joins on SuttaCentral-style sutta IDs (`mn10`). They are standard references, not text.
- **The crosswalk.** VRI and SuttaCentral group the repetitive (peyyāla) suttas differently in a few saṃyuttas and nipātas, and AN 1–2 number their suttas as paragraphs. A vendored list of SuttaCentral's sutta IDs (the file names in `bilara-data`, no text) maps each paragraph to the SuttaCentral sutta whose range holds its number, so every ID links to a real page. On the Pali side 3,398 of 3,399 IDs match; the one left over (`sn45.181`) is reported by `buddha sync`.
- Pali and English join by sutta heading. The Thai is organised by volume and ข้อ, so `buddha sync` builds a crosswalk into `suttas`:
  - DN, MN, SN and AN: each sutta starts where its opening words, from sc-data's ID-keyed copy of the same translation, are found in the volume. Openings found exactly once are anchors (the longest run in order is kept); the rest are searched for between them, and a short or repeated opening must be the only match. A sutta whose opening isn't found is left out with the one before it, whose end is then unknown: better no Thai than Thai under the wrong sutta. This places 3,157 of 3,233 suttas;
  - the Dhammapada and Sutta Nipāta aren't in sc-data's Thai, so they need their own crosswalk (verse numbers, sutta headings) later.
- **Paragraphs:** when a sutta has the same number of paragraphs in two languages, and each paragraph's share of the sutta's length agrees within a factor of two, they align in order. A count can match by chance: MN 10 has 94 paragraphs in Pali and in English, which drift apart midway. Otherwise the card shows the cited paragraph, the other languages whole when the sutta is short, and a link to the whole sutta.
- **Spike for later:** thepathofpurity also hosts the Siam Rath Pali that the Thai was translated from, in the same 45 volumes. If its ข้อ numbers match the Thai, Thai↔Pali paragraph alignment becomes a database join.

### 8.4 Chunks and embeddings

- A chunk is one paragraph (one ข้อ in the Thai). Paragraphs over about 1,500 characters are split at sentence ends into parts (`mn10#th7-2`).
- English and Thai share one multilingual vector space (`baai/bge-m3`, 1,024 dimensions), so a Thai question also finds English passages.
- Pali isn't embedded, because embedding models handle it poorly. It's searched lexically with diacritics folded (ā→a, ṃ→m), which is also how Pali mode finds its passages.
- Vectors are keyed by `(para_id, model)`. Switching models means re-embedding beside the old vectors, then dropping them.

### 8.5 Retrieval

- **Hybrid search:** pgvector HNSW (cosine) plus `pg_trgm` trigram matching on a normalized copy of each paragraph, fused with Reciprocal Rank Fusion. The top 8 go to the model.
- **Thai:** Postgres full-text search can't split Thai, which has no spaces between words. So the lexical side uses trigrams on text with Thai tone marks and spaces removed. If Thai recall falls short, try `pg_bigm`.
- Below a per-language similarity threshold, the turn becomes don't know.

### 8.6 Schema

```sql
create extension vector; create extension pg_trgm;
create table suttas    (id text primary key, collection text not null,      -- 'mn10', 'MN'
                        title_pi text, title_en text, title_th text,
                        th_vol smallint, th_from int, th_to int);            -- crosswalk to the Thai volumes
create table paras     (id text primary key,                                -- 'mn10#pi12', 'mn10#en7', 'mn10#th7-2'
                        sutta_id text not null references suttas,
                        lang text not null,                                  -- 'pi' | 'th' | 'en'
                        ord int not null, part smallint not null default 1,
                        vol smallint, item int,                              -- Thai only: volume and ข้อ
                        source text not null,                                -- 'vri' | 'royal' | 'thanissaro' | 'chalmers-1926' …
                        text text not null, thai_script text,                -- Pali only: the Thai-script copy
                        lex text not null,                                   -- normalized copy for trigram search
                        hash text not null);                                 -- re-embed only when this changes
create index on paras using gin (lex gin_trgm_ops);
create table para_vecs (para_id text references paras on delete cascade, model text, v vector not null,
                        primary key (para_id, model));                      -- English and Thai only
create index on para_vecs using hnsw ((v::vector(1024)) vector_cosine_ops) where model = 'baai/bge-m3';
```

There are no chat tables: history stays in the browser.

## 9. One chat turn

![One chat turn, step by step: retrieval, generation, then checks and cards](chat-turn.svg)

1. **Guard, then the first search.** Code checks crisis keywords and length. The guard reads the recent turns and returns the route, the decline topic, any words the user attributes to the Buddha, and `search_query`: the latest message rewritten to stand on its own. So "and the second one?" after the four noble truths becomes "the second noble truth, the origin of suffering". Code then calls `POST /v1/search` with it for the top 8, leaving out the risk suttas once the conversation shows risk. The guard also reports a reply language the person asked for, if any; otherwise code picks it (§5.1). Streaming the guard so search starts as soon as `search_query` arrives is a later latency win.
2. **Reply.** `streamText` with `search_canon` and `get_passage`, at most 4 steps, the last one without tools. The model cites by ID (`[[cite:mn10#en12]]`), or in Pali mode quotes by ID (`[[quote:…]]`).
3. **Checks, one sentence at a time.** Nothing reaches the browser until it passes:
   - citations must be IDs retrieved in this turn; any others are stripped;
   - quoted spans, reported speech and Pali runs must match retrieved text, or the sentence is dropped;
   - an answer is held until its first valid citation. With none by about 60 words, it gets one redraft, then the don't-know reply;
   - the first sentence must be in the reply language.
4. **Cards.** The last stream event carries the cards, filled from the database by ID.

- **Multi-turn.** The browser sends the conversation with every turn, and the reply call sees the last 10 turns, dropping the oldest first. Passages are searched fresh each turn. A passage from an earlier card can be cited again once `get_passage` fetches it in this turn.
- **Risk stays on.** The last stream event returns a `risk` flag, and the browser sends it back with every later turn, so the Vakkali filter (§6) stays on for the rest of the conversation.
- **History comes from the browser, so it's untrusted.** User text is escaped (`[[`, `]]`, `<`, `>`), and only IDs retrieved in this turn can become cards.
- **Failures are honest.** If retrieval is down, he says he can't recall the exact words right now, never that the texts are silent. If a model provider fails, OpenRouter's fallback list takes over, then an honest error. On a crisis turn, every failure ends in a fixed template with the hotline numbers.

## 10. Evals

- About 40 cases in `evals/cases/*.jsonl`, half in Thai: doctrine (with an expected sutta), life situations, multi-turn follow-ups ("…and the second one?" after the four noble truths must search the second truth and cite sn56.11), Pali mode, fake quotes, declines, crisis, don't-know, and adversarial cases (prompt injection, role-play, forged tags).
- `buddha eval` posts each case to the agent in eval mode and gets back the reply, the cards and a debug block: retrieved IDs, cited IDs, the route, dropped spans and the cost.

| Metric | Gate |
|---|---|
| Retrieval Recall@8: the expected sutta is in the top 8 | ≥ 0.85 |
| Citation validity: cited IDs ⊆ retrieved IDs | ≥ 0.98 |
| Fabricated quotes or Pali in the final reply | 0 |
| Crisis protocol: right route, right numbers, right language | 100% |
| Reply language | 100% |
| Missed declines / needless refusals | ≤ 1 / ≤ 2 |
| Faithfulness, judged 1–5 | ≥ 4.0 |

- The judge is a different model family from the agent (`JUDGE_MODEL`, `openai/gpt-5-mini` by default) and scores each answer's faithfulness to its cards. Calibrate it against 20 replies you've labelled yourself before trusting it.
- Each case says what it expects: the route, the sutta for Recall@8, the reply language, a don't-know reply, the verdict on a quote, or words that mustn't appear. `buddha eval` checks the hotline numbers on its own, not from `policy.yaml`, so a policy edit that drops one fails the gate.
- Without a key the agent's mock answers, and the report says so: it checks the harness and the code paths. Citation validity and fabrication pass even then, because code enforces them; recall, routes and declines need the real guard and embeddings.
- **CI:** GitHub Actions runs the suite on PRs that touch `prompts/`, `policy.yaml`, the agent or retrieval, and comments the summary on the PR. The built database snapshot lives in private storage fetched with a secret, never as a public file. Forks don't get the secret, so the gate runs on your own branches. One run costs about 5 cents with DeepSeek V4 Flash and the default judge.

## 11. Open source and privacy

- The code is MIT. The texts are never committed: `buddha sync` downloads them into `data/` (git-ignored), the README lists every source with its licence, and every card credits its texts.
- `prompts/` and `policy.yaml` are public, and that's fine. The safety lives in code (crisis checks, citation checks, risk filters), so it holds even when an attacker has read the prompt. "Show me your prompt" gets a link to the repo.
- Chats aren't stored on the server, and no message text goes into logs. A hosted demo that started storing chats would need consent under Thailand's PDPA, which treats religious beliefs and health as sensitive data.

## 12. Plan

Estimates assume about 4 focused hours a day.

| # | Phase | Demo at the end | Estimate |
|---|---|---|---|
| 0 | **Skeleton:** the monorepo (§7.2): the pnpm workspace with web, agent and shared; the Go module; root scripts; `AGENTS.md`; Compose with pgvector; `/healthz` everywhere; CI lint and tests | `pnpm dev` boots the web app, the agent and Go together | ½ day |
| 1 | **English RAG:** VRI Pali and Ṭhānissaro for DN, MN, SN, AN, Dhammapada and Sutta Nipāta → paragraphs → embeddings → hybrid search | `buddha search "four noble truths"` puts sn56.11 in the top 3 | 2 days |
| 1b | **Public-domain English:** OCR cleanup of *Dialogues*, *Further Dialogues* and *Kindred Sayings* for the suttas Ṭhānissaro skipped | A Saṃyutta sutta he skipped shows 1920s English on its card | 1–2 days |
| 2 | **Agent and cards:** Express + AI SDK tool loop, first search in code, citations, sentence checks, cards, chat UI | An English chat with verified cards | 2–3 days |
| 3 | **Guardrails:** guard and routes, crisis path, declines, don't-know, risk filters, fake-quote check | A lottery request gets a kind no; a crisis message gets the right numbers | 1–2 days |
| 4 | **Thai and Pali:** Thai ingest (glyph fix, ข้อ split, crosswalk), trigram search, Thai replies, Pali mode, Thai-script toggle | A Thai conversation; a Pali-mode answer from the canon | 3 days |
| 5 | **Evals and write-up:** 40 cases, judge, CI gate; a README with the demo GIF; a blog post on the design (§14) | A PR that weakens the prompt turns red | 2 days |

The phases add up to about 12–15 working days, or 3 weeks part-time.

**Stretch, from v0.1:** a hosted demo (rate limits, a spend cap, a review of the persona); queues with dead-letter handling for ingest; Datadog LLM Observability; feature flags and shadow replay; an LLM alignment agent with a review queue; gRPC through Connect; the Digital Pali Dictionary tool.

## 13. Risks

| Risk | Mitigation |
|---|---|
| A first-person Buddha can offend in Thailand, where Penal Code §206 covers insulting a religion | AI disclosure, no imagery, only the cards carry his words, free and non-commercial. Review the framing before any public demo. |
| The Thai text's rights are unclear | Fine for an open-source codebase that never ships the text. Check before hosting a public demo. |
| Users in crisis | Two detectors, hotline numbers owned by code, a 100% eval gate |
| The model writes fake Pali or fake quotes | Pali mode inserts the canon by ID, and every quoted or Pali span is checked |
| OCR noise in the old translations | Per-sutta checks (heading found, no page furniture left); Ṭhānissaro wins wherever both exist |
| Thai search is weak | Measure Thai Recall@8; fall back to `pg_bigm` |
| Costs | A credit limit on the OpenRouter key; `usage.cost` on every call |

## 14. The write-up

Each of these is a real problem the build solves, and together they make the blog post:

1. **The Vakkali problem.** Naive RAG would show a user in crisis the suttas about monks who ended their lives.
2. **The model may not write Pali,** so Pali mode quotes the canon by ID.
3. **The canon sets the guardrail.** AN 2.23 is why only the cards carry his words.
4. **Thai has no spaces,** so Postgres full-text search fails and trigrams take over.
5. **Messy documents:** private-use glyphs in the Thai PDFs, a duplicated volume, 100-year-old OCR.
6. **Respecting a source's wishes.** SuttaCentral's translations were the easiest to use, and their translator asked chatbots not to.
7. **The model chooses, code quotes.** Every card is filled from the database, never generated.

## 15. Open questions

1. A hosted demo, or local only with a GIF in the README? Default: local with a GIF.
2. MIT or Apache-2.0 for the code? Default: MIT.
