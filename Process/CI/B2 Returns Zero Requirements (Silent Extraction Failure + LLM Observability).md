---
ci-area: Screening / B-Phase — B2 extraction reliability
ci-title: B2 Returns Zero Requirements — silent extraction failure, stop_reason observability, stale step procedure
ci-status: 2 - Testing
ci-priority: high
ci-date: 2026-08-01
ci-estimated-time: 4
ci-time-spent: 0
pr-source: "[[B2. Extract Requirements from Job Description]]"
pr-target:
---

---
```simple-time-tracker
{"entries":[]}
```
---

> [!NOTE] Retrospective CI
> This note was written **after** the work, not before it. It documents a troubleshooting session that
> started from a live symptom rather than from a design agreed in Claude Chat, so there was no CI to hand
> to Claude Code at the outset. Sections 1–3 are reconstructed from the investigation; §4 is the real,
> dated log. Recorded this way deliberately — the alternative was four commits with no CI behind them.

---

## 1. What is the problem or opportunity?

**B2 (requirement extraction) sometimes returns 0 requirements from a real, well-formed JD, and reports
success while doing it.**

Observed live on 2026-07-31 on two leads — COWI *Senior Finance Business Partner* (3,550-char JD) and Vestas
*Head of Corporate Strategic Planning* (4,018-char JD). In both cases the trace panel showed all six B steps
**LIVE with no error**, while the requirement-evidence Map stayed empty or near-empty. A third lead (Aliaxis)
reproduced the same shape later the same evening.

**Why it is silent.** `lib/llm/schemas.ts` declares B2's output as
`requirements: z.array(...).default([])`. There is no floor, so *any* non-negative count is schema-valid:

- `runStructured` (`lib/llm/client.ts`) records `status='ok'`, `attempts=1`
- its bounded zod retry never fires — there is nothing invalid to retry
- B3–B6 proceed happily against whatever landed (B5 and B6 both degrade to rating the raw JD when the
  requirement list is thin)

So the failure is invisible at every layer that would normally catch it.

**Two distinct failure modes, not one.** From `llm_calls` for the affected leads:

| Mode | Evidence | Reading |
| --- | --- | --- |
| Empty answer | `output_tokens` 35, 39, 43, 64, 69, 169 | Model returned an essentially empty `requirements` array |
| Truncation | `output_tokens` **exactly 8000**, twice (Vestas) | Hit `max_tokens: 8000` (`lib/llm/client.ts:144`); tool JSON cut off mid-emit, and `.default([])` then parsed the fragment as a clean empty result |

Input tokens (1,295–1,510) are consistent with the real JDs being sent, and `jd_text` lengths were confirmed
non-empty (3,550 / 4,018 / 5,267 chars) — this is **not** a missing-JD problem.

**Ruling out the branch consolidation.** The session's opening hypothesis was that the GitHub
branch/commit consolidation earlier that day had dropped or partially reapplied a fix. It had not. See §4
for the full timeline; the short version is that the consolidation is **ruled out as a regression** but
**ruled in as the delivery vehicle** — it merged the B-phase reorder into `main` 48 minutes before the first
B2 failure, so the current B2 shipped with it rather than being broken by it.

---

## 2. What would the improvement look like?

### 2.0 Scope

**In scope:**
- A length-aware floor on B2 so a thin extraction fails loudly instead of writing an empty Map (§2.1)
- `stop_reason` observability on every LLM call, so "answered empty" and "was cut off" stop being
  indistinguishable (§2.2)
- Correcting `lib/journey.ts`, the one step registry the B-phase reorder missed (§2.3)
- Correcting the B2 procedure note, which still pointed the model at a retired Microsoft 365 source (§2.4)

**Out of scope (deliberately, pending the diagnostic run):**
- Raising `max_tokens` — the right value depends on which failure mode dominates, and the instrumentation
  in §2.2 exists precisely to answer that. Left unchanged so the next run stays diagnostic.
- Moving B2 to Opus. Considered and **not** done: if B2 is truncating, Opus hits the same 8000-token
  ceiling at higher cost. Revisit only if the empty-answer mode survives §2.4.
- The connector-era `## D` sections of the B2 note, and the same class of stale reference in B3/B5/B6/C2
  (§3.3). Flagged for CI review rather than unilaterally rewritten.

### 2.1 B2 floor — `lib/pipeline/screening.ts`

A fixed "must be non-zero" is not enough: Vestas came back with exactly **1** requirement from a
multi-paragraph posting, which a non-zero check accepts. But a one-line vacancy blurb can honestly have a
single demand, so the floor is **length-aware**:

- JD ≤ 200 chars → no floor (too short to judge)
- JD > 200 chars → at least 1 required
- JD > 600 chars → at least 4 required

Seeded rows that are themselves thin are **cleared and re-extracted** rather than reused, since B2's
idempotence shortcut (`requirements.length > 0 ⇒ skip`) would otherwise perpetuate exactly the state the
floor exists to catch.

On breach: throw, write nothing. Verified safe on all three call paths — see §2.5.

### 2.2 `stop_reason` observability — `lib/llm/client.ts`, `lib/db/schema.ts`

`callClaude` read the response envelope and discarded `stop_reason`, which is the *only* field that
separates "the model answered with nothing" from "the model was cut off mid-answer" — both arrive at the
zod parse as a thin object. Now:

- carried out of `callClaude` and persisted on `llm_calls.stop_reason` (migration `0030`, nullable text)
- printed on the `[llm]` line; a `max_tokens` stop additionally logs a bounded preview of the raw tool
  input, so the fragment zod accepted is visible rather than inferred
- retained across retries, so a double failure still reports why the last call stopped

**Not** raised to an error inside the client, on purpose: the client's job is faithful reporting, and only
the caller knows whether an empty result is legitimate for its step. That judgment lives in §2.1.

### 2.3 `lib/journey.ts` — the registry the reorder missed

The B-phase reorder moved extraction B5 → B2 and shifted roadblocks / misalignments / translate down one.
`lib/llm/schemas.ts`, `lib/prompts.ts` `STEP_NOTE`, the `Process/B*.md` filenames and
`lib/pipeline/screening.ts` all moved together. **`lib/journey.ts` `SCREEN_STEPS` did not** — it still
described B2 as "Roadblocks" and B5 as "Extract requirements", so `/pipeline` narrated an order the code no
longer runs. Display-only (`app/pipeline/page.tsx` is the sole consumer, and its gate annotations key off
B1/B6, neither of which moved), but it is exactly the desync `lib/prompts.ts` warns about in its own header
comment. Also drops ATS from the B5 label — that is an A1 output since the reorder.

### 2.4 B2 procedure note — §A pointed at a retired source

`lib/prompts.ts` loads `Process/B2. Extract Requirements from Job Description.md` **verbatim** as B2's
system prompt. Its §A said:

> Read the JD `.md` file from: `OneDrive > Obsidian Vault > JobSearch Camunda > Job Descriptions`

Correct when this step ran through the Microsoft 365 connector; wrong now, because the app passes the JD
inline in the user message under `JOB DESCRIPTION:`. The step was being told its source was a file it has
no access to, while the real source sat in front of it. **B2 is the only B-phase note carrying a Source
directive of this kind** — B3–B6 have no §A — which makes it the one step whose prompt opens by pointing
away from its own input.

§A now states the JD is supplied inline and is the complete source, forbids external lookup, and says
explicitly that returning empty because the source appeared absent is a failure rather than a valid answer.
The retired path is kept as a marked historic note so the CI trail stays legible. The stale
`Model: Sonnet 4.6` header was corrected to `Sonnet 5`.

### 2.5 Acceptance criteria

- [x] `npm run typecheck` clean
- [x] `npx vitest run` — 155/155 passing
- [x] Migration `0030` applied; `llm_calls.stop_reason` present and nullable
- [x] Guard verified non-destructive on all three call paths:
      capture (`lib/pipeline/capture.ts:180`, try/catch → lead stays `captured`, `kit.tsx:182` "Screen"
      fallback already documented this state); batch (`scripts/batch-screen.ts:106`, per-lead catch);
      manual UI (`components/roleproof/scoring-queue.tsx:85`, try/catch → inline error)
- [ ] **Live diagnostic run** — restart dev server (mandatory: `lib/prompts.ts` `noteCache` never
      invalidates), re-run screening on Vestas, read `stop_reason`
- [ ] Decide `max_tokens` / model tier from that result
- [ ] Confirm the Map populates for a lead that previously returned zero

---

## 3. Resources & references

### 3.1 Code paths

| File | Role |
| --- | --- |
| `lib/pipeline/screening.ts` §B2 block | the floor (§2.1) |
| `lib/llm/client.ts` | `callClaude` / `runStructured` / `logCall` — `stop_reason` (§2.2), `max_tokens: 8000` at line 144 |
| `lib/llm/schemas.ts` | `B2.zod` — the `.default([])` that makes the failure silent |
| `lib/db/schema.ts` + `drizzle/0030_whole_phil_sheldon.sql` | `llm_calls.stop_reason` |
| `lib/journey.ts` | `SCREEN_STEPS` (§2.3) |
| `lib/prompts.ts` | `STEP_NOTE` map + `noteCache` (restart requirement) |

### 3.2 Sibling CIs

- `[[Lead Page as Pipeline Canvas (B-Phase Reorder + Requirement-Evidence Map)]]` — introduced the current
  B2. This CI is a defect follow-up to it, not a rescope of it.
- `[[Migrate LLM Provider - DeepSeek to Claude (Sonnet 5 + Opus 4.8, Single Provider)]]` — the model-tier
  rationale referenced when B2's tier was considered and deferred.

### 3.3 Open finding — connector-era references across the loaded notes

`lib/prompts.ts` loads nine notes verbatim as system prompts. Counting references to OneDrive / Obsidian
vault / `.xlsx` / SharePoint:

| Note | Hits | Nature |
| --- | --- | --- |
| B5. Translate Requirements… | 11 | incl. the same OneDrive JD path at line 148 |
| B6. Role Fit… | 8 | names `tbl_Bullet_Bank` in `Profile_Reference_Workbook.xlsx` as "primary reference" |
| C2. Map JD Requirements… | 8 | — |
| B2. Extract Requirements… | 6 → 4 | §A fixed; `## D` export spec remains |
| B3. Identify Roadblocks | 4 | judges language/technical roadblocks against `tbl_*` workbook tables |
| B4. Identify Misalignments | 2 | — |
| C3 / C5 / C7 | 0 | clean |

These name data sources the model cannot open. They have not failed as visibly as B2's §A because those
steps receive their real inputs injected in the user message, but it is the same class of defect and it is
a genuine CI item in its own right. **Not actioned here.**

### 3.4 Suspected driver of the truncation mode

B2's own §C.7 instructs: *"Aim for completeness over brevity — better to over-extract and consolidate than
to miss a requirement that drives scoring."* Combined with §C.5's verbatim `sourceText` quote per
requirement, the procedure explicitly maximises output length — against a flat `max_tokens: 8000` unchanged
since the first commit. On a 4,000-character JD that can plausibly exceed the ceiling.

If confirmed, **the fix is the ceiling, not the methodology** — over-extraction is a deliberate choice and
B6 depends on it.

---

## 4. Notes / Progress log

### 2026-07-31 → 2026-08-01 · Forensic timeline — consolidation ruled out

Opening question: did the branch consolidation cause this, and did the earlier Vestas/COWI failures happen
before or after it? Established empirically rather than assumed.

**All times UTC** (git was displaying +0200 while `llm_calls` stores +00 — that offset is what made the
sequence ambiguous in the first place).

| Time (UTC) | Event |
| --- | --- |
| 12:37:28 | `79f88f1` merge PR #1 — docs only |
| 12:47:16–12:47:58 | `4f16d5e`…`3380a88`, five commits on `ci/lead-page-pipeline-canvas` |
| **13:39:20** | **`736384f` — consolidation merge lands on `main`** |
| 13:45:45 | main worktree checked out from the branch to `main` |
| 14:11:51 | Vestas B5 — first LLM call of the session |
| 14:27:04 | COWI B2 — 39 output tokens ← **first B2 failure** |
| 14:39:48 / 14:50:27 / 15:02:49 / 15:06:05 | Vestas B2 — 69 / **8000** / 169 / **8000** |
| 15:09:02 | COWI B2 — 35 |
| 17:49 / 18:11 | Aliaxis B2 — 64 / 43 |

**Conclusion: after, unambiguously, by 48 minutes.** Two facts make it airtight rather than suggestive:

1. Every B2 row in the entire `llm_calls` table (8 rows, all leads) postdates the merge.
2. For Vestas and COWI specifically, the earliest `llm_calls` row of *any* step is 14:11:51 UTC. Both leads
   were created 2026-07-21 from the SharePoint seed but have **no LLM history before that afternoon** —
   there is no "before" in which they could have failed. Checked across all steps, not just B2, because the
   reorder means pre-reorder extraction would have been logged as `B5`.

**Consolidation integrity — checked and clean:**

- `git diff 3380a88 736384f` over the five suspect files is **empty**: the merge took the branch version
  verbatim. No revert, no partial hunk. `lib/llm/client.ts` and `lib/ci.ts` untouched entirely.
- `reflog`: `3d9f1b1` → fast-forward `79f88f1` → merge `736384f`. No force-push, no rebase, no deleted
  branch. Stash list empty.
- `fsck --unreachable`: three unreachable commits — two are a dropped stash from 2026-07-23, one is a
  superseded draft of the Archive commit whose content landed in `3d9f1b1`. **None touch B2, the Anthropic
  retry logic, or the B2 schema.**
- `.env.local`: mtime 2026-07-24 17:43, a week before the consolidation. Gitignored (`.gitignore:39`),
  untracked, never staged. No `ANTHROPIC_MODEL_*` keys — models come from `lib/env.ts` defaults, and the
  only `env.ts` change in the merge was a comment edit.

**The "B2 length-aware guard" that was believed lost was never committed.** No such commit exists on any
branch, reachable or unreachable; no `-S` hit for `length-aware`, `MAX_JD`, `jdLength` or `maxTokens`. It
was sitting **uncommitted in the working tree**, one `git checkout` from being gone. That is what prompted
committing it properly (`f958eee`) rather than continuing to test against an untracked change.

### 2026-08-01 · Model-tier question raised and closed

Raised: were B5 *and* B6 meant to run on Opus? Checked three ways — `model: 'opus'` appears exactly once in
`screening.ts`, on B6, in **every commit since the first**; `llm_calls` shows B2–B5 all `claude-sonnet-5`
and B6 alone `claude-opus-4-8`; and `docs/ARCHITECTURE.md:70` defines the Opus tier as "B6, C2, C3, C5, C7".

**No regression.** The confusion traces to the renumbering: `docs/archive/phases/P2-screening.md:30` says
"Sonnet for B2–B5, Opus for B6" in the *old* numbering, where B5 *was* extraction — the step now called B2.
It was explicitly Sonnet then too. The B2 note's stale `Model: Sonnet 4.6` header is the likely proximate
source of the recollection; corrected in `2a0115b`.

The genuinely open version of the question — *should B2 be Opus now?* — is deferred to the diagnostic run
(§2.0, out of scope).

### 2026-08-01 · Commits

All on `fix/b2-thin-extraction-guard`, branched from `736384f`. Not merged to `main` at time of writing.

| Commit | Time | Subject |
| --- | --- | --- |
| `f958eee` | 00:32 | B2: fail loudly on a thin extraction instead of writing an empty Map |
| `394e609` | 00:34 | Renumber `SCREEN_STEPS` to match the B-phase reorder |
| `aad411f` | 00:57 | Record Anthropic `stop_reason` on every LLM call |
| `2a0115b` | 01:17 | B2 note: point the step at the JD it is actually given |

Migration `0030` was applied to the live database at the time of `aad411f`. This was **not** optional:
`logCall` wraps its insert in a try/catch that only logs, so against the pre-migration schema every audit
write would have failed *silently* and `llm_calls` would have stopped recording altogether.

### 2026-08-01 · Open at time of writing

- **`ci-time-spent` is 0 and the time-tracker block is empty** — needs Reggie's real entry; session
  wall-clock boundaries aren't observable from here. `ci-estimated-time: 4` is anchored to
  `[[Setup Hourly Postgres Backup on Synology]]` (4h actual, comparable shape: investigation + small
  focused changes + docs), not a fresh guess.
- **Status is `2 - Testing`, not `3 - Delivered`**, per `[[++ Continuous Improvement Procedure]]` §"2 vs 3":
  typecheck and 155 tests are green, but nothing here has been live-verified. The single criterion that
  cannot be verified any other way is a real screening re-run on the Vestas lead with the dev server
  restarted. Until that is clicked through, this stays at `2`.
- Two things **not** verified: the §A fix is a well-motivated hypothesis, not a confirmed cause — no
  reproduce has been run against it; and §B–§D of the B2 note have not been re-read line by line against
  the `emit_requirements` contract for subtler mismatches beyond those reported in §3.3/§3.4.
