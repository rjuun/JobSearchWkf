---
ci-area: CV Tailoring (C-Phase)
ci-roadmap:
ci-title: STAR Results Never Reach the Evidence Graph
ci-status: 0 - Idea
ci-priority: high
ci-date: 2026-08-24
ci-estimated-time: 1
ci-time-spent: 0
pr-source: "[[C3 Writes CV-Grade Skill Tags]]"
pr-target: "[[C2. Map JD Requirements to Supporting Evidence]], [[C3. Transform Evidence into CV Bullets]]"
---

---
```simple-time-tracker
{"entries":[]}
```
---

## 1. What is the problem or opportunity?

`gatherEvidence` (`lib/pipeline/tailoring.ts` §438) assembles the whole evidence graph C2 maps
against. It queries five tables — `star_actions`, `responsibilities`, `bullet_bank`, `education`,
`languages` — and **omits `star_results` entirely**.

Measured on the live profile, 2026-08-24:

```
stars=7  star_actions=52  star_RESULTS=22  bullet_bank=28  responsibilities=24
star_results with a refCode: 22 of 22
```

Every one of those 22 rows already carries the ref code C2 cites by. They are the quantified outcomes:

> `[1-R1]` Delivered a fully operational Shared Services Centre within 1 year and 8 months from
> project kick-off, processing 15,000…
>
> `[1-R3]` Gradual branch FTE reallocation from back-office to front-office over 6 years following
> SCE go-live.

**C2 has never been able to cite a single one, and no CV has ever been built on one.**

The sharpest way to see the defect: `Process/C3…md` §B.4 instructs the step to *"include measurable
results, scale, or business impact **when they exist** in the Original Text"* and *"do not invent or
exaggerate results that are not supported by the evidence."* Both rules are correct and the step obeys
them. The table where the measurable results actually live was simply never passed in. The bullets are
built from actions, and actions describe what was done, not what it produced.

This also silently shapes [[C3 Selects the CV Evidence Set]]: any impact-weighted selection scores
bullets partly on whether they carry a quantified outcome, and today almost none can.

## 2. What would the improvement look like?

### 2.1 · Scope

**In:** making `star_results` citable evidence, and deciding the shape it is cited in.
**Out:** the selection budget ([[C3 Selects the CV Evidence Set]]), and any change to how C3 writes a
bullet beyond having the outcome available to write from.

### 2.2 · The one real design decision: alone, or paired with its action?

A STAR result is not a self-contained claim. `[1-R3]` — *"Gradual branch FTE reallocation… following
SCE go-live"* — is an outcome of something, and a bullet built from it alone would state a consequence
with no actor. Three options:

1. **Emit results as their own evidence kind** (`kind: 'STAR result'`), cited independently.
   Simplest. Risks bullets that report an outcome without the action that earned it.
2. **Emit results, and give C3 the parent STAR's action as context** so a cited result can be written
   as action-plus-outcome. Costs a join through `stars`; C3's prompt gains a context line.
3. **Emit a pre-joined action→result composite** as one evidence item. Cleanest for C3, but it
   fabricates an evidence node that exists in no table and would need its own ref code — a new
   citable identity that traces to nothing in the profile workbook.

**Recommendation: (2).** It keeps every ref code traceable to a real row, which is the property
`resolveVocab` and the C2 ref discipline both rest on, and it gives C3 exactly what §B.4 asks for —
the action to lead with and the measurable result to close on. (3) is rejected for the same reason
free-text graph tags were rejected as My Skills values: an identity the profile does not recognise.

### 2.3 · Current state to verify before building

- **Ref-code collision.** Result refs look like `1-R1`, `1-R2`, `1-R3`. Confirm they cannot collide
  with `star_actions` ref codes (`A-R3` and `5-3` both appear in live tailoring rows) — two evidence
  items sharing a ref would make `absorbC3Bullets`'s ref→bullet map ambiguous, and it keys on ref.
- **`Evidence.cvPosition`.** Actions pass `cvPosition: null`; responsibilities and bullets derive one.
  Results need the same treatment as their parent action, or `templateFits` may reject the Keep set
  and silently drop C6 to the programmatic builder.
- **`Evidence.skills`.** `star_results` may or may not carry its own tags; if not, pass `[]` rather
  than inheriting the action's, so provenance stays honest.

### 2.4 · Implementation checklist

1. Add `star_results` to `gatherEvidence`'s query set, with the parent-STAR join for §2.2 option (2).
2. Extend the `Evidence` type with the optional parent-action context field, and render it in
   `c2UserMessage`'s evidence block.
3. Verify §2.3's three checks against live data before running anything paid.
4. Re-run C2 on one lead and confirm result refs appear in the map.

### 2.5 · Acceptance

- [ ] `gatherEvidence` returns 22 additional evidence items on the live profile.
- [ ] A re-run of C2 on `ee5c72bf` or `a9f2307b` cites at least one `*-R*` ref in the map.
- [ ] The resulting bullet reads as action-plus-outcome and carries the number from the result row.
- [ ] No ref-code collision: every evidence ref in `gatherEvidence`'s output is unique.

## 3. Resources or references

- `lib/pipeline/tailoring.ts` §438 `gatherEvidence`; §100 `c2UserMessage`'s evidence block.
- `lib/db/schema.ts` §186 `starResults`, §166 `stars`, §176 `starActions`.
- `Process/C3…md` §B.4 — the rule this unblocks.
- [[C3 Selects the CV Evidence Set]] — **build this note first.** Budgeting over a candidate pool that
  is about to gain 22 quantified outcomes is tuning against inputs that are about to change; the same
  argument sequenced [[C3 Writes CV-Grade Skill Tags]] ahead of consolidation.

## 4. Notes / Progress log

### 2026-08-24 · Opened

Found while measuring why generated CVs overflow two pages. The owner had independently reached the
same conclusion — *"we need to introduce the higher amount of STARs Results which works as evidences"* —
as a tuning instinct. It turned out to be a hard gap: not too few results used, but none available.
