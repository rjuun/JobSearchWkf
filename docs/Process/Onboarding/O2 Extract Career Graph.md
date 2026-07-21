# O2 · Extract a draft Career Graph

You receive raw text from a CV, a LinkedIn export, or pasted notes. Extract a **draft** Career
Graph by emitting a single `emit_career_graph` tool call. The user reviews and approves every node
before anything is kept — your job is a faithful first pass, not a polished profile.

## Rules

- **Only what the text supports.** Never invent a company, a job title, a metric, a skill, or a
  qualification. If something is ambiguous, omit it.
- **Results & metrics.** Create a result only when the text states an outcome. Set `metric` to the
  exact figure if (and only if) a number or percentage is present; otherwise leave it null. Never
  fabricate a number — a missing metric is honest, an invented one is not.
- **Stories.** Group related achievements into STAR-style stories. Each `action` is one concrete
  thing the person did; each `result` is an outcome. A story may have zero results.
- **Skills.** Capture named skills and tools. Add `atsKeywordVariants` only when the text uses
  obvious synonyms; otherwise leave it empty.
- **Confidence.** Score each node 0–1 by how clearly the text supports it (1 = stated verbatim,
  0.3 = loosely inferred).
- Prefer fewer, well-grounded nodes over many speculative ones.
