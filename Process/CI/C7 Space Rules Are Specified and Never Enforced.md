---
ci-area: CV Tailoring (C7 / template)
ci-roadmap:
ci-title: C7 Space Rules Are Specified and Never Enforced
ci-status: 3 - Delivered
ci-priority: high
ci-date: 2026-08-27
ci-estimated-time: 5
ci-time-spent: 5
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

### 2.1 · Decided by the owner, 2026-08-27 — including where the decision lives

Shown the arithmetic (C7 §C's 4x5 would shed 1 / 5 / 7 skills on the three measured leads; 6 per
category sheds 0 / 2 / 1), he settled all three questions:

**Skills — ceiling 5 categories x 6 skills, target 4 x 5.** A ceiling and a target, not one number:
*"it feels like a 5x6 is the max this section can bear, ideal being a 4x5."* The ceiling is what the
code enforces; the target is what the prompt asks for.

**Profile — maximum 6 lines, and the line is the truth.** *"Regardless of the number of words,
crossing the 6 lines feels already too long for the attention span of a Headhunter/Talent Acquisition
Manager."* So the constraint is the rendered outcome, not the word count — see §2.2 for how a model
that cannot see the rendering is made to hit it.

**And the budgets move to the steps that own them.** His framing, which supersedes this note's own
proposal of "one number in one place":

> *"In terms of Process design, I would set the decision where it belongs (Skills at C5 and Profile at
> C6), leaving C7 as much as possible as a simple compiler and orchestrator of the 2 page CV."*

That is better than picking a winner between two prompts. **C7 §C should not carry section budgets at
all.** Move the Skills numbers into `Process/C5…md` §B.1 and the Profile cap into `Process/C6…md`, and
reduce C7 §C to what only C7 can enforce: the two-page outcome, and what gives way when it is
exceeded. A compiler does not decide how big a section may be; it decides whether the document fits
and what to do when it does not.

This also removes the class of defect rather than the instance. Two prompts disagreeing about the
Skills section was possible because both claimed authority over it. After this, only one can.

### 2.2 · The line cap is the truth; the word target is how the model hits it

The owner's constraint is **6 rendered lines**. A model cannot see the rendering, so it cannot obey
that directly — it can only control words. So:

- **6 lines is the acceptance criterion**, checked against a rendered page.
- **The word target is the instruction**, and it is *derived* by measuring how many words fill six
  lines in the current template. Not estimated — measured, with `scripts/render-cv-from-stored.ts`.
- When the template changes, the word target is re-derived. The line cap does not move.

C6's spec currently pins both independently (`Process/C6…md` §39 and §81, `lib/llm/schemas.ts` §689),
which is how they came to disagree. After this, one is derived from the other.

**Never state a rendered-output limit as a model instruction.** That rule is what this whole CI is
about.

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

### 2.4a · Education needs a status field (added 2026-08-27)

The owner shortened two Education titles in the database so their dates fit on one line, and one of
them now needs a qualifier rendered **beneath** the entry:

> *Master's Quantitative Asset & Risk Management* — "(coursework complete, thesis not submitted)"

`education` carries `refCode`, `institution`, `qualification`, `type`, `year`, `cityCountry` and **no
notes or status column**. Folding the text into `qualification` would push the title length back up —
the exact problem he just fixed by shortening it. **Add a column** and render it as a sub-line.

In scope here because it touches the same Education rendering the line budget does; small enough not
to need its own note.

### 2.5 · Acceptance

- [x] Skills budget lives in C5 only; Profile budget in C6 only; **C7 §C carries neither**. All figures in `lib/cv-budget.ts`; the notes cite it.
- [x] Skills: ceiling 5 categories x 6 skills enforced in code (`capSkillGroups`, which repacks before it sheds); target 4 x 5 asked for in the prompt.
- [x] Profile: 6 rendered lines, verified on a page; 70–80 words derived from a measured 112 chars/line and 8.2 chars/word, then re-checked with `--profile-words`.
- [x] `education.status`, migration 0041, backfilled off the old notes convention and split at import in `seed.ts`. Renders as a sub-line — see page 2 of the sample.
- [x] **Two pages on all five**, counted by Word: 90 / 91 / 93 / 90 / 90 lines, from 100 / 127 / 114 / 106 / 133.
- [x] The Profile cap is words in the prompt and lines on the page; `lib/llm/schemas.ts` states only words, and C6's step report prints both.
- [x] The Skills section obeys the ceiling in code and reports anything shed at it; `verify-lead-run.ts` fails a run that sheds.
- [ ] A deliberate, owner-approved answer to what an unfilled slot renders. **Built and rendered — awaiting his look.** An empty project loses its caption with its bullets and the survivors renumber; an empty role overview loses its paragraph, so position D prints its header and goes straight to Key Projects (page 2 of the sample).
- [x] `verify-lead-run.ts` updated — Skills criteria read the ceiling from `cv-budget.ts`, shedding is a FAIL, and the C7 line cost and trim are reported.
- [ ] C8's ATS does not regress. Baselines: **88 ALDI · 84 Julius Baer · 78 Aliaxis · 72 Anritsu ·
      72 Allianz Services**. **Not re-measured — it needs a paid run.** No evidence changed except what the page trim took on the leads that needed it, so this is a check for the next run rather than a claim made here.

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

### 2026-08-27 · Delivered — two pages, measured

**All five reference leads render at two pages, counted by Word over COM** (`ComputeStatistics(2)`),
against a baseline where all five were three. Line counts 100 / 127 / 114 / 106 / 133 → 90 / 91 / 93 /
90 / 90. Nothing here is asserted: `scripts/cv-pages.ps1` is the measurement and it is committed
alongside the change, so the claim is re-checkable in a minute at no model cost.

#### What the note got wrong, and it matters for the diagnosis

**§1 said C5 and C7 are "both live system prompts". C7 is not loaded as a prompt at all** — `STEP_NOTE`
in `lib/prompts.ts` omits it deliberately, because C7 makes no model call. So the contradiction was
worse than symmetrical: C5 §B.1 was the version the *model* was given on every run, and C7 §C was the
version a *reader* would quote, with nothing to make them meet. That is why the fix had to be
ownership and not just reconciliation.

**§1.1's account of the refill is right that it made `B` inert, and understates it: the refill INVERTS
`B`.** Refilling is per-slot and unbounded — an emptied slot came back with *every* bank bullet
carrying that `cv_position`, up to four. So a slot that lost its one tailored bullet gained four bank
ones, and the line count rose as bullets came out. That is the mechanism behind
[[CV Template Output Format - Six Corrections]] §4's otherwise puzzling measurement that sweeping
`B` 14 → 9 left page count flat while *raising* the line count. Measured before the change, the refill
was contributing **2 / 4 / 6 / 10 / 12 lines** on the five leads.

**§2.4a said `education` "has no notes or status column". It has `notes`.** The status line was already
printing — out of `notes`, by a formatting convention (a leading parenthesised line means "print me").
The instruction to add a column was right anyway, and for a better reason than the one given: the
convention made every future note that happens to open with a bracket into CV-facing text, with no way
for whoever wrote it to know. Migration 0041 lifts the one row that used it into `education.status` and
retires the rule; `scripts/seed.ts` splits the workbook's single cell at import so a re-seed cannot
silently drop it again.

**The handover's "do not try to tune `B` into a page lever" was true only while the refill stood.**
With the refill gone `B` is a lever, and a blunt one — but it stays C3's parameter and was not touched.

#### The levers, and what each was worth

1. **The refill is gone** (`scripts/retag-cv-template-space.ts`). It could not simply be deleted: the
   project caption, the "Key Projects:" line and the role-overview placeholder were static or
   unconditional template text, so an empty slot left a caption announcing a project with no bullets
   under it. That is *why* the refill existed. All three are now loops over nought-or-one, the caption
   is data, and the surviving projects renumber. **Worth 4–35 lines per lead** — by far the largest.
2. **Skills caps** — §2.1's numbers, in `lib/cv-budget.ts`. Target 4 × 5 in the C5 prompt, ceiling
   5 × 6 enforced in code by `capSkillGroups`, which **repacks before it sheds** so §B.5's "merge,
   never drop" holds as far as the grid allows, and names anything it could not place. Worth ~4 lines
   at the ceiling, ~6 at the target.
3. **Profile cap as words.** Six rendered lines is the rule; **70–80 words** is the instruction, derived
   by measuring the template's own column (112 chars/line, 8.2 chars/word — both from five real
   profiles) and then *verified on a rendered page* with the new `--profile-words` handle rather than
   trusted. Worth 1–2 lines.
4. **The Core/Important bullet filter is REDUNDANT — measured, not argued.** C3's objective already
   weights Core 3 / Important 2 / Nice-to-Have 1. Across the whole catalogue: **0 of 82 selected
   bullets, over 174 leads, would have been dropped by it.** Retired from C7 §C with that number
   recorded, rather than built as a second mechanism that agrees with the objective until it doesn't.

Two levers the note did not anticipate, both found by looking at a rendered page:

5. **Languages on one line.** Four bulleted paragraphs for four three-word facts, against a C7 §C rule
   that has always called it "a small separate section at the bottom". On three of the five leads those
   four lines *were* the entire page-3 overflow. Worth 3 lines on every CV, at no cost to content.
6. **C7 now has a page rule that acts.** `contentLineCost` estimates the assembled document at the
   measured column width and, past `CONTENT_LINE_ALLOWANCE`, sheds the lowest-ranked project bullet
   from the end of C3's own `shortlist_rank` order — never a role overview, never a position's last
   bullet, always reported on the C7 step. This is the §C row the owner kept with C7: *what gives way
   when it does not fit.* The allowance is **calibrated against Word, not derived** — ten
   estimate/page-count pairs, and 67 is the value that separates every two-page render from every
   three-page one.

#### Where the budget lives now

`lib/cv-budget.ts` — every figure, each with its measurement beside it, imported by the prompt that
states it, the validator that checks it and the renderer that spends it. The step notes **cite** it:
Skills to C5 §B.1, Profile to C6 §B.6, and **C7 §C keeps neither**, reduced to the page limit and the
trim rule. `SKILLS_ENVELOPE = 40` is gone; it had never bound, because no lead has ever printed more
than 28.

#### Verification

- `npm run typecheck` clean. `npm test` — **382 passing, 3 failing**, all three the pre-existing
  `capture-enrich.test.ts` fixture gap in a fresh worktree. 14 new tests in `c7-space-budget.test.ts`.
- `scripts/snapshot-step-prompts.ts` reproduces the baseline for every step **except C5 and C6**, the
  two notes this CI edited; both re-baselined.
- `scripts/verify-lead-run.ts` updated: its Skills criteria now read the ceiling from `cv-budget.ts`,
  shedding at the ceiling is a FAIL rather than a note, and the C7 line cost and any trim are reported.
- ATS baselines are untouched by this work — no C8 re-run was spent. The change is compilation and
  budget, and the evidence C8 rates is the same evidence, minus what the page trim took on the leads
  that needed it. **Worth re-checking on the next paid run**, since a trimmed bullet is one fewer for
  the rating to see.

#### Still open

- The bullets under **D1. Servicing Center Project** print at a shallower indent than every other
  project's (`w:ind left="426"` against 567, and `numId=7` against 2–6). **Pre-existing** — identical in
  the template at `HEAD` — so left alone rather than folded into this CI. Flagged separately.
- A **paid end-to-end run** has not been spent. Every measurement here is a re-render of stored content
  through the new code, which exercises C7 and the template completely but takes C5's and C6's new
  instructions on trust. The five two-page renders above hold with the *old* budgets' content
  (93–106-word profiles, 19–28 skills), so the page limit does not depend on the new prompts landing —
  but that they land is the one thing still unmeasured.
