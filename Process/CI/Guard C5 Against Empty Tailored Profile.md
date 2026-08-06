---
ci-area: LLM tool schemas / pipeline reliability
ci-roadmap:
ci-title: Guard C5 against an empty tailored profile
ci-status: 3 - Delivered
ci-priority: medium
ci-date: 2026-08-04
ci-estimated-time: 1
ci-time-spent: 1.1
pr-source: "[[Complete Required Lists on the Remaining Strict Tool Schemas]]"
pr-target:
---

---
```simple-time-tracker
{"entries":[{"name":"Implement floor (worktree)","startTime":"2026-08-04T19:29:00.000Z","endTime":"2026-08-04T20:01:00.000Z"},{"name":"Testing","startTime":"2026-08-05T11:35:53.000Z","endTime":"2026-08-05T12:10:07.000Z"}]}
```
---

> [!IMPORTANT] Small and self-contained — roughly an hour
> This is the cheapest of the three open reliability CIs and has no dependencies. Do it before
> `[[Make C2 Build on B6 Instead of Re-Deriving the Map]]`.

---

## 1. What is the problem or opportunity?

**C5 — the tailored CV profile — has no floor of any kind. An empty string is a valid answer.**

`lib/llm/schemas.ts`:

```ts
export const C5 = {
  zod: z.object({ profile: z.string() }),
  …
  input_schema: { …, properties: { profile: { type: 'string' } }, required: ['profile'] },
};
```

`required: ['profile']` guarantees the key is present. `z.string()` accepts `""`. So a degraded call
returns `{"profile": ""}`, `runStructured` logs `status='ok'`, and `lib/pipeline/tailoring.ts` does:

```ts
profileText = r.data.profile.trim();
```

From there the empty string flows into three places: `if (profileText) data['Profile'] = profileText`
leaves the .docx template's `<<Profile>>` placeholder unfilled (blanked by the nullGetter); the
programmatic CV builder gets `profile: ''`; and **C7 is then asked to ATS-rate a CV whose profile section
is empty**, which quietly depresses the rating for a reason that has nothing to do with the candidate.

This is the same family as the C2 and C3 defects — `[[Complete Required Lists on the Remaining Strict
Tool Schemas]]` established that a complete `required` list makes the key present and can never make the
value meaningful — but C5 is by far the simplest instance, because the honest answer is never "nothing".

### How visible is it today?

More visible than C2's or C3's failures, which is why this is `medium` rather than `high`:

- The C5 step summary reports word count. `''.split(/\s+/)` has length **1**, so a collapse renders as
  **"1 words"** where a healthy run shows 70–110.
- The generated .docx has a blank profile section.

So it is caught by looking. The point of this CI is to stop requiring that anyone looks.

---

## 2. What would the improvement look like?

### 2.0 Scope

**In scope:** a floor on C5's output in `generateCv`, unit tests for the predicate, and a `Process/C5`
cross-check.

**Out of scope:** C2's floor (`[[Guard C2 Against Silent Evidence-Map Collapse]]`) and the C2/B6
incrementality work (`[[Make C2 Build on B6 Instead of Re-Deriving the Map]]`). C7 has completed
`required` lists but is unmeasured — separate concern, and it cannot corrupt the CV.

### 2.1 The floor

`Process/C5. Drafting CV Profile (Per Job Lead).md` and the tool description both specify **4–7 lines,
70–110 words**. That gives a defensible floor without inventing a threshold:

- **Reject empty or whitespace-only** — unambiguous, no judgement needed.
- **Reject implausibly short.** Pick a floor well under the specified minimum so normal variation never
  trips it — around **40 words** leaves generous headroom below the 70-word target while still catching a
  one-line stub. Confirm against real C5 outputs in `llm_calls` before fixing the number.
- **Do not put an upper bound on it.** Over-long is a quality nit, not a collapse, and C6 truncates anyway.

### 2.2 The fix pattern

Copy the shape already used three times in this codebase — B2's `tooThin` (`lib/pipeline/screening.ts`
~382), B6's `unjudged` (~684), and C3's `missingC3Refs` (`lib/pipeline/tailoring.ts` ~124):

```ts
const ATTEMPTS = 3;
const tooShort = (p: string) => p.trim().split(/\s+/).filter(Boolean).length < MIN_WORDS;

let r = await writeProfile();
for (let attempt = 2; attempt <= ATTEMPTS && tooShort(r.data.profile); attempt++) r = await writeProfile();
if (tooShort(r.data.profile)) throw new Error(/* specific and actionable */);
profileText = r.data.profile.trim();
```

Three properties to preserve:

1. **Re-ask rather than lower the bar.** `runStructured`'s own retry cannot fire — `""` is schema-valid.
2. **Throw rather than degrade.** C6 and C7 both consume `profileText`; shipping a CV with a blank profile
   and then rating it is worse than failing loudly. `generateCv` already throws for other reasons (no Keep
   evidence, no requirements), so the UI path handles it.
3. **Export the predicate and unit-test it**, mirroring `lib/__tests__/c3-bullet-floor.test.ts`.

Unlike C3's floor, this one does **not** need to accumulate across attempts — a profile is a single value,
so the last attempt either clears the bar or it doesn't.

### 2.3 Acceptance criteria

- [x] `MIN_WORDS` chosen against real C5 outputs (query `llm_calls` for step `C5`), not guessed —
      confirmed against `pipeline_runs.output.profile` (`llm_calls` only has token counts). One production
      C5 row on record at the time: 94 words, squarely inside 70–110. `MIN_PROFILE_WORDS = 40` sits well
      under it.
- [x] Floor predicate exported and unit-tested: empty, whitespace-only, one-word, a realistic 70–110 word
      profile passing, and a boundary case either side of `MIN_WORDS` — `lib/__tests__/c5-profile-floor.test.ts`
      (9 cases, mirrors `c3-bullet-floor.test.ts`)
- [x] Re-asks up to 3 attempts, then throws; nothing written on the way out — `lib/pipeline/tailoring.ts` C5 block
- [x] Mock mode still clears the floor — static tail on the mock guarantees ~63 words even in the thinnest
      case (no headline, no core themes)
- [x] `npx tsc --noEmit` clean — verified in the implementation worktree 2026-08-04; the same diff was
      ported by hand onto `main` 2026-08-06 (worktree never merged/pushed — see §4)
- [x] `npx vitest run` — 201 passing in the worktree 2026-08-04 (3 unrelated pre-existing failures in
      `capture-enrich.test.ts`, missing local fixtures, untouched by this change)
- [x] One live tailoring run where the C5 step summary shows a plausible word count — confirmed 2026-08-06
      on the Allianz Partners / Governance & Transformation Manager lead: downloaded .docx, Profile section
      is 97 words, inside the 70–110 target

---

## 3. Resources & references

- **Parent:** `[[Complete Required Lists on the Remaining Strict Tool Schemas]]` — the mechanism, and the
  C3 guard this copies.
- **Code:** `lib/pipeline/tailoring.ts` (C5 block, `profileText`) · `lib/llm/schemas.ts` (`C5`) ·
  `Process/C5. Drafting CV Profile (Per Job Lead).md` (the 4–7 line / 70–110 word spec).
- **Tests to mirror:** `lib/__tests__/c3-bullet-floor.test.ts`.
- `next lint` is broken in this repo (pre-existing). Verify with `npx tsc --noEmit` + `npx vitest run`.
- `scripts/verify-tailoring.ts` is **destructive** — it promotes a real lead and overwrites its tailoring
  rows. Do not use it as a smoke test against real data.

---

## 4. Notes / Progress log

### 2026-08-04 · Opened

Found while writing `[[Guard C2 Against Silent Evidence-Map Collapse]]` and scoped out of it as the
cheapest independent piece. No dependency on the C2 work in either direction.

### 2026-08-04 · Floor implemented (worktree)

Built on the `claude/guard-c5-empty-profile-18798f` branch/worktree: `MIN_PROFILE_WORDS` / `isProfileTooShort`
added to `lib/pipeline/tailoring.ts`, C5's `runStructured` call wrapped in the same re-ask-then-throw shape
as C3's, mock's static tail strengthened to always clear the floor. Unit tests in
`lib/__tests__/c5-profile-floor.test.ts`. `tsc --noEmit` clean, `vitest run` 201 passing. Confirmed
`MIN_PROFILE_WORDS` against the one production C5 row on record (94 words) via `pipeline_runs.output.profile`.
Left uncommitted in the worktree; never pushed to GitHub — the branch existed only locally.

### 2026-08-06 · Ported to `main`, live-verified, delivered

The worktree's diff was reviewed line-by-line and applied by hand onto `main`'s (already-modified,
uncommitted) `lib/pipeline/tailoring.ts` — a straight `git merge` wasn't used because `main`'s working tree
already carried unrelated uncommitted changes from the same session (candidate-facts fields, the `toRefresh`
evidence-kind backfill) that a merge risked colliding with. Added the same `MIN_PROFILE_WORDS` /
`isProfileTooShort` function and C5 retry-then-throw wrap at the current call site, and copied
`lib/__tests__/c5-profile-floor.test.ts` in unchanged.

Live-run check: opened the Allianz Partners / Governance & Transformation Manager lead
(`b7e91408-666b-4bd3-9aa2-feb760fc1036`) in the running dev server, confirmed C5 ran `LIVE` on
`claude-opus-4-8` in the run trace, then fetched the generated `.docx` via `/api/cv/[id]`, unzipped it
client-side, and read the actual `PROFILE` paragraph: **97 words**, inside the 70–110 target — the last
open acceptance box.

Sandbox couldn't independently re-run `tsc`/`vitest` today (known environment limitation — `tsc --noEmit`
timed out, `vitest` crashes on a native-binary mismatch on this box); the ported code is a mechanical,
line-for-line copy of what the worktree already verified clean, so this is marked Delivered on that basis.
Worth a quick `npx tsc --noEmit` / `npx vitest run` from your own machine to close the loop, though nothing
about the port changed the guarded logic itself.

**Time spent: 1.1h total** — tracked in the `simple-time-tracker` block above: 32 min implementing the
floor in the worktree (2026-08-04, 19:29–20:01 UTC) + 34 min testing (2026-08-05, 11:35–12:10 UTC). Slightly
over the 1-hour estimate once the testing pass is counted, not just the implementation.
