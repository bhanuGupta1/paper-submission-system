# Paper Submission System (AI-augmented) · v3.0

A production-shaped, AI-augmented academic paper submission and peer-review platform.

> v1 was a single-file course project. v2 turned it into a clean MVC app with four
> GenAI features wrapped in a provider-agnostic LLM abstraction. **v3** adds the
> advanced layer: conflict-of-interest detection, in-app notifications, an audit
> trail per paper, author profile stats, pagination + filtering on every list,
> a tagging system, and a sentence-transformer embeddings option — all on top of
> the same offline-by-default architecture so the app still costs nothing to run.

---

## ✨ What's new in v3

| Layer | Capability |
|---|---|
| **Conflict-of-interest detection** | Author/reviewer matching now filters out self-assignment, shared-affiliation, name-token, and recorded co-authorship signals. COI badges shown to the editor. |
| **In-app notifications** | Inbox in the nav bar with unread badge. Reviewer assignments, status changes, and editor decisions all push to the recipient's inbox. |
| **Audit trail per paper** | `/editor/papers/:id/audit` shows the full lifecycle: every reviewer assignment, every editor decision, every AI call with input/output token counts. |
| **Author profile + stats** | `/author/profile` with editable affiliation/expertise, plus accepted/rejected/in-review counts and AI-usage breakdown. |
| **Pagination + filter** | Editor dashboard supports status filter, full-text search, and paged results (20 per page). |
| **Tagging system** | Editors can tag papers; tags appear on the dashboard, in the reader feed, and are searchable. |
| **Sentence-transformer adapter** | `services/embeddings-st.js` provides a drop-in upgrade from TF-IDF using @xenova/transformers (runs locally — still no API cost). |
| **Decision history** | Every accept / reject / revisions decision is recorded with timestamp, editor, and optional note. |
| **Co-authorship table** | Recorded co-authorship history feeds the COI detector. |
| **Polished design system** | Inter + Fraunces typography, glass cards, status pills, hero gradients, refined empty states. |

---

## 👥 Roles

| Role | What they do | Login required |
|---|---|---|
| **Author** | Submit manuscripts, see review status, use AI writing assistant, edit profile + affiliation | Yes |
| **Reviewer** | Review assigned papers, generate an AI draft as a starting point | Yes |
| **Editor** | Oversee submissions, see AI-ranked reviewer suggestions with COI badges, manually override, make final accept/reject/revisions decisions, tag papers, inspect audit trail | Yes |
| **Admin** | Read-only audit dashboard, AI-usage stats, Excel export | Yes |
| **Reader** | Browse and search the public feed of accepted articles | **No** |

---

## 🧠 The four GenAI features

All four go through a single provider switch (`src/services/llm/index.js`):

- **`heuristic`** (default) — pure JS, fully offline, zero-cost.
- **`claude`** — Anthropic Claude via `@anthropic-ai/sdk`. Activates only when `LLM_PROVIDER=claude` and `ANTHROPIC_API_KEY` is set.

| Feature | Where | What it does | Provider |
|---|---|---|---|
| AI reviewer assistant | `services/aiReviewer.js` | Drafts structured first-pass review (summary / strengths / weaknesses / 1-5 scores / recommendation). `ai_assisted` flag recorded. | LLM |
| Smart reviewer matching | `services/reviewerMatcher.js` | TF-IDF cosine similarity over reviewer expertise tags **+ COI filter**. Top-3 surfaced in the editor dashboard. | local TF-IDF |
| Plagiarism + AI-text flag | `services/plagiarismDetector.js` | Max similarity to corpus + transparent stylometric AI-text score. Flag, never verdict. | local TF-IDF |
| Author writing assistant | `services/writingAssistant.js` | Polish abstract, suggest titles, extract keywords. | LLM |
| Conflict-of-interest detector | `services/conflictOfInterest.js` | Self-assignment / shared affiliation / name overlap / recorded co-authorship signals. | rule-based |

Every AI call is logged in `ai_audit` with paper_id, user_id, action, provider, and token counts.

---

## 🚀 Quick start (local, zero-cost)

```bash
git clone <repo>
cd paper-submission-system-v2
copy .env.example .env             # cmd.exe on Windows; use cp on macOS/Linux
npm install
npm run setup                      # migrate + seed demo users/papers
npm start                          # http://localhost:3000
```

Demo accounts (password `Password123!`):

| user | role | first page | affiliation |
|---|---|---|---|
| admin | admin | /admin | Platform Operator |
| editor | editor | /editor | Editorial Board |
| alice | author | /author | University of Auckland |
| bob | author | /author | University of Otago |
| reviewer_ml | reviewer | /reviewer | Victoria University of Wellington |
| reviewer_db | reviewer | /reviewer | University of Canterbury |
| reviewer_se | reviewer | /reviewer | University of Auckland |
| reader | reader | /reader | — |

The reader feed at `/reader` is accessible to anyone — no account needed.

> Note: alice + reviewer_se are seeded with a co-authorship + shared affiliation
> so the COI detector lights up when the editor tries to assign reviewer_se to one of alice's papers — useful for demoing the feature.

---

## 🐳 Docker

```bash
docker compose up --build
```

---

## 🔑 Switching to Claude

```bash
echo 'LLM_PROVIDER=claude'              >> .env
echo 'ANTHROPIC_API_KEY=sk-ant-...'      >> .env
echo 'ANTHROPIC_MODEL=claude-sonnet-4-6' >> .env
npm install @anthropic-ai/sdk
npm start
```

The heuristic backend remains the fallback if a Claude call fails.

---

## 🔬 Sentence-transformer upgrade (optional)

```bash
npm install @xenova/transformers
echo 'EMBEDDINGS_PROVIDER=st' >> .env
npm start
```

`services/embeddings-st.js` lazy-loads `Xenova/all-MiniLM-L6-v2` and exposes the same interface as the TF-IDF backend. Falls back to TF-IDF if the dependency is missing.

---

## 🧪 Tests

```bash
npm test
```

Unit tests cover: embeddings (TF-IDF cosine), the heuristic LLM backend, the plagiarism / AI-text scorer, the conflict-of-interest detector, and the notifications service. Integration tests boot the app against a throwaway SQLite file and exercise register / login / dashboard.

---

## 📁 Layout

```
src/
  app.js                    Express app factory (helmet, CSP, sessions, routes)
  server.js                 entrypoint + graceful shutdown
  config/                   env-driven config
  db/                       connection, migration (10 tables), seed
  middleware/               auth, errorHandler
  models/                   User, Paper, Review (promise-wrapped sqlite)
  controllers/              auth · author · reviewer · editor · admin · reader
                            · ai · notifications
  routes/                   one per controller (9 files)
  services/
    llm/                    provider switch (heuristic | claude)
    embeddings.js           pure-JS TF-IDF
    embeddings-st.js        sentence-transformer adapter (lazy load)
    reviewerMatcher.js      TF-IDF + COI filter
    plagiarismDetector.js
    aiReviewer.js
    writingAssistant.js
    conflictOfInterest.js   self / affiliation / name / co-authorship signals
    notifications.js        in-app inbox writes + reads
  utils/                    logger (pino), textExtract (docx/pdf/txt)
  views/                    EJS templates with Tailwind + Inter/Fraunces
public/                     static assets, design system in styles.css
tests/
  unit/                     embeddings · heuristic · plagiarism · coi · notifications
  integration/              smoke tests via supertest
Dockerfile  docker-compose.yml  jest.config.js  .env.example
```

Database tables: `users · papers · reviews · embeddings · ai_audit · notifications · coauthorships · decisions`.

---

## 🛡️ Ethics & limitations

The AI features are designed as **decision-support**, not decision-making:

- **Plagiarism similarity** is TF-IDF, not paraphrase-aware. High scores warrant a human check; low scores are not a clearance.
- **AI-text likelihood** is a stylometric *flag*, not a verdict. Real AI-text detectors are not reliable, especially against non-native English writers (Liang et al., 2023). We say so in the UI.
- **Reviewer matching** uses author-supplied expertise tags. Bias in tag choice or coverage can propagate; editors can override.
- **Conflict-of-interest detection** uses declared affiliation + recorded co-authorship. Missing or wrong affiliation data means COI may not fire — editors still need to know their reviewers.
- **AI reviewer drafts** never auto-submit. The reviewer must read, edit, and accept; whether AI was used is recorded on the review.

---

## 📜 License

MIT
