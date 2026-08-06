

This procedure the structured mechanism for capturing, storing, and revisiting potential enhancements to any workflow without interrupting the current documentation or execution of the process -> **Continuous Improvement (CI)**.

## **Definitions**

**CI Admonition** A lightweight, in‑place marker inserted during process documentation to flag an improvement opportunity. Contains a short description and a link to the Central CI Register.

**Central CI Register** In practice, this is the `Process/CI` folder — one note per CI item — rather than a single page. Each item includes description, tags, properties, and optional metadata for later review or prioritization. The **CI Dashboard** (below) is what makes the folder read like a single register.

**CI Item** A discrete improvement opportunity stored in the Central CI Register. Created from a CI Admonition. Must be atomic, actionable, and independently trackable.

**CI Tags** Machine‑readable labels assigned to CI Items (e.g., _workflow_, _UX_, _automation_, _structure_). Used for filtering, table views, and automated reporting.

**CI Properties** Structured fields attached to CI Items (e.g., _Status_, _Impact_, _Effort_, _Owner_, _CreatedOn_). Enables automated visualization, sorting, and prioritization.

**`ci-roadmap`** A 2-character code linking the CI to the wave of RoleProof's own build roadmap (`ROADMAP.md` — Next.js/Supabase app repo, not this vault) that it belongs to — e.g. `O2`, `M1`, `P4`. Blank until that wave mapping is finalized; the dashboard shows it as-is either way.

**`ci-status` values** (formalized 2026-07-29, after two independent implementation passes — Scoring Phase Redesign Parts 1 and 2 — both landed on the same fourth value on their own):

| Value | Meaning |
| --- | --- |
| `0 - Idea` | Captured, not yet spec'd or started |
| `1 - Development` | Being implemented |
| `2 - Testing` | Code landed and machine-verified (tests/build/harness); live/manual verification still pending |
| `3 - Delivered` | Live-verified and closed |

Two more values close out a CI outside the `0→3` delivery pipeline, added 2026-07-31 once a real case (`[[Migrating Power Automate Intelligence from Old Sharepoint]]`) showed the pipeline alone can't tell "we decided not to do this" apart from "something else already did it":

| Value | Meaning |
| --- | --- |
| `4 - Abandoned` | Decided not to pursue. No successor absorbs the work — it's just dropped. |
| `5 - Superseded` | The scope (in whole or in part) got absorbed by another CI or by an unrelated product change. The note stays as history; link whatever now carries the work forward (`pr-target` or a `## 3. Resources` line). |

One more, added 2026-08-06: a CI can be **code-complete and blocked on nothing but a live LLM spend** — everything short of the actual paid run is done, and the only thing left is a deliberate budget decision, not more engineering. `2 - Testing` doesn't fit (that implies verification is in progress); `3 - Delivered` is wrong (the question the CI set out to answer is still unanswered). This status exists so those notes are visibly parked on a decision rather than silently stalled:

| Value | Meaning |
| --- | --- |
| `9 - LLM Run Required` | Everything but a live, paid LLM run is done — code-complete, plumbing-verified, blocked only on someone deciding to spend the budget (and, where relevant, actually running it). Not part of the `0→3` ladder; a CI moves here from `1`/`2` and moves back into the ladder once the run happens. |

Neither of the two above is a silent status flip — see **Rescoping** below. And a CI whose scope only partly overlaps with something else isn't automatically Superseded: if part of the original ask is still open and nobody else is doing it, the right move is usually to rewrite the note's scope in place and keep it moving through the normal pipeline, not to close it.

**CI Table View** A dynamically generated table that displays CI Items using Tags and Properties. Used for quick scanning, triage, and planning. Implemented today as the **CI Dashboard** — see **Artifacts** below.

## **Artifacts**

**CI Template** — [[CI - Continuous Improvement]]. The Templater source for new CI notes: fills `ci-title` and `ci-date` automatically, defaults `ci-status` to `0 - Idea` and `ci-priority` to `medium`, and lays down the empty `simple-time-tracker` block plus the four numbered sections. Its properties block must be kept in sync with **Shape of a note** below — if a property is added there, add it here too, or every new CI note will be born missing it.

**CI Dashboard** — [[+ Continuous Improvement Dashboard]]. A `dataviewjs` query over every note in `Process/CI`; nothing here is hand-maintained, it just reads whatever's currently in that folder. Groups notes by `ci-status` in the fixed pipeline order (`0 - Idea` → `5 - Superseded`, see the table above), and within the `3 - Delivered` group orders by delivery date, latest first — every other group keeps creation-date order. Columns, left to right:

| Column | Header | Source |
| --- | --- | --- |
| Code | Code | Computed, not stored — `CI-001`, `CI-002`… assigned by `ci-date` ascending (tie-broken by file name). Deliberately not file-creation time, since git clone/checkout resets that and would scramble the numbering. |
| File | File | Link to the note itself |
| Area | Area | `ci-area` |
| Wave | Wave | `ci-roadmap` |
| Pri | Pri | `ci-priority`, shown as a colour-coded letter (H/M/L — red/amber/green) rather than the full word |
| Made | Made | `ci-date`, formatted `dd.MMM` |
| Done | Done | Latest `endTime` parsed out of the note's `simple-time-tracker` block — shown only once `ci-status` is `3 - Delivered`, so it reads as an actual delivery date rather than "last logged session" |
| Est. | Est. | `ci-estimated-time`, summed per group and overall |
| Used | Used | `ci-time-spent`, summed per group and overall |

## **Lifecycle in Practice**

The definitions above describe the states; this section describes how a CI note actually moves through them, distilled from how `Scoring Phase Redesign - Part 1` and `Part 2` were actually run — the two passes that forced the `ci-status` table itself into existence.

**Shape of a note.** Properties block (`ci-title`, `ci-area`, `ci-roadmap`, `ci-status`, `ci-priority`, `ci-date`, `ci-estimated-time`, `ci-time-spent`, `pr-source`/`pr-target`) + a `simple-time-tracker` code block, then four numbered sections: **1. What is the problem or opportunity** (why now, what's actually broken today — cite the specific file/line, not a vague symptom), **2. What would the improvement look like** (scope in/out, a "current state" audit of the code as it stands *today*, checked fresh rather than assumed carried over from an earlier chat; a target-state design; an ordered implementation checklist; acceptance criteria), **3. Resources or references** (design docs, code paths, sibling CIs), **4. Notes / Progress log** (dated entries, append-only).

**Estimating.** `ci-estimated-time` is anchored to this repo's own closest precedent by actual time spent, not a fresh guess — e.g. Part 1's estimate was set by comparing shape (schema + pipeline + new UI) against two prior CIs' recorded `ci-time-spent`. When a first guess turns out wrong, correct it in place and log the reasoning (Part 1: 18h → 4h) rather than leaving a number nobody trusts.

**`2 - Testing` vs `3 - Delivered` is the distinction that matters most, and both Parts hit it for real.** Green tests and a clean build are not the same claim as "this works when a human actually clicks it." Part 1 shipped with an explicit "Open for Reggie" note: the Queue/Ready-to-score surfaces were verified at the action/DB layer only, never browser-tested. Part 2 went further and named the *one* criterion that couldn't be verified any other way — a real `.msg` file dragged out of Outlook Classic — and stayed at `2 - Testing` specifically because that step wasn't done, even though 154 unit tests and a 41-check harness were green. Don't mark `3 - Delivered` on harness/test success alone; name what's still open, and only move to `3` once that's actually been clicked through or explicitly waived with a reason.

**Splitting large CIs.** When a design doc covers more than one deliverable, split it into its own CIs (`Part 1`/`Part 2`, or — for reconciliation-style work — `Round 1`/`Round 2`/`Round 3`) rather than one sprawling note. Each part re-verifies its own "current state" section against the *post-previous-part* repo instead of trusting assumptions from the original design chat — Part 2's §2.1 explicitly re-checked every fact it carried over from Part 1 before building on it.

**Post-implementation reconciliation.** Real-world data cleanup that happens *after* a feature ships — backfills, source-of-truth audits, fixing a script that wrote the wrong label — is genuinely different work from the original checklist (data correction, not new capability) but belongs in the same note. Log it as its own dated subsection (Part 2's "Reconciliation & backfill" is the precedent), not folded into the original numbered steps or lost in chat.

**Rescoping.** If the world changes after a CI is opened — a capability elsewhere makes part of the original ask moot, or the user's actual need turns out to be narrower/different than first written — don't quietly rewrite history and don't reach straight for `4 - Abandoned`/`5 - Superseded` either unless the *whole* thing is genuinely done or dropped. Instead: update `§1`/`§2.0` in place to describe the current intent, add a dated `§4` entry explaining what changed and why (what's now moot, what's still live), and reconsider `ci-status` — time spent under the old scope doesn't count toward a new one, so this usually means resetting toward `0 - Idea` even if the note was previously further along.


## **Continuous Improvement Types and Treatments**

**Type 1 — App Features/Improvements** (making it simpler, more powerful, new capabilities) → this belongs **in Obsidian/GitHub as docs**.

**Type 2 — Screening/Tailoring Precision** (enriching skills, competences, STARs, roadblocks, misalignments) → this belongs **in the App / database**.

This isn't a change to how the system _works_ — it's a change to the _data the system reasons over_. When you add a sharper ATS keyword variant to a skill, or add a new STAR, or refine a misalignment pattern, you're feeding the engine better fuel. The engine itself doesn't change. 

The interface for *Type 2 CIs is the Career Graph's "Strengthen" and "Build with AI" features* exist precisely to let you enrich this data directly in the app. So Type 2 CIs become a **habit inside the app**, not documents.

