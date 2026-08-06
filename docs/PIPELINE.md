# Pipeline — A → B → C → CI → D

The domain process, mapped to implementation. Each step's authoritative spec is its note in
[`Process/`](../Process/); this document is the index that ties those notes to code modules,
models, and I/O contracts. **The `Process/*.md` notes ARE the prompt templates** — load them at
runtime, don't rewrite them.

## Flow

```mermaid
flowchart TD
    A1["A1 · Capture job lead<br/>(bookmarklet → /api/ingest)"] --> B1

    subgraph B["B · Screening (gate before tailoring)"]
        B1["B1 · Freshness & saturation<br/><i>code parse</i>"] --> G1{"≥ 60 days<br/>old?"}
        G1 -- yes --> HOLD["status: hold<br/>(verify still active)"]
        G1 -- no --> B2["B2 · Extract & rank requirements<br/><i>Sonnet 5</i>"]
        B2 --> B3["B3 · Roadblocks<br/><i>Sonnet 5</i>"]
        B3 --> B4["B4 · Misalignments<br/><i>Sonnet 5</i>"]
        B4 --> G1b{"Anything<br/>flagged?"}
        G1b -- yes --> SQ["status: scoring_queue<br/>(needs your call — never auto-abandoned)"]
        G1b -- no --> SEL["status: selected"]
        SQ -.->|"batch decision"| B5
        SEL --> B5["B5 · Areas of Expertise + JD Group<br/><i>Sonnet 5</i>"]
        B5 --> B6["B6 · Role Fit Score<br/><i>Opus 4.8 + code rollup</i>"]
    end

    B6 --> G2{"Fit tier?"}
    G2 -- "Low / Not recommended" --> STOP["screened · no tailoring"]
    G2 -- "Proceed / Caution" --> C1

    subgraph C["C · Tailoring (promoted leads only)"]
        C1["C1 · Format & headshot check<br/><i>code</i>"] --> C2["C2 · Map requirements → evidence<br/>builds on B6, targets Good/Weak/No Match<br/><i>Opus 4.8</i>"]
        C2 --> HITL{"Human review<br/>Approve the map"}
        HITL -- "Approve" --> C3["C3 · Draft CV bullets<br/><i>Opus 4.8</i>"]
        C3 --> C4["C4 · Skills section<br/><i>code</i>"]
        C4 --> C5["C5 · CV profile<br/><i>Opus 4.8</i>"]
        C5 --> C6["C6 · Compile 2-page CV<br/><i>code · docxtemplater</i>"]
        C6 --> C7["C7 · ATS rating 0–100<br/><i>Opus 4.8</i>"]
    end

    C7 --> DL["Download .docx / preview PDF"]

    subgraph D["D · Monitor (sub-states on applications.status)"]
        DL --> SENT["Application sent<br/><i>drop the confirmation email</i>"]
        SENT --> RP["response_pending"]
        RP --> G3{"What came back?"}
        G3 -- "invite dropped" --> IV["interview<br/>+ interviewAt typed by hand"]
        G3 -- "decline dropped" --> SO["screened_out → Archive"]
        IV -- "decline dropped" --> SO
    end
```

## A — Acquire

| Step | Note | Model | Input → Output |
| --- | --- | --- | --- |
| **A1** Store job lead | `A1. Store Job Leads.md` | — (capture) | LinkedIn URL/JD → `job_leads(status=captured)` + raw markdown in Storage |

## B — Screen

All B steps read the captured JD; outputs land on `job_leads` / `job_requirements`.

**B runs in two halves, not one pass** (`lib/pipeline/screening.ts`). `runInitialChecks`
(B1→B2→B3→B4) fires automatically from `createLead()` at capture; the G1 gate above is a real
short-circuit, so a posting ≥60 days old reaches `hold` with **no B2–B4 rows in `pipeline_runs` at
all**. A lead nothing flagged auto-advances to `selected`; anything flagged parks at `scoring_queue`
for a human decision — never auto-abandoned. `runScoring` (B5→B6) then runs later, once, over the
whole `selected` pile from the Ready-to-score batch runner — deliberately sequential, so the calls
land seconds apart and hit the warm 1h prompt cache. `runScreening` remains as a back-compat wrapper
that chains both halves.

### The B-phase reorder (CI · *Lead Page as Pipeline Canvas* §2.1)

**Step codes moved; step bodies did not.** Extraction is now **B2** and runs first:

| Was | Now | Step |
| --- | --- | --- |
| B5 | **B2** | Extract Requirements from Job Description |
| B2 | **B3** | Identify Roadblocks |
| B3 | **B4** | Identify Misalignments |
| B4 | **B5** | Translate Requirements to Areas of Expertise and Define JD Groups |

The reason is in the titles, not in the UI: **B5 is called _Translate Requirements to Areas of
Expertise_ and used to run before any requirements existed**, so it necessarily translated raw JD
text — its name and its position had contradicted each other since the note was written. Second, a
hard dependency: B3 can now attach a roadblock to the specific requirement row it blocks (§2.5),
which is impossible if the rows don't exist yet.

Extraction also moved from the batch half into the automatic-at-capture half. Two of these three
calls already ran on every capture in production; the third costs roughly **+$2/month** at 160
captures, and it buys a Map whose requirement side is populated with no manual trigger. Only B5 and
B6 — Areas of Expertise and the Opus scoring pass — remain a batch spend decision.

**`pipeline_runs` history was migrated in lockstep** (`drizzle/0028_reorder_b_phase_steps.sql`).
Without it a lead screened before this change would show a `B2` trace meaning "roadblocks" beside a
`B2` trace meaning "requirements" — the same code silently naming two different steps.

| Step | Note | Model | Output (tool schema) |
| --- | --- | --- | --- |
| **B1** Freshness & saturation | `B1. Capture Posting Freshness and Market Saturation.md` | **code** | days_since_publication, applicant_count, freshness/saturation bands. **Gate:** ≥60 days → `hold`. |
| **B2** Extract requirements | `B2. Extract Requirements from Job Description.md` | Sonnet 5 | `job_requirements[]`: order, rank (Core/Important/Nice), requirement, description, **`source_text`** (the verbatim JD sentence — not the paraphrase in `description`), skills |
| **B3** Roadblocks | `B3. Identify Roadblocks.md` | Sonnet 5 | hard ineligibility across {language, technical, certification, geographic, industry} or `None`, each optionally naming the `requirement_id` it blocks (§2.5) |
| **B4** Misalignments | `B4. Identify Misalignments.md` | Sonnet 5 | flags (**not blockers**) across {values/culture, city, seniority}. Context: `Values & Motives Summary.md` |
| **B5** Areas of Expertise + JD Group | `B5. Translate Requirements to Areas of Expertise and Define JD Groups.md` | Sonnet 5 | 17 ratings (A–Q, **1=Central / 2=Contributing / 3=Peripheral**), `jd_group_primary/secondary`, and the "Key Patterns & CV Tailoring Notes" text (§B step 3 of the note) → `job_leads.key_patterns`. **No ATS** — see below. Now receives B2's requirements, which is what its title always claimed it translated. |
| **B6** Role Fit & Investment Worthiness Score | `B6. Role Fit & Investment Worthiness Score.md` | **Opus 4.8 + code** | per-dimension scores + per-requirement match/score → **code computes overall + tier** |

### ATS is A1's, and no B step's

`ats_system` is set once, at capture, and no B step writes it (CI · *Lead Page as Pipeline Canvas* §2.2a).
The Areas-of-Expertise step (**B5** now, B4 before the reorder) used to detect it, and its value
overwrote A1's whenever non-null — but that step is passed
`JOB DESCRIPTION:\n{jd}` and nothing else, so its answer was always inferred from prose, and ATS
identity isn't in prose; it's in the page chrome. A verified hostname match was being replaced by an
unverifiable guess. Its §C was deleted from the note outright rather than made conditional. A1 owns it end to end: `detectAtsSystem()` on the `jobPostLink` hostname
(`lib/pipeline/capture-enrich.ts`, unit-tested, and the single canonical ATS-name list), then the
capturing agent's inline page extraction filling nulls only at zero marginal cost. A re-check rides
on A1's refresh-without-re-screening hook — the only mechanism that re-reads the page.

### B6 scoring (computed in `lib/scoring`, not by the LLM)

```
overall = 0.35·relevance + 0.20·seniority + 0.20·impact + 0.15·reqAlign + 0.10·ats
reqAlign = Σ(reqScore · weight) / Σ(weight),  weight = {Core:3, Important:2, Nice:1}
```

**Misalignments never gate.** B4's output is awareness, not a blocker: `gateStatusFor` parks a
flagged lead at `scoring_queue` for a human call and nothing is ever auto-abandoned. `B4. Identify
Misalignments` says so twice in bold. Implementing a hard misalignment gate would be a regression
that silently kills viable leads — recorded here so a future pass doesn't "fix" it into one.

Match strength must stay consistent with the score band (Excellent 9–10 … No Match 0–1). Record
the `bullet_bank_version` used. Recommendation tier (Proceed / Caution / Low / Not recommended)
comes from code-owned thresholds. **B6 reads the Master Bullet Bank, not a tailored CV** — this
keeps scoring unbiased and reproducible.

## C — Tailor (only promoted leads)

**"Promote" is a status flip, not a trigger.** `promoteLeadAction` (`app/actions/pipeline.ts`) only sets
`job_leads.status = 'promoted'` — it does not call C1/C2. Both C1 and C2 run together, manually, from
"Map"/"Match the evidence" (`mapEvidenceAction` → `runEvidenceMapping`). C1 has no UI of its own; its one
output (the headshot decision) is folded into the same run trace as C2.

| Step | Note | Model | Output |
| --- | --- | --- | --- |
| **C1** Format & compliance | `C1. Overall Application Content and Format Guidance.md` | **code** | CV format/length, cover-letter required?, **headshot decision** (country/DEI tree), HR contact |
| **C2** Map requirements → evidence | `C2. Map JD Requirements to Supporting Evidence.md` | Opus 4.8 | Builds on B6 rather than re-deriving (CI-034): B6's Excellent/Very Strong picks are carried forward untouched (no model call); the model is targeted only at requirements B6 rated Good/Weak/No Match, to add candidates on top. Merges into `requirement_tailoring[]` — several evidence rows per requirement are allowed (ranked), a stored row is replaced only when new evidence scores strictly higher, and an untouched row still `pending` from a prior run is pruned. → **`approval_status=pending`** |
| ⟶ **Human gate** | — | — | **Approve the whole map in one action** — every row with a valid CV slot is Kept at once. No more per-row triage. |
| **C3** Evidence → CV bullets | `C3. Transform Evidence into CV Bullets.md` | Opus 4.8 | `cv_bullet` per Keep row (7 principles: truthful, natural keywords, strong verbs, real metrics, skill tags, concise) + `requirement_skills` (Job-Lead-facing skills this bullet demonstrates — the bracketed tag) |
| **C4** Skills section | `C4. Build and Manage the Skills Section.md` | **code** | 3–5 categories ×4–8 skills, built primarily from Keep rows' `my_skills` (consistency rule, uncapped) + a requirement-overlap top-up across Skills/STAR Competences/STAR Attributes |
| **C5** CV profile | `C5. Drafting CV Profile (Per Job Lead).md` | Opus 4.8 | 4–7 line profile leading with seniority + core-requirement alignment |
| **C6** Compile CV | `C6. Compile Complete CV Document.md` | **code** | `docxtemplater` fills the 2-page template; space rules enforced as a content budget |
| **C7** ATS rating | `C7. Run Reviewed ATS Matching Rating.md` *(status: dev)* | Opus 4.8 | 0–100 rating + per-requirement breakdown |

## CI — Continuous Improvement

| Artifact | Note |
| --- | --- |
| Procedure | `+ Continuous Improvement Procedure.md` |
| Dashboard method (folded into RoleProof surfaces) | `+ Continuous Improvement Dashboard.md` |
| ~10 initiatives | `Process/CI/*.md` |

Any session can raise an **Accuracy Improvement Tip** (Feedback Loop / Profile Update / Data
Capture / Process Refinement). In the app these become `ci_initiatives` rows. The loop is what
makes the system compound: a tip → a `Process/*.md` edit → new agent behavior, no code change.

## D — Monitor

Once a CV goes out, the lead sits at `job_leads.status = 'applied'` and **stays there for the whole
D-phase**. What changes is `applications.status`, a sub-state on the one row per `(owner, lead)`.
That split is deliberate: `job_leads.status` is the field every board consumer keys off, and these
are moments inside "applied", not new lead-level stages.

| `applications.status` | Set by | Surface |
| --- | --- | --- |
| `downloaded` | opening `/api/cv/[leadId]` | — (tracking only) |
| `response_pending` | "Application sent" — a dropped confirmation email, or the no-email manual confirm | Applications |
| `interview` | a dropped interview invite; `interviewAt` is then typed by hand | Applications |
| `screened_out` | a dropped decline | Archive |

```
response_pending ──(invite)──▶ interview ──(decline)──▶ screened_out
        └───────────────(decline)───────────────────────────▶
```

The three transitions are all drag-and-drop: the email is dragged out of Outlook onto the row,
stored under `applications/{leadId}/`, and the link column gets an href to this app's own
owner-scoped copy (`/api/applications/[leadId]/email/[file]`). Nothing is typed except the
interview date, which is a future fact no email carries. A drop with no file or link in it opens a
short manual form instead, pre-filled with today — the gesture works either way.

`screened_out` rows leave the Applications list and appear in the Archive in the same move, with
no confirmation step; the reply-assist pop-up that follows is only a reply assist, and dismissing
it reverts nothing.

Still on the drawing board:

| Step | Note | State |
| --- | --- | --- |
| **A0** Monitor target companies | `Process/Development/A0. Monitoring Target Companies.md` | idea |

---

*Implementation lives in `lib/pipeline/*` (one module per step) and `lib/scoring/*` (the
deterministic rollups). See [`ARCHITECTURE.md`](ARCHITECTURE.md).*
