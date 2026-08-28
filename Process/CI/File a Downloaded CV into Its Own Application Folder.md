---
ci-area: CV Tailoring (download) / Profile setup
ci-roadmap:
ci-title: File a Downloaded CV into Its Own Application Folder
ci-status: 0 - Idea
ci-priority: medium
ci-date: 2026-08-28
ci-estimated-time: 5
ci-time-spent: 0
pr-source: "[[C7. Compile Complete CV Document]]"
pr-target:
---

---
```simple-time-tracker
{"entries":[]}
```
---

## 1. What is the problem or opportunity?

`GET /api/cv/[leadId]` (`app/api/cv/[leadId]/route.ts`) streams the rendered `.docx` with
`Content-Disposition: attachment`. From that point the browser decides where the file lands — the
Downloads folder — and the owner moves it by hand into the folder for that application.

The *naming* half of the filing convention already shipped. `cvFileName`
(`lib/docx/metadata.ts:248`) produces `CV - Reginaldo S Junior - <role> - <company>.docx`, and its
comment states the intent plainly: a recruiter should see whose CV it is, not eight characters of a
UUID. **What never shipped is the filing itself** — the folder that CV belongs in, and putting it
there.

That folder is not a new idea either. The SharePoint system this app replaced kept one folder per
application, and the reconciliation still joins on it:

> `Sharepoint - Job Leads Table  <-- Folder ID -->  Sharepoint - Applications Table`
> — `scripts/reconcile-sharepoint.ts:7`

So a lead going out today loses a structure the previous system had. The ask is to restore it, one
level better: **the app creates `<Applications>/[Position] - [Company] - [City]/` and saves the CV
there**, and a one-time setup on the Profile page says where `<Applications>` is.

### 1.1 · Why this needs a setup step at all

A web page has no idea where anything is on the disk it is being viewed from, and no right to guess.
Every other artefact this app writes goes through `lib/storage.ts`, which is *bucket-relative* by
design — `cv-output/<leadId>/tailored.docx` — precisely so it can be a folder locally and a Supabase
object in production. The owner's `Applications` folder is neither. It is a location on his own
machine, outside anything the app roots itself in, and the only two ways to reach it are the two in
§2.0. Both need him to name the place once. Hence the setup.

## 2. What would the improvement look like?

### 2.0 · The one decision that shapes everything else — DECIDED, 2026-08-28

**A browser cannot write to a folder of its own choosing, and a server can only write to the machine
it is running on.** RoleProof is currently both — the Next server runs on the owner's laptop at
`localhost:3000` — which is why this looks easy today and is the reason to be careful.

**Route A · the server writes it.** `fs.mkdir(..., { recursive: true })` + `fs.writeFile` to an
absolute path. The setting is a text field: the owner types `C:\Users\rjuun\...\Applications`.
Roughly an hour's work, no new browser API, unit-testable against a temp directory.

*It expires on deployment.* [[RoleProof as Stand-alone App (Migration to Supabase + NAS Postgres Setup)]]
moves this app to Vercel. The moment it does, the "server" is a container in someone else's data
centre, `lib/storage.ts` flips to the Supabase branch (it already has that branch — `useSupabase`,
line 13), and a Windows path in the database means nothing to anyone. The field stays on the page and
silently stops working. A second user could never have filled it in meaningfully in the first place.

**Route B · the browser writes it.** The File System Access API. The owner clicks *Choose folder*
once, `showDirectoryPicker()` returns a `FileSystemDirectoryHandle`, the handle is kept in IndexedDB,
and each download does `handle.getDirectoryHandle(folderName, { create: true })` then writes the file
into it. The setting is a **button, not a text field** — a handle cannot be typed, and that is the
whole reason it survives: the browser holds a capability the owner granted, not a string the server
hopes is true.

*Its costs are real and should not be discovered later.* Chromium only — Chrome, Edge, Opera; not
Firefox, not Safari. The owner's own browser in the attached screenshot is Edge, so this works for
him today, but it is a genuine narrowing for a product. It needs a secure context (`localhost`
qualifies, so local dev is fine). Permission must be re-confirmed with
`handle.requestPermission({ mode: 'readwrite' })` from inside a user gesture, roughly once per
session — a granted folder is not granted forever. And **there is no precedent for any of this in the
repo**: `grep` for `showDirectoryPicker` returns nothing.

**The owner chose Route B, 2026-08-28. Do not relitigate it.**

The reasoning, recorded because the cheaper option is the tempting one and will be proposed again:
Route A saves about four hours and they are the wrong four hours. It builds a setting whose expiry
date is already written into another open CI, and it is unusable by anyone not sitting at the machine
running the server — which is the definition of the thing [[How to Present it as a Product]] is
trying to stop being true. B costs more because it does the harder, correct thing: it asks the person
for a capability instead of assuming the filesystem.

**A "ship A now, replace with B later" hybrid was offered and declined**, on the same grounds — it
builds the feature twice and puts a control on the Profile page that is known in advance to stop
working.

Everything below assumes B: the card in §2.5 is a **button**, the stored setting is a **label** and
not a path (§2.6), and both download anchors become click handlers (§2.3).

### 2.1 · The folder name, against real data

`[Position] - [Company] - [City]`, as asked. Measured over the 157 historical leads in
`scripts/data/sharepoint-reconciliation.json` — the only lead corpus checkable without a live
database — a naive template string breaks on three counts.

**Twelve of 157 names contain a character Windows forbids in a path component.** Almost all of it is
the slash inside German gender markers:

```
Head/VP of FP&A - Lingoda - Berlin
Head (f/m/d) of Finance-Europe - Siemens Energy - Milan
(Senior) Project Manager:in Strategy & Transformation - UNIQA - Vienna
Process Improvement Senior Specialist (m/f/d) | FOUR PAWS | LinkedIn
Senior Expert Finance with focus on Quotation/Business Development - Magna … - Graz
Head of Strategy (all genders) - NEVEON … - Vienna / Kremsmünster
```

Passed to `mkdir` unchanged, `Head/VP of FP&A - Lingoda - Berlin` does not create a folder with a
slash in it — it creates a folder called `Head`, containing one called
`VP of FP&A - Lingoda - Berlin`. The `|` row fails outright. **Do not write a new sanitiser:**
`safeFilenamePart` (`lib/docx/metadata.ts:231`) already strips exactly `\ / : * ? " < > |` plus
control characters and collapses whitespace, and it is the function the sibling filename already goes
through. It is currently **module-private** (no `export` on line 231) — export it rather than
copying it, so the folder and the file inside it can never disagree about how a title was cleaned.

**Eleven of 157 carry no city.** `Head of Strategy - Vestas - ` is not an acceptable folder name.
`cvFileName` already solves this with `.filter(Boolean)` on line 250 — the missing part collapses and
the separators close up. Same treatment.

**The shape of `city` is not settled, and this note is deliberately not deciding it.** In this corpus
it is nearly always bare (`Copenhagen`, `Graz`), with 2 of 157 carrying a country (`Vienna,
Austria`). But `lib/pipeline/tailoring.ts:98` records a correction stating the column holds
`"London, United Kingdom"` — and that correction is trustworthy, because a bug lived behind it for
the entire history of the build. **Both shapes are real.** The corpus above is a 2026 reconciliation
snapshot, not the current table; the live capture path (`lib/pipeline/capture.ts:53`, which asks the
model for *"the primary work location's city"*) may well produce more of the long form. **Query the
live `job_leads.city` before choosing** whether the folder takes the whole string or only the part
before the first comma. This is a five-minute check and it is free.

**Confirmed with the owner, 2026-08-28: measure before deciding.** The two candidate rules were put
to him alongside this option and he took the query. So this is not an oversight to be tidied up by
picking the obvious-looking rule — it is a deliberate instruction to look first. Record what the
query returns in §4 with the rule it implies, so the next reader inherits the fact and not the
question.

### 2.2 · The path-length rule this forces

The longest real lead in the corpus produces a 109-character folder and a 133-character filename —
243 characters before the root is even prepended:

```
Senior Expert Finance with focus on Quotation/Business Development - Magna International (Magna Steyr) - Graz
CV - Reginaldo S Junior - Senior Expert Finance with focus on Quotation/Business Development - Magna International (Magna Steyr).docx
```

Under a root as short as `C:\Users\rjuun\Applications` (27) the full path is **271 characters**.
Windows' `MAX_PATH` is **260**. Under a realistic OneDrive-style root it is 312.

So this is not hypothetical: **the 150-character cap already in `cvFileName` is not enough the moment
a folder layer exists above it**, and its own comment says why it was set — *"these land in a
Downloads folder several levels deep"* — which is now one level deeper than it was written for.
Budget both parts against the chosen root and truncate the folder name too. Truncate the *title*
specifically; company and city are short and are what make the folder identifiable at a glance.

### 2.3 · Where the write is triggered

Two entry points, both currently plain anchors:

- `components/roleproof/workspace.tsx:1560` — the "Download" button in the *Your next move* bar
- `components/roleproof/workspace.tsx:2144` — "↓ Download .docx" in the CV panel

Under Route B both must become click handlers that `fetch()` the route and write the blob, because an
`<a href>` cannot hand a `Blob` to a directory handle. Under Route A they can stay as they are and the
server does the filing as a side effect of the request.

**Whichever route: `/api/cv/[leadId]` must still be hit.** That route opens the `applications` row
the whole D-phase Applications list hangs off (`status: 'downloaded'`, lines 21–36, guarded by
`env.nextReturns` and idempotent on the unique index). A "download" that writes a file from a cached
blob without touching the route would silently stop tracking that the lead went out. Do not rebuild
the file client-side to avoid the round trip.

### 2.4 · Failure must be visible, and must not eat the CV

Every one of these is reachable: permission was revoked since last session, the folder was moved or is
on a disconnected drive, the disk is full, the path exceeds `MAX_PATH`. The B2 tracking block in the
route sets the precedent for the *opposite* case and says so — *"tracking must never block the
download"*. Filing is not tracking. If the CV cannot be filed, **fall back to an ordinary browser
download and say so in the UI**. Silently doing nothing is the one outcome to design out: the owner
would believe a CV was filed that is not there.

### 2.5 · The setup card

A third card on `/profile`, directly under `<CaptureTokenControl />` — which is rendered from **both**
branches of `app/profile/page.tsx` (lines 67 and 129), so a new card must be added in both places or
it will vanish when the view toggles between *Assembled* and *Meter*.

Match `components/roleproof/capture-token-control.tsx` exactly: `rounded-card border border-hairline
bg-surface p-5 shadow-card`, a `text-[13px] font-semibold` title, a `max-w-[46ch]` explanation, and
the action button on the right. Copy for the title: **"Application folder"**.

**Placement is explicitly a stopgap, and should be recorded as one.** The owner's words: *"Since we do
not have yet an 'Account Preferences' UI, let's place it simply at the Profile Landing Page."* The
Career Graph page is the owner's *evidence*; a filesystem location is account configuration and does
not belong beside it permanently. It sits here because the two neighbours already there — Public proof
link and Capture token — are the same kind of orphan, which is itself the argument that Account
Preferences is a real, separate, small CI. **Open that note; do not silently absorb it here.**

### 2.6 · Where the setting is stored

`profiles` (`lib/db/schema.ts:118`) is the right table — `publicEnabled` / `publicToken` are the
precedent for per-owner app configuration that is not career evidence. One new nullable column,
migration through `drizzle/` as usual, and one server action beside `app/actions/capture-token.ts`.

**Under Route B, understand what that column can and cannot hold.** A `FileSystemDirectoryHandle` is
not serialisable to Postgres — it goes to IndexedDB, in that browser, on that machine. What the
database stores is a **label** (`handle.name`, e.g. `Applications`) so the card can render *"Saving
to: Applications"* on load. The capability lives in the browser; the database only remembers that the
owner set one up. That asymmetry is worth stating in the card's own copy, because the honest sentence
— *"this folder is remembered by this browser"* — is one the owner will otherwise discover by
switching machines.

### 2.7 · Implementation checklist

1. Query live `job_leads.city` for comma-bearing values; settle §2.1's third point and log the
   result. (§2.0 is already decided — Route B. Start here.)
2. `applicationFolder` helper — pure, taking `{ title, company, city }` and the root's length,
   returning the sanitised, length-budgeted folder name. Reuse `safeFilenamePart`.
3. Schema column + migration + server action for the setting.
4. The Profile card, added to **both** render branches of `app/profile/page.tsx`.
5. The write path, per §2.0, with §2.4's fallback.
6. Rewire the two download sites (§2.3), keeping the `/api/cv/[leadId]` round trip.
7. Tests on the pure helper: the twelve illegal-character names, the eleven missing cities, and the
   243-character case truncating to fit a given root. These are the parts a test can reach — the
   picker handshake cannot be unit-tested and needs a real click.

### 2.8 · Acceptance

- [ ] The owner sets the Applications folder once from `/profile`, and the card shows it afterwards on
      a fresh page load.
- [ ] Downloading a CV creates `[Position] - [Company] - [City]` under that folder if absent, reuses it
      if present, and writes the CV inside — filename unchanged from what `cvFileName` produces today.
- [ ] Downloading the same lead twice does not create a second folder, and does not create a duplicate
      `applications` row (the existing `onConflictDoNothing` still covers this — verify, don't assume).
- [ ] `Head/VP of FP&A - Lingoda - Berlin` produces **one** folder, not two nested ones.
- [ ] A lead with no city files as `[Position] - [Company]`, with no trailing separator.
- [ ] The Magna lead files successfully under the owner's real root — the measured 271-character case.
- [ ] With no folder configured, or with permission refused, the CV still downloads the way it does
      today and the UI says the filing did not happen.
- [ ] The card appears in both the Assembled and the Meter view of `/profile`.

## 3. Resources or references

- `app/api/cv/[leadId]/route.ts` — the download route; the `Content-Disposition` and the B2
  `applications` insert that must survive any rewiring.
- `lib/docx/metadata.ts` — `cvFileName` (248), `safeFilenamePart` (231), `filingName` (218). The
  naming half of this convention, already shipped.
- `components/roleproof/capture-token-control.tsx` — the card shape to copy.
- `app/profile/page.tsx` — two render branches (67, 129), both needing the card.
- `lib/storage.ts` — why the app's own artefacts are bucket-relative, and why this folder is not.
- MDN · File System Access API — `showDirectoryPicker`, `getDirectoryHandle`, `requestPermission`,
  and persisting a handle in IndexedDB. Nothing in this repo uses it yet.
- `scripts/reconcile-sharepoint.ts` — the folder-per-application convention this restores.
- `scripts/data/sharepoint-reconciliation.json` — the 157-lead corpus every number in §2.1–§2.2 is
  measured from.
- [[RoleProof as Stand-alone App (Migration to Supabase + NAS Postgres Setup)]] — the deployment that
  decides §2.0.
- [[How to Present it as a Product]] — the reason Route A's per-machine setting is a product problem
  and not only an engineering one.

## 4. Notes / Progress log

### 2026-08-28 · Opened

Raised by the owner alongside the Profile landing page: a downloaded CV should be filed, not dropped in
Downloads, and the app should be told once where the Applications folder is.

Specified rather than started, because §2.0 is a real fork and the wrong half of it is the cheap
half. **Both open questions were put to the owner the same day and both came back** — Route B for the
write path, and "measure first" for the city format. §2.0 and §2.1 now record decisions, not options,
so the note can be handed out as it stands.

**Everything numbered here was measured, not estimated** — the 157-lead reconciliation corpus was read
directly. Three findings the ask does not anticipate, and that a straightforward implementation would
ship broken:

- **12 of 157 folder names contain a character Windows forbids in a path component.** German gender
  markers put a `/` in the job title far more often than intuition suggests. Untreated, `mkdir` nests
  a folder instead of naming one.
- **11 of 157 have no city at all**, so the three-part name must collapse rather than trail a
  separator.
- **The longest real lead already exceeds `MAX_PATH`.** 271 characters under a short root; 312 under a
  OneDrive-style one. The existing 150-character filename cap was calibrated for a Downloads folder,
  and this adds a level beneath it.

The first two are already solved inside `lib/docx/metadata.ts` for the filename. Reusing that function
rather than writing a second sanitiser is what keeps the folder and the file it contains from ever
disagreeing about how a title was cleaned.

**Left open on purpose:** whether `job_leads.city` holds `Copenhagen` or `Copenhagen, Denmark` today.
The corpus says mostly the former; `lib/pipeline/tailoring.ts:98` records a correction saying the
latter, and that correction is credible because a real bug hid behind the assumption for the whole
history of the build. It is a one-query check against live data and belongs to whoever implements
this, not to a guess made here.

`ci-estimated-time: 5` is anchored on this repo's own precedents by shape rather than guessed: 3 for a
schema column, a server action and a Profile card — [[Real Bullet Evidence Provenance in the Career Graph]]
was 4 for comparable work — plus 2 for the File System Access handshake, which has no precedent in the
repo at all. Note that both UI-heavy CIs here overran badly (Career Graph Visualization 4 → 8.5,
Capture Improvement 1.5 → 10.5). **Treat 5 as a floor.**

### For whoever implements this

Two standing instructions from the orchestrator method, and they are not formalities:

1. **Report what this note got wrong.** Every session in this sequence has found at least one real
   error in the note it was handed, and none of them was caught by review — only by asking. Line
   numbers drift, and the §2.1 measurement is from a snapshot, not the live table.
2. **Show the owner the rendered card before wiring the write.** He reviews visually, and the
   requirements that matter arrive after he has seen a page. Budget for a second round.
