# Buildable Spec — Career-Graph Onboarding

> The implementable spec for the new heart of the journey: an in-app **Career Graph** plus a
> **hybrid onboarding** (import → AI-extract → human-curate → coach to enrich). Scoped to
> single-user (current auth), schema-compatible, mock-LLM-first. Strategy context:
> [`USER_JOURNEY.md`](./USER_JOURNEY.md). Honors the build rules in [`../../CLAUDE.md`](../../CLAUDE.md).

## 0. Principles this spec must honour

- **LLM judges, code computes.** Extraction/coaching emit *judgments* via forced tool-use + zod
  (reuse `lib/llm/client.ts` `runStructured<T>`); all gating/IDs/rollups are TypeScript.
- **Process notes are prompts.** New step prompts live as `Process/Onboarding/*.md` and are loaded
  as system prompts — refining = editing markdown, not code.
- **AI drafts, the human commits.** Nothing AI-extracted enters the *trusted* graph until the user
  approves it (the onboarding analogue of the C2 gate).
- **Truthfulness guardrail.** The model must never invent a metric; missing results become a
  coaching prompt, never a number.
- **Design-system fit.** Reuse the kit (`components/ui.tsx`), tokens, and the mission-control feel.

---

## 1. Information architecture & routes

New first-class top-level section: **Profile** (the Career Graph). Add to the shell nav
(`components/nav-links.tsx`): `Profile · Leads · Dashboard`.

| Route | Purpose |
| --- | --- |
| `/profile` | **Career Graph home** — completeness & strength, the graph by section, provenance, CTAs to import/enrich. Empty-state → onboarding. |
| `/profile/onboarding` | The **guided wizard** (import → review → coach). Resumable. |
| `/profile/positions` · `/stars` · `/skills` · `/education` · `/languages` | Per-section **CRUD editors** over the evidence tables (power path). `stars` nests actions/results/competences/attributes. |

Mission-control gap prompts (Stage B/C) deep-link into `/profile/...?focus=<ref>` for
enrich-on-the-fly.

---

## 2. The onboarding wizard (flow)

Resumable; each step persists to `onboarding_state`.

1. **Welcome / how it works.** Set the contract: *"AI drafts, you decide. Nothing is claimed unless
   you approve it."* Pick a path: **Import** · Start blank · **Excel** (power).
2. **Bootstrap / Import.** Upload CV (PDF/DOCX) and/or LinkedIn export (PDF/CSV) and/or paste roles.
   Raw stored via the storage abstraction (`lib/storage.ts`, per-owner path). Trigger extraction
   (server action → `extractCareerGraph`, mock-first).
3. **Review the draft graph — the curation gate.** Extracted nodes shown grouped *position → story →
   actions/results*, each with **provenance** + **confidence**. Per node: **Approve / Edit / Drop**
   (the C2 segmented control). Approving commits to the real tables with `owner_id` + a generated
   `ref_code`.
4. **Coach / enrich.** AI surfaces highest-value gaps (`suggestEnrichments`): stories missing
   quantified results, skills missing ATS variants, thin positions. Targeted questions; the user's
   answer → `draftStarFromAnswer` → new draft nodes → approve. Truthfulness guardrail throughout.
5. **First win.** Once **minimally viable** (≥1 position + ≥3 approved actions + ≥1 result + ≥3
   skills), surface *"Capture your first job lead →"* and hand off to the existing pipeline.

---

## 3. AI extraction & coaching contracts

All via `runStructured<T>` (forced `tool_choice`, zod `safeParse` + retry, logged to `llm_calls`,
mock fixtures for offline/demo). Model per step: **Sonnet** (extraction/coaching) per the
model-per-step rule.

### `extractCareerGraph` (Sonnet)
- **In:** raw CV / LinkedIn / pasted text (+ source type).
- **Out (forced schema):**
  ```
  {
    positions: [{ company, title, start, end, summary, confidence }],
    stars: [{ positionRef, title, summary,
              actions:    [{ text, skills[], atsKeywords[], confidence }],
              results:    [{ text, metric|null, impactType, needsMetric, confidence }],
              competences:[{ competence, confidence }],
              attributes: [{ attribute, confidence }] }],
    responsibilities: [{ positionRef, text, skills[], confidence }],
    skills:    [{ skill, proficiency, atsKeywordVariants[], confidence }],
    education: [{ institution, qualification, type, year, confidence }],
    languages: [{ language, cefrLevel, confidence }]
  }
  ```
- **Guardrails:** `metric` is `null` unless explicitly present in the source; set `needsMetric:true`
  so coaching can target it. Every node carries `confidence` (0–1) and a `source` ('imported').
  No node is committed here — output lands in **staging**.

### `suggestEnrichments` (Sonnet)
- **In:** the current graph (sparse areas) + optionally a JD (for gap-driven enrichment from
  screening).
- **Out:** prioritised `[{ targetRef, type: 'metric'|'skill_variant'|'missing_story'|'thin_position',
  question, why }]`.

### `draftStarFromAnswer` (Sonnet)
- **In:** a coaching question + the user's freeform answer.
- **Out:** structured draft action/result nodes (truthful; `needsMetric` if no number given) → into
  staging → user approves before commit.

> Prompts live in `Process/Onboarding/O2-extract.md` and `O3-coach.md`, loaded as system prompts
> with the shared non-negotiables prepended.

---

## 4. Data-model deltas (minimal — the schema is already evidence-first)

Additive only; no destructive migration.

1. **Provenance on evidence rows.** Add to `star_actions`, `star_results`, `responsibilities`,
   `skills_master`, etc.:
   - `source enum('imported','authored','ai_suggested')` (default `'authored'`)
   - `confidence numeric null`
   - `needs_metric boolean default false` (results only)
2. **Staging, not a graveyard.** `onboarding_state` table (one row per owner):
   - `owner_id`, `step`, `raw_uploads jsonb` (storage refs), `draft_graph jsonb` (the unapproved
     extraction), `status enum('importing','reviewing','coaching','done')`, timestamps.
   - Unapproved AI output lives **only** in `draft_graph` until the user approves a node → it is
     promoted into the real table. This mirrors `pending → green`: trusted graph stays clean.
3. **`ref_code` generation** (replacing hand-authored Excel codes): positions → `A,B,C…`; stars →
   next integer; actions → `{star}-{n}`; results → `{star}-R{n}`; education → `EDU-{n}`; etc.
   Generated in TS on commit; kept human-readable for citation.

---

## 5. The curation gate (reuse C2, don't reinvent)

The review step is the onboarding twin of C2:

- Each draft node renders with the **same segmented control** language — here **Approve / Edit /
  Drop** — plus a provenance badge (`imported` / `AI draft` / `you wrote`) and a confidence hint.
- **Only approved nodes** are promoted from `draft_graph` into the trusted tables.
- Editing a node before approving records it as `source:'authored'` (the user's voice) — a positive
  trust signal worth keeping.

Reuse: the Keep/Maybe/Drop component pattern, `Badge` tones (add `imported`/`ai` tones), `EmptyState`,
`Skeleton`, `Button`, `Field`.

---

## 6. New UI surfaces

| Surface | Notes |
| --- | --- |
| **Career Graph home** (`/profile`) | A **completeness/strength meter** (new small component): e.g. *"3 positions · 12 actions · 8 with quantified results · 4 skills missing ATS variants."* Sections as cards; provenance badges; "Enrich" CTAs. |
| **Wizard** (`/profile/onboarding`) | Stepper (reuse the journey-rail visual language); upload + paste; extraction progress (Skeleton + status); the curation gate; the coaching panel (mission-control feel). |
| **Section editors** | Tables/cards over each evidence type with inline add/edit; the power path + the Excel bulk-import entry. |
| **Coaching panel** | One question at a time, the user's answer field, "Add to graph" → approve. Shows *why* the question matters (the value sell). |
| **Truthfulness UX** | Blanks shown as blanks; **"needs metric"** chips on results; numbers never auto-filled. |

---

## 7. States, a11y, privacy

- **States:** empty (*"Your Career Graph is empty — import a CV to draft it"*), loading (extraction
  can take seconds → Skeleton + progress), error/retry (extraction failed), **partial** (a
  minimally-viable banner with the first-win CTA).
- **A11y:** the kit's focus-visible + ARIA carry over; the curation gate gets `aria-pressed` like C2;
  upload has a labelled dropzone + keyboard fallback.
- **Privacy (sensitive career data):** raw uploads in **private** per-owner storage; all LLM calls
  server-side; never log raw PII to the client; **don't train on user data.** (A selling point for
  the persona.)

---

## 8. Build sequence

Each step is independently shippable and dogfoodable.

1. **O1 — Career Graph, first-class (no AI).** `/profile` view + CRUD editors over existing tables +
   the completeness meter. Immediate value; makes the asset real. *(Prereq for all of it.)*
2. **O2 — Import & extract.** Upload → `extractCareerGraph` → `onboarding_state.draft_graph` →
   the curation gate → commit approved nodes (with `ref_code` + provenance). Mock fixtures first;
   live behind `LLM_MODE=live`.
3. **O3 — Coach & enrich.** Completeness/strength signals, `suggestEnrichments` coaching,
   `draftStarFromAnswer`, gap→enrich prompts wired from Stage B/C, provenance surfaced on CV bullets.
4. **O4 — Multi-tenant.** ✅ shipped with **self-contained auth** (`jose` + `scrypt`, `lib/auth.ts`),
   owner-scoped in the app layer (not Supabase Auth/RLS); `/signup` gives each new user an empty
   graph; the wizard replaces Excel for new users.

---

## 9. What to validate while building

- Does `extractCareerGraph` on a **real, messy** CV produce a curation-worthy draft? *(Dogfood the
  owner's CV → compare to the hand-built workbook; target ≥ ~70% of nodes kept or lightly edited.)*
- Does coaching reliably **draw out a quantified result** people omit? *(Usability test.)*
- **Time-to-minimally-viable-graph < 30 min**, and time-to-first-CV after that?
- Does the curation gate *feel* like control, not data entry? *(The trust test.)*

---

## 10. Reuse map (what already exists)

| Need | Reuse |
| --- | --- |
| Structured LLM output | `lib/llm/client.ts` `runStructured` + `lib/llm/schemas.ts` (add the 3 tools) |
| Deterministic gates/IDs | `lib/scoring.ts` pattern; new `lib/career-graph.ts` for ref_code generation + completeness |
| Human-approval UI | the C2 segmented control + `approval_status` pattern |
| Storage of uploads/CV | `lib/storage.ts` (filesystem ↔ Supabase by env) |
| Components / tokens | `components/ui.tsx`, the design system |
| Prompts-as-notes | `Process/Onboarding/*.md` (new), loaded like the existing step notes |
