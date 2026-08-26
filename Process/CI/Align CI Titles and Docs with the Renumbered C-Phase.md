---
ci-area: Process / Documentation
ci-roadmap:
ci-title: Align CI Titles and Docs with the Renumbered C-Phase
ci-status: 0 - Idea
ci-priority: medium
ci-date: 2026-08-26
ci-estimated-time: 1
ci-time-spent: 0
pr-source: "[[Renumber the C-Phase to Seat Evidence Selection at C3]]"
pr-target: "[[+ Continuous Improvement Dashboard]]"
---

---
```simple-time-tracker
{"entries":[]}
```
---

## 1. What is the problem or opportunity?

[[Renumber the C-Phase to Seat Evidence Selection at C3]] moved every C-step: bullets to C4, skills to
C5, profile to C6, document build to C7, ATS to C8, with a new selection step at C3. It swept the
Process notes, the code, the database and `docs/`. **It did not sweep its own register** — CI note
titles were out of its scope, and a residue survived in `docs/`.

**One title is not merely stale, it is wrong.** `C3 Writes CV-Grade Skill Tags` names a step that now
does something else entirely: C3 is *selection*. A reader opening that note for the selection step
gets the bullet-writing register work instead. The other three are stale rather than misleading.

| CI note title | Should read | Inbound links |
| --- | --- | --- |
| **C3** Writes CV-Grade Skill Tags | C4 | 4 |
| **C4** Skills Selection Produces Unreadable Overflow | C5 | 6 |
| Guard **C5** Against Empty Tailored Profile | C6 | 1 |
| Improve **C3-C4** Skill Association Method (Bold Inline vs Bracketed Tags) | C4-C5 | 1 |

Titles that are already correct and must not be touched: `C2 Never Sees Nice-to-Have Requirements`,
`Make C2 Build on B6…`, `Guard C2 Against Silent Evidence-Map Collapse`, `Candidate Facts — … in B6
and C2` (C2 never moved); `C3 Selects the CV Evidence Set` (the new C3); `Renumber the C-Phase…`
(names its target); `Skill Name Treatment in the C5 Skills Section` (renamed during the epic).

**The `docs/` residue is small but real.** The renumber swept `PIPELINE.md`, `ARCHITECTURE.md` and the
rest, and most of it now reads correctly — `ARCHITECTURE.md` §168–170 already says C4 bullets, C5
skills, C6 profile, C7 docxtemplater. What survived is scattered prose, e.g. `DATA_MODEL.md` §98
describing `cv_bullet_skills` as *"C3's bracketed tag"* when C3 no longer writes tags. This is a
residue pass, not a sweep.

**Why now.** The observation came from the session closing CI-042, and its argument is the deciding
one: *"the longer both numbering schemes coexist in the notes the more expensive that pass gets."*
Every note written from here on cites whichever scheme its author happened to read.

## 2. What would the improvement look like?

### 2.1 · Scope

**In:** the four CI note titles above, their twelve inbound wiki-links, and stale C-step references in
`docs/*.md`.

**Out:** `docs/archive/**` and `RETROSPECTIVE.md` — preserved historical snapshots that keep the old
numbering deliberately, a decision the renumber already made. Also out: the bodies of delivered CI
notes, where a past-tense reference to what a step was called at the time is correct as written. Only
titles, links, and statements about how the system works *now*.

### 2.2 · The precedent to follow

`Skill Name Treatment in the C4 → C5 Skills Section` was renamed during the epic and its five inbound
links swept in one pass. Same operation: `git mv`, add `pr-previous-code` carrying the old code, then
update the links. That field is the established convention here — B2–B5 and C4 all carry it from the
B-phase and C-phase reorders.

### 2.3 · Implementation checklist

1. `git mv` each of the four notes; add `pr-previous-code` to each.
2. Update `ci-title` in the frontmatter to match the new filename.
3. Sweep the twelve inbound `[[...]]` links.
4. Residue pass over `docs/*.md` for statements about current behaviour that name a moved step.
5. Link check across `Process/**` — no new dangling links, and ideally one or two fewer.

### 2.4 · Acceptance

- [ ] No CI note title names a step that does something other than what the note is about.
- [ ] Every inbound link resolves; the count of broken links does not rise.
- [ ] `docs/` contains no statement about *current* behaviour naming a moved step.
- [ ] `docs/archive/**` and `RETROSPECTIVE.md` untouched.
- [ ] `npx tsx scripts/snapshot-step-prompts.ts` reproduces `Process/CI/_step-prompt-baseline.txt` —
      **no `Process/*.md` step note may change.** These are CI notes and docs, not prompts; if a hash
      moves, a live prompt was edited by mistake.

## 3. Resources or references

- [[Renumber the C-Phase to Seat Evidence Selection at C3]] — the rename that created this residue;
  its §2.3 carries the hazard that still applies (step codes and evidence ref codes share a namespace,
  so `C4` appears in prompt text meaning an evidence ref — never sweep a bare code).
- `Process/CI/_step-prompt-baseline.txt` — the guard that a prompt was not touched.

## 4. Notes / Progress log

### 2026-08-26 · Opened

Raised by the session that closed CI-042, which noticed that note's title still said C4 while its own
`pr-target` already pointed at C5, and declined to rename it alone — correctly, since a single silent
rename would break the wikilinks other notes use to reach it. Scoped here as one deliberate pass
instead.

Opened on the day the C-phase epic closed (CI-048/050/051/052, plus CI-042, CI-047 and CI-049), so the
numbering is as fresh as it will ever be.
