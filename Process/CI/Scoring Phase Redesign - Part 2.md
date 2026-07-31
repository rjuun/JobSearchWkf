---
ci-area: Monitoring / D-Phase
ci-title: Scoring Phase Redesign — Part 2 (Monitoring / Applications / Archive)
ci-status: 3 - Delivered
ci-priority: high
ci-date: 2026-07-28
ci-estimated-time: 5
ci-time-spent: 1.35
pr-source: "[[D1. Monitoring Applications]]"
pr-target: "[[D1. Monitoring Applications]]"
---

---
```simple-time-tracker
{"entries":[{"name":"Development","startTime":"2026-07-28T20:15:00.000Z","endTime":"2026-07-28T21:36:00.000Z"}]}
```
---

## 1. What is the problem or opportunity?

Once a lead reaches `applied`, RoleProof stops helping. The board shows it as done; nothing tracks what
happens next. Reggie currently reconstructs "what's outstanding" from memory and his mailbox, with no
record of when a confirmation came in, whether an interview got scheduled, or which applications quietly
died. `Process/Development/D1. Monitoring Applications.md` has sat as an empty frontmatter stub since
2026-06-24 — the D-phase was scoped but never built.

It isn't greenfield, though. `applications` (`lib/db/schema.ts`) already has one row per `(owner, lead)`
via `markAppliedAction`, `recordOutcomeAction` already writes outcome status/notes
(`app/actions/monitoring.ts`), and a small card on `/dashboard` — `components/roleproof/returns-panel.tsx`,
gated by `env.nextReturns` — already logs response/interview/offer/screened-out by button click. Reggie's
own words on that panel: **"I honestly do not know what the Returns Panel is."** A feature its own owner
doesn't recognize isn't earning its spot on the dashboard, which settles what to do with it (§2.2.G) — but
the underlying data model and write path it uses are sound and this CI builds on them rather than replacing
them.

The actual workflow gap, established across two rounds of feedback on the design doc (see §3), is specific:
Reggie tracks outcomes by dragging emails (confirmation, interview invite, decline) out of Outlook. Nothing
in the app can receive that gesture. This CI is what makes the D-phase scaffold match how he actually works,
plus the one piece that was missing entirely — a reference Archive of stopped applications, for pattern-
matching against past cases when a new lead looks similar to one that didn't go anywhere.

This is Part 2 of a two-part redesign. Part 1 (B-phase Scoring Queue — `[[Scoring Phase Redesign - Part 1]]`)
is delivered: `job_leads` now has `scoring_queue`/`selected`/`roadblocked`/`misaligned`, the Queue/Ready-to-
score/Results flow exists, and — the exact hook this CI picks up — the Results row action for
`status = 'ready'` already reads **"Application sent"**, with a code comment in `rpNextAction`
(`components/roleproof/kit.tsx`) stating outright that the drop-target mechanic behind it is this CI's
scope, not Part 1's. Confirmed still true against the current repo (2026-07-28, post-Part-1 commits
`2039db3`..`3d5b260`): the label exists, the mechanic behind it does not yet.

## 2. What would the improvement look like?

### 2.0 Scope

**In scope:**
- 5 new nullable columns on `applications` (§2.2.A) — no enum, no `ALTER TYPE`, plain `ALTER TABLE ADD
  COLUMN`.
- One new `applications.status` value, `response_pending`; everything else reuses values
  `ALLOWED_OUTCOMES` already has, relabelled.
- Native HTML5 drag-and-drop (no new dependency) as the capture mechanic, tolerant of file / text-link /
  nothing landing in `dataTransfer`, with a manual inline-form fallback for the no-email case (e.g. a
  portal application with no confirmation email at all).
- **Confirmed with a real dropped file** (2026-07-28 — see §4): dragging out of Outlook Classic produces
  a genuine `.msg` file (CDFV2 compound binary format) via `dataTransfer.files`, exactly as designed —
  this is not a live Outlook deep-link and can't be turned into one after the fact (§2.2.C).
- Three new server actions extending `app/actions/monitoring.ts`, mirroring `recordOutcomeAction`'s shape.
- **"Application sent" is drop-triggered, confirmed** — the drop *is* the intended way this fires, not an
  optional bonus path on top of a manual click (§2.2.H). A plain manual-confirm click stays only as the
  fallback for the no-email case above, not as an equally-weighted alternative.
- New unified **Applications** list (response-pending + interview-scheduled rows in one list, not two
  screens) joining the Flow tab group after Results.
- New **Archive** tab (stopped applications only), sibling to Flow, not part of it.
- Decline pop-up (modal, not a route) firing on decline-drop: reply-template assist, `mailto:`, no
  outbound send.
- Retiring `components/roleproof/returns-panel.tsx` and its `/dashboard` wiring outright; folding its one
  good idea (a "no word in 7+ days" stale nudge) into the Applications list as a badge.
- `nextMonitoring` feature flag, same convention as `nextScoringQueue`.

**Explicitly out of scope (do not implement in this pass) — confirmed, not just deferred:**
- Live Microsoft Graph mailbox deep-links. **Confirmed 2026-07-28: an archived copy is enough** — "the link
  to the confirmation email" means a link to the copy RoleProof stores itself, not a live click-through
  into the mailbox. This also settles a design question that had genuinely been open: a raw dropped `.msg`
  file cannot be turned into a live Outlook deep-link after the fact (that URL shape only exists because
  Outlook itself generates it from the live mailbox) — so building toward a live link would have meant a
  *second*, separate "Copy Link"-and-paste interaction alongside the drag, not an enhancement of it. Not
  needed: no Graph API, no OAuth.
- Auto-extracting subject/date from a dropped `.msg`/`.eml` (e.g. `@kenjiuno/msgreader`, `mailparser`).
  The manual inline form (pre-filled with today's date) covers this for v1; parsing is a phase-2
  enhancement.
- Any outbound email send capability. The decline pop-up's "Open in email" is a `mailto:` handoff to
  Reggie's own mail client — RoleProof has no SMTP/Graph send integration and this CI does not add one.
- Filtering/search on the Archive list. V1 is a plain list; search-by-company/JD-group is a real v2
  candidate, not required to ship the reference view.
- A stats/analytics view over `roadblocked`/`misalignments` throughput (leads-processed-vs-sent funnel,
  recurring-roadblock mining). Earmarked as its own future CI in the design doc — this CI only makes sure
  the underlying data stays available for it later, doesn't build the view.
- Vercel Cron auto re-screening, model/prompt changes — unrelated to this CI, per the original brief's
  scope for the whole redesign effort.

### 2.1 Current state (for reference — don't rediscover this)

Re-verified against the running repo on 2026-07-28, after Part 1's six commits landed:

- `applications` (`lib/db/schema.ts`) is **unchanged** by Part 1: `{...base, jobLeadId, cvVariantId,
  appliedAt, status: text('status'), outcomeNotes}` plus a unique index on `(ownerId, jobLeadId)`. Every
  column this CI plans to add (§2.2.A) is still exactly as designed — nothing to reconcile.
- `app/actions/monitoring.ts` is **unchanged**: `markAppliedAction` (idempotent `onConflictDoUpdate` on the
  `(ownerId, jobLeadId)` unique index — no select-then-insert race) and `recordOutcomeAction`, gated by
  `const ALLOWED_OUTCOMES = new Set(['response', 'interview', 'offer', 'screened_out', 'applied',
  'downloaded'])`. Both call `recordActivity`; `recordOutcomeAction` also calls
  `recordUxEvent(owner, 'returns', 'outcome_logged', ...)` — the reaction signal this CI must keep emitting
  from wherever the equivalent write happens next.
- `components/roleproof/returns-panel.tsx` is **unchanged** and still live: imported in
  `app/dashboard/page.tsx` (line 8), rendered at line 116, fed by `listApplications()` gated behind
  `env.nextReturns` (line 23). It calls `recordOutcomeAction` directly from four buttons
  (response/interview/offer/screened-out) and renders a `STATUS_LABEL` map covering
  downloaded/applied/response/interview/... This is the exact surface §2.2.G retires.
- `components/roleproof/kit.tsx`'s `rpNextAction` — **the hook point this CI exists to fill**:
  ```ts
  case 'tailoring':
    return { label: 'Tailoring CV', actionable: true };
  case 'ready':
    return { label: 'Application sent', actionable: true };
  ```
  with a comment stating plainly that the drop-target mechanic behind "Application sent" is this CI's
  scope, not Part 1's. Confirmed present, unchanged, exactly as Part 1 left it.
- `lib/storage.ts` exists and is reusable as-is: a bucket-relative adapter (`writeBuffer`, `writeText`,
  `readBuffer`, `readText`, `exists`, `localPath`) that picks Supabase Storage vs. local filesystem at
  runtime based on `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, already backing `jd-captures/` and
  `cv-output/`. No changes needed to the adapter itself — this CI just writes to a new prefix,
  `applications/{leadId}/`.
- `app/actions/scoring-queue.ts` (new in Part 1) is the shape template to mirror for this CI's new actions:
  `'use server'`, a typed status union, owner-scoped select-then-update, `recordActivity` with a
  human-readable summary, `revalidatePath` on every affected route. Confirmed this pattern reads cleanly
  and is worth copying rather than inventing a new action shape.
- `job_leads.status` (`leadStatusEnum`, confirmed full current list): `captured, hold, scoring_queue,
  roadblocked, misaligned, selected, screening, screened, promoted, tailoring, ready, applied, archived`
  (declaration order; the live Postgres type has the four Part-1 values appended after `archived` per
  `ALTER TYPE ... ADD VALUE` semantics — doesn't affect this CI, noted for completeness). **This CI adds no
  new `lead_status` values** — per the design doc's own reasoning (§2.2 below), the D-phase sub-states
  belong on `applications.status`, not `job_leads.status`, which stays at `applied` throughout.
- Checked fresh (not assumed carried over from Part 1's own check): no `dnd-kit`/`react-dnd` dependency and
  no `draggable`/`onDrop`/`dataTransfer` usage anywhere in the repo. Part 1 didn't touch this area, so the
  design doc's original finding still holds — this CI is genuinely the first drag-and-drop surface in the
  app.

### 2.2 Target state

**A. Schema — `applications` additions, no enum surgery**

```ts
export const applications = pgTable('applications', {
  ...base,
  jobLeadId: uuid('job_lead_id').notNull(),
  cvVariantId: uuid('cv_variant_id'),
  appliedAt: timestamp('applied_at', { withTimezone: true }),
  status: text('status'),
  outcomeNotes: text('outcome_notes'),
  confirmationEmailLink: text('confirmation_email_link'),          // NEW — sent-confirmation drop
  outcomeEmailLink: text('outcome_email_link'),                    // NEW — decline OR interview-confirm drop
  outcomeAt: timestamp('outcome_at', { withTimezone: true }),      // NEW — decline date, or interview setup date
  interviewAt: timestamp('interview_at', { withTimezone: true }),  // NEW — actual interview date/time, manual entry
  thanksRepliedAt: timestamp('thanks_replied_at', { withTimezone: true }), // NEW — optional reply-sent marker
});
```

`outcomeEmailLink`/`outcomeAt` are deliberately dual-purpose (decline *or* interview-confirmation) rather
than split into separate column pairs — a lead is only ever in one terminal-ish outcome at a time, and the
UI picks the label from `status`. `interviewAt` is the one field that's a future fact, not something in a
dropped email's metadata — confirmed it renders as a real date/time picker, not a display field, since it's
typed by hand every time. This is a plain `ALTER TABLE ADD COLUMN` migration — cheaper and lower-risk than
Part 1's `ALTER TYPE ... ADD VALUE` sequencing constraint, no deploy-order dependency to manage.

One new status value: `response_pending` — set the moment "Application sent" fires. Everything else reuses
`ALLOWED_OUTCOMES` values already in `app/actions/monitoring.ts`, relabelled for this surface:

| Stored value | Existing meaning (Returns panel, retiring) | New label (Applications list) |
| --- | --- | --- |
| `response_pending` (new) | — | Response pending |
| `interview` | "Interview" | Interview scheduled (extra columns populate) |
| `screened_out` | "Screened out" | Stopped → moves to Archive (§2.2.F) |
| `offer` | "Offer" | Offer (unchanged, bonus bucket, not part of this CI's ask) |

No data migration needed — existing rows keep their existing meaning; only the label map changes and one
new value is added going forward. `job_leads.status` does **not** grow a matching value: it stays at
`applied` throughout this whole D-phase, exactly as it is today. Reasoning carried over deliberately from
Part 1's own status-column argument (§2.2.A there): `job_leads.status` is the one thing every board consumer
keys off, and these are sub-states of "applied," not a new lead-level stage — tracking them on `applications`
instead keeps that single source of truth intact.

**B. `app/actions/monitoring.ts` extensions**

Extend `ALLOWED_OUTCOMES` with `'response_pending'`. Add three actions, each following
`setScreeningGateAction`'s shape from Part 1 (owner-scoped fetch/update, `recordActivity`,
`revalidatePath`) and each still calling `recordUxEvent(owner, 'returns', 'outcome_logged', ...)` so the
Statement feed doesn't lose the signal the retired Returns panel used to emit:

```ts
export async function logApplicationSentAction(
  leadId: string,
  input: { confirmationEmailLink?: string | null } = {},
): Promise<void> { /* upsert applications row: status 'response_pending', appliedAt if unset,
                       confirmationEmailLink if provided. Mirrors markAppliedAction's onConflictDoUpdate. */ }

export async function logDeclineAction(
  leadId: string,
  input: { outcomeEmailLink?: string | null; outcomeAt?: Date },
): Promise<void> { /* status 'screened_out', outcomeEmailLink, outcomeAt (default now()).
                       No popup logic here — that's client-side, fired after this resolves. */ }

export async function logInterviewScheduledAction(
  leadId: string,
  input: { outcomeEmailLink?: string | null; outcomeAt?: Date; interviewAt: Date },
): Promise<void> { /* status 'interview', outcomeEmailLink, outcomeAt (setup date), interviewAt (manual). */ }
```

**C. Drag-and-drop mechanic — tolerant capture, no new dependency**

Plain HTML5 (`draggable` on nothing needed here — the *targets* are what matter: `onDragOver` +
`preventDefault`, `onDrop` reading `event.dataTransfer`). Confirmed no dnd-kit/react-dnd needed anywhere in
this app for this to work (§2.1).

The real risk isn't the mechanic, it's what actually lands in `dataTransfer`, which depends on the mail
client. Confirmed: Reggie uses Outlook Classic (desktop), with New Outlook as a fallback — the good case,
since classic desktop Outlook reliably hands the browser a real `.msg` file via `dataTransfer.files` when
you drag a message out of it. New Outlook / OWA are less reliable across window boundaries. **Verified
against a real dropped file (2026-07-28):** a receipt email dragged out of Outlook Classic produced a
genuine 206 KB CDFV2-format `.msg` file — exactly the `dataTransfer.files` shape this design is built
around, not a link or plain text. Build the drop handler tolerant of all three shapes rather than betting
on one:

**Workflow detail, not a functional requirement — worth reflecting in UI copy:** Reggie doesn't drag
straight from his inbox. He first moves confirmation and decline emails into two named Outlook folders
(**Bewerbungen**, **Absagen**), then drags from there onto the corresponding Job Lead. The drop mechanic
itself doesn't care which folder the file came from, so this needs no code branching — but a short
instructional line in the drop-target UI ("drag from your Bewerbungen / Absagen folder") would match how
he actually works rather than assuming a raw-inbox drag.

```ts
function handleDrop(e: React.DragEvent) {
  e.preventDefault();
  const file = e.dataTransfer.files?.[0];
  if (file) return uploadAndLink(file); // → lib/storage.ts, applications/{leadId}/{kind}-{ts}.msg, signed URL as the link
  const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
  if (text) return linkDirect(text);
  openManualForm(); // pre-filled with today's date — the gesture works either way
}
```

Auto-extracting subject/date from the `.msg`/`.eml` itself is explicitly out of scope (§2.0) — the manual
form's date field covers it either way, so v1 doesn't need a parser dependency.

**D. Applications tab — one unified list**

New route `app/roleproof/applications/page.tsx`, new component `components/roleproof/applications-list.tsx`.
Query: `applications.status IN ('response_pending', 'interview')` for the owner — `screened_out` rows never
render here (§2.2.F, they're already in the Archive). Both statuses render in the *same* list; only the
status pill and a few conditional columns differ:

- `response_pending` row: sent date (`appliedAt`), confirmation link (`confirmationEmailLink`), a drop
  target to promote it to `interview` or `screened_out`.
- `interview` row, additionally: interview setup date (`outcomeAt`), interview date (`interviewAt` — the
  manual date/time picker), interview confirmation link (`outcomeEmailLink`).
- `stale` badge (folded in from the retired Returns panel, §2.2.G) on any `response_pending` row where
  `appliedAt` is 7+ days old with no status change since.

Joins the existing Flow tab group after Results (Queue → Ready to score → Results → **Applications**),
using the same tab-treatment pattern already in `app/roleproof/scoring-queue/page.tsx`, not a new nav
pattern.

**E. Decline pop-up — an event, not a destination**

`components/roleproof/decline-popup.tsx` — a modal (not a route, dismissible, no back-button state).
Dropping a decline email on a `response_pending` row calls `logDeclineAction` immediately (status change +
Archive move happen with no extra click), *then* opens the pop-up as a reply-assist:

> "Thank you for letting me know, and for considering my profile. I remain very interested in `{company}`
> and would welcome being considered for future roles that fit my background."

Three buttons: **Copy text**, **Open in email** (`mailto:` pre-filling subject/body in the default mail
client — no sender pre-fill without `.msg` parsing, out of scope per §2.0), **Skip**. Skipping doesn't undo
anything — the lead is already in the Archive regardless; this is purely the reply assist.

**F. Archive tab — reference list, sibling to Flow**

New route `app/roleproof/archive/page.tsx`, new component `components/roleproof/archive-list.tsx`. Scope
confirmed narrow: **only `applications.status = 'screened_out'`** — "processed" applications that ran their
course. `roadblocked`/`misaligned` triage drops from Part 1 explicitly stay out — they never had an
application to stop, and this is a body of finished cases, not everything terminal. That data isn't lost;
it's earmarked for a separate future stats/pattern-mining CI (§2.0), not built here.

V1 is a plain list: company, role, stopped date, a link into the lead's full detail (screening scores,
requirements, the CV that was sent) — the point is pattern-matching against a similar past case, so the
link-through matters as much as the list itself. Visually distinguished from the Flow tab group (a divider
or different tab treatment) so it reads as "look back," not "keep working" — the same distinction Part 1
already draws between the active board and archived leads, just given its own tab here instead of staying
an implicit filter.

**G. Retiring the Returns panel**

Delete `components/roleproof/returns-panel.tsx`; remove its import (line 8) and render (line 116) from
`app/dashboard/page.tsx`, and remove the now-dead `env.nextReturns`-gated `listApplications()` call (line
23) unless something else on that page still needs it (check before removing — confirm nothing else reads
that same query result). The panel's one genuinely good idea — flagging "no word in 7+ days" — is not lost,
it moves into the Applications list as the `stale` badge (§2.2.D). The underlying writes
(`recordActivity`/`recordUxEvent`) are preserved because the new actions (§2.2.B) call the same helpers;
only the standalone panel and its button-click UI go away.

**H. Results tab — closing Part 1's breadcrumb**

`components/roleproof/kit.tsx`'s `rpNextAction` case for `status === 'ready'` keeps its `'Application
sent'` label but stops being a static, always-actionable pill — it becomes a real drop target using
§2.2.C's handler. **Confirmed 2026-07-28: the drop is the intended trigger**, not an optional shortcut
alongside an equally-weighted manual click — build the drop target as the primary control. Keep a
manual-confirm fallback only for the genuinely no-email case (a portal application with nothing to drop),
calling `logApplicationSentAction` either way. This is one of three places the same drag-and-drop mechanic
fires — here, and twice more inside Applications for decline/interview-confirm drops.

**I. Nav and feature flag**

`lib/env.ts`: add `nextMonitoring: str('NEXT_MONITORING', '1') !== '0'`, same convention as
`nextScoringQueue`. Gate the new Applications/Archive nav entries and routes behind it. Board/nav changes:
Applications tab added to the Flow group; Archive tab added as a visually distinct sibling, not part of
Flow.

**J. Docs**

`docs/PIPELINE.md` and `docs/ARCHITECTURE.md` don't currently describe the D-phase at all (checked — both
stop at B6/C-phase). Add a short D-phase section to `docs/PIPELINE.md` covering the
`response_pending → interview | screened_out` sub-state flow on `applications.status`, and note in
`docs/ARCHITECTURE.md` that this is the first drag-and-drop surface in the app (native HTML5, no library)
in case a future feature is tempted to reach for `dnd-kit` without checking this precedent first.

### 2.3 Ordered implementation checklist

1. `lib/db/schema.ts`: add the 5 nullable columns to `applications` (§2.2.A); run `drizzle-kit generate`;
   inspect the output (should be a single `ALTER TABLE` statement, no `statement-breakpoint` sequencing
   concern like Part 1's enum had); apply via `scripts/migrate.ts`.
2. `app/actions/monitoring.ts`: extend `ALLOWED_OUTCOMES` with `'response_pending'`; add
   `logApplicationSentAction`, `logDeclineAction`, `logInterviewScheduledAction` (§2.2.B).
3. `lib/storage.ts`: no code change — confirm the `applications/{leadId}/` prefix write path works against
   the existing adapter with a throwaway lead before building UI on top of it.
4. Build the drop handler (§2.2.C) as a small shared hook/util (e.g.
   `components/roleproof/use-email-drop.ts`) — used in three places (H, D, E below), write it once.
5. `components/roleproof/kit.tsx`: wire the real drop-or-manual-confirm control behind the existing
   `'ready'` → "Application sent" case (§2.2.H).
6. `components/roleproof/applications-list.tsx` (new) + `app/roleproof/applications/page.tsx` (new) —
   unified response-pending/interview-scheduled list, stale badge (§2.2.D).
7. `components/roleproof/decline-popup.tsx` (new) — reply-assist modal (§2.2.E).
8. `components/roleproof/archive-list.tsx` (new) + `app/roleproof/archive/page.tsx` (new) — stopped-only
   reference list (§2.2.F).
9. `lib/env.ts`: add `nextMonitoring`; gate new routes/nav entries.
10. Nav: add Applications to the Flow tab group, Archive as a distinguished sibling tab.
11. Delete `components/roleproof/returns-panel.tsx`; remove its wiring from `app/dashboard/page.tsx`
    (§2.2.G) — confirm nothing else on that page depends on the `listApplications()` call before removing
    it outright.
12. Run `vitest` — add coverage for the label-mapping (`STATUS_LABEL`-equivalent) and for the drop handler's
    three-way branch (file / text / neither), since that branching logic is new and easy to get subtly
    wrong.
13. Live smoke test: drag a real `.msg` file out of Outlook Classic onto each of the three drop targets
    (Results "Application sent," Applications decline, Applications interview-confirm) and confirm the
    file lands in storage, the link resolves, and the status/columns update correctly. This is the one step
    a mock-mode harness cannot substitute for — Part 1's own log (§4 there) is the cautionary precedent:
    verify this against Outlook itself, don't infer it from code review alone.
14. Update `docs/PIPELINE.md` / `docs/ARCHITECTURE.md` per §2.2.J.

### 2.4 Acceptance criteria

- Dropping a `.msg` file from Outlook Classic onto the Results "Application sent" control — this is the
  primary, intended trigger, not a bonus path — uploads it to `applications/{leadId}/`, sets
  `applications.status = 'response_pending'`, and populates `confirmationEmailLink` with a resolvable link
  to the archived copy, zero manual date/link entry required.
- The same control, clicked with nothing dropped, still sets `status = 'response_pending'` via manual
  confirm — kept only as the fallback for the no-email (portal application) case, not as an equal
  alternative to dropping.
- A `response_pending` row with `appliedAt` 7+ days old and unchanged status shows the `stale` badge in the
  Applications list.
- Dropping a decline email on a `response_pending` row sets `status = 'screened_out'`, populates
  `outcomeEmailLink`/`outcomeAt`, moves the lead out of the Applications list into the Archive
  immediately, and opens the reply-assist pop-up — dismissing the pop-up does not revert any of the above.
- Dropping an interview-confirmation email sets `status = 'interview'`, populates `outcomeEmailLink`/
  `outcomeAt`, and the row gains an `interviewAt` date/time picker that persists a manually entered value.
- The Archive list shows only `screened_out` rows — no `roadblocked`/`misaligned` leads appear there.
- `/dashboard` no longer renders `returns-panel.tsx`; the page still loads cleanly with no dead import or
  unused query.
- `roadblocked`/`misalignments` throughput data remains fully intact in the DB (untouched by this CI) —
  confirms the future stats CI has something to build on, without this CI building the view itself.
- `tsc --noEmit` clean; `vitest` passes.

## 3. Resources or references

- Design doc, Part 2 section (the fuller spec this CI distills, §2.1–2.8, including the drag-and-drop
  client-reliability research and the confirmed Outlook Classic decision):
  `docs/proposals/Scoring Queue - Implementation Plan.md`.
- Sibling CI, delivered, and the source of every current-state fact re-verified in §2.1 above:
  `[[Scoring Phase Redesign - Part 1]]` — in particular its §2.2.G (the exact `rpNextAction` breadcrumb this
  CI closes) and its §4 log entry on the mock-mode harness bug (the precedent for why step 13 above insists
  on a real live drag-and-drop test, not just a mocked one).
- Process note this CI is filed against (currently an empty stub, first real content):
  `[[D1. Monitoring Applications]]`.
- Code: `lib/db/schema.ts` (`applications`), `app/actions/monitoring.ts`, `lib/storage.ts`,
  `components/roleproof/kit.tsx` (`rpNextAction`), `components/roleproof/returns-panel.tsx` (retiring),
  `app/dashboard/page.tsx`, `app/roleproof/scoring-queue/page.tsx` (tab-treatment pattern to copy),
  `app/actions/scoring-queue.ts` (action-shape template), `lib/env.ts`.
- Model choice: same recommendation and reasoning as Part 1 — Claude Opus 5 as the default for this class
  of agentic coding work, per Anthropic's own guidance (roughly half Fable 5's cost, ahead on
  coding-specific agentic benchmarks), reserving Fable for an actual expensive-failure escalation rather
  than as the default: https://www.anthropic.com/news/claude-opus-5.

## 4. Notes / Progress log

- 2026-07-28: CI opened, immediately after Part 1 shipped (`[[Scoring Phase Redesign - Part 1]]`,
  `3 - Delivered`). Reggie chose to build the full two-part change before starting Part 1's own click-testing
  (its §4 "Open for Reggie" item — Queue/Ready-to-score UI not yet browser-tested), so that testing happens
  once against the complete redesign rather than twice. Re-verified every piece of current-state evidence
  used here against the post-Part-1 repo rather than carrying over pre-Part-1 assumptions from the original
  design-doc chat — confirmed `applications`, `monitoring.ts`, `returns-panel.tsx`, and `lib/storage.ts` are
  all untouched by Part 1's commits, and confirmed the exact `rpNextAction` breadcrumb Part 1 left behind
  (§2.1 above) still reads exactly as designed.
- **`ci-estimated-time: 5`**, set by the same precedent-anchored method Part 1 used rather than a fresh
  guess: Part 1 (comparable schema+pipeline+2-new-UI-components surface) was estimated 4h against this
  repo's two closest real precedents (6h/1.5h actual, 10h/2h actual). This CI has a smaller schema/pipeline
  footprint (plain column adds, no enum sequencing, extending an existing actions file rather than
  splitting a pipeline function) but a larger UI footprint (3 new components + 2 new routes vs. Part 1's 2
  + 1) and one genuinely new risk Part 1 didn't have to carry: drag-and-drop has no precedent anywhere in
  this codebase, and its real-world behavior depends on Outlook's client-specific export behavior, which
  can only be confirmed by a live test (§2.3 step 13), not by code review. That last point is the main
  reason this sits at 5h rather than matching Part 1's 4 — budget for a follow-up round if Outlook Classic's
  actual drag output doesn't match the well-documented behavior this CI is designed around.
- **2026-07-28 · both open decisions resolved, same day the CI was opened:**
  1. **"Application sent" is drop-triggered, confirmed.** Not "same affordance, two ways to fire it" as
     originally drafted — the drop is the intended mechanism; manual click survives only as the no-email
     fallback (§2.2.H, §2.4).
  2. **Archived copy confirmed sufficient — no Graph API, no OAuth.** Settled after a genuinely useful
     tangent: Reggie shared an `outlook.office.com/mail/deeplink/read/...` URL asking whether that was the
     kind of link he wanted stored. It isn't reachable by anything outside his own logged-in mailbox
     session (confirmed by trying to fetch it — expected, not a bug), but more importantly it clarified a
     real constraint: that URL shape only exists because Outlook itself generates it from the live
     mailbox, and a dragged `.msg` file — confirmed moments later against a real dropped receipt email,
     206 KB, genuine CDFV2 format — cannot be turned into one after the fact. So "live link" and "the file
     you're already dragging" were never actually the same option; once that was clear, Reggie confirmed
     the archived copy is enough. This also corrects the design doc's own framing (§2.3/§2.8 there), which
     had assumed a live link would need Graph API + OAuth as a deferred nice-to-have — the real reason to
     skip it is that it's incompatible with the drag gesture itself, not merely bigger scope.
  3. **Workflow detail folded in, not a decision but worth keeping:** Reggie moves confirmation/decline
     emails into two named Outlook folders — **Bewerbungen**, **Absagen** — before dragging them in.
     Doesn't change the mechanic (§2.2.C already notes the UI-copy implication), noted here so a future
     reader doesn't have to rediscover it.

### Implementation log

- **Step 1 · schema.** Five nullable columns added to `applications` exactly as §2.2.A specifies.
  `drizzle-kit generate` produced `drizzle/0024_superb_scorpion.sql` — five plain `ALTER TABLE ... ADD
  COLUMN` statements, no `ALTER TYPE`, so none of Part 1's enum-sequencing/deploy-order concern applies
  (§2.2.A was right about that). Applied via `npm run db:migrate`, clean. `tsc --noEmit` clean.
- **Steps 2–4 · actions, storage, the drop hook.** Three actions added as designed. Two details §2 left
  as pseudo-code had to be settled in the code:
  1. **The stored link is this app's own route, not a signed URL.** §2.2.C's sketch said "signed URL as
     the link". That doesn't survive contact with `lib/storage.ts`: signed URLs expire, and don't exist
     at all on the local-filesystem backend the adapter falls back to. The repo already had the right
     precedent in `/api/cv/[leadId]` — an owner-scoped, middleware-gated route reading through the
     storage adapter — so `confirmationEmailLink`/`outcomeEmailLink` now hold
     `/api/applications/{leadId}/email/{file}`. This also keeps §2.4's wording exactly ("a resolvable
     link to the archived copy") and means a dropped *text* link can go in the same column verbatim.
  2. **The three-way branch is a pure function, not a hook internal.** `classifyEmailDrop` lives in
     `lib/applications.ts` rather than inside `use-email-drop.ts`, because §2.3 step 12 asks for it to
     be unit-tested and vitest here is plain node — there is no `DragEvent` to construct. One
     deliberate deviation from §2.2.C's sketch: a **zero-byte** file falls through to the text shapes
     instead of counting as a capture.
  Step 3 confirmed `lib/storage.ts` needed no change, as §2.3 predicted — the bucket-relative adapter
  took the `applications/{leadId}/` prefix as-is (13 checks green in `scripts/verify-monitoring.ts`).
- **Step 5 · the one place the CI's current-state read was wrong.** §2.1/§2.2.H both say the drop target
  replaces "the Results row action for `status = 'ready'`". There is no such row: `lib/queries.ts`'s
  `scoringQueueData()` filters `results` to `status === 'screened'` **only**, so a `ready` lead never
  renders on the Results tab at all. `rpNextAction('ready') → "Application sent"` actually renders on the
  board's All-leads table (as inert text inside a row-wide `<Link>`), the This-week strip and Weekly
  Triage — and the *real* "I sent it" click was a **"Mark applied"** button on the lead workspace calling
  `markAppliedAction`. Part 1's own §2.2.G carries the same mis-description, so this was inherited, not
  introduced here. **Resolved with Reggie mid-implementation:** the control goes on the board row *and*
  the workspace panel. The workspace button was **replaced**, not kept alongside — `markAppliedAction`
  writes `applications.status = 'applied'`, which the new Applications list doesn't query, so a send
  confirmed there would silently never have appeared in the very list this CI exists to build.
  `markAppliedAction` itself is left untouched for back-compat, just no longer wired to any UI.
  Board rows became `div + Link + action cell`: a drop target nested inside an anchor is neither valid
  HTML nor droppable.
- **Steps 6–8 · Applications, the decline pop-up, Archive.** Built as specified. Two small extensions
  worth recording: the decline drop target is offered on `interview` rows too, not only
  `response_pending` as §2.2.D describes (a decline can land *after* an interview, and that's the same
  terminal move — the harness covers it); and `setInterviewAtAction` is split out from
  `logInterviewScheduledAction` because the invite arrives (drop) and the slot gets pinned down
  (typing) days apart, so folding them into one write would force a re-drop to change a date.
- **Steps 9–10 · nav.** The tab strip had to be extracted from `app/roleproof/scoring-queue/page.tsx`
  into a shared `FlowTabs`: §2.2.D says Applications "joins the existing Flow tab group", but that group
  was inline markup switching a `?tab=` on one page, and Applications is its own route. `flowCounts()`
  feeds every badge from two grouped aggregates so the strip costs the same on all five surfaces.
  `nextMonitoring` landed a step early (with step 6) because the new route imports it.
- **Step 11 · Returns panel retired.** Checked before removing, as §2.2.G insists: nothing else on
  `/dashboard` read the `listApplications()` result, so the import, the render, the query and the
  then-unused `env` import all went. `listApplications()` itself stays exported-but-uncalled and
  `env.nextReturns` stays live — `/api/cv/[leadId]` still gates its download-tracking insert on it.
- **Step 12 · tests, and a refactor the harness forced.** `lib/__tests__/monitoring.test.ts` covers the
  drop branch (including the cases that make it easy to get wrong: an empty `FileList` is truthy, a
  zero-byte file isn't a capture, `getData` can throw outside a real drop event) and the label map +
  stale rule. Suite: **154 tests / 14 files green, `tsc --noEmit` clean, `next build` clean** with all
  three new routes emitted.
  Two things had to move for the tests to be able to reach the code at all — both worth knowing before
  writing the next one:
  1. **A test cannot import a `.tsx` module here.** vitest runs the repo tsconfig, which leaves
     `jsx: preserve`, so importing `decline-popup.tsx` fails at transform. `declineReplyText` moved to
     `lib/applications.ts`. Same class of trap as Part 1's mock-mode bug: the thing that looks obviously
     fine is defeated by module-loading mechanics.
  2. **A `'use server'` module can't expose an owner-taking function**, and the harness has no request,
     so no `currentOwnerId()`. The write path therefore moved to `lib/monitoring.ts` with
     `app/actions/monitoring.ts` reduced to session-resolving wrappers. This is what makes
     `verify-monitoring.ts` drive the *real* write path instead of re-implementing it — the difference
     between a harness that proves something and one that only agrees with itself.
  `scripts/verify-monitoring.ts`: **41 checks, 0 failures**, covering every §2.4 criterion that doesn't
  need Outlook — including three the checklist implied but never stated: a re-drop **corrects** the row
  rather than duplicating it (and preserves the original send date), `interviewAt` starts null because no
  email carries a future fact, and a decline leaves the Applications list and enters the Archive in the
  same write with no intermediate state.
- **Step 13 · NOT DONE — needs Reggie and Outlook.** Deliberately not marked complete. Everything
  reachable without a real drag is verified: the write path (harness, 41 checks), the classifier (unit
  tests, all three branches), and a clean `next build` emitting `/roleproof/applications`,
  `/roleproof/archive` and `/api/applications/[leadId]/email/[file]`. What is **not** verified is the
  only thing that matters here — that Outlook Classic's actual `dataTransfer` payload behaves as
  designed on each of the three targets. Browser click-testing wasn't possible either: the app requires
  a login, and I don't enter credentials. See "Open for Reggie" below.
- **Step 14 · docs.** `docs/PIPELINE.md`'s D-phase was a two-row "idea" stub; it now carries the
  sub-state table, the reasoning for putting them on `applications.status`, and a D subgraph in the
  mermaid flow. `docs/ARCHITECTURE.md` gained the `applications/` storage prefix (with the
  route-not-signed-URL reasoning), lifecycle step 8, and a drag-and-drop row in the risk table so a
  future feature reaching for `dnd-kit` hits this precedent first. Beyond the checklist: filled
  `Process/Development/D1. Monitoring Applications.md`, the stub this CI is filed against (§3), empty
  since 2026-06-24 — flagged in-file as **not** a prompt template, since unlike the B/C notes nothing
  loads it at runtime (`lib/prompts.ts`'s `STEP_NOTE` covers B/C/O2 only).

### Reconciliation & backfill (post-implementation, 2026-07-29 — not part of §2.3's checklist)

Once Part 2 shipped, Reggie began reconciling his real SharePoint history into it — this is genuinely
different work from the checklist above (data correction, not new capability), but it changed the schema,
the query layer, and the Archive UI enough to belong in this log rather than be lost in chat.

- **Round 1 (pre-existing).** `scripts/reconcile-sharepoint.ts` + `scripts/data/sharepoint-reconciliation.json`
  (157 rows) already existed from an earlier session but had never been `--apply`'d.
- **Round 2.** 5 leads Reggie personally verified (dates, current status) moved into Applications as
  `response_pending`. Running `--apply` also fired round 1's *entire* backlog at once — worth recording
  as a real lesson: **a script that processes a whole data file doesn't stay scoped just because you only
  edited a few rows of it.** That surfaced two real data problems, both fixed:
  1. `applications.status` had literal SharePoint label text ("9 - Stopped", "3 - Waiting Application
     Reply", "2 - Send Application") instead of the app's vocabulary, because `reconcile-sharepoint.ts`
     writes via Drizzle directly and bypasses the `ALLOWED_OUTCOMES` guard. Fixed via
     `scripts/fix-reconciliation-status-labels.ts` (91 rows → `screened_out`, 17 → `response_pending`).
  2. The 17 relabeled `response_pending` rows turned out to be unverified and stale — all had been sitting
     at `job_leads.status = 'captured'` (never screened) with applied dates up to 9 months old. Reverted
     via `scripts/revert-unverified-applications.ts` back to `captured`, applications row deleted. Same
     treatment for 2 rows whose SharePoint status ("2 - Send Application") turned out to mean "never
     actually sent" — confirmed with Reggie, not guessed.
- **Archive dates were blank.** The 91 reconciled Archive rows showed "Stopped —" with no date:
  `outcome_at` was never populated by round 1, only buried as text inside `outcome_notes`. Fixed via
  `scripts/backfill-archive-outcome-dates.ts` (regex-parses "Process Closed: …", 91/91 parseable).
- **Full audit against the source of truth.** Reggie's own `Reconciliation Files/Final Reconciliation
  Review.xlsx` (`Sharepoint - Job Leads Table` tab) encodes exactly which of the 3 source tables
  (App - Job Leads / Sharepoint - Job Leads / Sharepoint - Applications) each lead's data should come
  from, via its own `Comment`/`Action` columns. Cross-checked all 91 Archive rows' `appliedAt` and
  `outcomeAt` against that rule. 90/91 matched. One didn't: seq 184 (Chief of Staff / Erste Digital) — round
  1 had linked it to Applications-table Folder ID 438, which actually belongs to an unrelated posting
  ("Chief of Staff - Avilon"), borrowing that row's dates instead of this lead's own. Fixed via
  `scripts/fix-erste-digital-dates.ts`.
- **Round 3 — Email address / Email response.** Reggie asked for two more Archive columns. `Email
  response` in the source is a SharePoint hyperlink column whose *displayed* text is almost always the
  unhelpful literal "Open Email" — the real value is the link target (an Outlook web deep-link, or
  occasionally an ATS dashboard URL), only extractable via `openpyxl`'s `hyperlink.target`, not the cell's
  display value. Reused the existing `outcome_email_link` column for it (semantically the same thing
  §2.2.C already means) rather than adding a new one. `Email address` is genuinely new — new nullable
  `applications.contact_email` column. Sourced with the same Comment/Action priority as the date audit;
  30 of 91 archived leads have at least one of the two fields, the rest never had it recorded in
  SharePoint at all.
- **Archive UI redesign (not in §2.2.F's original spec).** Reggie asked for column headers fixed once at
  the top instead of repeating per row, plus the two new columns. `components/roleproof/archive-list.tsx`
  now renders a shared CSS grid template for both a sticky header and every row, and "Email response"
  needed to become a real, independently-clickable link rather than inert text (the original design's own
  reasoning for inert text — "the whole row is already a Link, nested anchors don't work" — still holds,
  so the fix is a stretched-card layering: the row's own navigation is an absolutely-positioned layer
  *behind* everything (`z-0`), and "On file" is a normal `<a>` painted on top (`z-10`/`relative`). Clicks
  on the link open the email; clicks anywhere else on the row still navigate to the lead. No JS needed,
  still a server component.
- **Gap closed same day: on-demand Reply in the Archive.** The decline reply-assist pop-up (§2.2.E) only
  ever fired at the moment a decline email was *dropped*, live — none of these backfilled historical rows
  passed through that drop, so none of them got the reply-assist. Added `archive-reply-button.tsx` — a
  small client island inside the otherwise server-rendered `ArchiveList`, reusing `DeclinePopup` unchanged,
  opened by a click instead of a drop. Sits next to "On file" using the same stretched-card stacking
  (`archive-list.tsx`'s own layering comment). Available on every Archive row regardless of whether an
  email link was captured — the template only needs the company name, and "worth a short reply" doesn't
  stop being true just because the record came from reconciliation instead of a live drop.

### Open for Reggie

1. **Step 13, the live drag-and-drop test — the one genuinely open item.** Drag a real `.msg` out of
   Outlook Classic onto each of the three targets and confirm the file lands, the link resolves and the
   columns update:
   - **Board** (`/roleproof`) — a `ready` lead's row action now reads "Application sent" as a dashed
     drop target. Drop a confirmation from **Bewerbungen**. Expect: row moves to Applied, and the lead
     appears in Applications as *Response pending* with a working "Confirmation ↗" link.
   - **Applications** (`/roleproof/applications`) — drop an invite from Bewerbungen on that row
     ("Interview invited"), then a decline from **Absagen** ("Declined"). Expect: the invite populates
     the invite link and reveals the interview date/time picker; the decline moves the row into the
     Archive *and* opens the reply pop-up.
   - Also worth one click each without dropping anything: the manual fallbacks (two-step confirm on the
     board; the today-prefilled form on the other two).
   If Outlook hands over something other than a file, the classifier already falls back to a text link
   and then to the manual form — so the failure mode to watch for is a *silent* one (nothing happens at
   all), not an error.
2. **Part 1's Queue / Ready-to-score surfaces still haven't been browser-tested** — its own §4 left this
   open, and the same login constraint applied here, so it's still open. Both CIs' UI now wants one
   click-through pass together, which was the stated reason for building both before testing either.
3. ~~Nothing was backfilled.~~ **Superseded** — see "Reconciliation & backfill" above. 5 leads landed in
   Applications, 91 in Archive, verified against the SharePoint source of truth. Applications sent before
   this shipped that Reggie hasn't yet brought over still sit at `applications.status = 'applied'` (or
   `downloaded`) and won't appear in either list until a future round does the same verified reconciliation
   — by design, not an oversight.
