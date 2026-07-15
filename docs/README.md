# Documentation

The authoritative specs for RoleProof. Read them in this order:

1. **[PIPELINE.md](PIPELINE.md)** — the domain process, step by step (A→B→C→CI→D). Ties each step to
   its `Process/*.md` note (the prompt templates) and to code modules.
2. **[DATA_MODEL.md](DATA_MODEL.md)** — the entities and the Postgres schema they map to.
3. **[ARCHITECTURE.md](ARCHITECTURE.md)** — how it's built: stack, "LLM judges / code computes",
   model-per-step, self-contained auth, docx generation.
4. **[ROADMAP.md](ROADMAP.md)** — what was built and in what order; what's next.
5. **[DEPLOYMENT.md](DEPLOYMENT.md)** — envs, secrets, Supabase + Vercel, seeding, cost.
6. **[RETROSPECTIVE.md](RETROSPECTIVE.md)** — decisions, gaps, and the full delivered scope.
7. **[DEMO_RUNBOOK.md](DEMO_RUNBOOK.md)** — the 5-minute click-path for a live demo.

## Also here

- **[design/](design/)** — the design system (`DESIGN_SYSTEM.md`), onboarding spec, and user-journey plan.
- **[bpmn/](bpmn/)** — BPMN visual spec of the gated pipeline (documentation now; optional Camunda
  runtime later).
- **[archive/](archive/)** — the frozen build-log (per-phase/milestone/wave review pages and
  screenshots). History, not current spec — see [`archive/README.md`](archive/README.md).

For working *in* this repo (conventions, non-negotiables, model-per-step), read
[`../CLAUDE.md`](../CLAUDE.md).
