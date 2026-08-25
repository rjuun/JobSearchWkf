---
ci-area: CV Tailoring (C-Phase)
ci-roadmap:
ci-title: STAR Results Never Reach the Evidence Graph
ci-status: 3 - Delivered
ci-priority: high
ci-date: 2026-08-24
ci-estimated-time: 1
ci-time-spent: 1.5
pr-source: "[[C3 Writes CV-Grade Skill Tags]]"
pr-target: "[[C2. Map JD Requirements to Supporting Evidence]], [[C4. Transform Evidence into CV Bullets]]"
---

---
```simple-time-tracker
{"entries":[]}
```
---

## 1. What is the problem or opportunity?

`gatherEvidence` (`lib/pipeline/tailoring.ts` §437) assembles the whole evidence graph C2 maps
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

The sharpest way to see the defect: `Process/C4…md` §B.4 instructs the step to *"include measurable
results, scale, or business impact **when they exist** in the Original Text"* and *"do not invent or
exaggerate results that are not supported by the evidence."* Both rules are correct and the step obeys
them. The table where the measurable results actually live was simply never passed in. The bullets are
built from actions, and actions describe what was done, not what it produced.

This also silently shapes [[C3 Selects the CV Evidence Set]]: any impact-weighted selection scores
bullets partly on whether they carry a quantified outcome, and today almost none can.

## 2. What would the improvement look like?

### 2.1 · Scope

**In:** making `star_results` citable evidence, and deciding the shape it is cited in.
**Out:** the selection budget ([[C3 Selects the CV Evidence Set]]), and any change to how C4 writes a
bullet beyond having the outcome available to write from.

### 2.2 · The one real design decision: alone, or paired with its action?

A STAR result is not a self-contained claim. `[1-R3]` — *"Gradual branch FTE reallocation… following
SCE go-live"* — is an outcome of something, and a bullet built from it alone would state a consequence
with no actor. Three options:

1. **Emit results as their own evidence kind** (`kind: 'STAR result'`), cited independently.
   Simplest. Risks bullets that report an outcome without the action that earned it.
2. **Emit results, and give C4 the parent STAR's action as context** so a cited result can be written
   as action-plus-outcome. Costs a join through `stars`; C4's prompt gains a context line.
3. **Emit a pre-joined action→result composite** as one evidence item. Cleanest for C4, but it
   fabricates an evidence node that exists in no table and would need its own ref code — a new
   citable identity that traces to nothing in the profile workbook.

> [!WARNING] What was built is (2) with the STAR's TITLE, not its action — 2026-08-25
> `gatherEvidence` sets `context` to `outcome of STAR <ref>: <star.title>`, so `1-R3` resolves to
> *"outcome of STAR 1: Establishment of a Servicing Center in Portugal"* and `4-R3` to
> *"outcome of STAR 4: Transfer Pricing — Master File Implementation"*. Neither is an action.
>
> **The spec above asked for something the schema cannot give.** `star_results` carries `starRef`,
> which points at the STAR — not at an action. A STAR holds roughly six actions and three results, and
> nothing records which action produced which result. So the title is the best available join, and the
> implementation is right; §2.2 was wrong to say "action" and is corrected here rather than in place,
> so the reasoning survives.
>
> **The missing edge is real and worth its own note.** The owner, shown `1-R3`, framed it exactly:
> *"you have created a result which does not have an Action behind it. What is the action behind it?"* —
> and could answer from memory. `4-R3` ("Agreement review reduced annual IT cost payments") plainly
> belongs to action `4-2` ("Reviewed, drafted and negotiated Master Agreements…"); the ref numbers even
> align. They align by ordering coincidence, not by anything modelled. A `result → action` link would
> let a bullet lead with what the candidate DID and close on what it produced, which is what §B.4 asks
> for. That is a schema column plus a curation pass, and it belongs to a note of its own.

**Recommendation: (2).** It keeps every ref code traceable to a real row, which is the property
`resolveVocab` and the C2 ref discipline both rest on, and it gives C4 exactly what §B.4 asks for —
the action to lead with and the measurable result to close on. (3) is rejected for the same reason
free-text graph tags were rejected as My Skills values: an identity the profile does not recognise.

### 2.3 · Current state to verify before building

- **Ref-code collision.** Result refs look like `1-R1`, `1-R2`, `1-R3`. Confirm they cannot collide
  with `star_actions` ref codes (`A-R3` and `5-3` both appear in live tailoring rows) — two evidence
  items sharing a ref would make `absorbC4Bullets`'s ref→bullet map ambiguous, and it keys on ref.
  **Correction, 2026-08-25:** only `5-3` is a `star_actions` ref. `A-R3` is a **Responsibility** —
  the two examples were lifted from `Process/C2…` §B's kind table and both attributed to the wrong
  one table here. That misses where the near-collision actually is; see §4.
- **`Evidence.cvPosition`.** Actions pass `cvPosition: null`; responsibilities and bullets derive one.
  Results need the same treatment as their parent action, or `templateFits` may reject the Keep set
  and silently drop C7 to the programmatic builder.
- **`Evidence.skills`.** `star_results` may or may not carry its own tags; if not, pass `[]` rather
  than inheriting the action's, so provenance stays honest.

### 2.4 · Implementation checklist

1. Add `star_results` to `gatherEvidence`'s query set, with the parent-STAR join for §2.2 option (2).
2. Extend the `Evidence` type with the optional parent-action context field, and render it in
   `c2UserMessage`'s evidence block.
3. Verify §2.3's three checks against live data before running anything paid.
4. Re-run C2 on one lead and confirm result refs appear in the map.

### 2.5 · Acceptance

- [x] `gatherEvidence` returns 22 additional evidence items on the live profile. — 113 → 135.
- [x] A re-run of C2 on `ee5c72bf` or `a9f2307b` cites at least one `*-R*` ref in the map. — `4-R3`
      on the Julius Baer lead, slotted to `B2. Transfer Pricing`.
- [x] The resulting bullet reads as action-plus-outcome and carries the number from the result row.
      — carries the GBP 1.2M figure that lives only in `metric`; see §4 for the one part of the
      mechanism this run did not exercise.
- [x] No ref-code collision: every evidence ref in `gatherEvidence`'s output is unique. — 135/135.

## 3. Resources or references

- `lib/pipeline/tailoring.ts` §437 `gatherEvidence`; §101 `c2UserMessage`'s evidence block.
- `lib/db/schema.ts` §187 `starResults`, §167 `stars`, §177 `starActions`.
- `Process/C4…md` §B.4 — the rule this unblocks.
- [[C3 Selects the CV Evidence Set]] — comes AFTER this one; **land the present CI first.** Budgeting over a candidate pool that
  is about to gain 22 quantified outcomes is tuning against inputs that are about to change; the same
  argument sequenced [[C3 Writes CV-Grade Skill Tags]] ahead of consolidation.

## 4. Notes / Progress log

### 2026-08-25 · Built and delivered

Implemented as §2.2 option (2). **The recommendation survived contact with the data unchanged** —
nothing in §2.3's checks argued for (1) or (3).

**What was built.** `gatherEvidence` gained `star_results` plus a `stars` join, and `Evidence` gained
an optional `context` field carrying `outcome of STAR <n>: <STAR title>`. `c2UserMessage` renders it
as an indented follow-on line under the evidence item, so it reads as context and never as a second
citable ref. §2.4 stopped there, and **that is where the checklist was short of its own acceptance**:
item 3 of §2.5 is a claim about a *bullet*, and C4 reads `originalText` off `requirement_tailoring`,
which snapshots the evidence text and nothing around it — so the context died at C2 and the bullet
step never saw it. Closed by adding `context` to `C4Row` and re-deriving the ref→context map in
`generateCv` from the same `gatherEvidence` call C2 was built on. No migration: the context is
derived from the profile, so re-deriving keeps it current and costs no column.

**§2.3 check 1 — ref-code collision: none, but the note had the near-miss in the wrong place.**
All 135 refs are unique. `star_actions` refs are `<star>-<n>` (`1-1` … `5-10`); **no action ref
contains an `R` at all**, so the `A-R3` this note cited as a `star_actions` ref is not one — it is a
**Responsibility**, numbered under a *position letter*. Both examples came from `Process/C2…` §B's
kind table and were attributed here to one table. It matters, because the real adjacency is
`Responsibility` `A-R3` against `STAR result` `1-R3`: **identical shape**, disjoint only because
positions are lettered and stars are numbered. That is one data-entry convention away from a silent
collision, so C2's note now says so in as many words rather than leaving it to hold by luck.

**§2.3 check 2 — `cvPosition`: passed `null`, same as a STAR action, exactly as asked.** A result's
parent STAR *does* have a derivable slot (`getCareerGraphFor`'s lane logic maps star 4 → `B2`), and
`normalizeCvPosition(link.cvPosition || ev.cvPosition)` would have made it a harmless fallback. Left
alone deliberately: duplicating that lane logic here would make a result better-slotted than the
action it came out of, and slotting belongs to whichever CI fixes it for both kinds. The live run
justified the restraint — C2 assigned `4-R3` to `B2. Transfer Pricing` on its own, correctly, and
C7 reported `real template`, so `templateFits` was never at risk.

**§2.3 check 3 — `skills`: `[]`.** `star_results` has no tags column at all (`ref_code`, `star_ref`,
`text`, `metric`, `impact_type`), so there was nothing to inherit even if inheriting were honest.

**One thing added that §2 did not ask for: `metric`.** The evidence text is
`text — measured: <metric>` where the column is populated (15 of 22 rows). This is not decoration —
`[2-R1]`'s sentence names the branches consolidated and **never says "EUR 1.5B"**, and `[2-R2]` never
says "350 MEUR"; those figures exist only in `metric`. Without it, the CI would have shipped
quantified outcomes with the quantities left in the database. Composing a node's text from its own
columns is what `Education` and `Language` already do, so no new precedent. It earned itself on the
live run: the delivered bullet carries "roughly GBP 1.2 million", a figure that appears nowhere in
`4-R3`'s sentence.

**Live verification (paid, approved before spending).** C2 on `ee5c72bf` (Julius Baer): `5 new · 0
improved · 59 unchanged · 0 pruned`, one Opus call. Only 3 requirements were in the targeted subset
(Core/Important rated Good/Weak/No Match), and one of the three drew a result — `4-R3` against
*CtB Budgeting and Controlling*, rated Good. Approving that row and running `generateCv` produced:

> **original:** Agreement review reduced annual IT cost payments to parent company by nearly 50% from
> GBP 2.4 million. — measured: ~50% IT cost reduction; GBP ~1.2M saving
> **bullet:** Renegotiated the intercompany IT services agreement with the parent company, cutting
> annual IT cost payments by nearly 50% from GBP 2.4 million — a saving of roughly GBP 1.2 million.

Action verb first (§B.3), outcome second, both numbers present. **The first CV bullet this system has
ever written from a recorded result.**

**What that run did NOT prove.** `4-R3`'s own text already opens on an action, so C4 correctly left
the `context:` line out — which is the case `Process/C4…` §B.4 now explicitly tells it to. The
context path therefore reached C4 but was never *used* live; the result that needs it most (`1-R3`,
"Gradual branch FTE reallocation… following SCE go-live", an outcome naming no actor) was not among
the three requirements this lead targeted. That half is pinned by unit test only. It costs another
paid run over a lead whose weak requirements reach into STAR 1 to close, and it is not worth a call
of its own — the next real tailoring run that cites an actor-less result will settle it.

**Left alone deliberately.** `gatherB6Evidence` still omits results: B6 scores against the Master
Bullet Bank plus education and languages by its own §A/§B.1.2, and widening it to the career graph
would erase the distinction between the initial screen and the tailoring pass — already documented at
`lib/pipeline/screening.ts` §198. `STEP_NOTE`'s missing C3/C7 keys and the `TAILOR_STEPS` /
`docs/PIPELINE.md` gaps were left as they are; they belong to [[C3 Selects the CV Evidence Set]].

**Side effect on the test lead.** The C2 re-run left 4 new `pending` rows on `ee5c72bf` besides
`4-R3` (`A-R5`, `7-4`, `B-R6`, `7-2`) awaiting the owner's triage, and regenerated that lead's CV
(ATS 78/100). No green row was pruned or reset — 63 green before, 64 after.

**Verification.** `npm run typecheck` clean · `npm test` 282 passing (275 + 7 new in
`lib/__tests__/star-result-evidence.test.ts`) · `scripts/snapshot-step-prompts.ts` moved exactly the
two hashes whose notes were edited (C2, C4), the other nine held, and `_step-prompt-baseline.txt` is
refreshed in this commit.

### 2026-08-24 · Opened

Found while measuring why generated CVs overflow two pages. The owner had independently reached the
same conclusion — *"we need to introduce the higher amount of STARs Results which works as evidences"* —
as a tuning instinct. It turned out to be a hard gap: not too few results used, but none available.
