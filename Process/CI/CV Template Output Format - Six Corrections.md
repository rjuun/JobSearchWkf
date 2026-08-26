---
ci-area: CV Tailoring (C7 / template)
ci-roadmap:
ci-title: CV Template Output Format - Six Corrections
ci-status: 0 - Idea
ci-priority: high
ci-date: 2026-08-27
ci-estimated-time: 4
ci-time-spent: 0
pr-source: "[[C7. Compile Complete CV Document]]"
pr-target: "[[C7. Compile Complete CV Document]], [[C1. Overall Application Content and Format Guidance]]"
---

---
```simple-time-tracker
{"entries":[]}
```
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

- [ ] A Vienna lead prints no relocation line; a non-Vienna lead names that lead's city.
- [ ] Every section header renders its glyph.
- [ ] Skills read as bold category line + inline `·` run.
- [ ] Project numbering restarts at 1 under each position.
- [ ] **Every** bullet renders a bullet, in every section.
- [ ] Education and Executive Education dates sit right-aligned on the entry's own line, and a long
      institution name does not break that.
- [ ] The CV is two pages, and `B` is re-calibrated against a measurement rather than an estimate.
- [ ] `npx tsx scripts/verify-lead-run.ts <leadId>` still passes — it parses the rendered `.docx`, so
      a structural change to the Skills section will break its parser if the shape changes
      unexpectedly. **That is a feature: if it breaks, understand why before fixing the script.**

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
