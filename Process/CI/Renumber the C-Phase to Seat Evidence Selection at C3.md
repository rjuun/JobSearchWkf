---
ci-area: CV Tailoring (C-Phase)
ci-roadmap:
ci-title: Renumber the C-Phase to Seat Evidence Selection at C3
ci-status: 0 - Idea
ci-priority: high
ci-date: 2026-08-24
ci-estimated-time: 3
ci-time-spent: 0
pr-source: "[[C3 Writes CV-Grade Skill Tags]]"
pr-target: "[[C3. Transform Evidence into CV Bullets]], [[C4. Build and Manage the Skills Section]], [[C5. Drafting CV Profile (Per Job Lead)]], [[C6. Compile Complete CV Document]], [[C7. Run Reviewed ATS Matching Rating]]"
---

---
```simple-time-tracker
{"entries":[]}
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
      C5  b5571e741958d575    →  C6  b5571e741958d575   (if C6 joins STEP_NOTE; today C5's note is the
                                                         profile step and C6 makes no model call)
      C7  a3dd3257953eed2c    →  C8  a3dd3257953eed2c
      B2–B6, O2-extract       →  unchanged
      ```

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
