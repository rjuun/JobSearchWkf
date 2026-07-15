# BPMN / Camunda

The project is named **JobSearch_Camunda** because the long-term intent is to model this gated
pipeline as **BPMN**. For the prototype, BPMN is **documentation only** — a visual spec of the
process, not a runtime engine.

## Status

- **Now (Phase 0):** the interim visual spec is the Mermaid flowchart in
  [`../PIPELINE.md`](../PIPELINE.md) (renders on GitHub, version-controllable, zero tooling).
- **Next:** author a proper `pipeline.bpmn` here in **Camunda Modeler** (free desktop app) — one
  pool for the candidate, the A→B→C lanes, the two gateways (B1 freshness `≥60d`, B6 fit tier), and
  the C2 human task. Each task carries a documentation link to its `Process/*.md` step note. Export
  `pipeline.svg`/`.png` for the README.
- **Later (optional, post-prototype):** promote the model to a **Camunda 8 (Zeebe)** runtime.

## Why this maps cleanly to BPMN

The process is already a gated graph:

- **Tasks** = the pipeline steps (A1, B1–B6, C1–C7).
- **Gateways** = the two real decision gates — B1 (*posting ≥60 days → hold*) and B6 (*fit tier →
  proceed / caution / low / not recommended*).
- **Human task** = C2's Green/Yellow/Red evidence approval.
- **Service tasks** = the DeepSeek API calls (extraction / scoring tiers).

## Migration path to a Camunda 8 runtime

The app's architecture is deliberately built so this is a **swap, not a rewrite** (see
[`../ARCHITECTURE.md`](../ARCHITECTURE.md#camunda-later)):

1. Each step is already an **idempotent, resumable unit** with a `pipeline_runs` state machine.
2. To adopt Zeebe: map each step module to a **job worker**, each gate to a **BPMN gateway**, and
   the C2 review to a **user task**. Orchestration moves to Zeebe; the step code (DeepSeek calls +
   the deterministic `lib/scoring` rollups) stays unchanged.
3. Trigger the process on lead capture; let Zeebe drive the sequence and gates.

Until there's a reason to add that infrastructure (concurrency, multi-user orchestration, audit/SLA
needs), the in-app state machine is the right amount of engine for a single-user demo.

## Files (to be added)

```
docs/bpmn/
├── README.md        ← this file
├── pipeline.bpmn    ← (todo) author in Camunda Modeler
└── pipeline.svg     ← (todo) exported visual for the README
```
