---
ci-area: Monitoring / D-Phase
ci-roadmap:
ci-title: Archive Decline Capture — Real Email Date and Sender, Not the Drop Date
ci-status: 3 - Delivered
ci-priority: high
ci-date: 2026-08-10
ci-estimated-time:
ci-time-spent: 2.25
pr-source: "[[Scoring Phase Redesign - Part 2]]"
pr-target: claude/database-extraction-formatting-aeb92d
---

---
```simple-time-tracker
{"entries":[{"name":"Retrace: what Part 2 + its Round 3 addendum required vs. what the Archive actually shipped, for the outstanding-applications Excel export","startTime":"2026-08-10T22:00:00.000Z","endTime":"2026-08-10T22:35:00.000Z"},{"name":"Forensic dig on Round 3's Email Response data — decoded the Outlook deep-link IDs byte-for-byte, confirmed against the raw SharePoint workbook, found the UNIQA/Agrana cross-contamination and the near-duplicate-ID source defect","startTime":"2026-08-10T22:35:00.000Z","endTime":"2026-08-10T23:15:00.000Z"},{"name":"Reggie reconciled 14 real declines live in-app during this window; reported Process Closed and Email address were still not populating from the drop — retraced §2.0's deferred scope, confirmed against the write path","startTime":"2026-08-10T23:15:00.000Z","endTime":"2026-08-10T23:30:00.000Z"},{"name":"lib/email-parse.ts — .msg via @kenjiuno/msgreader, .eml via manual header read; verified messageDeliveryTime vs. clientSubmitTime vs. creationTime against a real stored file before trusting the field choice","startTime":"2026-08-10T23:30:00.000Z","endTime":"2026-08-10T23:50:00.000Z"},{"name":"Wire extraction through the write path — storeEmailArtifact, both server actions, use-email-drop's DropResult, EmailDropZone, applications-list.tsx's decline/interview handlers, contactEmail on decline()/interviewScheduled()","startTime":"2026-08-10T23:50:00.000Z","endTime":"2026-08-11T00:20:00.000Z"},{"name":"DeclinePopup + ArchiveReplyButton — pre-fill the mailto: recipient now that the sender address is actually available (closed the gap that component's own comment had flagged)","startTime":"2026-08-11T00:20:00.000Z","endTime":"2026-08-11T00:30:00.000Z"},{"name":"Test coverage: 4 new checks in verify-monitoring.ts (malformed .msg fails silently, .eml extraction, end-to-end date/address on a real decline) — 49/49 pass; full vitest suite (209 tests) green","startTime":"2026-08-11T00:30:00.000Z","endTime":"2026-08-11T00:50:00.000Z"},{"name":"scripts/backfill-decline-email-metadata.ts — dry run, reviewed all 14 corrections, applied, verified live in the browser against /roleproof/archive","startTime":"2026-08-11T00:50:00.000Z","endTime":"2026-08-11T01:10:00.000Z"}]}
```
---

## 1. What is the problem or opportunity?

`Scoring Phase Redesign — Part 2` (§2.0, "explicitly out of scope") deliberately deferred one thing: auto-extracting the subject/date out of a dropped `.msg`/`.eml`, calling it a "phase 2 enhancement" and shipping a today-prefilled manual form instead. That was the right call for v1 — nobody had felt the gap yet.

Tonight, Reggie felt it. He reconciled 14 real declines by dragging them onto the Applications list's Decline target, live. Every one of them landed with `outcomeAt` = today (the day he dropped it) and `contact_email` = null — not the date the employer actually sent the decline, and not the HR contact address sitting right there in the email he'd just dragged. The CI's own §2.0 language ("the manual form... covers this for v1") reads very differently once "phase 2" is the thing standing between a user and correct data he's looking at on his own screen.

Separately, retracing Part 2's Round 3 addendum (the SharePoint-backfilled "Email address"/"Email response" columns) for an unrelated Excel export surfaced a second, older defect: roughly 27 of the 30 backfilled "Email response" links decode to near-identical Outlook item IDs — 112 of 113 bytes identical across completely unrelated companies — meaning the SharePoint source data itself is corrupted (confirmed byte-for-byte against the raw workbook, not something RoleProof's own extraction introduced), and one row (UNIQA, seq 124) was assigned Agrana's contact email via what looks like a bad Folder-ID join. That defect is **not** fixed by this CI — see §5 below — this CI's scope is the live drop path only.

## 2. What would the improvement look like?

### 2.0 Scope

**In scope:**
- Extract the dropped email's own sent/received date and sender address at drop time, for both the Decline and Interview-invite targets (symmetric treatment — confirmed with Reggie, not assumed).
- Write those into `applications.outcome_at` ("Process Closed") and `applications.contact_email` ("Email address") instead of the existing `new Date()` / `null` defaults.
- Pre-fill the decline reply-assist's `mailto:` recipient now that the address is available — `decline-popup.tsx`'s own comment already named this as blocked on exactly this gap.
- Backfill the 14 rows Reggie had already reconciled tonight, by re-reading the `.msg` files already sitting in storage — no re-drop required.

**Explicitly out of scope:**
- The Round 3 SharePoint-backfill corruption described in §1 (corrupted Outlook deep-link IDs, the UNIQA/Agrana mix-up). Different data path, different remediation, flagged for a separate pass.
- Anything on the "Application sent" / confirmation drop target — Reggie confirmed this pass is Decline + Interview only.
- Re-deriving `applied_at` from anything — that field is untouched; only `outcome_at`/`contact_email` are in play here.

### 2.1 Current state (confirmed against the repo, 2026-08-10)

- `lib/monitoring.ts`'s `storeEmailArtifact` wrote the file and returned a bare `string` link — nothing about the file's own content was ever read.
- `decline()`/`interviewScheduled()` defaulted `outcomeAt` to `new Date()` whenever the caller didn't supply one, which the drop path never did (only the manual-fallback form ever passed a date, and only the date the user typed, not anything from an email).
- `applications.contact_email` — per its own schema comment — was "Archive-only for now... nothing in the live drag-and-drop capture flow writes it yet." Confirmed true: no call site anywhere passed a `contactEmail` argument into either write function.
- `decline-popup.tsx`'s `mailto:` had no recipient, with a code comment stating outright that a recipient would require parsing the dropped `.msg`, "which is explicitly out of scope."
- No `.msg`/`.eml` parsing dependency existed anywhere in the repo.

### 2.2 Target state

**A. `lib/email-parse.ts` (new)** — `parseEmailArtifact(buf, filename): { date: Date | null; senderEmail: string | null }`.
- `.msg` via `@kenjiuno/msgreader` (new dependency). Date preference: `messageDeliveryTime` (received) over `clientSubmitTime` (sent) over nothing — **never** `messageDeliveryTime`'s sibling `creationTime`, which is when the file was saved into RoleProof's own storage, not anything about the email. Verified this distinction against a real stored file before trusting it: one decline's `creationTime` read today's date, while `messageDeliveryTime` read the email's real date nine months earlier.
- Sender preference: `senderSmtpAddress` (always real SMTP when Exchange attaches it) over `senderEmail` (rejected unless it matches an email-shaped regex, since `senderEmail` can instead be an `/O=EXCHANGELABS/...` X.500 DN when `senderAddressType === 'EX'`).
- `.eml` via a small manual RFC822 header read (`Date:`/`From:` lines) — not a second dependency, since it's already plain text.
- Never throws; a parse failure or unrecognised extension yields `{ date: null, senderEmail: null }`, same as today's manual-fallback shape.

**B. Write path.** `storeEmailArtifact` now returns `{ link, emailDate, senderEmail }`. `decline()`/`interviewScheduled()` gain an optional `contactEmail` param, written the same conditional-overwrite way `outcomeEmailLink` already is. `uploadEmailArtifactAction` returns the same shape (dates as ISO strings — Dates don't reliably cross the server-action boundary, same reasoning `applications-list.tsx` already documents for its own props).

**C. Client plumbing.** `DropResult`'s `'captured'` variant carries `emailDate`/`senderEmail` alongside `link` (null for a dragged link — there's no file to parse). `EmailDropZone.onCaptured` and `applications-list.tsx`'s `recordDecline`/`recordInterview` thread them through to the server actions.

**D. Reply-assist.** `DeclinePopup` takes an optional `senderEmail` prop, used as the `mailto:` recipient. `ArchiveReplyButton` (the Archive's click-triggered reuse of the same popup) gets it from `row.contactEmail`.

**E. Backfill.** `scripts/backfill-decline-email-metadata.ts` — re-reads every `applications` row whose `outcome_email_link` points at this app's own `/api/applications/{leadId}/email/{file}` route (i.e. a genuinely stored file, never a SharePoint-reconciliation deep link or an ATS dashboard URL — those have nothing to re-parse and are left alone), re-parses the stored file, and corrects `outcome_at`/`contact_email` from it. Dry-run by default; idempotent — a row already correct is reported unchanged, not rewritten.

### 2.3 Ordered implementation checklist

1. Install `@kenjiuno/msgreader`; write `lib/email-parse.ts`; verify field choice against a real stored `.msg` before writing any tests against it.
2. `lib/monitoring.ts` — `storeEmailArtifact` parses and returns the extra fields; `decline()`/`interviewScheduled()` accept `contactEmail`.
3. `app/actions/monitoring.ts` — `uploadEmailArtifactAction` returns the extended shape; `logDeclineAction`/`logInterviewScheduledAction` accept `contactEmail`.
4. `use-email-drop.ts` + `email-drop-zone.tsx` — extend `DropResult`/`onCaptured` to carry the new fields through.
5. `applications-list.tsx` — both `EmailDropZone` call sites (decline, interview) pass the parsed date/sender into `recordDecline`/`recordInterview`.
6. `decline-popup.tsx` + `archive-reply-button.tsx` — thread `senderEmail`/`contactEmail` into the `mailto:` recipient.
7. `scripts/verify-monitoring.ts` — add extraction unit checks (malformed `.msg`, real `.eml`) plus an end-to-end decline-with-a-real-file check; run the full harness against the live DB.
8. `npx vitest run` — full suite, not just the new coverage.
9. `scripts/backfill-decline-email-metadata.ts` — dry run, review every proposed correction by eye, `--apply`, confirm live in the browser.

### 2.4 Acceptance criteria

- Dropping a real `.msg` decline sets `outcome_at` to the email's own delivery date and `contact_email` to its sender's address — not today's date and not null.
- The same is true for an interview-invite drop.
- A dragged text link, or the manual no-email fallback, behaves exactly as before (both fields stay whatever the caller explicitly provides, defaulting to today/null) — this CI adds extraction, it doesn't change the fallback contract.
- A malformed or unparseable file degrades to the pre-existing default silently — never a thrown error that breaks the drop.
- The decline reply-assist's "Open in email" pre-fills the recipient when a sender address is available, from either a live drop or a backfilled Archive row.
- The 14 already-reconciled rows read correctly in the live Archive UI, not just in the DB.
- `tsc --noEmit` clean; full `vitest` suite green; `verify-monitoring.ts` green against the live DB.

## 3. Resources or references

- Parent CI, the source of the deferred scope this closes: `[[Scoring Phase Redesign - Part 2]]`, §2.0 ("Auto-extracting subject/date from a dropped `.msg`/`.eml`... parsing is a phase-2 enhancement") and its Round 3 addendum (the separate, unfixed Email-response defect noted in §1/§5 here).
- Code: `lib/email-parse.ts` (new), `lib/monitoring.ts`, `app/actions/monitoring.ts`, `components/roleproof/use-email-drop.ts`, `components/roleproof/email-drop-zone.tsx`, `components/roleproof/applications-list.tsx`, `components/roleproof/decline-popup.tsx`, `components/roleproof/archive-reply-button.tsx`, `scripts/verify-monitoring.ts`, `scripts/backfill-decline-email-metadata.ts` (new).
- Library: [`@kenjiuno/msgreader`](https://www.npmjs.com/package/@kenjiuno/msgreader) — exposes `messageDeliveryTime`/`clientSubmitTime`/`senderSmtpAddress`/`senderEmail` off Outlook's own MAPI property set (MS-OXPROPS).

## 4. Notes / Progress log

- 2026-08-10/11: Built and verified in one session, immediately after Reggie's own live reconciliation pass made the gap concrete rather than theoretical. `messageDeliveryTime` vs. `creationTime` was the one real trap in the parsing library — confirmed against a real file before trusting it, since the two look superficially similar (both are timestamps on the same object) but mean completely different things (when the email arrived vs. when RoleProof's own upload happened).
- Backfill result: 14/14 rows corrected, reviewed by eye before `--apply`, confirmed live in `/roleproof/archive`. One pre-existing data mix-up surfaced during review (NEVEON's stored file is actually ENPULSION's decline — same sender, same date, on two different leads) — a live drag-and-drop mistake made during tonight's reconciliation, not a bug in this CI's code; flagged to Reggie to re-drop NEVEON's real decline if still available.
- `ci-time-spent` above is reconstructed from session activity and file-write timestamps (no external time tracker was running) — treat as a good-faith estimate, not a precise log.

## 5. Open — not fixed by this CI

The Round 3 SharePoint-backfill corruption from §1 is still live in the data:
- ~27 of 30 backfilled "Email response" links are near-duplicate, almost certainly non-functional Outlook deep-link IDs, corrupted at the SharePoint source (confirmed byte-for-byte against the raw workbook — not this app's extraction).
- `scripts/data/archive-email-backfill.json` still holds `agrana@myworkday.com` against UNIQA (seq 124), a wrong-row join — UNIQA's own SharePoint row has no email data and a `#N/A` Folder-ID lookup, so there's no legitimate source for that value. It hasn't reached the live DB yet only because that row's `applications` record didn't exist when the backfill script last ran (`--apply` skips rows with no existing row to update) — it's a live landmine, not a dormant one.

Both are a different data path (SharePoint reconciliation, not the live drop mechanic) and a different fix (data correction / re-extraction, not code). Tracked here so the next pass doesn't have to rediscover it.
