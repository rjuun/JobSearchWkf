---
ci-area: LLM tool schemas / pipeline reliability
ci-roadmap:
ci-title: Guard C5 against an empty tailored profile
ci-status: 0 - Idea
ci-priority: medium
ci-date: 2026-08-04
ci-estimated-time: 1
ci-time-spent: 0
pr-source: "[[Complete Required Lists on the Remaining Strict Tool Schemas]]"
pr-target:
---

---
```simple-time-tracker
{"entries":[]}
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

- [ ] `MIN_WORDS` chosen against real C5 outputs (query `llm_calls` for step `C5`), not guessed
- [ ] Floor predicate exported and unit-tested: empty, whitespace-only, one-word, a realistic 70–110 word
      profile passing, and a boundary case either side of `MIN_WORDS`
- [ ] Re-asks up to 3 attempts, then throws; nothing written on the way out
- [ ] Mock mode still clears the floor — check `mock:` for C5 in `generateCv` produces enough words
- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` — all passing (195 at the time of writing)
- [ ] One live tailoring run where the C5 step summary shows a plausible word count

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
