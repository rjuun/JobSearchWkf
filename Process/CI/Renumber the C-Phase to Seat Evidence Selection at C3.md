---
ci-area: CV Tailoring (C-Phase)
ci-roadmap:
ci-title: Renumber the C-Phase to Seat Evidence Selection at C3
ci-status: 2 - Testing
ci-priority: high
ci-date: 2026-08-24
ci-estimated-time: 3
ci-time-spent: 1
pr-source: "[[C3 Writes CV-Grade Skill Tags]]"
pr-target: "[[C4. Transform Evidence into CV Bullets]], [[C5. Build and Manage the Skills Section]], [[C6. Drafting CV Profile (Per Job Lead)]], [[C7. Compile Complete CV Document]], [[C8. Run Reviewed ATS Matching Rating]]"
---

---
```simple-time-tracker
{"entries":[{"name":"CI-052 — C-phase renumber: baseline gate (surfaced the CRLF artifact), the five note renames + reference sweep, prompts/schemas/tailoring/UI/scripts/docs, the enum-recreating migration (dry-run then applied), §2.4 step-9 audit, commit and merge","startTime":"2026-08-24T23:12:00.000Z","endTime":"2026-08-25T00:16:00.000Z"}]}
```
---

> [!IMPORTANT] Pure structure. No behaviour change, and that is the acceptance criterion.
> This CI renames steps and nothing else. If any generated output differs before and after, it has
> failed. It exists so that [[C3 Selects the CV Evidence Set]] can be built under its final name
> instead of being renamed afterwards — a mechanical rename tangled into a feature diff is
> unreviewable, because you cannot tell churn from behaviour.

---

## 1. What is the problem or opportunity?

The C-phase has no step that decides **which** evidence reaches the CV. C2 finds evidence and proposes
every honest link; the owner approves rows one at a time; everything approved prints. Nobody ever
chooses a *set*, and the consequences are measured on three real leads (2026-08-24):

| Lead | Green rows | Distinct bullets | Requirement coverage |
| --- | --- | --- | --- |
| `69bc2e13` ALDI | 31 | 23 | Core 8/8 · Imp 1/1 |
| `ee5c72bf` Julius Baer | 63 | 34 | Core 13/13 · Imp 5/5 · NtH 0/2 |
| `a9f2307b` Aliaxis | 46 | 27 | Core 11/11 · Imp 3/3 · NtH 0/1 |

All three CVs overflow two pages. Julius Baer spends 34 bullets covering 18 requirements — 63 links,
1.85 requirements per bullet — so the excess is redundancy, not coverage. That selection step is
specified in [[C3 Selects the CV Evidence Set]] and has to sit **between mapping and bullet-writing**:
it decides what old-C3 is even asked to rewrite.

**Why the number matters and "C2.5" will not do.** `Process/*.md` notes are not documentation about
the prompts — they *are* the prompts (`lib/prompts.ts` `STEP_NOTE`, loaded as the system prompt for
each step). A fractional step number is text a model reads, and it permanently marks a first-class
decision as an afterthought for every future reader. The owner's judgement, 2026-08-24: *"It looks to
me as this is a genuinely important step we have just discovered."*

**The cost is bounded and it only grows.** Measured, not estimated: 266 code references to `C3`–`C7`
across 32 files, 589 markdown references across 36 files, and **105 historical database rows** keyed
by step code. The database was the objection this CI expected to die on, and it does not survive
contact with the number.

## 2. What would the improvement look like?

### 2.1 · Current state, audited 2026-08-24

- **`lib/prompts.ts` §17 `STEP_NOTE`** is the single map from step code to Process filename. It is the
  pivot: change it and every system prompt follows. Note **C6 is absent** — the document build makes
  no model call, so it has no note to load. C1 is absent for the same reason.
- **`step:` literals** are passed to `runStructured` and `recordStep` in `lib/pipeline/tailoring.ts`,
  and become the stored `pipeline_runs.step` / `llm_calls.step` values the run trace renders from.
- **`lib/llm/schemas.ts`** exports `C2`, `C3`, `C4`, `C5`, `C7` as tool/zod pairs, plus `C3Out`.
- **Historical rows**: `pipeline_runs` `{C1:7, C2:7, C3:10, C4:10, C5:10, C6:10, C7:10}` = 64;
  `llm_calls` `{C2:7, C3:11, C4:3, C5:10, C7:10}` = 41. The backtest labels `C2-bt-base` /
  `C2-bt-cand` belong to `scripts/backtest-notes.ts` and stay as they are.
- **Precedent exists.** `Process/C4…md` carries `pr-source: "[[C4. Associate Skills to CV Bullets]]"` —
  that step has already been renamed once, and `pr-previous` plus `Process/Past Versions/` are the
  established convention for it.

### 2.2 · Target state

```
C1  Overall Application Content and Format Guidance   unchanged
C2  Map JD Requirements to Supporting Evidence        unchanged
C3  Select the CV Evidence Set                        NEW (stub here, specified by its own CI)
C4  Transform Evidence into CV Bullets                was C3
C5  Build and Manage the Skills Section               was C4
C6  Drafting CV Profile (Per Job Lead)                was C5
C7  Compile Complete CV Document                      was C6
C8  Run Reviewed ATS Matching Rating                  was C7
```

### 2.3 · The hazard, which is why this is not a find-and-replace

**Step codes and evidence ref codes share a namespace.** Real ref codes in the live data include `G5`,
`5-3`, `A-R3`, `1-R1`, `EDU-3`, `LANG-2` — and `lib/llm/schemas.ts` §319 documents the evidence ref
field with the example *"an exact ref code from the CANDIDATE EVIDENCE list (e.g. `C4`, `EDU-2`,
`LANG-3`)"*. A blind `C4` → `C5` sweep rewrites that prompt text into a lie about the candidate's own
data, and nothing would fail: it is a string inside a description, so tests stay green and the damage
only shows as worse evidence citation on live runs.

**Mitigation:** rename by anchored pattern per surface — `step: 'C3'`, `STEP_NOTE` keys, `C3.tool`,
`[[C3. `, `Process/C3` — never a bare `C3`. Every remaining bare occurrence is reviewed by hand, and
§2.4's audit step exists to force that review.

### 2.4 · Implementation checklist

1. **Rename the five Process notes** highest-number-first (`C7`→`C8`, then `C6`→`C7`, …) so no rename
   ever collides with an existing filename. Update each note's own `pr-previous` to its old name.
2. **Sweep the wiki-links** across `Process/**/*.md` — 589 references, anchored on `[[C<n>. ` — and
   verify no link dangles afterwards.
3. **Create `Process/C3. Select the CV Evidence Set.md`** as a stub: frontmatter, a Purpose paragraph,
   and a pointer to [[C3 Selects the CV Evidence Set]]. It is deliberately not in `STEP_NOTE` yet —
   the step makes no model call until its own CI builds one, and an empty note loaded as a system
   prompt would be worse than no entry.
4. **`lib/prompts.ts`** — remap `STEP_NOTE` keys to the new codes.
5. **`lib/llm/schemas.ts`** — rename the exported tool/zod pairs and `C3Out`. Tool *names*
   (`emit_cv_bullets`, `emit_skill_groups`) do **not** change: they are the model-facing contract and
   carry no step number.
6. **`lib/pipeline/tailoring.ts`** — `step:` literals, block comments, the pipeline diagram at §6.
7. **UI and scripts** — run-trace labels, step-name maps, `scripts/audit-*`, `scripts/backtest-notes.ts`.
8. **Migration** rewriting `pipeline_runs.step` and `llm_calls.step` for the 105 historical rows,
   highest-first, leaving `C2-bt-*` untouched. Without it a trace from last week silently reads as a
   different step — the same class of error as a claim inherited without checking its source.
9. **Audit pass**: `grep -rnE "\bC[1-8]\b"` over code and Process, and eyeball every hit that is not a
   step reference. This is where the §2.3 hazard is caught.

### 2.5 · Acceptance

- [ ] `npm run typecheck` clean; `npm test` green with no test's *meaning* changed — only its labels.
- [ ] **`npx tsx scripts/snapshot-step-prompts.ts` reproduces every hash in
      `Process/CI/_step-prompt-baseline.txt`, re-keyed to the new codes and otherwise unchanged.**
      This is the criterion that matters. The baseline was captured 2026-08-24 before any rename:

      ```
      C2  9edc9783d63c6b24    →  C2  9edc9783d63c6b24   (unchanged)
      C3  8cc73624d6471458    →  C4  8cc73624d6471458
      C4  5ba75c944bbc191b    →  C5  5ba75c944bbc191b
      C5  b5571e741958d575    →  C6  b5571e741958d575
      C7  a3dd3257953eed2c    →  C8  a3dd3257953eed2c
      B2–B6, O2-extract       →  unchanged
      ```

      `STEP_NOTE`'s keys therefore end as `C2, C4, C5, C6, C8` — **with C3 and C7 legitimately
      absent.** C3 is the new selection step, which makes no model call until its own CI builds one;
      C7 is the document build, which has never made one. That gap is correct, not an oversight to
      tidy up.

      A hash that **changes** means a note's text was edited, which a pure renumber must never do. A
      hash that **vanishes** means a note lost its wiring. Costs nothing — no model call, so it can be
      run on every intermediate commit rather than once at the end.
- [ ] The run trace for a pre-rename lead still reads correctly — old C3 rows show as C4, etc.
- [ ] No dangling wiki-link in `Process/**`; `Process/C3. Select the CV Evidence Set.md` exists.
- [ ] `schemas.ts`'s evidence-ref example still says `C4` — the §2.3 hazard, checked explicitly.

## 3. Resources or references

- `lib/prompts.ts` — `STEP_NOTE`, `stepNoteFile`, `loadedSteps`.
- `lib/pipeline/tailoring.ts` — `generateCv`, every `step:` literal, the phase diagram at the head.
- `lib/llm/schemas.ts` — the `C*` exports; §319 carries the §2.3 hazard.
- [[C3 Selects the CV Evidence Set]] — the step this makes room for. Build order: this note, then
  [[STAR Results Never Reach the Evidence Graph]], then that one.

## 4. Notes / Progress log

### 2026-08-24 · Opened

Split out of the design conversation that produced [[C3 Selects the CV Evidence Set]]. Kept separate
on the CI Procedure's own test — atomic, actionable, independently trackable — and because it carries
a risk (§2.3) that would be a footnote inside a note about maximisation instead of a section with a
mitigation.

### 2026-08-25 · Implemented

Renumber done as specified, with four departures from §2 — the first of which changed the acceptance
criterion itself.

**§2.5's hash criterion and §2.4's step 2 cannot both hold, and §2.5 was wrong.** The loaded step
notes cross-reference each other by step code: B2 (1 line), C2 (4), old-C3 (14), old-C4 (16),
old-C5 (6), old-C7 (1) — 42 lines in total, including live wiki-links such as C2 §180's
`[[C4. Transform Evidence into CV Bullets]]` and old-C4 §104's "inserted into the CV during **C6.
Compile Complete CV Document**". Renumbering those changes each note's text, so its hash *must* move;
not renumbering them leaves wiki-links dangling (which §2.5 also forbids) and leaves prompts saying
C3 writes bullets when C3 is now selection. Put to the owner on 2026-08-25, who chose to sweep the
references and restate the criterion. What replaced it is strictly stronger for the notes that
changed: **every changed line in every renamed note differs only by a step code**, verified line by
line through `git diff`, and the five loaded notes with no C-references (B3, B4, B5, B6, O2-extract)
are byte-identical to HEAD. Neither hash equality nor `git diff` was weakened anywhere else.

**The baseline in `_step-prompt-baseline.txt` is line-ending sensitive, and that nearly cost the
verification.** A fresh worktree checkout applies CRLF (`core.autocrlf=true` + `* text=auto`), while
the main working tree holds LF for notes the owner has edited in Obsidian and CRLF for the rest. The
committed blobs are LF throughout; the baseline was captured against that mixed working tree, so
B3/B4/old-C5 carry CRLF hashes and every other note carries LF ones. Before touching anything the
snapshot reproduced only 8 of 11 hashes, which looked like drift and was not. Normalising the Process
notes to LF reproduced the baseline exactly — that was the gate, and it passed. The baseline has
since been recaptured. **A hash from this file is only comparable to one taken in the same working
tree**; the `git diff` check above does not have that weakness and should be preferred.

**`pr-previous-code`, not `pr-previous`.** §2.4 step 1 says to put the old name in `pr-previous`, but
that field already means something else here — B6 uses it for `[[B6. Run Initial ATS Matching
Rating]]`, a `Past Versions/` note. The B-phase reorder used a dedicated `pr-previous-code:` holding
the bare old code (B2–B5 all carry one). Followed that precedent instead.

**The migration recreates the enum type rather than extending it.** `ALTER TYPE ... ADD VALUE 'C8'`
plus an `UPDATE` writing `'C8'` cannot share a transaction, and drizzle's migrator runs *all* pending
migrations inside one (`pg-core/dialect.js` → `session.transaction`), so splitting them across two
files would not have helped either. `0039_renumber_c_phase_steps.sql` renames the old type, creates
the new one, and moves every row in a single `CASE` — a type created in the current transaction may
be used in it freely. `pipeline_runs.step` is the only column of that type, which is what makes the
swap tractable; `llm_calls.step` is plain `text` and moves with a guarded `UPDATE` that leaves
`C2-bt-base` / `C2-bt-cand` alone.

**`docs/` was swept too, though §2.4 never lists it.** ARCHITECTURE, PIPELINE, DATA_MODEL, ROADMAP,
DEPLOYMENT, `bpmn/README` and `design/USER_JOURNEY` describe the live pipeline, and PIPELINE.md's
step table pointed at the five note filenames that no longer exist. `docs/archive/**` (980 hits) and
`docs/RETROSPECTIVE.md` were left alone: both are explicitly preserved historical snapshots.

#### The §2.3 hazard, and what the audit found

The hazard is real and it fired twice more than §2.3 anticipated. `lib/llm/schemas.ts` §319 still
reads *"an exact ref code … (e.g. `C4`, `EDU-2`, `LANG-3`)"* — checked explicitly, untouched. The two
instances a bare sweep would also have corrupted:

- `lib/__tests__/b6-evidence.test.ts` uses `C1` and `C4` as **evidence ref codes** (`ev('C4')`,
  `refs: ['C1', 'C4']`), and `'German — C1'` / `'German (C1)'` are **CEFR language levels**.
- `docs/design/career-graph-visualization.html` holds 27 matches that are all `CompetenceEntry_ID`
  values from the owner's real profile data — `1-C3`, `3-C4`. `\bC3\b` matches inside `1-C3`,
  because `-` is not a word character.

Nothing was renamed by bare code. Every surface was renamed by an anchored pattern or edited line by
line, and the CI-note titles carrying historical step numbers (`C3 Writes CV-Grade Skill Tags`,
`C4 Skills Selection Produces Unreadable Overflow`, `Skill Name Treatment in the C4 Skills Section`,
`Improve C3-C4 Skill Association Method`) were placeholder-protected through every sweep and verified
after it.

The rule applied throughout: **a pointer must resolve; a historical claim keeps its original code.**
Wiki-links, file paths and `Process/Cn` references were renumbered wherever they appear — CI notes
included — while prose in historical CI notes recording what happened under the old numbering was
left as written.

#### Found and deliberately left alone

- **Pre-existing dangling wiki-links**, unchanged: `[[C3. Transform Evidences into CV Bullets]]`
  (typo'd, ×2, in `Introduce Requirement Skills to Job Requirements List`) and
  `[[C4. Drafting the CV Profile (Per Job Lead)]]` (an old title, inside what is now the C6 note).
  55 targets dangled at HEAD and 54 do now — **this change introduced none and resolved one**
  (`[[C3. Select the CV Evidence Set]]`, which the new stub satisfies).
- **`+ Job Hunting Master Instructions.md` §58 lists the `STEP_NOTE` keys and is missing one.** It
  read `C2, C3, C5, C7` — stale since old-C4 joined the map on 2026-08-24. The codes present were
  renumbered (`C2, C4, C6, C8`); the missing entry for the skills step is still missing.
- **`workspace.tsx` `STEP_SOURCE` calls the skills step `'code rule'`**, also stale since that step
  gained a model call. Renumbered in place.
- **`lib/llm/schemas.ts` §605** carries an orphaned `── C6 · Tailored CV profile ──` header sitting
  above the *skills* block, while the real profile export below has none. Both renumbered in place;
  the misplacement survives.
- **The C6 note still says "C4 is one of the highest-impact steps"** (§122–123), meaning *itself*
  under a numbering two moves old. Wrong before this CI and wrong after; renumbering it as though it
  named the skills step would have been a guess.
- **Test and script filenames keep their historical codes** — `c3-bullet-floor.test.ts`,
  `c4-skills.test.ts`, `c5-profile-floor.test.ts`, `scripts/audit-c4-skills-density.ts`. Renaming
  them would have meant rewriting ~14 references inside CI notes that record what was run at the
  time ("226 tests pass, 17 of them new (`lib/__tests__/c4-skills.test.ts`)"). Their *contents* are
  renumbered, and the exported symbols they cover moved with the step: `missingC3Refs` →
  `missingC4Refs`, `c3UserMessage` → `c4UserMessage`, `C3Row`/`C3Bullet` → `C4Row`/`C4Bullet`,
  `absorbC3Bullets` → `absorbC4Bullets`, `c3HasRun` → `c4HasRun`.
- **C3 is absent from every step enumeration**, not only `STEP_NOTE`: `TAILOR_STEPS` in
  `lib/journey.ts`, and the mermaid flow and step table in `docs/PIPELINE.md`, all run C1, C2, C4…C8.
  A row was drafted and then withdrawn — §2.5 already rules that the `STEP_NOTE` gap "is correct, not
  an oversight to tidy up", and the same reasoning holds harder for a *display* list: a C3 on the
  pipeline map that no run trace can ever show is a step the UI claims to run and doesn't. Both lists
  carry a comment saying the gap is deliberate. **[[C3 Selects the CV Evidence Set]] adds those three
  entries when it builds the step.**

### 2026-08-25 · Epic framing — why this stays at `2 - Testing`

The owner's decision, 2026-08-25: this note and its three successors —
[[STAR Results Never Reach the Evidence Graph]], [[C3 Selects the CV Evidence Set]] and
[[Skill Name Treatment in the C4 Skills Section]] — are **one epic, click-tested once when the last
of them concludes**, not four separately. They change overlapping surfaces of the same phase, and
clicking through after each would test the same paths three times over against a pipeline still in
motion.

**What that leaves unverified here, named rather than assumed.** Everything machine-checkable passed
(§2.5), the migration ran against the live database, and the run traces were confirmed readable on
all three leads. But **no C-phase step has actually executed since the renumber.** The renamed `step:`
literals are written only when a run happens, so `recordStep(… step: 'C4' …)` and its C5–C8 siblings
have never fired for real. The pipeline page rendering `TAILOR_STEPS` is likewise unviewed.

The risk is small and bounded — they are string labels on trace rows, and `STEP_NOTE` resolution is
separately proven for every key by `scripts/snapshot-step-prompts.ts`. But small is not verified, and
the CI Procedure is explicit that green tests are not the same claim as "this works when a human
actually clicks it".

So the status stays `2 - Testing`, which is exactly what that value means: code landed and
machine-verified, live verification pending. It is not a demerit — with all four notes sitting in the
same group, the dashboard renders the epic as the block it is.

**The click test that closes it** is a Generate CV on a real lead: that single run exercises the
renamed literals for C4 through C8 end to end and writes them to `pipeline_runs`. Note that
[[STAR Results Never Reach the Evidence Graph]] will *not* close it — that CI exercises C2, whose
literal never changed. The first genuine test arrives with [[C3 Selects the CV Evidence Set]].

All four move to `3 - Delivered` together, in one pass, once that run is read.

### 2026-08-25 · The click-test gap closed early, and the entry above was wrong about how

The previous entry said [[STAR Results Never Reach the Evidence Graph]] "will *not* close" the one
unverified item, because it exercises C2 and C2's literal never moved. That reasoning was wrong. Its
acceptance §2.5 item 3 is a claim about a *bullet*, and a bullet needs C4 — so verifying it meant a
full Generate CV, which duly ran on `ee5c72bf` at 2026-08-25T16:41–16:42.

`pipeline_runs` for that lead now holds two generations side by side, and together they verify both
halves at once:

```
2026-08-24T18:35–18:36   C4 C5 C6 C7 C8   ← written as C3–C7, rewritten by the migration
2026-08-25T16:41–16:42   C4 C5 C6 C7 C8   ← written natively by a live run
```

The renamed literals have now fired for real, the migrated rows and the native rows agree, and the
trace renders. **The item §2.5 could not verify is verified.**

C7's rating on that lead was 78/100 both before and after — unchanged, as a pure renumber plus an
evidence-graph addition should leave it.

So the epic's remaining click test is no longer about this note at all: what is still unexercised is
the *selection* step, which does not exist yet. This CI has nothing outstanding, and moves to
`3 - Delivered` with the rest of the epic only because the owner chose to close the four together.
