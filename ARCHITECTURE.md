# Architecture

```
        ┌──────────────────────────────┐
        │         Browser (EJS+Tailwind) │
        └──────────────┬───────────────┘
                       │ HTTPS
        ┌──────────────▼───────────────┐
        │ Express app (src/app.js)     │
        │  helmet · session · CSP      │
        └──┬─────────┬─────────┬───────┘
           │         │         │
     auth │   author│ reviewer│ admin   /api/ai
       routes     routes     routes      routes
           │         │         │
           ▼         ▼         ▼
    ┌──────────────────────────────────┐
    │  Controllers (thin, async/await) │
    └──────────────────────────────────┘
           │
           ▼
    ┌──────────────────────────────────┐
    │  Services                        │
    │   ├── reviewerMatcher (TF-IDF)   │
    │   ├── plagiarismDetector         │
    │   ├── aiReviewer                 │
    │   ├── writingAssistant           │
    │   └── llm/                       │
    │        ├── index.js (switch)     │
    │        ├── groq.js (default)     │
    │        ├── openrouter.js         │
    │        └── heuristic.js (offline)│
    └──────────────────────────────────┘
           │
           ▼
    ┌──────────────────────────────────┐
    │  Models (promise-wrapped sqlite) │
    │   User · Paper · Review          │
    └──────────────────────────────────┘
           │
           ▼
    ┌──────────────────────────────────┐
    │  SQLite (WAL, FK on)             │
    │   users · papers · reviews       │
    │   embeddings · ai_audit          │
    └──────────────────────────────────┘
```

## Why these choices

* **Provider switch over hard-coded SDK.** Lets the app run cost-free in demo / CI yet upgrade to a hosted LLM (Groq or OpenRouter) with one env var. The heuristic backend ships *the same return shape* as the LLM one, so controllers and views never branch on provider.
* **TF-IDF over neural embeddings.** Hundreds of papers is the realistic scale of a workshop-level system. Pure-JS TF-IDF is good enough, has zero install footprint, and explains itself to an examiner. The `embeddings` module already mirrors a `model.embed(text)` interface so swapping in a transformer is a one-file change.
* **Audit log on every AI call.** Prepares the system for a real-world deployment where authors and reviewers must be told (and can audit) when AI assisted a decision.
* **Separation of "draft" and "submit".** The AI never decides — it only proposes. `ai_assisted` is recorded on each review for transparency.

## Data model highlights

* `papers.similarity_score`, `papers.ai_text_likelihood` cached at submission time so the admin/author dashboards don't recompute on every render.
* `embeddings` table is reserved for a future migration to persistent vectors when the corpus outgrows on-the-fly TF-IDF.
* `reviews` is fully structured (summary / strengths / weaknesses / three 1-5 scores / recommendation), which makes both human reviews and AI drafts comparable in the same UI.
