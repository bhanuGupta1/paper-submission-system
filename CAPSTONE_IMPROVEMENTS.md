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
