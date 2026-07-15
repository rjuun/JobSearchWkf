# User Journey & Experience Plan — the Career Graph

> A first-principles plan to make the system **approachable and extensible to new users**, built
> on the insight that its power is not the tailoring engine (generic AI does that) but the
> **rich, human-curated inputs** that feed it. Grounded in the owner's manual A→B→C→CI→D process.
> Friendly walkthrough: [`docs/archive/phases/user-journey.html`](../archive/phases/user-journey.html). Buildable
> spec: [`ONBOARDING_SPEC.md`](./ONBOARDING_SPEC.md).

## North star

> **Turn a real, messy career into a structured, evidence-backed *Career Graph* — then let an
> honest AI co-pilot screen roles and tailor trustworthy, ATS-ready applications from it, getting
> more personal with every use.**

The wedge is not "AI writes your CV." It is "**you build a career asset once (with AI's help), and
it compounds.**" The user's inputs *are* the product.

---

## 1. The moat (why this beats generic AI CV tools)

Generic tools are **stateless**: `(CV + JD) → tailored CV`. They are generic, forgetful, and prone
to fabrication because they optimise impressiveness over truth. This system has two things they
don't, both made of **human input**:

1. **The Career Graph** — a normalised evidence store: positions → STAR stories → actions,
   quantified results, competences, attributes; plus responsibilities, skills (each with ATS
   keyword variants), education, languages. Every claim carries a `ref_code` so it can be cited as
   proof. (See [`DATA_MODEL.md`](../DATA_MODEL.md).)
2. **Human judgment gates** — the C2 **Green / Yellow / Red** approval and the non-negotiables
   (truthfulness, evidence-bound ATS, honest gaps, anti-sycophancy). Output is trustworthy because
   *the user vouched for every claim*.

**Defensibility:** the graph + the user's curation history + outcome feedback is a personal data
asset that's costly to replicate and that *the user owns and grows*. The more it's used, the more
personal it gets — the opposite of generic.

**The gap today:** for a new user, that moat is a **12-sheet Excel wall**. The graph is currently
pre-seeded; there is no way to build or grow it in-product. **Closing that is the whole game.**

---

## 2. Who we build for first

**Primary persona — "The Senior Operator"** (the owner; dogfoodable):

- 15+ years; exec / finance / transformation / chief-of-staff; multi-country, non-linear career.
- Applies **selectively** to senior roles; time-poor; reputation-sensitive — **will not risk a
  fabricated claim**.
- Already distrusts generic AI "slop." Values nuance, honesty, and control.

**Jobs to be done** (ranked):

| # | Job | Why it's hard / valuable |
| --- | --- | --- |
| 1 | "Help me articulate what I've actually done, **at the level it deserves**." | Senior people chronically *undersell* — they omit metrics and scope. AI coaching that draws this out is the highest-value, least-served job. |
| 2 | "Tell me **honestly** which roles are worth my scarce time." | Role-fit triage (B1–B6) — already built as mission control. |
| 3 | "Produce a **truthful, tailored, ATS-safe** CV per role in minutes." | The C-phase — already built, human-gated. |
| 4 | "Build a **career asset I own** that gets better over time." | The Career Graph as compounding value. |

**Anti-jobs** (what they explicitly *don't* want): generic templates, invented metrics,
keyword-stuffing, re-entering everything per application.

> Senior-first is the right wedge: it's the *validated* process, the owner can dogfood it, and
> truthfulness/nuance matter most exactly where the stakes are highest. Broaden to any ambitious
> professional later (bigger market, higher approachability bar).

---

## 3. The reimagined journey

The new-user spine — with the **Career Graph as the persistent foundation under everything**:

```
            ┌──────────────────── Career Graph (the asset, always growing) ───────────────────┐
            │                                                                                  │
  ▶ BUILD ───────▶ SCREEN ───────▶ TAILOR ───────▶ APPLY ───────▶ IMPROVE ──┐
  (onboard:       (B1–B6,         (C1–C7,          (track          (the loop:  │
   import+coach)   honest fit)     human gate)      outcomes)       graph grows)│
            ▲                                                                   │
            └──────────────────── enrichment loop feeds back ───────────────────┘
```

The emotional arc we're designing for: **"ugh, my career is a mess" → "wow, it captured my real
impact" → "I trust this CV enough to send it."**

### Stage 0 · BUILD the Career Graph (the new heart)

Hybrid onboarding — **import to bootstrap, then coach to enrich** — applying the system's *own best
pattern* (AI drafts → human curates) to profile-building:

1. **Bootstrap (import).** Upload an existing CV (PDF/DOCX) and/or a LinkedIn export and/or paste a
   few roles. AI extracts a **draft** graph (positions, inferred STAR stories, actions, results,
   skills, education, languages) — each node tagged with **provenance** and **confidence**.
2. **Curate (the gate — the differentiator).** The user walks the draft and **Approves / Edits /
   Drops** each node — the same muscle as C2. Only approved nodes enter the *trusted* graph.
   **Truthfulness guardrail: AI never invents a metric**; blanks stay blank until the user supplies
   them.
3. **Coach (enrich).** AI surfaces the highest-value gaps and asks targeted questions —
   *"You led the SSC migration — what was the headcount, and the cost/time impact?"* — drawing out
   the quantified results senior people omit. The user answers; new evidence is drafted and approved.
4. **First win, fast.** As soon as the graph is **minimally viable** (≈ 1–2 positions + a few
   actions/results + skills), the user can capture a lead and get a tailored CV — they feel the
   payoff *before* finishing. A completeness/strength meter invites continued enrichment.

### Stage A · CAPTURE leads
Frictionless capture (bookmarklet / paste), as today. Optionally pull company intel.

### Stage B · SCREEN (B1–B6 · mission control)
Honest role-fit, already built. **New:** when screening surfaces a gap (*"Core: SAP S/4 — Weak
match"*) it becomes an **enrichment prompt** — *"Do you actually have this? Add the evidence."* The
screen becomes a graph-growth moment.

### Stage C · TAILOR (C1–C7 · the human gate)
Already redesigned. Strengthen:
- **Provenance in the CV** — every bullet traces to the approved evidence node. The user can trust
  and verify every line.
- **Enrich-on-the-fly** — if a Core requirement has only Weak evidence, invite the user to add a
  story/metric *right there*. The graph grows from real demand.

### Stage D · APPLY & track
Capture outcomes (applied / interview / offer / reject). Feeds CI and recalibrates B6 over time.

### Stage CI · IMPROVE (the loop)
Accuracy tips (built) plus the compounding asset: *"Your graph this month: +5 actions, +3
quantified results, 2 skills gained ATS variants."* The system gets smarter — better B6
calibration, faster C2 (it learns your approval patterns), richer evidence.

---

## 4. Design principles

1. **AI drafts, the human curates & enriches — everywhere.** Lowers input cost *and* keeps it true
   (the human vouches). One consistent, trust-building interaction across onboarding and C2.
2. **Start with a win, not a wall.** A minimally-viable graph unlocks value; never block on
   completeness.
3. **Make the moat visible.** Show graph completeness & strength as an asset worth growing.
4. **Trust by provenance.** Every claim is traceable to evidence the user approved. Truthfulness is
   a *feature*, not a constraint — especially for this persona.
5. **Two speeds.** A guided wizard for newcomers; a power path (bulk/table editor + Excel import)
   for people like the owner. Don't lose the power user.
6. **The graph is the product; jobs are transient.** Invert today's lead-centric IA — Profile
   becomes first-class.
7. **Coach, don't just collect.** The STAR/impact interview draws out under-told wins — the
   highest-value job for senior pros.
8. **Honest by default.** Gaps are shown, not hidden; the co-pilot's voice is anti-sycophantic.

---

## 5. The information-architecture shift

| | Today | Proposed |
| --- | --- | --- |
| Top nav | Leads · Dashboard | **Profile (Career Graph)** · Leads · Dashboard |
| Profile | invisible (pre-seeded) | **first-class destination** — view, build, enrich, see strength |
| Entry point | the lead board | onboarding into the graph → then the board |
| Gaps | dead-ends in screening | **deep-link into the graph** to enrich on demand |

The Career Graph becomes the home base the rest of the experience orbits.

---

## 6. Extensibility (multi-user) — what it takes

> **Shipped (O2–O4):** multi-user signup is live. Auth shipped **self-contained** (`jose` cookie +
> `scrypt`, `lib/auth.ts`), owner-scoped in the app layer — **not** Supabase Auth + RLS as this
> section originally proposed. Onboarding-as-importer is built too.

The schema is `owner_id`-scoped throughout; the work was auth + replacing Excel:

- **Auth** → self-contained session cookie + `scrypt` (`lib/auth.ts`); owner-scoped in the app
  layer. *(Originally planned as Supabase Auth + RLS; shipped self-contained.)*
- **Onboarding writes directly to Postgres** — the wizard *is* the importer; new users never touch
  Excel.
- **Per-user storage isolation** for raw uploads and CV output.
- **A sample "Senior Operator" graph** to copy/learn from.
- Keep **Excel bulk-import** as a power path.
- **Privacy as a selling point** for this persona: encrypted at rest, server-side LLM only, never
  trained on.

---

## 7. Phased roadmap

Sequenced so the graph becomes first-class, then bootstrapped, then enriched, then opened to others.
The owner can **dogfood O1–O3 single-user** before multi-tenant.

| Phase | Outcome | Notes |
| --- | --- | --- |
| **(this) Plan** | This document + the onboarding spec + review HTML | — |
| **O1 · Career Graph, first-class** | A `/profile` section: view + manual CRUD editors over the existing evidence tables | No AI; immediate value; makes the asset real & editable |
| **O2 · Import & extract (bootstrap)** | CV/LinkedIn upload → AI-drafted graph → **curation gate** → committed evidence | The "import" half of hybrid; reuses `runStructured` + the C2 muscle |
| **O3 · Coach & enrich** | Completeness/strength meter, AI coaching interview, gap→enrich prompts from screening, provenance surfaced in the CV | The "coach" half; closes the enrichment loop |
| **O4 · Multi-tenant (P7)** | Supabase Auth + RLS + per-user onboarding | The wizard replaces Excel for everyone |
| *parallel / after* | Live LLM (P6), Apply/track (D) + outcome→B6 calibration, CV provenance polish | — |

---

## 8. Success metrics (per JTBD)

- **North-star:** *time from signup → first **trusted** tailored CV* — and **graph strength over
  time**.
- **Activation:** % of new users reaching a minimally-viable graph; time-to-first-CV.
- **Enrichment:** actions/results added per week; % of skills with ATS variants; **quantified-result
  coverage** (the senior-pro value signal).
- **Trust / quality:** % Green on the *first* C2 pass (proxy for evidence relevance); edits per
  bullet (the user's voice asserting itself); **provenance coverage** (share of CV bullets traceable
  to approved evidence); self-reported trust.
- **Outcome (Phase D, later):** interview rate by fit-score band → B6 calibration.

---

## 9. Validation plan (lightweight — no users yet)

Honouring the research method, sized to a solo prototype:

1. **Dogfood (the best first test).** The owner builds a **fresh** graph from scratch via
   import + coach — *not* the seed. Does it reach parity with the hand-built workbook? **Time it.**
   This validates extraction quality and the coaching's pull on quantified results in one shot.
2. **Usability tests (5–8 senior peers).** Can they reach a minimally-viable graph in **< 30 min**?
   Where do they stall? Do they trust the draft? (Method: the skill's usability protocol.)
3. **JTBD interviews (5–8).** How do senior pros build CVs today? What do they distrust about AI
   tools? What would make them invest inputs? (Guide: warm-up → current workflow → deep dive on
   evidence & trust → react to the Career-Graph concept → wrap.)
4. **Concept test.** Does "you own a growing career asset, and every bullet is backed by evidence
   you approved" resonate enough to change behaviour?

**Go/no-go criteria:** extraction draft is curation-worthy (≥ ~70% of nodes kept or lightly edited);
time-to-minimally-viable < 30 min; ≥ 1 quantified result drawn out per coached session; testers say
they'd trust and send the CV.

---

## 10. Risks & open questions

| Risk | Mitigation |
| --- | --- |
| Import/extraction quality on messy CVs & LinkedIn | The curation gate catches errors; show confidence + provenance; never auto-commit |
| Cold-start effort even with hybrid | "Start with a win"; make coaching *feel* valuable (people enjoy articulating wins when prompted well) |
| AI inferring metrics that aren't true | Hard guardrail: results only when explicitly present; otherwise a `needs-metric` prompt, never a number |
| Senior-pro skepticism of AI | Provenance + honest gaps + "you curate" + privacy posture |
| Sensitive career data across users | RLS, encryption at rest, server-side LLM only, no training on user data |

**Open questions:** ref_code generation for self-serve users (auto vs. user-visible); how much
LinkedIn structure to rely on (export formats vary); whether coaching is a wizard step or an
always-available "enrich" mode (lean: both — a first pass in onboarding, then ambient).
