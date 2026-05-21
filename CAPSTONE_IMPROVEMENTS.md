# Capstone Improvements Completed

- Added a production-ready `/health` endpoint for Render-style uptime checks, including service version, environment, database readiness, response time, uptime, and timestamp.
- Wired the health route into the main Express router and covered it with an integration test.
- Improved the Dockerfile for Render deployment with a multi-stage build, native dependency support, production port defaults, migrations, and seed execution on startup.
- Added operational analytics for the admin/editor experience:
  - submission status breakdown
  - review completion rate
  - pending review count
  - average review scores
  - integrity flag summary
  - at-risk manuscript queue
- Redesigned the admin dashboard into a platform command center with workflow metrics, pipeline bars, integrity snapshot cards, at-risk queue, submission inventory, and AI usage transparency.
- Upgraded the editor dashboard with an editorial hero panel and workflow metric cards.
- Refreshed the landing page with a stronger editorial visual treatment, clearer calls to action, and cleaner ASCII-safe text.
- Added shared visual polish in `public/styles.css`, including metric cards, dashboard hero styling, improved cards, responsive behavior, and a photographic hero background.
- Updated the content security policy to allow the landing-page hero image.
- Hardened reviewer assignments against duplicate assignment rows with `INSERT OR IGNORE` and a unique assignment index.
- Added unit tests for the new analytics service.
- Verified the full Jest suite passes: 7 suites, 23 tests.
- Verified local HTTP responses for `/` and `/health`.

Local commit created:

```text
34adfbb Elevate capstone platform experience
```

Second upgrade pass completed:

- Reworked the whole visual system with a more premium product feel:
  - polished sticky navigation
  - stronger global background treatment
  - metric cards
  - publication cards
  - submission rows
  - process timeline styling
  - improved form focus states
- Rebuilt the landing page around a stronger PaperSub.AI brand impression and end-to-end editorial workflow story.
- Redesigned the author dashboard into a manuscript workspace with high-signal submission cards and next-action guidance.
- Redesigned the author paper detail page with a hero record, integrity metrics, status timeline, decision history, and review cards.
- Redesigned the submission page with a professional two-column workflow, clearer AI assist controls, safer HTML escaping in AI suggestions, and a submission pipeline sidebar.
- Redesigned the reviewer dashboard into a reviewer cockpit with assignment cards and completion metrics.
- Redesigned the reviewer review form into a structured assessment workspace with manuscript context, guardrails, scoring, recommendation, and AI draft insertion.
- Redesigned the public reader feed as a research library with a stronger search hero and publication cards.
- Redesigned login and registration into premium onboarding screens.
- Redesigned the editor audit trail into a real transparency view with decision, review, and AI-call sections.
- Fixed affiliation metadata not being saved during registration, which improves conflict-of-interest detection.
- Added reviewer dashboard stats and included AI-assisted review data in reviewer assignment queries.
- Removed visible encoding artifacts from `src` and `public`.
- Added integration tests for registration metadata and reviewer/editor dashboard rendering.
- Verified the full Jest suite passes: 7 suites, 25 tests.
- Verified local HTTP responses for `/`, `/reader`, `/login`, and `/register`.

Auth and hosted deployment hardening completed:

- Added a confirm password field to registration.
- Added server-side password confirmation validation.
- Trimmed and validated usernames before registration/login.
- Prevented public self-registration of privileged editor/admin accounts.
- Fixed registration so affiliation metadata continues feeding COI checks.
- Regenerated the session on login to reduce session fixation risk.
- Gave the app a named session cookie and clears it on logout.
- Added Render/reverse-proxy session support with production `TRUST_PROXY=1` behavior.
- Added `.env.example` and README guidance for Render secure cookies and persistent SQLite storage.
- Added regression tests for password confirmation, privileged-role registration blocking, and production proxy cookie config.
- Verified the full Jest suite passes: 8 suites, 29 tests.

Not pushed to GitHub.

---

## Phase 2–7 Upgrades: Enterprise-Grade Academic Platform

All features below are committed and pushed to GitHub; Render auto-deploys from main.

### Phase 1 — Integrations & GDPR
- **Microsoft Teams webhooks**: `POST /api/teams/...` with AdaptiveCard notifications on submission, review assignment, and editorial decisions
- **Notification preferences UI**: per-user Slack/Teams webhook URLs, email toggles, digest frequency in author profile
- **ORCID identity**: OAuth2 link to researcher ORCID iD stored on user record
- **GDPR compliance**: data export (JSON download of user record + submissions), account deletion request workflow, `account_deletion_requested_at` tracking
- **Audit log**: paginated view at `/admin/audit-log` with CSV export; every editorial action logged with user, action, resource, and IP

### Phase 2 — Reviewer Invitations, FTS5, Calendar, LMS
- **Reviewer invitation system**: editor sends tokenised invitation email; reviewer creates account, gets auto-assigned to paper; invitation tokens expire in 7 days
- **Email notifications wired to preferences**: assignment/decision emails check `notification_prefs` before sending
- **FTS5 full-text search**: `papers_fts` virtual table with porter tokeniser + 3 sync triggers; graceful LIKE fallback on first boot
- **Calendar export (.ics)**: reviewer dashboard exports pending deadlines as RFC 5545 VCALENDAR at `/reviewer/calendar.ics`
- **LMS webhooks**: Canvas (HMAC-SHA256) and Moodle (bearer token) event receivers at `/api/lms/:provider/webhook`; event normalisation and audit logging
- **DB migration v7**: `reviewer_invitations`, `papers_fts`, `lms_integrations` tables

### Phase 3 — LMS Admin UI & Editorial Analytics
- **LMS integration manager** at `/admin/lms`: create/toggle/delete Canvas, Moodle, generic integrations; webhook endpoint reference panel
- **Editorial analytics** at `/editor/analytics`: Chart.js bar charts (submission trend, accepted vs rejected per month), status donut chart, reviewer performance table, KPI strip (total submissions, acceptance rate, avg turnaround days)
- **operationsAnalytics**: `getSubmissionTrends`, `getDecisionTrends`, `getReviewerPerformance`, `getTurnaroundStats`, `getEditorAnalytics` added

### Phase 4 — Email Attachments, Reader, Citations, Weekly Digest
- **Calendar (.ics) email attachments**: review assignment emails now include a `.ics` attachment for Outlook/Google Calendar direct import
- **Reader paper detail page** at `/reader/papers/:id`: abstract, AI summary, keyword cloud, download + citation buttons
- **FTS5-powered reader search** with pagination (18/page)
- **Citation export**: BibTeX download at `?format=bibtex`, APA copy button with clipboard API
- **Weekly editorial digest**: Monday 08:00 cron sends editors an HTML email with pending papers, overdue reviews, papers ready for decision, and submission count

### Phase 5 — API Keys & REST API v1
- **API key management**: generate/revoke/delete at `/author/api-keys`; SHA-256 hashed storage, prefix display, scope selection, optional expiry; displayed in profile
- **REST API v1** at `/api/v1/`: `GET /papers` (FTS5 search, pagination), `GET /papers/:id`, `GET /papers/:id/cite`, `GET /status` — all authenticated with Bearer token
- **Rate limiting**: 100 req/15 min per API key; `X-RateLimit-*` headers on all responses
- **DB migration v8**: `api_keys` table

### Phase 6 — API Docs & OpenRouter AI
- **Swagger/OpenAPI docs** at `/api/docs`: interactive Swagger UI with full OpenAPI 3.0.3 spec; raw JSON at `/api/docs/openapi.json`
- **OpenRouter LLM backend**: `LLM_PROVIDER=openrouter` uses OpenRouter's free-tier models (llama-3.3-70b, gemma-4-31b, hermes-3-llama-405b) with automatic fallback chain on 429/404; heuristic fallback if all fail
- **Manuscript version diff** at `/editor/papers/:id/versions`: side-by-side field comparison with word-level LCS diff (insertions highlighted green, deletions red), version selector, revision timeline

### Phase 7 — Leaderboard & Guidelines
- **Reviewer leaderboard** on review-progress page: ranked table with completion rate, avg turnaround, avg quality score per reviewer; gold/silver/bronze rank highlights
- **Submission guidelines** at `/guidelines`: required fields table, review process timeline (6 steps), AI tools disclosure, track-specific sidebar, quick-links
- **Guidelines in nav**: globally accessible including for unauthenticated users

### Summary statistics
| Metric | Value |
|---|---|
| New routes added | 30+ |
| New DB tables | 4 (`reviewer_invitations`, `papers_fts`, `lms_integrations`, `api_keys`) |
| New services | `teams.js`, `invitation.js`, `lms.js`, `backup.js`, `digestEmail.js`, `apiKeys.js`, `llm/openrouter.js` |
| Git commits (Phase 1–7) | 13 commits on main |
| Live URL | https://paper-submission-system.onrender.com |

