#import "@preview/vibrant-color:0.2.1": *

#show: doc => vibrant-color(
  theme: "red-theme",
  title: "GenAI Paper Review System",
  authors: (
    "Bhanu Gupta",
  ),
  lang: "en",
  sub-authors: "IA730151 GenAI | Assessment 1",
  description: "AI-assisted academic paper submission and peer-review redesign",
  date: datetime(day: 13, month: 5, year: 2026),
  subject: "Generative AI Research Report",
  doc
)

// --------------------
// Global settings
// --------------------
#set text(size: 10.2pt, lang: "en", hyphenate: false)
#set par(justify: true, leading: 0.62em)
#set heading(numbering: none)

// --------------------
// Colours
// --------------------
#let accent = rgb(160, 40, 45)
#let deep = rgb(35, 45, 60)
#let muted = rgb(90, 95, 105)
#let soft = rgb(248, 250, 252)
#let border = rgb(215, 222, 230)
#let success = rgb(60, 130, 85)

// --------------------
// Heading styling
// --------------------
#show heading.where(level: 1): it => block(
  width: 100%,
  above: 16pt,
  below: 8pt,
  sticky: true,
  breakable: false,
)[
  #text(size: 17pt, weight: "bold", fill: accent)[#it.body]
  #v(3pt)
  #line(length: 100%, stroke: 0.8pt + accent.lighten(35%))
]

#show heading.where(level: 2): it => block(
  width: 100%,
  above: 10pt,
  below: 5pt,
  sticky: true,
  breakable: false,
)[
  #text(size: 13pt, weight: "bold", fill: deep)[#it.body]
]

// --------------------
// Reusable components
// --------------------
#let callout(title, body, icon: "•", fill: soft, stroke: border) = {
  box(
    width: 100%,
    fill: fill,
    stroke: 0.75pt + stroke,
    radius: 5pt,
    inset: 11pt
  )[
    #grid(
      columns: (auto, 1fr),
      gutter: 10pt,
      align: horizon,
      [#text(size: 14pt)[#icon]],
      [
        #text(weight: "bold", fill: deep)[#title]
        #v(3pt)
        #body
      ]
    )
  ]
  v(7pt)
}

#let compact-card(title, body, icon: "•") = {
  box(
    width: 100%,
    fill: white,
    stroke: 0.6pt + border,
    radius: 5pt,
    inset: 9pt
  )[
    #text(size: 10.5pt, weight: "bold", fill: accent)[#icon #h(4pt) #title]
    #v(3pt)
    #text(size: 9.1pt)[#body]
  ]
}

#let badge(label, color: accent) = {
  box(
    fill: color.lighten(84%),
    stroke: 0.65pt + color.lighten(25%),
    radius: 10pt,
    inset: (x: 8pt, y: 4pt)
  )[
    #text(size: 8.3pt, weight: "bold", fill: color.darken(15%))[#label]
  ]
}

#let code-box(body) = {
  box(
    width: 100%,
    fill: rgb(245, 247, 250),
    stroke: 0.6pt + border,
    radius: 5pt,
    inset: 9pt
  )[
    #raw(body, block: true, lang: "bash")
  ]
}

#let screenshot-figure(path, caption, purpose, height: 155pt) = {
  box(
    width: 100%,
    fill: rgb(252, 253, 255),
    stroke: 0.8pt + border,
    radius: 6pt,
    inset: 10pt
  )[
    #text(size: 9pt, weight: "bold", fill: muted)[#purpose]
    #v(8pt)
    #align(center)[
      #image(path, width: 100%)
    ]
  ]
  v(4pt)
  text(size: 8.8pt, style: "italic", fill: muted)[#caption]
  v(12pt)
}

// --------------------
// Report title inside body
// --------------------
#align(center)[
  #text(size: 18pt, weight: "bold", fill: deep)[
    Integrating Generative AI into an Academic Paper Submission System
  ]
  #v(4pt)
  #text(size: 12pt, weight: "bold", fill: accent)[
    Critical Analysis and Revised Project Scope
  ]
  #v(4pt)
  #text(size: 9.5pt, fill: muted)[
    Bhanu Gupta | Bachelor of Information Technology | Study Block 02, 2026
  ]
]

= 1. Original Project Presentation

== Context and Objectives

The project I am revising is the Paper Submission System I built in a prior web-development course. It is a Node.js application using Express, EJS, SQLite, bcrypt, express-session, multer, and ExcelJS. It supports five roles: author, reviewer, editor, administrator, and a public reader. It runs the full submission-to-publication lifecycle. Authors upload manuscripts, editors manually assign reviewers, reviewers leave feedback, and the public reader page lists accepted articles. The brief asked for role-based access, file uploads, a structured workflow, and an Excel export. I delivered a five-role site seeded with seven manuscripts and five reviews.

== Methodology, Results, Challenges, and Gaps

The methodology was iterative. Build a route, test it in the browser, commit, repeat. The result was functional but shallow.

#table(
  columns: (0.9fr, 1.7fr),
  inset: 7pt,
  stroke: 0.55pt + border,
  [*Identified gap*], [*Why it matters for the original system*],
  [Broken login wiring], [Sessions were misconfigured and the wrong field was used to look up the author. Some pages silently failed to load.],
  [Random reviewer assignment], [The system used `Math.random()`. Real conferences match reviewers by topical fit (Charlin & Zemel, 2013), not chance.],
  [No integrity checks], [No plagiarism scan, no duplicate-submission detection, no AI-text flag. Serious venues expect all three, though AI-text detectors are unreliable and must be used cautiously (Liang et al., 2023).],
  [Unstructured reviews], [Reviewers had one free-text textarea with no scoring fields. Editors could not aggregate or compare. Structured output is also more suitable for LLM drafting because models follow constrained formats (Brown et al., 2020).],
  [No author tooling], [Authors submitted without spelling help, title suggestions, or pre-submission feedback.],
  [No tests or containerisation], [Single file, hardcoded secrets, two leftover databases. The codebase would not survive a real code review.]
)

= 2. Revised Scope and Business Questions

The revised scope turns the system from a passive upload tracker into a decision-support platform. AI helps each role. Humans still decide. AI systems can introduce bias, privacy, reliability, and accountability risks if they are treated as automatic decision-makers (Bender et al., 2021; Mittelstadt, 2019), which is why human-in-the-loop is the design rule rather than an afterthought.

#grid(
  columns: (1fr, 1fr, 1fr),
  gutter: 7pt,
  badge("Author support", color: rgb(70, 130, 180)),
  badge("Reviewer matching", color: rgb(34, 139, 34)),
  badge("Integrity flags", color: rgb(230, 140, 20)),
  badge("Structured reviews", color: accent),
  badge("Human oversight", color: rgb(80, 90, 110)),
  badge("Low-cost upgrade path", color: rgb(90, 80, 160))
)
#v(6pt)

#callout("Refined business questions", [
  1. How can authors get useful feedback on their abstract before submitting, without paying a copy editor?

  2. How do I match each manuscript to the right reviewer instead of assigning at random?

  3. How do I screen submissions for near-duplicates and AI-generated text fairly?

  4. How do I make peer reviews structured so editors can aggregate and compare them?

  5. How do I keep cost at zero today and leave a clean upgrade path to a paid model tomorrow?
], icon: "❓")

Each question maps to one feature, and each feature uses the AI technique that fits its retrieval-versus-generation profile. Generation tasks suit LLMs (Vaswani et al., 2017; Brown et al., 2020). Similarity, ranking, and matching tasks suit retrieval or embedding methods (Salton & Buckley, 1988; Reimers & Gurevych, 2019; Lewis et al., 2020).

= 3. Generative AI Capabilities Relevant to the Project

Foundation models can support text generation, classification, summarisation, and decision-support workflows, but they must be aligned with specific tasks rather than treated as general-purpose magic (Bommasani et al., 2021; Bender et al., 2021). The revised system splits these capabilities into a generation lane (LLM-driven writing tasks) and a retrieval lane (embedding-driven matching and similarity tasks), then exposes each through one service interface so models can be swapped through configuration.

#table(
  columns: (0.8fr, 1.1fr, 1.6fr),
  inset: 7pt,
  stroke: 0.55pt + border,
  [*Capability*], [*What it does*], [*Where I use it in my system*],
  [Large language models], [Transformer-based models like Claude follow JSON-constrained prompts and produce structured prose (Vaswani et al., 2017; Brown et al., 2020).], [Review drafting, abstract polishing, title suggestions, and keyword extraction.],
  [Embeddings], [Project text into a vector space so semantic similarity becomes cosine distance (Reimers & Gurevych, 2019).], [Reviewer matching and near-duplicate screening.],
  [Retrieval-augmented generation], [Retrieve relevant context first, then generate, reducing hallucination on knowledge-intensive tasks (Lewis et al., 2020).], [Grounds the AI reviewer draft in the actual paper text rather than the model's priors.],
  [Stylometric checks], [Writing-style statistics flag possible AI text. Treated as a signal, never a verdict, because detectors misclassify non-native English writing (Liang et al., 2023).], [AI-text likelihood flag on every submission.],
  [Prompt engineering], [Structured, schema-constrained prompts make LLM output reliable and parseable (Brown et al., 2020).], [Every LLM call uses a JSON schema so output drops cleanly into a form.]
)

= 4. Tool Selection and Justification

I chose each tool to fit a specific phase of the project, not to chase model novelty. The first group are the industry tools I use during development. The second group are the AI components that live inside the running system. For each I explain my reasoning and the trade-off in my own words.

#table(
  columns: (0.9fr, 1.2fr, 1.7fr),
  inset: 7pt,
  stroke: 0.55pt + border,
  [*Tool*], [*Where I use it in my workflow*], [*Why I think it is the right pick for my project*],
  [Claude Sonnet 4.6 (chat interface)], [Development phase. Architecture decisions, generating most of the code, drafting all documentation, building this report.], [Best coding model available right now. Follows long instructions without losing context, which is essential for a multi-file rebuild. Runs on a Pro subscription rather than per-token, so cost is predictable. Trade-off: the chat session is a black box, so I review and verify every change before committing.],
  [Cursor], [Development phase. Inline AI completion while editing code by hand.], [Cursor reads the entire project context, so completions match my existing import paths and patterns. Saves me typing on the 80 percent of code that is mechanical so my attention goes to the 20 percent that actually needs design thought. Trade-off: it can suggest plausible but wrong code, so I always review before accepting.],
  [Whisper Flow], [Development phase. Dictating prompts to the AI instead of typing them.], [Typing slows thinking. Speaking at full speed lets me iterate on architecture in seconds rather than minutes. Over a multi-day build, the compounding gain is real. Trade-off: occasional misheard words, easy to fix.],
  [GitHub Copilot], [Development phase. Inline completion for repetitive code such as model methods, migrations, and tests.], [Useful when the next ten lines are predictable boilerplate. I never trust it on logic, only on shape. Trade-off: lower quality than Cursor on long-range context, but still saves keystrokes.],
  [ChatGPT], [Development phase. Second-opinion check when I want to sanity-test a design choice or compare against Claude's recommendation.], [Different model, different priors. When two strong models agree on a design call, I trust the decision more. Trade-off: occasionally less reliable on structured output than Claude.],
  [Claude API (claude-sonnet-4-6)], [Runtime phase. Drafts reviews, polishes abstracts, suggests titles, extracts keywords inside the running platform.], [Same writing quality I rely on in chat, now embedded in the product. Activated through one environment variable. Trade-off: per-call cost and external data transfer, which is why a local fallback runs by default and every call is logged.],
  [TF-IDF embeddings (pure JavaScript)], [Runtime phase. Reviewer matching and near-duplicate screening at submission time.], [Free, fast, deterministic, and explainable. At workshop scale I do not need a neural model. I can show the editor exactly which words triggered a match, which matters for defending an assignment decision. Trade-off: bag-of-words ignores word order and falls apart on paraphrasing.],
  [Sentence-Transformers (Xenova/all-MiniLM-L6-v2)], [Runtime phase, planned upgrade for retrieval once the corpus outgrows lexical matching.], [Captures meaning, not just word overlap. Runs locally in Node so the trust boundary stays intact and the cost stays at zero. Trade-off: 80 MB model download and slower per query than TF-IDF.]
)

= 5. Ethical Considerations

#table(
  columns: (0.9fr, 1.8fr),
  inset: 7pt,
  stroke: 0.55pt + border,
  [*Ethical issue*], [*Critical discussion and mitigation*],
  [Bias and fairness], [LLMs inherit biases from training data, which may affect review prose, keyword choices, and recommendations (Bender et al., 2021; Weidinger et al., 2022). Tag-based reviewer matching can also under-represent niche subfields. Mitigations: AI output is advisory, the editor can override every suggestion, match scores are visible, every AI call is logged, and a conflict-of-interest detector filters out self-assignment, shared affiliation, name overlap, and recorded co-authorship.],
  [Privacy and data minimisation], [Default mode runs on-device. No data leaves the trust boundary unless the operator explicitly enables Claude. Even then, only the title and abstract are transmitted, never the full manuscript or reviewer identities. Every external call lands in an audit table with token counts (Mittelstadt, 2019).],
  [Accountability and reliability], [AI drafts will be labelled and humans submit the final review. AI-text and plagiarism scores are framed as flags, not verdicts, because detector errors can unfairly affect non-native English writers (Liang et al., 2023). Ethics is treated as concrete engineering practice, not a checklist (Mittelstadt, 2019).]
)

= 6. Reflection on Integration

#grid(
  columns: (1fr, 1fr),
  gutter: 9pt,
  compact-card("Enhances", "Reviewer matching becomes topic-based. Authors receive pre-submission support. Reviews become structured and comparable. Accepted papers surface with AI-extracted keywords.", icon: "+"),
  compact-card("Complements", "AI drafts and humans decide. Local methods surface signals while editors verify before acting. The audit log supports accountability across both paths (Mittelstadt, 2019).", icon: "="),
  compact-card("Challenges", "AI-text flags may unfairly affect non-native English writers (Liang et al., 2023). Bias may favour mainstream topics (Bender et al., 2021). Authors may over-trust writing assistance. API cost requires controls.", icon: "!"),
  compact-card("Current limitation", "Prototype validation does not yet prove real-world review quality or fairness. Those claims require benchmarking and user testing in Assessment 2.", icon: "⚠")
)

Going back to this project with a GenAI lens taught me that architectural choices matter more than model choice. The provider switch, the audit log, the split between generation and retrieval, and the rule that AI drafts but humans submit are what let me run cost-free today and scale tomorrow. GenAI integration is interface design as much as it is model selection. The question I keep returning to is not what the model can do, but where in the workflow the model belongs and how the human is kept in the loop.

= 7. Conclusion

#callout("Conclusion", [
  The revised system addresses five clear gaps with writing assistance, reviewer matching, integrity screening, and structured review drafting, all governed by human accountability. Tool selection prioritises explainability, privacy, and cost control. The provider-agnostic architecture leaves a clean upgrade path for Assessment 2.
], icon: "🎯", fill: rgb(255, 249, 249), stroke: accent.lighten(35%))

#pagebreak(weak: true)

= 8. References

#set text(size: 8.8pt, lang: "en", hyphenate: false)
#set par(justify: true, leading: 0.55em)

Anthropic. (n.d.). *Models overview. Claude developer documentation.* Retrieved May 13, 2026, from https://docs.anthropic.com/en/docs/about-claude/models/overview

Bender, E. M., Gebru, T., McMillan-Major, A., & Shmitchell, S. (2021). On the dangers of stochastic parrots: Can language models be too big? *Proceedings of FAccT.* https://doi.org/10.1145/3442188.3445922

Bommasani, R., Hudson, D. A., Adeli, E., Altman, R., Arora, S., von Arx, S., Bernstein, M. S., Bohg, J., Bosselut, A., Brunskill, E., Brynjolfsson, E., Buch, S., Card, D., Castellon, R., Chatterji, N., Chen, A., Creel, K., Davis, J. Q., Demszky, D., … Liang, P. (2021). On the opportunities and risks of foundation models. *arXiv.* https://doi.org/10.48550/arXiv.2108.07258

Brown, T. B., Mann, B., Ryder, N., Subbiah, M., Kaplan, J., Dhariwal, P., Neelakantan, A., Shyam, P., Sastry, G., Askell, A., Agarwal, S., Herbert-Voss, A., Krueger, G., Henighan, T., Child, R., Ramesh, A., Ziegler, D. M., Wu, J., Winter, C., … Amodei, D. (2020). Language models are few-shot learners. *Advances in Neural Information Processing Systems, 33*, 1877–1901. https://doi.org/10.48550/arXiv.2005.14165

Charlin, L., & Zemel, R. (2013). The Toronto paper matching system: An automated paper-reviewer assignment system. *ICML Workshop on Peer Reviewing and Publishing Models.* https://www.cs.toronto.edu/~lcharlin/papers/tpms.pdf

Lewis, P., Perez, E., Piktus, A., Petroni, F., Karpukhin, V., Goyal, N., Küttler, H., Lewis, M., Yih, W., Rocktäschel, T., Riedel, S., & Kiela, D. (2020). Retrieval-augmented generation for knowledge-intensive NLP tasks. *Advances in Neural Information Processing Systems, 33*, 9459–9474. https://doi.org/10.48550/arXiv.2005.11401

Liang, W., Yuksekgonul, M., Mao, Y., Wu, E., & Zou, J. (2023). GPT detectors are biased against non-native English writers. *Patterns, 4*(7), Article 100779. https://doi.org/10.1016/j.patter.2023.100779

Mittelstadt, B. D. (2019). Principles alone cannot guarantee ethical AI. *Nature Machine Intelligence, 1*(11), 501–507. https://doi.org/10.1038/s42256-019-0114-4

Reimers, N., & Gurevych, I. (2019). Sentence-BERT: Sentence embeddings using siamese BERT-networks. *Proceedings of EMNLP-IJCNLP 2019*, 3982–3992. https://doi.org/10.18653/v1/D19-1410

Salton, G., & Buckley, C. (1988). Term-weighting approaches in automatic text retrieval. *Information Processing & Management, 24*(5), 513–523. https://doi.org/10.1016/0306-4573(88)90021-0

Vaswani, A., Shazeer, N., Parmar, N., Uszkoreit, J., Jones, L., Gomez, A. N., Kaiser, Ł., & Polosukhin, I. (2017). Attention is all you need. *Advances in Neural Information Processing Systems, 30*, 5998–6008. https://doi.org/10.48550/arXiv.1706.03762

Weidinger, L., Uesato, J., Rauh, M., Griffin, C., Huang, P., Mellor, J., Glaese, A., Cheng, M., Balle, B., Kasirzadeh, A., Kenton, Z., Brown, S., Hawkins, W., Stepleton, T., Biles, C., Birhane, A., Haas, J., Rimell, L., Hendricks, L. A., … Gabriel, I. (2022). Taxonomy of risks posed by language models. *Proceedings of FAccT*, 214–229. https://doi.org/10.1145/3531146.3533088

#set text(size: 10.2pt, lang: "en", hyphenate: false)
#set par(justify: true, leading: 0.62em)

#pagebreak(weak: true)

= Appendix A: Project Artefacts and Prototype Evidence

#table(
  columns: (0.9fr, 1.8fr),
  inset: 7pt,
  stroke: 0.55pt + border,
  [*Artefact*], [*Location or details*],
  [Original project], [`/paper-submission-system/`],
  [Revised scaffold], [`/paper-submission-system-v2/`],
  [Planned GenAI services], [`aiReviewer.js`, `reviewerMatcher.js`, `plagiarismDetector.js`, `writingAssistant.js`, `conflictOfInterest.js`],
  [Planned provider switch], [`src/services/llm/index.js`],
  [Designed tables], [`users`, `papers`, `reviews`, `embeddings`, `ai_audit`, `notifications`, `coauthorships`, `decisions`],
  [Audit schema], [`ai_audit(id, user_id, paper_id, action, provider, input_tokens, output_tokens, created_at)`]
)

== Design Maturity and Feasibility Validation

A feasibility prototype validated the MVC scaffold, role-aware routing, TF-IDF reviewer matching logic, local fallback for AI-assisted drafting, and the LLM provider-switch pattern. Full implementation, benchmarking, user evaluation, and production-quality testing are reserved for Assessment 2.

#table(
  columns: (1.1fr, 1.5fr),
  inset: 7pt,
  stroke: 0.55pt + border,
  [*Capability*], [*Implementation status*],
  [MVC project structure], [Prototype tested.],
  [Login and five roles], [Prototype tested.],
  [Smart reviewer matching], [Prototype logic tested; full integration planned.],
  [Plagiarism similarity score], [Algorithm designed; validation planned.],
  [AI-text flag], [Designed; validation planned, treated as a risk signal only.],
  [AI reviewer drafts], [Local fallback prototype tested; Claude pending.],
  [Author writing helper], [Prototype workflow tested locally; Claude pending.],
  [Claude API integration], [Provider switch designed; API activation pending.],
  [Sentence-transformer matching], [Roadmap upgrade.],
  [User study and benchmarking], [Assessment 2 evaluation.]
)

== Screenshot Evidence

#screenshot-figure(
  "original-dashboard.png",
  "Figure A1. Original Paper Submission System login page or dashboard.",
  "Evidence of the original previous-course project and role-based access."
)

#screenshot-figure(
  "author-submit.png",
  "Figure A2. Author submission page from the original or prototype system.",
  "Evidence of the manuscript and abstract submission flow where writing support will be added."
)

#screenshot-figure(
  "editor-reviewer-assignment.png",
  "Figure A3. Editor or reviewer assignment workflow.",
  "Evidence of the reviewer assignment area that will be improved by AI-based matching."
)

#screenshot-figure(
  "project-structure.png",
  "Figure A4. Revised project scaffold or GenAI service files.",
  "Evidence of MVC layers or service files such as reviewerMatcher.js, aiReviewer.js, or writingAssistant.js."
)

#screenshot-figure(
  "terminal-run.png",
  "Figure A5. Local run, setup, or test command evidence.",
  "Evidence showing npm install, npm start, npm test, or the local server running successfully."
)

== Planned Local Run

#callout("Planned local run", [
  #code-box("cd paper-submission-system-v2
npm install
npm run setup
npm start")
  App URL: `http://localhost:3000`
], icon: "💻")

= Appendix B: Roadmap to Assessment 2

#table(
  columns: (0.8fr, 1.9fr),
  inset: 7pt,
  stroke: 0.55pt + border,
  [*Milestone*], [*Planned work*],
  [1], [Finalise scaffold. Local AI fallback covers core features. Audit log live.],
  [2], [Activate Claude API. Benchmark draft quality, cost, and latency.],
  [3], [Replace TF-IDF with sentence-transformers and re-evaluate matching precision.],
  [4], [Add conflict-of-interest detection and automated regression tests.],
  [5], [Run a small user study comparing reviewer thoroughness with and without AI draft assistance.]
)

= Appendix C: AI Use Disclosure

#callout("Tools used to prepare this report", [
  Claude Sonnet 4.6 was used to help structure the outline and surface candidate references, which were independently verified against primary sources. ChatGPT was used for second opinions and reference cross-checking. No AI-generated content was inserted without author review.
], icon: "🧾")

#callout("Tools planned or used for the revised system", [
  Claude (Sonnet 4.6), Cursor, Whisper Flow, GitHub Copilot, ChatGPT, and Excalidraw will support architecture, prompt engineering, code generation, documentation, and diagrams. All AI-assisted contributions will be reviewed, tested, and accepted by the author. Runtime AI use will be logged in the `ai_audit` database table.
], icon: "🛠️")

#align(center)[
  #v(12pt)
  #text(size: 12pt, weight: "bold", fill: deep)[GenAI supports the workflow. Humans keep the authority.]
  #v(4pt)
  #text(size: 9pt, style: "italic", fill: muted)[
    "AI drafts. Humans decide. The system audits."
  ]
]
