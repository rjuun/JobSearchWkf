---
ci-area: CV Tailoring (C7 / template)
ci-roadmap:
ci-title: Never Render a Position Header Over Nothing
ci-status: 3 - Delivered
ci-priority: medium
ci-date: 2026-08-28
ci-estimated-time: 2
ci-time-spent: 3
pr-source: "[[C7 Space Rules Are Specified and Never Enforced]]"
pr-target: "[[C7. Compile Complete CV Document]]"
---

---
```simple-time-tracker
{"entries":[{"name":"Delivered","startTime":"2026-08-28T18:24:21+02:00","endTime":"2026-08-28T18:24:21+02:00"}]}
```
---

## 1. What is the problem or opportunity?

[[C7 Space Rules Are Specified and Never Enforced]] removed the slot refill: a `cv_position` slot the
selection does not cover now renders nothing, instead of being topped up from the bullet bank. That
was the largest single lever on CV length and it works.

**It also makes a state reachable that was previously impossible: a position whose slots are ALL
empty — a job title and its dates with nothing underneath.**

Measured across the six leads with a current shortlist, filled slots per position:

```
                   A    B    C    D
ALDI               4    3    2    1
Vestas             2    3    2    1
Aliaxis            3    2    2    1
Julius Baer        2    3    2    1
Allianz Services   2    2    2    1
Anritsu            3    3    2    1
```

Positions A, B and C hold two or more on every lead. **Position D holds exactly one, on all six** — it
is one selection away from rendering as a header over white space, and it is the last thing on the CV.

### 1.1 · Why an empty role overview is NOT the problem

An earlier draft of this reasoning proposed exempting the four role overviews (`A0` `B0` `C0` `D0`)
from the bullet budget, on the grounds that they are structure rather than evidence. **The owner
corrected it, and the correction is the design:**

> *"I don't see any problem when the 0's positions do not come to the CV because they do not
> contribute. They are written in this way because sometimes some experience is required running X and
> Y, and then the 0's bullets come to play. It is also the reason you will see no 'Responsibilities'
> headings in the CV as you see 'Key Projects'. Since they come right under the Name of the Position,
> it is clear for the reader that this is a description of the role."*

Role overviews are evidence with a different *shape* — written at role level so they can answer a JD
that asks about running a function. They compete on merit like everything else, and dropping out when
they do not contribute is the system working. Nothing is lost when one is absent, because no heading
announced it was coming. **`D0` empty on all six leads is correct behaviour, not a defect.**

The owner also names `D0`'s specific purpose: for the Lisbon Project Manager role it is *"meant to be
displayed as a short description of what I did, in case none of the Project Bullets are relevant."* So
it is the fallback — which is precisely why the failure case is `D0` **and** `D1` together, not either
alone.

## 2. What would the improvement look like?

### 2.1 · The rule, and the constraint that shapes it

An empty position may be **omitted**, but only where omitting it cannot leave a gap in the record. The
owner's constraint, 2026-08-28:

> *"The guard can only be applied if the empty Role is the last one, otherwise it could create a 'Hole
> in the CV'. It is okay for me to privilege the most recent 2 or 3 positions because they span
> somewhere between 11 to 13 years of experience already, but to have a blank in Role A or B or C
> would be a real problem."*

A missing position in the middle is not a formatting flaw — it reads as concealed time. Positions A and
B alone span July 2018–December 2024 and February 2013–June 2018, close to twelve years; adding C
reaches roughly thirteen. That is what makes dropping a *trailing* position acceptable and dropping an
interior one unacceptable.

**So the rule is about position in the sequence, not about which letter:**

- A position with zero filled slots that has **any non-empty position after it** must not be omitted —
  force its role overview back in, and let it cost a line.
- A **trailing** run of empty positions may be omitted entirely; the CV simply ends earlier.

Expressed over sequence rather than hard-coded to `D`, so it still holds if `CV_SLOTS` ever changes.

### 2.2 · Two things to decide while implementing

**What "force the overview back in" draws on.** The text has to come from somewhere when selection did
not choose it — the `responsibilities` table is the natural source, and is what the old refill used for
role overviews. Confirm before building.

**Whether a forced overview consumes budget.** It is one line, in a state that has not yet occurred.
Simplest is to render it outside the budget, like Education and Languages, since by construction the
position contributed nothing else.

### 2.3 · Implementation checklist

1. Group filled slots by position at render time, in `CV_SLOTS` order.
2. Identify positions with zero filled slots, and which of those are trailing.
3. Trailing empties: omit the whole position — header, dates, everything.
4. Interior empties: render the role overview, sourced per §2.2.
5. A test over a constructed selection that empties an interior position and a trailing one, asserting
   the two are treated differently. **This state does not occur on live data, so a unit test is the
   only thing that will ever exercise it.**

### 2.4 · Acceptance

- [x] An interior position with zero selected slots renders its header and a role overview — never a
      header alone, never nothing. Falls back to the position's first `responsibilities` row (§2.2).
- [ ] A trailing empty position is omitted entirely: no header, no dates, no gap — and no "Direct
      Reports" line. **Decision logic done and tested; the template re-tag it needs is written,
      dry-run clean and NOT YET RUN** — it waits on the owner committing his own hand edit to
      `CV_Template.docx`. See §4.
- [x] The six current leads render **byte-identical** to today — `word/document.xml` hashes compared
      pairwise, all six unchanged.
- [x] Page count unchanged on all six, counted in Word.
- [x] The rule is expressed over sequence position — `POSITION_LETTERS`, derived from `CV_SLOTS` — and
      a test pins that a lead with only its first position filled omits everything after it.

## 3. Resources or references

- `lib/cv-slots.ts` — `CV_SLOTS`, the eleven slots and their order; `slotCode`.
- `lib/pipeline/tailoring.ts` — `templateSlotData`, where slots are filled and where the refill was
  removed; `positions` for the display strings.
- [[C7 Space Rules Are Specified and Never Enforced]] — the CI that removed the refill and made this
  state reachable, and whose page rule already sheds bullets at render time.

## 4. Notes / Progress log

### 2026-08-28 · Opened

Found by mapping empty slots per position after the refill came out. The measurement is the argument:
position D sits at one filled slot of two on every lead, so the failure is one selection away rather
than theoretical.

Recorded because the first version of this guard was wrong in an instructive way. It proposed making
role overviews render unconditionally, treating them as structure like Education. They are not — they
are role-level evidence that competes, and the absent `Responsibilities` heading is the deliberate
design that makes their absence invisible. The real risk was never an empty overview; it is an empty
*position*, and only where omitting it would leave a hole.

### 2026-08-28 · Delivered

The guard is `applyPositionGuard` in `lib/pipeline/tailoring.ts`, called at the end of the slot fill so
it always sees the current selection. It groups filled slots by position in `CV_SLOTS` order, finds the
last position with anything under it, and treats everything after that as trailing.

**The six current leads render byte-identical** — `word/document.xml` extracted from each rendered
`.docx` and hashed before and after, all six unchanged, page counts unchanged. That is the acceptance
this CI actually has: none of the six is in the guarded state, so a correct implementation moves
nothing.

#### What the note got wrong

**§2.3 step 3 — "omit the whole position: header, dates, everything" — could not be done from the data
side, and the handover's "this CI should not need to [touch the template]" does not hold.** The position
header (`<<Position D Header>><<Position D Dates>>`) and the "Direct Reports: …" line under positions A
and B are plain unconditional paragraphs. Supplying empty strings leaves a blank paragraph where the
header was, and on A and B leaves the literal words "Direct Reports:" printing under nothing — which is
a worse version of the defect this CI exists to prevent.

So a third re-tag is needed: `scripts/retag-cv-template-positions.ts` wraps each position's header and
its Direct Reports line in `<<#Position X Visible>>` … `<</Position X Visible>>`. It finds the Direct
Reports paragraph by looking at what follows the header rather than from a list of letters, so a
position that gains or loses that line needs no change to the script.

**It has not been run.** The owner keeps `CV_Template.docx` open and edits it by hand — he fixed the D1
bullet indent there on 2026-08-28 and that change is still uncommitted — so running a script over it
would either clobber his work or fork the file. Asked, he chose to commit his edit first and have the
re-tag applied on top. Until that happens the guard's data is inert on the trailing case: every
`Position X Visible` key is written, and the template has no loop reading it yet. The interior case is
live now, because it needs no template change.

The sequencing is the point rather than an inconvenience: a tracked binary that two parties edit cannot
be merged, only ordered.

**The interior half needed no template change at all**, which is the asymmetry the note missed: the
role-overview loop already exists, so forcing an overview back in is pure data. That is why the two
halves ship at different times.

#### §2.2's two decisions

**Where a forced overview draws its text: `responsibilities`.** Confirmed against live data before
building — every position carries 3 to 9 rows keyed by `position_ref`, and it is the only table holding
role-level prose. The **first** row, not the two the old refill took: the rule promises one line to stop
a bare header, not a reconstruction of the role. Rows are in the owner's own authored order, so "first"
is a real priority rather than an arbitrary pick. A position with no responsibility row keeps its header
and gets no overview — degraded, and deliberately so, because a bare header is bad but a hole in the
record is worse.

**Whether it costs budget: it counts — the opposite of what §2.2 suggested.** The argument for exempting
it was that it should work "like Education and Languages", but those are outside `contentLineCost` for a
different reason: they are fixed furniture, on every CV, already absorbed into the calibrated allowance.
A forced overview is not fixed. It appears only in this state and occupies a real line when it does, so
an estimator that ignored it would be wrong exactly when the guard fires. Counting it costs nothing —
by construction the position contributed nothing else, so the document is already short.

#### How a state that cannot occur was tested

`applyPositionGuard` is **pure over `TemplateData`** — that is the whole design decision. The rule is
separable from the database, the model and the .docx, so a test can construct the selection directly
instead of trying to arrange one through C3. Thirteen tests in `lib/__tests__/c7-position-guard.test.ts`
build slot maps with chosen positions emptied and assert on the result: an interior empty is kept and
filled, a trailing empty is omitted, a trailing *run* is omitted whole, and — the case the rule exists
for — both in one document, treated differently.

Two of them guard the rule's shape rather than its behaviour: a lead with only its FIRST position filled
must omit everything after it (a rule hard-coded to the last letter would keep the middle ones), and a
position holding only a role overview counts as filled and is not trailing.

*Correction while here:* `lib/pipeline/skills.ts` justified its existence as a separate module by saying
`tailoring.ts` "cannot be imported under vitest". It can, and five test files already do. The real reason
is import cost, and the comment now says so.

#### Verification

- `npm run typecheck` clean. `npm test` — **395 passing, 3 failing**, the three being the pre-existing
  `capture-enrich.test.ts` fixture gap in a fresh worktree. 382 before, plus the 13 new.
- Six leads re-rendered from stored data at no model cost, `word/document.xml` compared pairwise:
  identical. Page counts unchanged, measured in Word over COM.

### 2026-08-28 · The re-tag applied — and it did not render identical

The blocker cleared: the owner's hand edit to the template (the D1 bullet indent) was committed as
`8be3129`, so the ordering this note asked for could complete. `scripts/retag-cv-template-positions.ts`
ran clean and wrapped all four positions — headers on A–D, plus the "Direct Reports:" line on A and B.

**The acceptance this note set for itself did not hold, and that is the finding.** It predicted the six
current leads would render byte-identical, since every one of them sets every position visible. They did
not. `word/document.xml` was extracted and hashed before and after: all six differed, each about 500
bytes shorter, and the diff was in exactly the paragraphs the re-tag had touched.

**Every position header and every date rendered BLANK.**

The cause is in `lib/docx/template.ts`, not in this CI's own code. Its raw-tag parser resolved a tag
against the CURRENT scope and returned `''` when the key was absent:

```ts
get: (scope) => (tag === '.' ? scope : scope?.[tag] ?? '')   // before
get: (scope) => (tag === '.' ? scope : scope?.[tag])          // after
```

Inside `<<#Position A Visible>>` the scope is the marker element `'x'`. `<<Position A Header>>` therefore
looked up a property of a string, found nothing, and resolved to the empty string **instead of looking
outward to the enclosing scope**. Returning `undefined` is docxtemplater's signal to walk out; `''` is a
found value and stops the search. `nullGetter` still blanks a tag that is unmapped everywhere, so the
behaviour for genuinely missing tags is unchanged.

This is the second time a defect in this template path has been invisible for the same reason: **a
missing value and an empty one are indistinguishable to a renderer.** Nothing threw, no test failed, and
the six CVs would have gone out with no job titles on them. It was caught only by comparing rendered XML
against the previous version — the check this note wrote down as its acceptance, which is the argument
for writing that kind of acceptance down.

After the fix, all six render **textually identical** to before, verified by `pandoc -t plain` diff. The
only XML delta is two `xml:space="preserve"` attributes docxtemplater adds; no text moved, and page
counts are unchanged at two.

`lib/__tests__/template-scope.test.ts` pins it — four tests against the REAL template, because the defect
lived in the seam between the template and the parser and a hand-built fixture would not have had the
loop in it. Confirmed to fail against the old parser before being kept.

#### Why `2 - Testing` and not `3 - Delivered`

Both halves are now live and machine-verified. What cannot be done is the thing the procedure asks for:
**no current lead can reach the guarded state**, so there is nothing for a human to click through. The
trailing case fires only when a position's last project bullet is dropped, and C3 does not currently do
that to any of the six.

That is a waiver, not a pass, and it is recorded here rather than assumed: the guard is proven by
thirteen unit tests over `applyPositionGuard` and by four render tests, and it will be observed in the
wild the first time a lead selects nothing under position D. Move to `3 - Delivered` when that happens,
or when the owner is content to close it on the test evidence alone.

#### Verification

- `npm run typecheck` clean. `npm test` — **407 passing**, up from 403: the four new render tests.
- Six leads re-rendered and rewritten in place; headers confirmed present in Word over COM, two pages each.

### 2026-08-28 · Closed — live verification waived, with the reason

The owner, asked whether to hold at `2 - Testing` until the guarded state occurs in the wild:
*"this is a safety guard that I imagine will take really long to be implemented. Lets close it."*

So the one open criterion is waived deliberately rather than left to lapse. What it was waiting for is a
lead whose selection empties a trailing position — the state the guard exists to catch — and the whole
point of the guard is that this is rare. Holding a note open against an event nobody wants to happen
turns the status into a lie about whether anything is left to do.

**What is actually verified**, so the waiver is not mistaken for a pass later:

- Both halves are live. The interior case forces a role overview back in; the trailing case omits the
  header and the Direct Reports line through the `<<#Position X Visible>>` loops the third re-tag added.
- Thirteen unit tests over `applyPositionGuard`, which is pure over `TemplateData` — that purity is what
  let the unreachable state be constructed directly instead of arranged through C3.
- Four render tests against the real template, covering the visible and omitted cases.
- The six current leads re-rendered textually identical, at two pages, headers intact.

**What is not**: nobody has seen it fire on a real lead. If a position ever prints its header over
nothing, or a role vanishes that should not have, this note is where to start — not because the rule is
in doubt, but because that would be its first live observation.
