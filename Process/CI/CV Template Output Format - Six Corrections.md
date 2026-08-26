---
ci-area: CV Tailoring (C7 / template)
ci-roadmap:
ci-title: CV Template Output Format - Six Corrections
ci-status: 3 - Delivered
ci-priority: high
ci-date: 2026-08-27
ci-estimated-time: 4
ci-time-spent: 4
pr-source: "[[C7. Compile Complete CV Document]]"
pr-target: "[[C7. Compile Complete CV Document]], [[C1. Overall Application Content and Format Guidance]]"
---

---
```simple-time-tracker
{"entries":[]}
```
---

> [!IMPORTANT] Delivered 2026-08-27 — read §4 before this body
> All six landed, plus six more from a second review the owner made of the first re-render. Two
> things in the body below turned out to be wrong and are corrected in §4: **item 2 inverted** (the
> banners never had glyphs; the ◆ dividers came OUT), and **item 4 was template text, not code**.
> The two-page goal was called off by the owner mid-CI; `B` stays 14, and the measurement showing
> that `B` is not the lever on CV length is the part worth keeping.

---

> [!IMPORTANT] This is the format work the owner deliberately deferred
> Throughout the C-phase epic (CI-042/047/048/049/050/051/052) the owner held template and output
> formatting back until bullets and skills were right: *"Once they are done, I will move back to some
> final tuning in the template and output format."* They are done — the epic closed 2026-08-26 with a
> CV of 14 bullets and 19 skills. **This is that work.**
>
> One consequence: [[C3 Selects the CV Evidence Set]] §2.6 left the bullet budget `B = 14` as a
> deliberately provisional parameter, because *"a page budget calibrated against a template that is
> about to change is a number nobody should trust."* The template is now changing. Re-calibrating `B`
> belongs with this note — see §2.7.

---

## 1. What is the problem or opportunity?

The generated `.docx` is correct in content and wrong in six specific ways in presentation. The owner
marked up a real output against how it should read (2026-08-26). Each item below is his, verbatim
where it matters.

| # | What is wrong | Where |
| --- | --- | --- |
| 1 | The relocation line always prints | header |
| 2 | Section-header icons do not render | all headings |
| 3 | Skills print as a vertical bullet list | Skills |
| 4 | Project numbering does not restart per position | Professional Experience |
| 5 | Only the first bullet of each group gets a bullet glyph | everywhere |
| 6 | Education dates wrap to the line below | Education / Executive Education |

### 1.1 · Item 5 has a probable root cause, and it explains the shape of the bug

> *"Every bullet has a 'bullet'. In the output from the last CVs, only the first bullet is actually
> bulleted."*

`buildCvFromTemplate` (`lib/docx/template.ts` §40) takes a flat `Record<string, string>` and
docxtemplater substitutes each value into **the paragraph the placeholder sits in**. Multi-line values
are built by joining with `\n` — `data['Education']` joins with `\n\n`, `data['Skills']` with `\n`. A
`\n` inside a substituted value becomes a line break *within one paragraph*, and Word applies list
formatting per paragraph. So the paragraph gets its bullet, and every subsequent line is a soft break
inside it, unbulleted.

**The corroborating detail:** `data['Languages']` already prefixes each line with a literal `"•  "`
(`lib/pipeline/tailoring.ts` §738, commented *"Unicode bullet per line, matching the owner's original
CV convention"*). Someone hit this once and worked around it for that one field. That workaround is
the evidence, not the fix.

Verify before building — this is a hypothesis from reading, not a measurement.

## 2. What would the improvement look like?

### 2.1 · Relocation line — conditional, and name the right city

> *"Should only appear in case position is not in Vienna and should mention the city where the
> position is located."*

Today `data['Relocation']` prints `profiles.relocation` unconditionally, so a Vienna role reads
*"Vienna 1020, Austria (Willing to relocate to London)"* — irrelevant at best, wrong at worst.

Suppress it when the lead's city matches the candidate's, and otherwise name **the lead's** city.
`job_leads.city` is the input. Decide what "matches" means (exact, case-insensitive, or a small alias
set) and what happens when the lead has no city — silence is the safe default.

### 2.2 · Section-header icons

> *"The unicodes are missing."*

PROFILE, SKILLS, PROFESSIONAL EXPERIENCE, EDUCATION, EXECUTIVE EDUCATION and LANGUAGES each carry a
glyph in the owner's own CV; the generated file renders none. Establish first whether the glyphs are
absent from the template, present but stripped on render, or present in a font the renderer cannot
resolve — the three have different fixes and only one is a template edit.

### 2.3 · Skills — bold category line, then one inline run

> *"Skill Categories are Bold in a separated line. The skills themselves can continue as they are in
> a single line separated by bullets."*

Target shape:

```
Core Capabilities
Strategic Execution & Governance · Cross-Functional Transformation · Process & System Design
```

`data['Skills']` is already built as `"Category: a · b · c"` joined by `\n`
(`lib/pipeline/tailoring.ts` §688) — the inline separator is right and the category prefix is not.
The category needs its own **bold** paragraph and the skills a plain one beneath, which means this
value can no longer be one flat string. Same structural problem as item 5.

### 2.4 · Project numbering restarts per position

> *"Notice that the numbering of the projects start from 1 for every new position."*

Under *Head of Governance & Strategy* the projects read 1, 2, 3; under *Deputy Head of Controlling &
IT* they must restart at 1, 2 — not continue at 4, 5.

### 2.5 · Education and Executive Education — date on the same line

> *"The date should come not in the line below, but rather right-indented at the same line of all the
> other fields."*

Target: qualification and institution left, date right-aligned on the same line — a right tab stop,
not spaces. `eduLine` (`lib/pipeline/tailoring.ts` §721) builds these today.

**The owner is fixing the one case that would not fit** by shortening *IMD Business School of
Management* to *IMD Business School* in the database. That is his edit, not this CI's: do not rewrite
profile data here. But **the layout must not depend on it** — a long institution name should wrap or
truncate gracefully rather than pushing the date onto its own line again.

### 2.6 · The structural question underneath items 3 and 5

Four of the six are one problem: **a flat `Record<string, string>` cannot express paragraph
structure.** Bulleted lists, bold-then-plain pairs and right-aligned tabs are all paragraph-level
formatting, and a `\n` inside a substituted string is not a paragraph.

Two routes, and the choice shapes the work:

- **Keep the flat contract**, encode structure with literal glyphs and tabs — extends the `"•  "`
  workaround already in Languages. Cheap; leaves the template unable to express anything richer.
- **Move to docxtemplater loops** (`{#items}…{/items}`), so the template owns the repeating paragraph
  and the data supplies the values. Correct, and means re-tagging the template once.

The second is what the template is for. `docs/ARCHITECTURE.md` already flags *".docx 2-page fidelity"*
as the highest-risk area with *"re-tag template once"* as the plan — this is that moment.

### 2.7 · Re-calibrate the bullet budget, last

`B = 14` was set from the owner's 13–16 estimate against the *old* template and explicitly marked
provisional. Once the six corrections land, measure the real page count and re-set `B` if it is wrong.

[[C3 Selects the CV Evidence Set]] §2.6 left the measurement method open: render and count with
LibreOffice if `soffice` is available, or a line-count proxy. **Decide it here** — this is the note
that has a stable template to measure against. `B` is a named parameter; changing it must not require
touching `lib/pipeline/selection.ts`.

### 2.8 · Acceptance

- [x] A Vienna lead prints no relocation line; a non-Vienna lead names that lead's city. — checked on
      three real leads: Anritsu (Vienna) silent, Vestas (Copenhagen) and Allianz (Barcelona) each
      naming their own city.
- [x] ~~Every section header renders its glyph.~~ **This item inverted on contact with the page** —
      see §4. The banners never had glyphs in any committed template; what the CV had were three ◆
      dividers, and the instruction on seeing them rendered was *"eliminate these unicode symbols to
      save space"*. They are gone. No glyph was added.
- [x] Skills read as bold category line + inline `·` run.
- [x] Project numbering restarts at 1 under each position.
- [x] **Every** bullet renders a bullet, in every section — including Languages, whose literal `"•  "`
      prefix is gone with the cause of it.
- [~] Education and Executive Education dates sit right-aligned on the entry's own line. Seven of the
      nine dated lines fit; two Education heads are long enough to wrap, and their date then moves
      whole to the wrap line rather than splitting mid-range (`fmtDateRangeAtomic`). A single
      paragraph cannot hold a long head on line 1 *and* its date beside it — only a two-column table
      can, and that is an ATS risk this CV should not take. See §4 for the two entries and the lever.
- [~] ~~The CV is two pages~~ — dropped on the owner's instruction, 2026-08-27: *"I don't think we can
      try and fit the CVs into 2 pages, so let's not waste time trying to do so."* `B = 14` is
      untouched. **The measurement was made and is worth keeping**: the CV was 3 pages BEFORE this CI
      and is 3 pages after, and `B` is not the lever — see §4.
- [x] `npx tsx scripts/verify-lead-run.ts <leadId>` still passes. It broke exactly as predicted, and
      the break was read before it was fixed — see §4.

## 3. Resources or references

- `lib/docx/template.ts` — `TEMPLATE_PATH` §29, `buildCvFromTemplate` §40, and the custom parser note
  at §18 explaining why tags with spaces and dots need special handling.
- `lib/pipeline/tailoring.ts` — the `data[...]` assembly §658–738: `Skills` §688, `eduLine` §721,
  `Education` §730, `Executive Education` §731, `Languages` §738.
- `Group CVs/CV_Template.docx` — the template itself. The owner has it open; coordinate before editing.
- `Process/Development/Click Test - Tailoring a Lead End to End.md` — the end-to-end routine, and how
  to produce a CV to inspect.
- [[C3 Selects the CV Evidence Set]] §2.6 — why `B` is provisional and what it is waiting for.

## 4. Notes / Progress log

### 2026-08-27 · Opened

Drafted from the owner's own annotated markup of a generated CV, made 2026-08-26 the day the C-phase
epic closed. Six items, numbered as he numbered them.

Recorded because it will save the implementing session a measurement: items 3 and 5 are almost
certainly the same defect — a flat string contract cannot carry paragraph structure — and the
`"•  "` prefix already sitting in the Languages field is the fingerprint of someone hitting it before
and working around it once.

### 2026-08-27 · Delivered, in two rounds

§1.1's root cause held, and it was measured before anything was built. A probe rendered three bullets
into one slot and read the XML back: one `<w:p>`, one `<w:numPr>`, three `<w:t>` runs and two
`<w:br/>`. A flat value cannot carry paragraph structure, exactly as the note reasoned from the
`"•  "` fingerprint in Languages.

**The flat-contract vs loops decision went to loops**, put to the owner with the prototype already
working. Both routes were feasible for items 5 and 6; item 3 was not — a category cannot be bold and
its skills plain inside one substituted string, because bold is a run *inside* a paragraph and every
line of a flat value shares one paragraph. That settled it. `docs/ARCHITECTURE.md` already named
"re-tag template once" as the plan for this and this was the moment. The custom raw-tag parser took
one line to support loops (`<<.>>` → the loop item itself); everything else is template.

The re-tag is `scripts/retag-cv-template.ts` rather than a hand edit in Word, because the template is
a tracked binary and a hand edit lands in git as an opaque blob. The script names all 22 paragraphs it
rewrites, refuses to run twice, and fails loudly if any anchor has moved.

**A second round arrived mid-CI**, from the owner marking up the first re-render: the headshot line
made conditional on C1, the ◆ dividers removed, Education/Exec-Education notes dropped, one grey
`MMM YYYY` treatment for every date, one black-bold treatment for every first-level heading. All six
landed. Both rounds are in one commit.

#### Verification did not cost a run

`scripts/render-cv-from-stored.ts` rebuilds a lead's CV from what a paid run already stored — evidence
rows and profile from the database, the tailored profile from the C6 step report, C4's bullets off
`requirement_tailoring.cv_bullet`, and the Skills grouping parsed back out of the previously rendered
`.docx` (C5 stores category names and counts, not items, so the document is its only surviving
record). Every render and every page count below is real data at zero cost. That the template was the
least-verified part of the build — because looking at it used to cost a run — is a fair account of how
it accumulated six defects at once.

Page counts come from **Word itself** over COM (`ComputeStatistics(2)`), not LibreOffice: `soffice` is
not installed here, Word is, and Word is the renderer the CV is actually read in. That is §2.7's open
measurement method, decided.

#### The budget: measured, and then set aside

- Before this CI, at `B = 14`: **3 pages**, 115 lines. After: **3 pages**, 107 lines.
- Swept `B` = 14 → 9 by truncating C3's `shortlist_rank` order. Page count never moved, and the LINE
  count went *up* as bullets came out.

That last fact is the one worth keeping. **`B` is not the lever on CV length.** When a project slot
empties, `templateSlotData` refills it from the bullet bank so the section is never blank — so
lowering the budget swaps tailored bullets for bank bullets rather than shortening the document. Any
future attempt to reach two pages has to start there, not at `B`.

The owner then called the two-page goal off — *"let's not waste time trying to do so"* — and asked for
space to be found elsewhere instead. The ◆ dividers, the Education notes and the conditional headshot
line are that: eight lines back, with `B` untouched at 14.

#### verify-lead-run.ts broke, as the note predicted

It read the Skills section by splitting each line on its colon, keyed to the old `"Category: a · b"`
layout. §2.3 gave the category its own paragraph, no line had a colon, and it returned **zero**
entries — reported as `0 in the .docx · 19 in the step report`, i.e. as a mismatch against C5 rather
than as a parse failure. Failing that way is worse than failing loudly: it points at the wrong step.

Fixed by moving the read-back into `lib/docx/cv-skills.ts`, which knows both layouts (twenty
already-generated CVs on disk carry the old one) and is now shared with the re-render script — the two
had duplicate parsers, and only one of them broke. Eight tests cover both layouts and both ways they
have bitten. The checker's two remaining FAILs on the Anritsu lead — 6 categories, 1 unplaced skill —
are properties of that stored C5 run and fail identically against the pre-CI document.

#### Five defects found on the way, none of them in the six

1. **`headshotDecision` had never once fired.** It compared `city.toLowerCase()` against bare city
   names while `job_leads.city` holds `"London, United Kingdom"`, so the equality never held for any
   lead in the build's history. It also read C1's rule off the wrong column — C1 decides by COUNTRY
   (UK, IE, DK, NL, CA) and only mentions cities as examples. Now every comma-separated part is
   tested. The Vestas lead is the first CV ever to print that line for the reason it states.
2. **A trailing-period trim with a false premise.** `templateSlotData` ended with
   `.replace(/\.\s*$/, '')`, commented *"the template already prints `<<…>>.`"*. No committed version
   of the template puts a period after any placeholder. What it actually did was strip the full stop
   from the LAST line of every group — visible in the 2026-08-26 CV, under every position, two bullets
   ending in "." and a third ending in nothing. Gone.
3. **The `"•  "` prefix in Languages was load-bearing, and is now removed** along with its cause.
4. **`e.dateCompleted ?? …` was wrong for the in-progress Master's.** That row holds an EMPTY STRING,
   not null, so `??` accepted it as a completion date and the entry printed "Sep 2016" where it had
   read "Sep 2016 — Present". Caught because the owner edited the row mid-CI. `||`, not `??`.
5. **Bullet order within a slot is non-deterministic.** `loadGreenRows` has no `ORDER BY` and
   `selected` is never sorted, so the same evidence set can print in a different order run to run.
   Pre-existing, not touched here, and not a format matter — but it will make any future
   before/after CV comparison noisy.

#### What the brief got wrong

- **Item 2 was inverted.** The note recorded *"the unicodes are missing"* and reasoned that the
  banners had lost glyphs, offering three hypotheses (absent / stripped / unresolvable font). None
  applied: no committed template ever carried a banner glyph. The ◆ characters in the file were
  section dividers, and the owner's instruction on seeing them rendered was to delete them. An item
  written from a marked-up printout described the opposite of what it turned out to mean.
- **Item 4 was not a code bug.** §2.4 sat under "Professional Experience" as though numbering were
  computed. The numbers are literal text in the template — `4.`, `5.`, `6.`, `7.` — and no code change
  could have reached them. A dry-run of the template's own text would have shown that in a minute.
- **The two-page acceptance criterion assumed a two-page CV.** It read as though the format work
  might cost the second page. The CV was already three pages before this CI touched anything.
- **The handover said the owner had the template open and modified.** His tree was clean; the file
  was not modified. Worth asking anyway — he was editing profile DATA throughout, which changed the
  Education section under the render mid-CI.

#### Still open, and it is the owner's lever

Two Education heads are long enough that their date wraps to a second line (right-aligned, whole):

- `Master's Quantitative Asset & Risk Management (Thesis Pending), FH des BFI, Vienna, Austria`
- `Leading Sustainable Business Transformation, IMD Business School, Lausanne, Switzerland`

Both fit at 10pt and wrap at 11pt, which is the size the position headers already used and which
`HEADING_RPR` now applies uniformly. Dropping every first-level heading to 10pt fixes both and is a
one-line change in `scripts/retag-cv-template.ts`; it also removes the size step between a heading and
body text. Shortening either title in the database fixes it without that cost — the same move already
made for *IMD Business School of Management*.
