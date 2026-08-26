---
ci-area: CV Tailoring (C-Phase)
ci-roadmap:
ci-title: C2 Never Sees Nice-to-Have Requirements
ci-status: 3 - Delivered
ci-priority: medium
ci-date: 2026-08-25
ci-estimated-time: 3
ci-time-spent: 2
pr-source: "[[C3 Selects the CV Evidence Set]]"
pr-target: "[[C2. Map JD Requirements to Supporting Evidence]], [[C3. Select the CV Evidence Set]]"
---

---
```simple-time-tracker
{"entries":[]}
```
---

## 1. What is the problem or opportunity?

`runEvidenceMapping` filters requirements to `CORE_AND_IMPORTANT` before anything else runs
(`lib/pipeline/tailoring.ts` §772). **A Nice-to-Have requirement is therefore never mapped, never
approved, and can never reach the CV** — there are no green rows for it, so no downstream step can
choose one.

[[C3 Selects the CV Evidence Set]] set an acceptance criterion that Nice-to-Have coverage should rise
above zero, and it could not be met. That criterion was unmeetable by that step, and its §1(b) —
*"budget freed by cutting redundancy buys fit and ATS currently left on the table"* — was wrong:
nothing was on the table, because selection cannot manufacture a link to a requirement with no
evidence rows. This note is where that opportunity actually lives.

**The evidence already exists.** B6 rates and evidences every requirement, Nice-to-Have included, and
those rows sit in `requirement_evidence` unread. Measured 2026-08-25:

| Lead · Nice-to-Have requirement | `initial_match_strength` | `tierFor` | B6 evidence waiting |
| --- | --- | --- | --- |
| Julius Baer · Meeting Preparation and Coordination | **Very Strong** | **carry** | `G2` `G10` `G11` |
| Julius Baer · Cultural and People Initiatives | Good | improve | `L1` `L2` `G11` |
| Aliaxis · Project/Change Management Certifications | No Match | dig | none |
| ALDI | *(no Nice-to-Have requirements)* | — | — |

**And there is room.** [[C3 Selects the CV Evidence Set]]'s objective goes flat before its budget
does: 8 of Julius Baer's 14 bullets, and 4 and 5 on the other leads, were filled past the point where
they added anything measurable. Those slots currently buy nothing.

## 2. What would the improvement look like?

### 2.1 · The owner's constraint, which decides the scope

> *"I wanted the equation to be very, very economical about fulfilling nice-to-have requirements. If
> the equation can be fine tuned for being so economical, then it is ok to open the doors of C2."*
> — 2026-08-25

**The objective is already economical, by construction, and needs no tuning.** `w(Nice-to-Have) = 1`
against Core's `3` means such a requirement can only ever win a slot once every Core and Important
requirement is saturated — it is structurally last in the queue, and it displaces nothing. What is
needed is not a change to the equation but a supply of green rows for it to consider.

> [!IMPORTANT] Re-measured across the whole back catalogue, 2026-08-26 — 13× larger than §1 says
> §1's table covers the three test leads. Across every lead in the database: **34 Nice-to-Have
> requirements on 19 leads**, rated by B6 as `Very Strong` 11 · `Excellent` 2 · `Good` 6 · `Weak` 3 ·
> `No Match` 5 · unrated 7.
>
> **13 of them are carry-tier — free to promote, evidence already found:**
>
> ```
> Vestas        High Drive, Integrity and Cultural Navigation      2 evidence rows
> Vestas        Interpersonal Style and Culture Affinity           4
> Vestas        Willingness to Travel                              2
> Vestas        Attention to Detail Under Pace                     3
> papernest     Previous Successful Managerial Experience          3
> EPAM Systems  Industry Specialization Preferred                  4
> EPAM Systems  Distributed Multi-Disciplinary Team Leadership     4
> Signify       Corporate Finance Experience                       3
> Julius Baer   Meeting Preparation and Coordination               3
> Danske Bank   Experience in Financial or Technology Sector       5
> BCG           Global and Cross-Regional Finance Collaboration    4
> …and two more
> ```
>
> So the note's own line — *"carry-only admits exactly one requirement across all three leads"* — is
> true of the sample and badly understates the opportunity. It is 13 requirements across nine
> companies, every one with B6 evidence sitting unread in `requirement_evidence`, and **none of them
> costs a model call to promote.** Those are soft requirements — culture fit, travel willingness,
> attention to detail — which is exactly the kind a CV usually fails to answer explicitly and which
> the ATS step rewards when it does.

### 2.2 · Carry tier only — the economical door

`tierFor` already distinguishes three intake modes: `carry` transposes B6's evidence with **no model
call at all**; `improve` and `dig` both cost one.

So: **admit Nice-to-Have requirements only in the `carry` tier.** Prompt size unchanged, per-run cost
unchanged, nothing C2 is asked to judge changes. Only requirements B6 already rated Excellent or Very
Strong are promoted, and their evidence is already chosen.

On the measured leads that admits **exactly one requirement across all three** — Julius Baer's
*Meeting Preparation and Coordination*, Very Strong, with three evidence rows waiting. The other two
stay out, correctly: *No Match* has nothing to promote, and *Good* is marginal enough to deserve its
own argument with real numbers rather than being swept in here.

**Explicitly out of scope:** widening `improve` or `dig` to Nice-to-Have. That grows the prompt, the
per-run cost and every lead's map, and [[C3 Selects the CV Evidence Set]] §2.1 holds that C2 stays
unchanged. If carry-only proves out, that case can be made separately.

### 2.3 · Second scope item: coverage is reported in a way that misleads

Bundled here because it is the same measurement surface, and fixing one without the other leaves the
numbers still not meaning what they say.

Three Core requirements are answered **only** by Education or Language evidence — ALDI's
*Business-Fluent English* (`LANG-2`), Julius Baer's *University Degree* (`EDU-1/2/3`) and *Fluency in
English and German* (`LANG-2/3`). [[C3 Selects the CV Evidence Set]] §2.4 deliberately keeps those out
of the bullet budget, because they render from the profile tables regardless. So coverage measured
over selected rows alone drops to Core 7/8 and 11/13 — **the criterion fails for obeying the
constraint two paragraphs above it.**

Neither reading is wrong; reporting only one of them is. The owner's format, agreed 2026-08-25, makes
the difference visible instead of hiding it in either direction:

```
Core  7/8 + 1 LAN            Important  11/13 + 1 EDU + 1 LAN
```

Bullet-borne coverage first, since that is the part selection controls, then what the fixed sections
answer. It reads as the sentence you would say aloud: *"seven from bullets, one from the Languages
section."*

### 2.4 · Implementation checklist

1. Widen §771's filter to admit Nice-to-Have requirements **whose tier is `carry`**, leaving
   `improve` and `dig` gated to Core/Important.
2. Verify the carried rows land as `pending` and are subject to the same merge rules — a carried
   Nice-to-Have row must not bypass the human Keep gate.
3. Re-check that [[C3 Selects the CV Evidence Set]]'s objective picks them up only after saturation.
   No weight change should be needed; if one appears to be, stop and re-read §2.1 first.
4. Change the coverage line in C3's step report to §2.3's format, in both readings.

### 2.5 · Acceptance

- [x] A `carry`-tier Nice-to-Have requirement produces `pending` rows on Julius Baer, awaiting review.
      — `G2` `G10` `G11`, all `pending`. 13 admitted across 9 leads; only Julius Baer was run.
- [x] Per-run model cost is unchanged — no growth in C2's prompt or call count. Compare `llm_calls`.
      — **exactly flat, not approximately**: `in=1615` on the call either side of the change, the same
      three requirements in the prompt.
- [ ] After approval, a selection run covers that requirement **only** once Core and Important are
      saturated, and displaces no Core or Important bullet.
- [x] The step report shows both coverage readings in §2.3's format. — `formatCoverageSplit`.
- [ ] C8's ATS does not regress. Baselines 2026-08-25: **88/100 ALDI**, **82/100 Julius Baer**,
      **82/100 Aliaxis**.

## 3. Resources or references

- `lib/pipeline/tailoring.ts` §66 `CORE_AND_IMPORTANT`, §772 the filter, §189 `tierFor`, §822 where
  tiers are assigned from `initialMatchStrength`.
- `lib/db/schema.ts` §429 `jobRequirements.initialMatchStrength` — B6's rating, the tier's input. Note
  it is `initial_match_strength`, not `match_strength`; there is no such column.
- [[C3 Selects the CV Evidence Set]] §1(b) and §2.8 — the criterion this note inherits, and the
  correction to why it could not be met there.

## 4. Notes / Progress log

### 2026-08-25 · Opened

Found by the session implementing [[C3 Selects the CV Evidence Set]], which reported the criterion as
*"structurally impossible"* and correctly declined to fix it — widening C2's intake was out of its
scope. It then sat only in a chat transcript, which is why this note exists.

Recorded because it was nearly written wrong: the carry-tier design was first proposed citing a
`matchStrength` column that does not exist. The real column is `initial_match_strength`, and checking
it before writing is what turned a plausible-sounding design into a verified one — including the fact
that carry-only admits exactly one requirement across three leads, which is the whole economy argument
made concrete.

### 2026-08-26 · Built — the door opened, and it cost nothing

Both scope items shipped. `c2AdmitsRequirement` (`lib/pipeline/tailoring.ts`) is now the single place
that decides what C2 may look at: Core and Important unconditionally, plus a Nice-to-Have requirement
whose `tierFor` is `carry`. `improve` and `dig` stay gated to Core/Important, exactly as §2.2 asked.
Extracted as its own exported predicate rather than left inline so the economy argument is a test
rather than a comment — `lib/__tests__/c2-intake.test.ts` pins that `Good`, `Weak`, `No Match` and
unrated Nice-to-Have requirements all stay out, which is the line that must not move.

**The cost claim held exactly.** Measured on Julius Baer `ee5c72bf` against a real Opus call:

```
before   C2 llm_calls 2   last call in=1615 out=3254
after    C2 llm_calls 3   this call in=1615 out=1380
```

Not "about the same" — the *same number*. The requirements sent to the model are the same three either
side, so the prompt is byte-identical; the carried Nice-to-Have rows never enter it. Checked across the
whole database first, read-only: on all nine affected leads the targeted set is unchanged, requirement
for requirement.

`4 new · 1 improved · 63 unchanged · 0 pruned · 0 gaps · 1 nice-to-have carried · pending review`.
Three Nice-to-Have rows landed, all `pending`, and nothing green was erased — the one row that changed
was a Core/Important link the model genuinely beat B6 on, which reset to pending by §2.2's own rule.

**The selection result, simulated read-only rather than by approving anything.** Approving only the
three carried rows would give C3:

```
green today                       14 bullets · V 43.8 · Core 11/13 +1 EDU +1 LAN · Important 5/5 · Nice-to-Have 0/2
+ the three carried rows          14 bullets · V 44.8 · Core 11/13 +1 EDU +1 LAN · Important 5/5 · Nice-to-Have 1/2
dropped: (nothing)   newly selected: (nothing)
```

**The identical fourteen bullets.** *Meeting Preparation and Coordination* is answered by `G2`, which
was already on the CV for a Core requirement — so the first non-zero Nice-to-Have coverage this
pipeline has ever produced displaces nothing at all, because the coverage was always there and only
the link was missing. That is a sharper result than §2.1 predicted: the objective did not have to
spend a slot to be economical, it had to be *told*.

The coverage line is now `formatCoverageSplit` in `lib/pipeline/selection.ts`, carried in C3's step
report as `coverage.split` and in its summary. `afterBulletsOnly` and `afterAsPrinted` are untouched —
the acceptance checker parses the latter, and each is still the right answer to its own question.
Replayed over every lead with a Keep set:

```
ALDI SÜD Holding   Core 7/8 + 1 LAN · Important 1/1
Julius Baer        Core 11/13 + 1 EDU + 1 LAN · Important 5/5 · Nice-to-Have 0/2
Anritsu            Core 9/11 + 2 EDU · Important 2/2 · Nice-to-Have 0/1
Vestas             Core 7/8 + 1 EDU · Important 9/9 · Nice-to-Have 0/4
Allianz Services   Core 11/13 + 1 EDU · Important 4/5 · Nice-to-Have 0/3
Aliaxis            Core 11/11 · Important 3/3 · Nice-to-Have 0/1
```

ALDI reproduces §2.3's worked example to the character.

#### What §2 got wrong

- **§2.3's worked example mislabels its own leads.** `Core 7/8 + 1 LAN` is ALDI, and
  `Important 11/13 + 1 EDU + 1 LAN` is not a real line anywhere: Julius Baer's 13-of-which-11 are its
  **Core** requirements, and its Important is a clean 5/5. The two halves of the example come from two
  different leads and the second one has the wrong rank on it. The format was right; the numbers
  beside it were a composite.
- **§2.3 undercounts the leads this affects.** It names three requirements answered only by
  Education or Language. Across the Keep sets there are eight, on six leads — Anritsu alone has two
  Core requirements answered only by degrees, and Allianz Partners' single covered Core requirement is
  covered by a language. (Allianz Partners `b7e91408` has no shortlist at all — `Core 0/10` from
  bullets — which is its own thing to look at, and not this note's.)
- **The 13-carry-tier figure is exactly right**, and reproduces on the nose: 34 Nice-to-Have
  requirements across 19 leads, 13 carry-tier, all 13 with B6 evidence already stored (43 rows in
  total). The two the callout elides are Allianz Services · *Additional European Languages* (Excellent,
  2 rows) and Danske Bank · *Develop Strategy Toolbox and Ways of Working* (Very Strong, 4 rows).

#### Found and deliberately left alone

- **`tierFor` returning `carry` for a requirement with no evidence rows.** The existing code demotes
  that case to `dig` so the deep pass looks for something. Correct for Core/Important; wrong for a
  Nice-to-Have requirement, which is only admitted *because* it carries for free — demoting it would
  put it in front of the model and grow the prompt by exactly what §2.2 rules out. Such a requirement
  now leaves the run instead, and leaves the merge's scope with it, so the prune arm cannot delete
  pending rows for a requirement this run said nothing about. **No lead currently hits this path** — all
  13 carry-tier Nice-to-Have requirements have evidence — so it is a guard against a state the data
  has not yet reached, not a fix for an observed bug.
- **The ATS criterion cannot be closed by this session.** It needs the three pending rows approved,
  which is the owner's truthfulness judgement and precisely the gate this note says must not be
  bypassed. Julius Baer's C8 baseline today is **84**, and its shortlist is frozen behind a generated
  `.docx`, so nothing has moved yet. Approving the map in the UI re-solves C3 for free and the number
  can be read then.
- **Two pre-existing C5 failures on Julius Baer** (`verify-lead-run.ts`): six skill categories against
  a 3-5 limit, and one skill in *Additional Skills*. Present before this change, untouched by it, and
  nothing to do with requirement intake.

### 2026-08-26 · Waiver — the two criteria that need an approval this lead cannot take

Julius Baer is at `Download` status, so the Map's approval controls are gone and `shortlistFrozen`
(`app/actions/tailoring.ts` §38 and §164) stops the shortlist re-solving once a `tailored.docx`
exists. That is [[C3 Selects the CV Evidence Set]] §2b implementing the owner's generate-once rule,
working as designed. **The three `pending` rows on this lead can therefore never be approved through
the app**, and approving them by a direct database write would grow the green set while the frozen
shortlist ignored it — a criterion ticked because rows were edited behind the UI, which is not the
same claim as one the flow produced.

**So both remaining criteria are waived on the read-only simulation the implementing session ran
before touching anything:**

```
identical fourteen bullets · Nice-to-Have 0/2 → 1/2 · V 43.8 → 44.8 · nothing displaced
```

`Meeting Preparation and Coordination` is answered by `G2`, **which was already on the CV** for a Core
requirement. So the requirement is covered at **zero budget cost** — §2.1 predicted the objective
would be economical about spending a slot, and it turned out not to need one. The coverage was always
there; only the link was missing. That is a stronger result than the criterion asked for.

C8 on this lead reads **84**, above the 82 baseline in §2.5 and unchanged by this work, since no
regeneration happened.

**Live confirmation is expected, not arranged.** Vestas carries four carry-tier Nice-to-Have
requirements and the others are spread across papernest, EPAM ×2, Signify, Allianz Services, BCG and
Danske Bank ×2. The next fresh lead run through the app will show this in the normal flow, in the UI,
at no cost. Waived here rather than staged, per the CI Procedure's allowance for closing on an
explicit waiver with a reason.
