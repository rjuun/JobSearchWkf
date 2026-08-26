---
ci-area: CV Tailoring (C-Phase)
ci-roadmap:
ci-title: C2 Never Sees Nice-to-Have Requirements
ci-status: 0 - Idea
ci-priority: medium
ci-date: 2026-08-25
ci-estimated-time: 3
ci-time-spent: 0
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

- [ ] A `carry`-tier Nice-to-Have requirement produces `pending` rows on Julius Baer, awaiting review.
- [ ] Per-run model cost is unchanged — no growth in C2's prompt or call count. Compare `llm_calls`.
- [ ] After approval, a selection run covers that requirement **only** once Core and Important are
      saturated, and displaces no Core or Important bullet.
- [ ] The step report shows both coverage readings in §2.3's format.
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
