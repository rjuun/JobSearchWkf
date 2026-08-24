---
ci-area: Screening (B3) / Roadblocks
ci-roadmap:
ci-title: B3 Raises False Roadblocks (Case Log)
ci-status: 0 - Idea
ci-priority: high
ci-date: 2026-08-23
ci-estimated-time:
ci-time-spent: 0
pr-source:
pr-target:
---

---
```simple-time-tracker
{"entries":[]}
```
---

> [!IMPORTANT] This note is a CASE LOG, not a design
> Opened at the owner's explicit instruction: *"Can you please find if there is already a CI to deal
> with the False Roadblocks. If there is nothing there, just create it and take note. We will keep on
> accumulating more cases for you to find a solution in the future... For now, just document it."*
>
> **Do not propose a fix from two cases.** §3 is the log; add to it. §1.2 records a structural cause
> found while documenting the first two, which any eventual fix will have to reckon with — but it is a
> finding, not a plan.
>
> There was no prior CI on this. The nearest note,
> [[Introduce Environment Gate Check during Screening Phase]], adds a *new* gate; it does not address
> an existing gate firing wrongly.

---

## 1. What is the problem or opportunity?

A roadblock **gates the lead** — B3's output is the hard stop, shown as a red `Block` on the
Requirement → Evidence map and treated as disqualifying. When B3 raises one against a requirement the
owner can in fact evidence, the cost is not cosmetic: it argues for dropping a role he should pursue.

Reported 2026-08-23 by the owner, moving three leads into tailoring: *"2 of them are showing Blocks,
although there is good evidence that satisfies the requirement."*

### 1.1 · What the two cases actually are

They are **not the same failure**, which is the first thing worth knowing.

**Case A — Julius Baer · Language.** B3 flagged *"Fluency in German required — job demands fluency,
which may exceed Business Conversational German level."* But `Process/B3…md` §A.1 does not say "flag
when fluency is required". It enumerates four triggers: **native-level, near-native, excellent written
German, or leadership-grade German.** The JD says plain "Fluency in English and German required" —
none of the four. B3 reached for *"may exceed"*, which is its own judgement, not the rule it was
given. Separately, the `languages` table records **German = C1**.
→ **The rule is a closed list and B3 treated it as a disposition.**

**Case B — Aliaxis · Geographic.** B3 flagged *"Regular travel across EMEA and to sites required
(mandatory delivery/travel scope)."* §D's test is travel **"in regions outside acceptable scope"**.
EMEA is not outside his scope — he is an EU citizen, open to relocation within the EU, and the
evidence panel on that very lead shows cross-border work across Austria, Portugal, France and Italy.
B3 flagged the *existence* of travel rather than its *region*.
→ **B3 applied the right dimension to the wrong test.**

> [!WARNING] Case B may still be a true roadblock — for a reason B3 did not give
> The candidate fact reads **"Willing to travel up to 10%"**, and the JD asks for *regular* travel.
> A volume-based roadblock could well be defensible. But §D is a **geographic-scope** test, and on
> that test the flag does not hold. So B3 may have reached a defensible verdict by an indefensible
> route — which is worse than a plain false positive, because the stated reason is what the owner
> reads when deciding. Any fix has to get the *reason* right, not just the verdict.

### 1.2 · Structural cause: B3 cannot see the candidate

Found while documenting the above. `b3UserMessage` (`lib/pipeline/screening.ts`) is:

```ts
export function b3UserMessage(jd: string, leadTitle: string, requirements: PromptRequirement[]): string
```

The JD and the requirements. **Nothing else.** B3 receives:

| Candidate data | Sent to B3? | Would have decided |
| --- | --- | --- |
| `languages` (German **C1**) | **no** | Case A |
| `candidateFacts` — citizenship / relocation / **travel** | **no** | Case B |
| `skills_master` | **no** — B3's own §B admits *"which you are not sent"* | §B technical roadblocks |

So B3's entire model of the candidate is **the prose hard-coded in `Process/B3…md`**. It is asked
"does the candidate have X?" and given no data to answer with, only a note describing him in general
terms. Both cases are what that produces: with no fact to check against, the cautious reading of an
ambiguous JD phrase wins, and the cautious reading is *flag it*.

The asymmetry is stark. [[Candidate Facts — Citizenship, Relocation, Travel in B6 and C2]] added
`candidateFactsSummary` to **B6** (`screening.ts`) and **C2** (`tailoring.ts`) for exactly this
reason — so a requirement that is really an eligibility check is *"rated honestly against what's
actually true, instead of forcing a fabricated bullet-based match or a false No Match"* (C2 §A). **B3
— the one step whose output actually gates the lead — was left out of that CI.** B6 can see the
travel fact and B3 cannot, so the step with the softest consequence is better informed than the step
with the hardest one.

Whether the answer is to feed B3 the same facts, to tighten the note's wording, or to stop treating
B3's output as a hard gate, is exactly what more cases should decide. Two is not enough.

## 2. What would the improvement look like?

**Not scoped, deliberately.** Accumulate cases first — see the log below. Questions worth holding
open while it fills:

- Is the pattern **missing data** (§1.2) or **prompt wording**? Case A is arguably wording — the four
  triggers are explicit and B3 ignored them — while Case B is arguably data. If both recur, the fix is
  probably both, and they are separable.
- Should the eventual fix be **preventive** (give B3 the facts / tighten the rule) or **corrective**
  (let the owner dismiss a roadblock on the lead, recording why — which would also build this log
  automatically instead of by hand)?
- Does a roadblock need a **confidence** or a **severity**, so "may exceed" is expressible as
  something short of a hard gate? Misalignments already occupy the softer tier; the two cases here may
  be misalignments wearing a roadblock's label.
- **Never lose the true positives.** B3 exists because some roles genuinely are out of reach. A fix
  that quietly stops flagging is worse than the current state, and the log needs true positives in it
  too, not only complaints.

## 3. Case log

Append here. Keep the JD's own words, B3's stated reason, and why it is judged wrong — the wording is
the evidence.

| # | Date | Lead | Dimension | JD wording | B3's stated reason | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 2026-08-23 | Julius Baer · Business Manager COO (`ee5c72bf`) · fit 8.0 | Language | "Fluency in English and German required" | "job demands fluency, which may exceed Business Conversational German level for high-stakes stakeholder interactions" | **False.** §A.1's triggers are native / near-native / excellent written / leadership-grade. Plain "fluency" is none of them, and `languages` records German = C1. |
| 2 | 2026-08-23 | Aliaxis · Head of Strategy Execution & Transformation Office (`a9f2307b`) · fit 7.9 | Geographic | "flexibility to travel regularly across EMEA … engage with local teams" | "Regular travel across EMEA and to sites required (mandatory delivery/travel scope)" | **Wrong reason; verdict unsettled.** §D tests *regions outside acceptable scope*; EMEA is inside his. A volume roadblock (travel fact: "up to 10%") might hold, but that is not what B3 said. |

**Control, same batch:** ALDI SÜD Holding · Director Functional Controlling (`69bc2e13`, fit 7.6)
raised **no** roadblock and only a City misalignment — so B3 is not flagging indiscriminately. Two of
three, not three of three.

## 4. Notes / Progress log

### 2026-08-23 · Opened as a case log

Opened at the owner's instruction while he moved three leads into tailoring — he is proceeding past
both Blocks rather than waiting on a fix, which is the right call and is itself worth recording: **the
gate is currently advisory in practice, because he overrides it by hand.**

Confirmed no prior CI covers this. Documenting the first two cases turned up §1.2 — that B3 is sent no
candidate data at all, and was left out of the Candidate Facts CI that gave B6 and C2 exactly the
facts these two roadblocks turned on. That is the most likely root cause, and it is recorded as a
finding rather than a plan, per the instruction to document and wait for more cases.
