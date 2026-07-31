---
ci-title: Migrating Power Automate Intelligence from Old Sharepoint
ci-area: Monitoring / D-Phase
ci-status: 0 - Idea
ci-priority: medium
ci-date: 2026-06-24
ci-estimated-time:
ci-time-spent: 2.5
pr-source: "[[D1. Monitoring Applications]]"
pr-target:
---

---
```simple-time-tracker
{"entries":[{"name":"Draft","startTime":"2026-06-24T08:03:55.000Z","endTime":"2026-06-24T08:17:50.972Z"},{"name":"Development","startTime":"2026-06-24T08:17:59.335Z","endTime":"2026-06-24T10:32:29.635Z"}]}
```

---
## 1. What is the problem or opportunity? *(rewritten 2026-07-31 — original ask below in §4 is preserved, not deleted)*

At capture time, the original ask (§4) is now moot: leads used to arrive via a bookmarklet → Power Automate →
SharePoint pipeline, and this CI's job was to route that intelligence to Claude instead of hand-rolled
SharePoint formulas. Capture today goes straight through the app (posting a URL in Claude chat), so there's
no SharePoint hop left to migrate on the way in.

At the decline-response end, the gap this CI was always circling is still real and still unbuilt. Today:
Reggie moves decline emails into an Outlook **Absagen** folder; a Power Automate flow (`JH 01 - Update Job
Leads with Decline Email`, linked in §3) watches that folder, asks him to pick the matching job lead, and
writes the email's deep link into SharePoint's **Email response** column. That column only reaches the app
through a manual, after-the-fact reconciliation pass — `scripts/reconcile-sharepoint.ts` plus the
label-fixing and hyperlink-extraction scripts logged in `[[Scoring Phase Redesign - Part 2]]`'s
"Reconciliation & backfill" section — not a live sync. Every new decline still has to wait for a future
reconciliation round before it shows up as a working "On file" link in the Archive.

Part 2 already built the in-app side of exactly this: `applications.outcome_email_link`, set by
`logDeclineAction` (`app/actions/monitoring.ts`), rendered as a real link in
`components/roleproof/archive-list.tsx`. The live gap is purely on the write path: Power Automate writes to
SharePoint, never to the app, so every decline still needs a human reconciliation pass instead of showing up
automatically.

## 2. What would the improvement look like?

**Live scope:** have the `JH 01` flow write the decline email's link straight into the app instead of (or in
addition to) SharePoint — calling a new authenticated endpoint that resolves to the same write
`logDeclineAction` already performs, rather than depending on a future reconciliation script to notice the
SharePoint row. Not yet designed: what that endpoint looks like (a new API route Power Automate can `POST`
to, auth model, whether it uploads the email file itself the way the in-app drag-and-drop does in Part 2, or
just the deep link/text). This is genuinely `0 - Idea` again — none of the 2.5h already logged against this
CI covers this version of the ask.

**Parked, not in scope right now:** whether the bookmarklet capture flow could hit the app/Claude directly
without Power Automate as a middle hop. Reggie still prefers the bookmarklet's ergonomics over pasting a URL
into chat, but hasn't confirmed there's a cleaner integration path than what exists today, and it doesn't
block the decline-email work above. Worth its own look (possibly its own CI) rather than folding into this
one.

## 3. Resources or references

- [Edit your flow | Power Automate — JH 01 flow](https://make.powerautomate.com/environments/Default-cfa77709-86a8-41a7-86b6-d487977d02b0/flows/73de7286-f147-43fe-b57a-91bbabbd7c6e?v3=false)
- [JH 01 - Update Job Leads with Decline Email](https://make.powerautomate.com/environments/Default-cfa77709-86a8-41a7-86b6-d487977d02b0/flows/03f4c8a3-99a8-40b9-a93d-2f3ab03ace40?v3=false) — the flow this CI would eventually redirect.
- `[[Scoring Phase Redesign - Part 2]]` — built the in-app write path (`logDeclineAction`,
  `outcome_email_link`, the Archive's "On file" link) and the reconciliation scripts this CI's live gap is
  the alternative to.

## 4. Notes / Progress log

- **2026-06-24 (original scope).** Replace the tables from `Job Application Dashboard.xlsx`, feeding them
  from the Job Leads SharePoint List instead of the old Applications Library, plus new stats (pre-application
  screenings, roadblocked/misaligned, applied). Finished adjusting the `JH 01` flow so it handles negative
  responses; next steps noted as transferring history from Applications to Job Leads and recreating the
  tables. Left an unfinished `>Abandoned` marker in the body with no explanation — superseded by the app
  existing at all, not by anything decided at the time.
- **2026-07-31 — rescoped, not abandoned or superseded.** The capture/SharePoint-tables half of the original
  ask is moot (app replaced the tables outright). The decline-email half is still open and still exactly
  what Reggie wants, just redefined as a direct Power-Automate-to-app write instead of a
  Power-Automate-to-SharePoint write. `ci-status` reset to `0 - Idea` and `ci-estimated-time` cleared per
  `++ Continuous Improvement Procedure.md`'s rescoping rule — the 2.5h already spent was against the old
  scope and doesn't estimate this one. `ci-time-spent` kept as a historical fact, not zeroed.

