---
ci-area: Career Graph / CV Tailoring
ci-roadmap:
ci-title: STAR Results Have No Action Behind Them
ci-status: 0 - Idea
ci-priority: medium
ci-date: 2026-08-25
ci-estimated-time: 2
ci-time-spent: 0
pr-source: "[[STAR Results Never Reach the Evidence Graph]]"
pr-target: "[[C2. Map JD Requirements to Supporting Evidence]], [[C4. Transform Evidence into CV Bullets]]"
---

---
```simple-time-tracker
{"entries":[]}
```
---

## 1. What is the problem or opportunity?

A STAR result is an outcome. It says what happened, not who did it or how. Some results are written so
they carry their own action and stand alone; others are not:

```
4-R3  "Agreement review reduced annual IT cost payments to parent company
       by nearly 50% from GBP 2.4 million."            ← an action is present
1-R3  "Gradual branch FTE reallocation from back-office to front-office
       over 6 years following SCE go-live."            ← no actor, no verb of the candidate's
```

Written into a CV alone, `1-R3` states that a thing happened. It does not say the candidate did it.

[[STAR Results Never Reach the Evidence Graph]] anticipated this and gave each result a `context`
field. **What that field can carry is the parent STAR's TITLE, not an action** — `1-R3` resolves to
*"outcome of STAR 1: Establishment of a Servicing Center in Portugal"*. That is genuine context and
better than nothing, but it is a project name, not something the candidate did.

**The reason is a missing edge in the data model.** `star_results` carries `star_ref`, which points at
the STAR. It has no reference to an action. A STAR holds roughly six actions and three results — 52
actions and 22 results across 7 STARs on the live profile — and **nothing records which action
produced which result**.

The owner, shown `1-R3`, framed the gap exactly (2026-08-25):

> *"Reggie, you have created a result which does not have an Action behind it. What is the action
> behind it?"* — and I would answer: this result is linked to Action 4.2, *"Reviewed, drafted and
> negotiated Master Agreements, Cooperation Agreements, Cost Sharing Agreements and SLAs to formalise
> all intergroup exchanges."*

That knowledge exists, and it exists only in his head. `4-R3` ("Agreement review reduced annual IT
cost payments") plainly belongs to action `4-2` ("Reviewed, drafted and negotiated Master
Agreements…"). The ref numbers even align — by ordering coincidence, not by anything the schema
models.

`Process/C4…md` §B.4 asks the bullet step to lead with an action and close on a measurable result.
For a result with no action behind it, that instruction currently cannot be followed.

## 2. What would the improvement look like?

### 2.1 · Scope

**In:** a link from a result to the action(s) that produced it, and using it where `context` is built.
**Out:** the wider question of which skills or competences a result or action required. The owner's own
assessment, 2026-08-25: *"Results derives from Actions is a clear relationship"*, while the skill and
competence edges *"are more difficult to draw"*. Those hang off the STAR and are selected at C2 across
all three curated tables. Only the clear edge is being modelled.

### 2.2 · Shape, approved by the owner 2026-08-25

- **A nullable array of action ref codes on `star_results`.** Many, not one — a result such as
  *"Delivered a fully operational Shared Services Centre within 1 year and 8 months"* comes out of the
  Operating Manuals, the Target Operating Model, the Workflow Interface and the branch tour together.
  Forcing one action would be a worse claim than no link at all.
- **`gatherEvidence` prefers it when present and falls back to the STAR title when empty.** Every
  existing result keeps working unchanged while curation happens at whatever pace suits. No flag day.
- Each referenced action must be a real `star_actions.ref_code`; anything else is dropped, the same
  discipline `resolveVocab` applies to vocabulary.

### 2.3 · Curation is Type 2, and belongs in the app

Filling 22 rows is data enrichment, not engineering — Type 2 in the CI Procedure, done through the
Career Graph rather than in a document. This note covers the column, the join and the fallback; the
links themselves are the owner's to draw. The fallback is what makes that split safe.

### 2.4 · Honest expected impact, so the priority is not overstated

**This fires rarely.** Measured 2026-08-25, green rows by evidence kind across every lead:

```
Bullet 223 · STAR action 18 · Language 11 · Responsibility 9 · Education 6 · STAR result 2
```

Bullets are 83% of all kept evidence, and exactly one STAR result (`4-R3`) has ever been cited. That
is the system working as the owner describes it: `bullet_bank` was built from the whole Career Graph,
is well formed, and C2 reaches for it first; raw STAR material is the reserve for requirements not yet
bulleted. So this improves a path that is taken seldom — but when it is taken, it is the difference
between a bullet that claims something and one that reports weather.

### 2.5 · Implementation checklist

1. Migration: `star_results.action_refs jsonb` (`string[]`), nullable, default `[]`.
2. `gatherEvidence` — resolve `action_refs` to their action texts; build `context` from them when
   present, keep the STAR-title form when empty.
3. Decide how several actions render in one context line — a joined sentence or a short list — and
   pin it with a test.
4. Career Graph surface for the owner to draw the links (may already exist; check before building).

### 2.6 · Acceptance

- [ ] A result with `action_refs` set renders its actions as context; one without still renders the
      STAR title.
- [ ] An unrecognised action ref is dropped rather than rendered.
- [ ] A tailoring run citing an actor-less result produces a bullet that leads with the action —
      **this is the case [[STAR Results Never Reach the Evidence Graph]] could never exercise live**,
      because the only result ever cited already carried its own action.

## 3. Resources or references

- `lib/pipeline/tailoring.ts` `gatherEvidence` — the `context` construction and `starTitleByRef`.
- `lib/db/schema.ts` — `starResults` (`refCode`, `starRef`, `text`, `metric`, `impactType`; no action
  reference), `starActions`, `stars`.
- [[STAR Results Never Reach the Evidence Graph]] §2.2 — carries the admonition recording that its own
  spec asked for an action join the schema could not provide.

## 4. Notes / Progress log

### 2026-08-25 · Opened

Surfaced when the owner asked what "the context path reached C4 but was never used" meant, and, on
being shown the actor-less example, immediately named the missing edge and answered it from memory.
The shape was agreed in the same exchange, including that a result may need more than one action.
