---
ci-area: Screening → Tailoring pipeline design
ci-roadmap:
ci-title: Make C2 build on B6 instead of re-deriving the map
ci-status: 9 - LLM Run Required
ci-priority: high
ci-date: 2026-08-04
ci-estimated-time: 6
ci-time-spent: 0
pr-source: "[[Complete Required Lists on the Remaining Strict Tool Schemas]]"
pr-target:
---

---
```simple-time-tracker
{"entries":[]}
```
---

> [!IMPORTANT] Start here — this note is self-contained
> Written to be picked up in a **fresh chat with no prior context**. This is a **design change, not a bug
> fix**: the B6 → C2 hand-off was always conceived as incremental and was never implemented that way.
> Read §1 and §2.1 before touching code — §2.1 is the owner's design and it is not negotiable plumbing,
> it is the point of the CI.
>
> **Do `[[Guard C5 Against Empty Tailored Profile]]` first** — it is an hour and independent.

---

## 1. What is the problem or opportunity?

### 1.1 The intended design

B6 and C2 were conceived as two passes of increasing depth over the same question — *which evidence
supports which requirement?*

- **B6** is the cheap, narrow pass. It matches requirements against a limited set of curated CV bullets
  (the Master Bullet Bank) and produces a per-requirement `matchStrength` — `Excellent`, `Very Strong`,
  `Good`, `Weak`, `No Match` — plus an overall fit score.
- **C2** is the deep, expensive pass. It searches the **whole evidence graph** — STAR actions,
  responsibilities, bank bullets, education, languages — for cruder, less-polished evidence that could
  raise a requirement the cheap pass could not satisfy.

The intended flow is *repair and improve*: B6 says where you stand, C2 goes digging where standing is poor.

### 1.2 What the code actually does

**None of that hand-off exists.**

1. **C2 never reads B6's output.** B6 writes one `requirement_evidence` row per requirement
   (`evidenceRef`, `evidenceKind`, `evidenceText`, `cvPosition`, `note`) at `lib/pipeline/screening.ts`
   ~742. `lib/pipeline/tailoring.ts` does not reference that table anywhere. C2 calls
   `gatherEvidence(ownerId)` over the entire graph and starts from zero on every requirement, including
   the ones B6 already rated `Excellent`.
2. **C2 destroys everything before it starts.** `lib/pipeline/tailoring.ts` ~240, the *first* statement in
   the C2 block, before the model is even called:

   ```ts
   await db.delete(requirementTailoring).where(and(eq(requirementTailoring.jobLeadId, leadId), …));
   ```

3. **That delete takes the human's review with it.** `approvalStatus` (Keep / Maybe / Drop) lives on
   `requirement_tailoring`. Every re-run of C2 resets all of it to `pending`. `generateCv` only consumes
   rows where `approvalStatus === 'green'`, so a re-run silently discards the one part of the pipeline that
   is entirely human judgement.

So a C2 re-run throws away the prior map **and** the review decisions, having never used B6's work in the
first place — then pays Opus rates to re-derive from scratch what it already knew.

### 1.3 Why this matters now

Three compounding reasons:

- **Cost and time.** Re-deriving `Excellent` and `Very Strong` requirements is spend with no possible
  upside. The owner's stated objective is explicit: *"first eliminate things where I am Weak, then improve
  things where I am only Good. Requirements where I am Very Strong or Excellent will very likely be left
  aside because the marginal effort-to-scoring improvement ratio will simply not pay off."*
- **It makes the C2 collapse defect much worse than it needs to be.**
  `[[Guard C2 Against Silent Evidence-Map Collapse]]` measured C2 degrading roughly 1 call in 12 to a
  single link. Under delete-then-replace, that collapse is *destructive*. Under an incremental C2, the
  same collapse costs nothing — you simply gain nothing that run. **This CI removes most of the damage the
  guard CI was written to contain.**
- **It blocks iterative working.** The owner cannot re-run C2 to dig further on a stubborn requirement
  without losing every approval already given.

---

## 2. What would the improvement look like?

### 2.0 Scope

**In scope:** targeting C2 by B6's per-requirement `matchStrength`; replacing the wholesale delete with a
merge; preserving `approvalStatus`; the stale-row rule in §2.4; and the measurement in §2.6.

**Out of scope — separate CIs:**
- **C2's collapse floor** — `[[Guard C2 Against Silent Evidence-Map Collapse]]`. Do it *after* this;
  the floor's design depends on whether C2 is incremental. Note that CI's "delete-after-validate" item
  becomes moot once there is no wholesale delete.
- **C5's floor** — `[[Guard C5 Against Empty Tailored Profile]]`. Independent, do it first.
- **Retiring `job_requirements.requirement_group`** — pre-existing duplicate column.

### 2.1 The design — B6's matchStrength decides where C2 digs

**This is the owner's design and the core of the CI.** It also dissolves the anchoring risk that would
otherwise dominate: showing C2 what B6 already found is not a contamination to be minimised, it is the
targeting signal.

| B6 `matchStrength` | What C2 does |
| --- | --- |
| `Excellent`, `Very Strong` | **Carry forward, do not re-search.** Marginal effort-to-score ratio does not pay. |
| `Good` | **Attempt to improve.** Look for evidence that would lift it. |
| `Weak`, `No Match` | **Dig hardest.** This is where the deep pass earns its cost. |

Consequences worth stating explicitly:

- The C2 prompt shrinks. Only the requirements in the lower tiers need the deep search, so input tokens and
  the collapse surface both drop.
- **The design trusts B6's judgement.** An over-confident `Very Strong` is never revisited. That is an
  accepted trade — the Map shows the user every rating, so a forced re-dig is a UI affordance, not a
  pipeline behaviour. Consider whether the tier boundary should be user-adjustable per lead.
- **This depends on B6 being trustworthy**, which it now is: B6 gained a re-ask-then-refuse collapse guard
  (`lib/pipeline/screening.ts` ~636), so a partially-judged lead throws rather than storing fabricated
  mid-scores. Without that guard this design would propagate B6's silence as "nothing to improve".

### 2.2 The replacement rule

The owner's rule, and it is precise enough to implement directly:

> A row is deleted **only** when new evidence scores higher for that requirement than the evidence already
> stored.

So the merge, per requirement:

- **New evidence stronger than stored** → replace. `matchStrength` is ordinal
  (`Excellent > Very Strong > Good > Weak > No Match`); `lib/scoring.ts` already has
  `matchStrengthToScore` / `matchStrengthForScore` — **use those, do not invent a second ordering.**
- **New evidence not stronger** → keep what is there. Do not append a weaker duplicate.
- **Requirement had no row** → insert.
- **C2 returned nothing for a requirement that has a row** → keep the row. Silence is not a verdict.

**Open question to settle before coding:** `Process/C2` §A.6 permits *one row per reference* — several
pieces of evidence may legitimately support one requirement. A strict "replace" collapses that to one.
Decide whether the rule is "replace the weakest row" or "keep up to N rows per requirement, ranked". The
current write path already dedups to one row per requirement (`seen` at ~267), so replacing preserves
today's behaviour; the many-to-many reading would be a change.

### 2.3 Preserving the review

Carry `approvalStatus` forward for every row that survives the merge. Only a genuinely replaced row resets
to `pending` — the evidence changed, so the judgement has to be made again.

Match rows on `(requirementId, evidenceRef)`. **Check first whether a unique constraint exists** on
`requirement_tailoring` for that pair; a clean upsert may need a small migration, which is the main thing
that could push the estimate.

### 2.4 The stale-row rule

The owner is right that **job requirements never change** — the posting is published and static; what
changes is time-since-publication and applications-received. The orphan risk comes from somewhere else:

**B2 re-extraction.** `lib/pipeline/screening.ts` ~388: when a lead's stored extraction is too thin, the
B2 guard deletes `requirementEvidence` **and** `jobRequirements` and re-extracts, producing new rows with
new ids. It does **not** delete `requirementTailoring`. Today that orphaning is invisible because C2 wipes
the table at the start of its next run. Remove the wipe and the orphans become permanent — rows pointing at
requirement ids that no longer exist.

**But the deeper question is why re-extraction can reach a tailoring lead at all**, and the answer is a
missing guard rather than a missing cascade. The owner's framing: *"considering the work of each procedure
was properly executed, why should we have a re-screening/re-scoring at all? Why should we allow the
deletion of job requirements and/or requirement tailoring during the B-phase?"*

**The codebase already agrees with him.** `refreshFreshnessAction`'s own doc comment in
`app/actions/pipeline.ts` states the design:

> *B1 only. The re-screen affordance for a lead that has been sitting in the queue — elapsed time is the
> only B1 input that changes, and B2–B6 are judgments over static JD text, so re-running them would just
> re-spend LLM calls for the same answer.*

That is exactly right, and it is what B1's `refreshFreshness` exists for. The problem is that the *other*
entry points are not gated to match:

- `runInitialChecksAction` documents itself as an error-recovery path — "the manual path for a lead that
  landed at `captured` because the capture-time call failed, and the 'Screen anyway' override for a lead
  the B1 gate held". Recovery, not routine.
- `runScreeningAction` is the back-compat all-six wrapper.
- Both call `requireScreenableLead`, which checks **only** that the lead exists and that `jdText` is at
  least 80 characters. **There is no status guard.** Nothing stops either action running on a lead that is
  already `promoted` and carrying human-approved tailoring rows.

And B2's re-extraction is itself a **back-catalogue repair mechanism**, not steady-state behaviour: the
`tooThin` branch exists to clear thin extractions left by the pre-guard era. Once every lead has a healthy
extraction it never fires again. It is currently living permanently in the capture path.

So there are three candidate fixes, and the third is the one the owner's question points at:

1. Have B2's re-extraction branch delete `requirementTailoring` alongside `requirementEvidence` — it
   already accepts that stranding rows is wrong, and this is the same argument.
2. Have C2's merge drop rows whose `requirementId` no longer resolves.
3. **Gate the B-phase re-run actions on lead status** so re-extraction cannot reach a lead that has
   progressed to tailoring. A lead past `promoted` should expose the B1-only refresh, and re-screening it
   should require a deliberate, warned action that states what will be discarded.

**(3) is the right primary fix** — it removes the cause instead of cascading the damage, and it matches the
design already written into `refreshFreshnessAction`. (1) is a sensible belt-and-braces for the case where
a re-screen *is* deliberately confirmed. (2) is the weakest: it leaves the deletion in place and makes C2
responsible for cleaning up after a step that should not have run.

Worth checking while implementing: whether `runScoringAction` (B5/B6) has the same exposure. Its doc
comment says it is "safe to re-invoke from the top on a stuck lead (B4/B6 overwrite, B5 skips
re-extraction)" — so it is likely benign, but confirm rather than assume.

> [!NOTE] Implemented 2026-08-06 — see §4 for the full account
> **(3)** is done: `runScreeningAction`, `runInitialChecksAction` and `runScoringAction` all now block by
> default on `promoted`/`tailoring`/`ready`/`applied` and require an explicit `force` override, confirmed
> in the UI after showing what's at stake. **(1)** was also added as the belt-and-braces this section
> recommends, now that (3) means it can only fire on a deliberately confirmed re-screen. **(2)** was not
> built — it's C2's merge logic, which doesn't exist yet in this codebase state (see §4); moot until it
> does, and the CI note's own §2.0 scope already treats it as unnecessary once (3) is in place.

### 2.5 The one remaining risk

**Re-proposed rejected evidence.** This cannot arise on a first pass — B6 offers no approval step, and C2
is the first point at which the user has any say. It arises on a **C2 re-run after review**: mark a row
Drop, re-run C2 to dig further, and the same evidence may come back as `pending`.

The §2.2 rule mostly handles it — a dropped row is only re-proposed if C2 found the same evidence *and*
scored it higher. But "Drop" is a human judgement about applicability, which does not track `matchStrength`
at all. Decide: does a `red` verdict suppress that `(requirementId, evidenceRef)` pair on future runs, or
does it return as `pending`? Suppression is the smaller surprise; it needs the rejected pair to persist
somewhere rather than being deleted.

### 2.6 Measurement

The plumbing is not the deliverable — the question is whether targeting produces better maps for less
money. Both halves are measurable, and one is free.

**Free, no API calls:**
- Re-run `npx tsx scripts/audit-strict-schemas.ts` (should stay clean).
- On a lead with an existing map: run C2 twice and confirm the second run preserves `approvalStatus`,
  changes only rows where evidence genuinely improved, and leaves `Excellent`/`Very Strong` rows untouched.
  This is the acceptance test for §2.2 and §2.3 and needs no live model.

**Live, narrow — budget is ~US$17 and a 147-lead re-screen is planned:**
- `scripts/backtest-notes.ts` builds C2's user message from the production `c2UserMessage` builder
  (`lib/pipeline/tailoring.ts` ~64) so the harness cannot drift from production. **Because of that, a code
  change to `c2UserMessage` changes both arms** — to A/B the targeting you must add a variant flag to the
  harness, not just edit the note. Budget for that.
- Always `--dry-run` first (omit `--apply`): it resolves the cohort and prints the call count for free.
- `--apply --steps C2 --runs 2` is 12 calls, roughly $1–1.50.
- **Judge by collapse count, not mean coverage** — the variance exceeds the effect at low n.
- The comparison that matters: for requirements B6 rated `Weak`/`Good`, does targeted C2 return *stronger*
  evidence than untargeted C2? Plus input tokens per run, which should fall.

### 2.7 Acceptance criteria

- [ ] C2 reads `requirement_evidence` and tiers requirements by B6 `matchStrength` per §2.1
- [ ] Merge replaces a row only when the new evidence scores higher, using `lib/scoring.ts`'s existing
      ordinal helpers
- [ ] `approvalStatus` survives a re-run for every unreplaced row — proven by the free double-run test
- [ ] Wholesale `delete(requirementTailoring)` removed from the C2 block
- [x] Stale-row rule implemented per §2.4, with the choice justified in §4 — option (3) (the gate) plus
      option (1) (belt-and-braces) as of 2026-08-06; §2.1–§2.3's merge/tiering (and therefore option (2))
      are still open, see §4
- [ ] Decision recorded in §4 for the §2.2 one-row-vs-many question and the §2.5 rejected-evidence question
- [ ] Harness variant flag so targeted vs untargeted C2 can be A/B'd
- [ ] Live measurement per §2.6, per-run numbers recorded in §4 — not just means
- [x] `npx tsc --noEmit` clean · `npx vitest run` all passing (200 — 195 baseline + 5 new gate tests,
      2026-08-06) — scoped to §2.4's work only; §2.1–§2.3, the harness flag, and the live measurement are
      unimplemented so their tests don't exist yet
- [ ] Mock mode still works (`mockEvidenceMap` must cope with a tiered requirement set) — N/A until
      §2.1's tiering exists; this CI's mock (`mockEvidenceMap`) is untouched by the §2.4 gate
- [ ] One live tailoring run verified in the UI, including a **second** run proving approvals survive

---

## 3. Resources & references

- **Sibling CIs:** `[[Guard C2 Against Silent Evidence-Map Collapse]]` (do after) ·
  `[[Guard C5 Against Empty Tailored Profile]]` (do first) ·
  `[[Complete Required Lists on the Remaining Strict Tool Schemas]]` (parent; the C2 measurement).
- **B6's guard, which this design depends on:** `[[B6 Never Receives the Master Bullet Bank (Empty Evidence
  Lanes in the Map)]]`.
- **Code:** `lib/pipeline/tailoring.ts` — C2 block ~238, the delete ~240, `c2UserMessage` ~64, dedup ~267,
  `generateCv`'s green filter ~338 · `lib/pipeline/screening.ts` — B6's `requirement_evidence` write ~742,
  B2's re-extraction branch ~388, B6's collapse guard ~636 · `lib/scoring.ts` — `matchStrengthToScore`,
  `matchStrengthForScore` · `lib/db/schema.ts` — `requirementTailoring`, `requirementEvidence`.
- **Process notes:** `Process/C2. Map JD Requirements to Supporting Evidence.md` (§A execution sequence and
  §G persistence both need rewriting for the tiered flow) · `Process/B6. Role Fit & Investment Worthiness
  Score.md`.

### 3.1 Environment notes

- **Editing any `Process/*.md` note requires a dev-server restart** — `lib/prompts.ts` caches step notes in
  a module-level `noteCache` that never invalidates. A fresh `cache[w=… r=0]` on the `[llm]` line confirms
  the prompt bytes changed. This CI rewrites the C2 note, so expect it.
- `.env.local` lives in the repo root and is **not** copied into `.claude/worktrees/*`; the harness needs it
  in `process.cwd()`. Gitignored via `.env.*` — delete any copy when done.
- A fresh worktree has no `node_modules` (`npm install`) and no `.storage/`; three `capture-enrich` tests
  fail with `ENOENT` until `.storage/jd-captures/{188,180,149}` are copied from the repo root.
- The harness writes its report to `scripts/data/backtest-notes.md`, **overwriting the note-repoint
  baseline**. Move the output aside afterwards, as `scripts/data/schema-ci/` did.
- `next lint` is broken (pre-existing). Verify with `npx tsc --noEmit` + `npx vitest run`.
- `scripts/verify-tailoring.ts` is **destructive** — it promotes a real lead and overwrites its tailoring
  rows. Not a smoke test against real data.

---

## 4. Notes / Progress log

### 2026-08-04 · Opened

Split from `[[Guard C2 Against Silent Evidence-Map Collapse]]` once it became clear that guarding C2's
collapse without fixing the delete-then-replace behaviour would freeze the wrong design in place. The
guard CI originally carried a "delete-after-validate" item; that item is superseded here, because a merge
never wholesale-deletes.

The tiering in §2.1 is the owner's design, stated directly: *"my objective is to first try to eliminate
things where I am Weak, and then improve things where I am only Good. Requirements where I am Very Strong
or Excellent very likely will be left aside because the marginal effort to improved scoring ratio will
simply not pay off."* It is recorded here verbatim because it also answers the anchoring objection raised
when this work was first scoped — C2 seeing B6's findings is the mechanism, not a contaminant.

Nothing implemented yet. Three decisions are open and should be settled before code: one-row-vs-many per
requirement (§2.2), the stale-row owner (§2.4), and rejected-evidence suppression (§2.5).

### 2026-08-05 · Implemented (plumbing + bulk-approve UI, unverified against live tsc/vitest)

Triggered by a real observed regression: the owner compared B6's evidence lanes against a freshly-run C2
map on a live lead and found C2's result strictly worse than B6's own screen — the exact failure mode this
CI predicted. Implemented in the same pass as retiring the row-by-row Keep/Maybe/Drop triage UI (separate,
unrelated ask, done together because both touch the same C2 → `requirement_tailoring` surface).

**Decisions settled:**
- **§2.2 one-row-vs-many:** **many, ranked.** `requirement_tailoring` now allows several rows per
  requirement. B6's evidence is transposed unconditionally for EVERY tier (not just carry — see below),
  so C2 can only ever ADD candidate rows, never substitute a worse one in place of B6's. `planMerge`
  matches on `(requirementId, evidenceRef)` and replaces a stored row only when the new pick scores
  strictly higher on `matchStrengthToScore`; ties/weaker proposals and unmentioned rows are left alone.
- **§2.5 rejected-evidence suppression:** moot, not implemented. With bulk-approve replacing per-row
  triage, there is no more UI path for a human to mark a single row Drop, so a `(requirement, evidence)`
  pair can no longer be rejected and then re-proposed. Revisit if per-row Drop ever comes back.
- **§2.4 stale-row rule:** only **option (1)** implemented (B2's re-extraction branch now also deletes
  `requirement_tailoring` alongside `requirement_evidence`/`job_requirements`). **Option (3)** — gating
  `runInitialChecksAction`/`runScreeningAction` on lead status so a promoted/tailored lead can't be
  silently re-extracted at all — is NOT done. Still the right primary fix per the analysis above; left as
  follow-up since it's a UX-gate change independent of the C2 plumbing.

**Deviation from §2.1's literal tiering:** the doc's table implies Excellent/Very Strong SKIP the model
entirely and Good/Weak/No Match go through it — implemented that way for which requirements reach the
model (prompt still shrinks to only Good/Weak/No Match). But ALL tiers, including Excellent/Very Strong,
now carry B6's evidence into `proposed` unconditionally, before the model call. This was necessary, not
optional: a Good-tier requirement where C2's own fresh pick came back weaker than B6's original would
otherwise have silently dropped B6's (stronger) pick, reproducing the exact regression this CI exists to
fix. Carrying forward first and letting C2 only ADD is the safer reading of "attempt to improve."

**Not done (needs a live key + the owner's judgement, can't be verified from here):**
- The harness A/B variant flag, the ~$17 live measurement (§2.6), and the acceptance criteria that read
  results (collapse count, requirement-level before/after) are all outstanding.
- `npx tsc --noEmit` / `npx vitest run` were NOT run to completion — the dev sandbox this was written in
  couldn't execute them (see below). **Run both before trusting this.**
- The second-run-preserves-approvalStatus acceptance test (§2.6, free) was not executed, only reasoned
  through statically via `planMerge`'s logic.
- C2's tool `matchStrength` enum and the live system prompt (`Process/C2...md`) were updated to the
  Excellent/Very Strong/Good/Weak/No Match scale to match B6's, since §2.2 requires one shared ordinal —
  this touches what the LIVE model will emit henceforth, not just plumbing. Worth a first live run's
  output being read closely.

### 2026-08-05 · §2.3 addendum — prune untouched `pending` rows on re-run

Real case surfaced immediately on the first lead this ran against: 16 pre-CI `requirement_tailoring`
rows (delete-then-replace era, one row per requirement, searched the wrong evidence, never reviewed —
0/16 kept) sat next to B6's 46-row `requirement_evidence` set. Because §2.2's merge only ever inserts/
replaces, those 16 stale rows survived a re-run untouched (their `evidenceRef`s don't collide with
anything B6 or C2 proposes), so the Map would have shown 62 rows instead of the 46 real ones, and
"Approve entire map" would have Kept the 16 leftover guesses right alongside the real evidence.

Owner's framing: *"Can we simply delete the 16 rows of initial evidence which simply was a result of
poor execution?"* Checked first whether that's safe — grepped `lib/db/schema.ts` for any column
referencing `requirement_tailoring.id`; there is none, and `activityEvents`/`activationEvents` are only
written on a genuine status transition into `green`, which never happened for these rows (0/16 kept).
No FK, no soft reference, no orphan risk.

Rather than a one-off manual delete, built it into `planMerge` as a permanent rule: a stored row is
pruned when it's still `pending` (nobody has decided anything about it — §2.3's "silence is not a
verdict" protects a human VERDICT, not un-reviewed noise), its requirement is one this run actually
covers, and no proposal this run named its exact `(requirementId, evidenceRef)` pair. A row carrying a
real verdict (green/yellow/red) is never a pruning candidate under any circumstance. `planMerge` now
takes a third argument, `coveredReqIds`, and returns `toDelete: string[]` alongside the existing three
buckets; `runEvidenceMapping` deletes those ids after the insert/replace writes.

Sanity-checked offline (pure-function reimplementation, synthetic data shaped like the real lead — 16
requirements, 46 B6 rows, 16 stale untouched-pending rows with non-overlapping refs): confirms the merge
now lands on exactly 46 rows post-prune (not 62), and separately confirms a `green` row with the same
"untouched" shape is excluded from pruning. Not yet verified against the live lead / live DB — the next
Match-the-evidence run on `b7e91408-666b-4bd3-9aa2-feb760fc1036` is the real test.

**Environment note for whoever picks this up next:** verification tooling (`tsc`, `vitest`) could not be
run in the environment this was authored in — filesystem operations on the mounted project (even a plain
`find`) consistently timed out, and `vitest` additionally failed outright on a platform-mismatched native
binding (`@rolldown/binding-linux-x64-gnu` missing — `node_modules` was installed on Windows, the shell was
Linux). Changes were reviewed by hand instead. Run the full acceptance checklist locally before relying on
this.

### 2026-08-06 · Live-verified in the UI; moved to `9 - LLM Run Required`

`tsc --noEmit` and `vitest run` (195/195) confirmed clean by the owner, live in their own environment.
Bulk-approve, the evidence-kind gating fix, and the stale-row prune rule were all exercised live across
multiple real leads over several sessions, including a full screen → map → approve → generate CV run
end to end. `evidence_kind` backfill-on-refresh (a `planMerge` gap found during this live testing, not in
the original design) also shipped and was verified.

Everything on §2.7's checklist is now done except the harness A/B variant flag and the live measurement
itself (§2.6) — the one criterion that answers the CI's actual question (does targeting produce better
maps for less money), as opposed to proving the rebuild didn't break anything. Status set to
`9 - LLM Run Required` rather than `2 - Testing` (undersells what's live-verified) or `3 - Delivered`
(the original question is still open) — see `[[++ Continuous Improvement Procedure]]` for the new value.
Also still open, unrelated to the LLM run: §2.4 option (3), gating B-phase re-screening actions on lead
status — a Claude Code prompt for that was handed off separately.

### 2026-08-06 · §2.4 option (3) implemented — the B-phase re-screen gate

Scoped narrowly per a dedicated hand-off prompt: build the gate only, independent of §2.1–§2.3's
merge/tiering work (which has not landed in this codebase — `lib/pipeline/tailoring.ts`'s C2 block is
still the original delete-then-replace `runEvidenceMapping`, unchanged by this entry). §2.4's own analysis
already established the gate doesn't depend on the merge: it blocks re-entry into B2–B6, not anything C2
does with what B2–B6 produce.

**Built:**
- `assertRescreenAllowed` in `app/actions/pipeline.ts` guards `runScreeningAction`, `runInitialChecksAction`
  and `runScoringAction`. Each gained a `force = false` parameter; when the lead's status is
  `promoted`/`tailoring`/`ready`/`applied` and `force` is false, the action throws instead of running,
  pointing at `refreshFreshnessAction` as the safe alternative. `runScoringAction` was gated too (the CI
  note's "worth checking" at §2.4) — reasoned through rather than assumed: B5 skips re-extraction when
  `job_requirements` rows exist and B6 only overwrites `requirement_evidence` by existing id, so it cannot
  orphan anything the way B2's re-extraction can; it's gated anyway for consistency and because it still
  silently re-spends an Opus call for no benefit on a lead past the B-phase. No current UI call site
  reaches `runScoringAction` on a past-`promoted` lead (Ready-to-score only ever operates on
  `screening`/`selected` rows), so this is defense-in-depth, not a UX change.
- `rescreenBlocked(status, force)` and `PAST_PROMOTED_STATUSES` extracted as a pure, DB-free predicate in
  `lib/db/types.ts` — same pattern as `gateStatusFor` — so both the server gate and the client confirm
  prompt read one definition, and so the predicate is unit-testable without a live lead.
  `lib/__tests__/rescreen-gate.test.ts` covers: every past-promoted status blocked without override; every
  one let through with `force: true`; every everyday status (`captured` through `selected`) never blocked
  either way; the exact status set; `archived` explicitly left out (a re-screen there is the owner's call,
  not this gate's).
- `getRescreenImpactAction(leadId)` — a new read-only action returning `{ status, total, green }` over
  `requirement_tailoring`, so the UI can show what's at stake before someone overrides.
- UI wiring in `components/roleproof/workspace.tsx`: `onScreen` now checks the gate client-side first
  (`lead.status` is already a prop, no round trip needed to ask); if blocked, it fetches the impact via
  `getRescreenImpactAction` and renders a new `RescreenConfirm` card (sibling of `ActionError`, same visual
  language) with the counts and a "Re-screen anyway" button that re-invokes with `force: true`.
  `onScreen`/`onConfirmRescreen` are separate zero-arg closures in `Ctx` specifically so a raw
  `onClick={c.onScreen}` never has a MouseEvent misread as `force: true` — `force` is never a parameter any
  DOM handler can reach directly.
- **Option (1), belt-and-braces:** confirmed already present in `lib/pipeline/screening.ts`'s B2 `tooThin`
  re-extraction branch — it already deletes `requirement_tailoring` alongside `requirement_evidence`/
  `job_requirements` (landed earlier, in the live evidence-kind testing session), so a deliberately
  confirmed override that lands in that branch doesn't orphan tailoring rows. Not implemented: option (2)
  (C2 dropping unresolvable rows) — moot, since it's C2 merge logic that doesn't exist yet, and §2.4 already
  rated it the weakest of the three.

**Not implemented, out of scope for this entry:** §2.1's tiering, §2.2's merge rule, §2.3's approval
preservation, the harness A/B flag, the §2.6 live measurement, and a live UI verification against a real
lead (this was built in an isolated worktree with no DB/auth access, then reviewed and ported by hand onto
`main` once confirmed sound — see the commit-organization note below for why it wasn't a plain `git merge`).
`npx tsc --noEmit` and `npx vitest run` were confirmed clean in the worktree (200/200: 195 baseline + 5 new
gate tests); not re-run independently after the port, since it's a line-for-line copy of already-verified
code plus one already-landed hunk (option 1) that turned out to need no changes at all.

### 2026-08-06 · Commit-organization note — where the code actually lands

For anyone tracing the `evidence_kind` backfill (`toRefresh` in `planMerge`/`runEvidenceMapping`,
`lib/pipeline/tailoring.ts`) or the `matchStrength` scale widening (`lib/llm/schemas.ts`) from this note
into git history: both ship in the **Career Graph Visualization & Your Story Restructure** commit, not a
commit tied to this CI. That commit absorbed `lib/pipeline/tailoring.ts` and `lib/db/schema.ts` wholesale
as part of an owner-approved simplification (several unrelated sessions had touched those two files, and
splitting every hunk by feature wasn't worth the effort). The Education/Language Map-lane gating fix itself
(the UI/action side — `workspace.tsx`, `cv-slots.ts`, `approveAllAction`) has its own note,
`[[CV Tailoring — Evidence Mapping Issues]]`, and ships in that note's own commit.
