# Prompt for Claude Code — gate B-phase re-screening on lead status

Paste everything below into Claude Code, run from the repo root (`JobSearchWkf`).

---

Implement §2.4 option (3) from `Process/CI/Make C2 Build on B6 Instead of Re-Deriving the Map.md` — read
that note's §2.4 in full before starting, it has the complete investigation. Short version below so you
don't have to context-switch immediately.

## The problem

`app/actions/pipeline.ts` has three B-phase actions — `runScreeningAction`, `runInitialChecksAction`, and
`runScoringAction` — that all call `requireScreenableLead(leadId, owner)` as their only guard:

```ts
async function requireScreenableLead(leadId: string, owner: string) {
  const [lead] = await db.select().from(jobLeads).where(and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, owner)));
  if (!lead) throw new Error('Lead not found.');
  const jd = lead.jdText ?? '';
  if (jd.trim().length < 80) {
    throw new Error('No job description captured for this lead yet — paste or re-capture the posting before screening.');
  }
  return lead;
}
```

That only checks the lead exists and has JD text — nothing stops any of these three firing on a lead
that's already `promoted`, `tailoring`, `ready`, or `applied` and carrying **human-approved**
`requirement_tailoring` rows. If a re-screen reaches B2's `tooThin` re-extraction branch
(`lib/pipeline/screening.ts` ~388), `job_requirements` gets deleted and rewritten with new ids — every
`requirement_tailoring` row pointing at the old ids is now orphaned. (That specific orphan-cleanup half is
already fixed — B2's `tooThin` branch now also deletes `requirement_tailoring` — but that's cleanup after
the fact, not prevention.)

The codebase already has the right model for this, just not applied here: `refreshFreshnessAction`'s own
doc comment states the design — *"B1 only. The re-screen affordance for a lead that has been sitting in
the queue — elapsed time is the only B1 input that changes, and B2–B6 are judgments over static JD text,
so re-running them would just re-spend LLM calls for the same answer."* That's exactly right, and it's
what B1's refresh exists for. `runScreeningAction`/`runInitialChecksAction`/`runScoringAction` just aren't
gated to match it.

## What to build

Gate the three actions so a lead past `promoted` can't be silently re-screened:

1. **Default: block.** For a lead whose `status` is `promoted`, `tailoring`, `ready`, or `applied`,
   `runScreeningAction` and `runInitialChecksAction` should refuse to run and explain why (point at
   `refreshFreshnessAction` as the safe alternative for "this posting might be stale").
2. **Confirm and override, don't just hard-block.** The CI note is explicit that re-screening such a lead
   should stay possible, just deliberate: *"a deliberate, warned action that states what will be
   discarded."* Add a way to pass an explicit override (e.g. a `force: boolean` param on the action) that
   only fires after the UI shows the person what's at stake — how many `requirement_tailoring` rows exist,
   how many are `approvalStatus = 'green'` — and they confirm anyway.
3. **Check `runScoringAction` too, don't assume.** Its own doc comment claims it's "safe to re-invoke from
   the top on a stuck lead (B4/B6 overwrite, B5 skips re-extraction when `job_requirements` rows exist)" —
   so it likely can't orphan `requirement_tailoring` the way B2's re-extraction can, since B5 skips
   re-extraction whenever requirements already exist. But it does still silently re-spend an Opus B6 call
   and rewrite `requirement_evidence` (B6's initial links) on a lead that's already past the B-phase — read
   the code yourself and decide whether that's also worth gating, don't take the doc comment's word for it.
4. **Find every caller.** `runScreeningAction` and `runInitialChecksAction` are called from wherever the
   lead detail page / board exposes "Screen" / "Screen anyway" — find those call sites and make sure the
   confirmation surfaces sensibly in context, not just as a generic alert.

## What NOT to do

- Don't touch `refreshFreshnessAction` — it's already correctly scoped to B1-only and is the intended safe
  path.
- Don't add a second parallel status column — `job_leads.status` is already the single source of truth
  every other consumer keys off (`rpNextAction`, stage pills, the board's `active` filter). The gate is a
  read of the existing status, not a new field.
- Don't touch `runEvidenceMapping`/C2 at all — this is a B-phase (screening) gate, unrelated to how C2
  merges.

## Acceptance criteria

- A lead at `promoted`/`tailoring`/`ready`/`applied` cannot have `runScreeningAction` or
  `runInitialChecksAction` fire without an explicit, confirmed override.
- The override path still works end-to-end (a deliberate re-screen completes and, if it hits B2's
  `tooThin` branch, the existing orphan cleanup still fires correctly).
- A lead at `captured`/`screening`/`hold`/`scoring_queue`/`selected`/`screened` is completely unaffected —
  this must not add friction to the normal, everyday screening flow.
- `runScoringAction`'s exposure is explicitly checked and either gated the same way or documented as to
  why it doesn't need to be — not left unexamined.
- `npx tsc --noEmit` clean, `npx vitest run` all passing, new tests covering the gate (blocked without
  override, allowed with override, unaffected pre-`promoted` statuses).
- Update `Process/CI/Make C2 Build on B6 Instead of Re-Deriving the Map.md` §2.4 and §2.7 (check the box)
  with what was actually built, per this repo's CI logging convention (dated §4 entry, append-only).
