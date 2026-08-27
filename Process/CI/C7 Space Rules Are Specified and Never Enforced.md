---
ci-area: CV Tailoring (C7 / template)
ci-roadmap:
ci-title: C7 Space Rules Are Specified and Never Enforced
ci-status: 0 - Idea
ci-priority: high
ci-date: 2026-08-27
ci-estimated-time: 5
ci-time-spent: 0
pr-source: "[[CV Template Output Format - Six Corrections]]"
pr-target: "[[C7. Compile Complete CV Document]], [[C5. Build and Manage the Skills Section]], [[C6. Drafting CV Profile (Per Job Lead)]]"
---

---
```simple-time-tracker
{"entries":[]}
```
---

## 1. What is the problem or opportunity?

**The CV is three pages. C7 §C says two, "Non-negotiable".** That table has been in the step note the
whole time, and nothing implements any row of it:

| C7 §C rule | Specified | What actually happens |
| --- | --- | --- |
| Maximum Pages | **2, non-negotiable** | 3 |
| Profile | max **5 lines** | C6 targets 4–7 lines / 70–110 words; runs measure 93–106 words |
| Skills Section | max **4 categories**, max **5 per category** | C5 §B.1 says 3–5 categories × 4–8; runs print 19–26 skills |
| Bullet Inclusion | only bullets linked to **Core or Important** skills | C3 selects by coverage; no such filter exists |

**Two live prompts carry different budgets.** C5 §B.1 and C7 §C disagree on the Skills section, and
both are loaded as system prompts. Whichever a reader consults, the other contradicts it.

### 1.1 · Why reducing the bullet budget did nothing

[[CV Template Output Format - Six Corrections]] swept `B` from 14 down to 9 and **the page count never
moved**. The reason is at `lib/pipeline/tailoring.ts` §655:

> *"Map Keep bullets into the template's 11 `cv_position` slots, **refilling any slot the Keep set
> doesn't cover from the bank** (projects) / responsibilities (role overviews) so the real 2-page
> template never renders a blank section."*

**Eleven fixed slots, always filled.** Selecting fewer tailored bullets substitutes bank bullets for
them; it does not shorten the document. `B` governs *what is tailored*, not *what renders* — so it can
never be the page lever, and no amount of tuning it will make it one.

That is the finding this CI exists to act on: **length is set by the slot structure and the section
caps, and neither is enforced.**

## 2. What would the improvement look like?

### 2.1 · The decision only the owner can make

He asked (2026-08-27) for a **6-line profile** and **max 6 skills per category**. C7 §C already says
**5 lines**, **5 per category**, **4 categories**. His numbers are looser than the ones already
written down.

**Resolve the conflict before building.** Either C7 §C's numbers stand and C5/C6 are brought to them,
or the owner's new numbers supersede C7 §C and it is rewritten. What must not survive is two live
prompts carrying different budgets. Bring the resolved numbers to one place and have the others cite
it.

### 2.2 · Words are the lever; lines are the outcome

C6's spec pins **both** lines and words (`Process/C6` §39 and §81, `lib/llm/schemas.ts` §689). The
model cannot see the rendering, so a line count is not something it can obey — it can only control
words. Make the word target authoritative, and **derive it by measuring** how many words fill a line
in the current template. The line figure then becomes an observation, not an instruction.

Same discipline everywhere: never state a rendered-output limit as a model instruction.

### 2.3 · The four levers, in the order they actually bite

1. **Stop refilling empty slots** — or decide deliberately that a slot with no selected evidence
   renders its header and no bullets. This is the largest lever and the reason `B` looked inert.
   Whether an empty role reads as a gap is a judgement worth putting to the owner with a rendered page.
2. **Enforce the Skills caps** — categories × per-category, whichever numbers §2.1 settles.
3. **Enforce the Profile cap** — as a word target derived by measurement.
4. **The Core/Important bullet filter** — C7 §C's fourth row. Note this overlaps
   [[C3 Selects the CV Evidence Set]]'s objective, which already weights Core above Important above
   Nice-to-Have. Check whether it is redundant before implementing it; a second filter doing what the
   objective already does would be two mechanisms disagreeing.

### 2.4 · Measure, do not assume

`soffice` is not installed; [[CV Template Output Format - Six Corrections]] established **Word via COM**
as the working method and left `scripts/render-cv-from-stored.ts`, which rebuilds a CV from stored
data **with no paid run**. Every measurement here is free. There is no excuse for a number nobody
checked — which is how `SKILLS_ENVELOPE = 40` and the 70–110 word target both came to be wrong.

### 2.5 · Acceptance

- [ ] One budget, in one place, cited by C5, C6 and C7 rather than restated differently in each.
- [ ] A generated CV is **two pages**, measured, on at least three real leads.
- [ ] The Profile obeys its cap, expressed as words, with the line count measured not instructed.
- [ ] The Skills section obeys the settled category and per-category caps.
- [ ] A deliberate, owner-approved answer to what an unfilled slot renders.
- [ ] `npx tsx scripts/verify-lead-run.ts <leadId>` updated if its Skills-count criterion changes.
- [ ] C8's ATS does not regress. Baselines: **88 ALDI · 84 Julius Baer · 78 Aliaxis · 72 Anritsu ·
      72 Allianz Services**.

## 3. Resources or references

- `Process/C7…md` §C — the table this CI implements. It is the specification; it just was never built.
- `lib/pipeline/tailoring.ts` §655 `templateSlotData` — the refill, and §1.1's explanation.
- `Process/C5…md` §B.1 and `Process/C6…md` §39/§81, `lib/llm/schemas.ts` §689 — the competing budgets.
- `scripts/render-cv-from-stored.ts` — free re-render, no model call.
- [[CV Template Output Format - Six Corrections]] §4 — the measurement that `B` is not the lever.

## 4. Notes / Progress log

### 2026-08-27 · Opened

The owner asked for two parameter changes to reach two pages. Checking them against C7 §C showed both
were *looser* than rules already written and never implemented, and that the C5 and C7 prompts have
been contradicting each other on the Skills budget the whole time.

Recorded so nobody re-derives it: the reason the bullet budget looked inert is the eleven-slot refill,
not the budget. A page limit enforced on selection can never work while the renderer tops the document
back up from the bank.
