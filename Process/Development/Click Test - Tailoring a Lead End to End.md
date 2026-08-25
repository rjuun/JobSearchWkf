---
pr-title: Click Test — Tailoring a Lead End to End
pr-area: CV Tailoring (C-Phase)
pr-status: Valid
pr-date: 2026-08-25
ci-source: "[[C3 Selects the CV Evidence Set]]"
---

## Purpose

The live verification that closes CI-048 / CI-050 / CI-051 / CI-052 — the four notes of the C-phase
epic — and the routine for checking any newly tailored lead afterwards.

Everything machine-checkable is already automated (`scripts/verify-lead-run.ts`). **What this document
covers is the part no script can do: a person driving the app.** All four notes sit at `2 - Testing`
for exactly that reason, and they move to `3 - Delivered` together once this is done.

> [!IMPORTANT] Use a NEW lead, and expect one pass only
> Once a lead has a `tailored.docx`, the workspace hides the **Generate** button — by design, since a
> CV is produced once and produced properly. So this runs on a freshly captured lead, and you get one
> attempt at each step. Do not plan to re-generate.

---

> [!NOTE] How to use this document
> Keep it open beside RoleProof and work down the tables while you drive the app normally. Words in
> **bold** in the "Do" column are the labels on buttons **in the app**, not links here — nothing in
> this document is clickable. The "Watch for" column is the real content: it is what a person can
> catch and a script cannot.

## A. Before you start

1. **Restart the dev server.** `Process/*.md` notes are the live prompts and are cached per process.
   Anything edited since the server started is not in effect until it restarts.
2. Have a real job posting ready — one genuinely in your target space, not a synthetic test.

---

## B. Capture and screen

| # | Do | Expect | Watch for |
| --- | --- | --- | --- |
| 1 | Capture the lead from its URL | The role text lands, company and city populated | Freshness and "still accepting" chips read sensibly |
| 2 | **Extract must-haves** | Requirements listed with Core / Important / Nice-to-Have ranks | A long posting yielding only 2–3 requirements is a misfire — re-run before continuing |
| 3 | **Re-run screening** if the fit score looks wrong | Fit score with a breakdown behind **See the breakdown** | Roadblocks and misalignments are named, not generic |

---

## C. Map the evidence

| # | Do | Expect | Watch for |
| --- | --- | --- | --- |
| 4 | **Match the evidence** | Each requirement gets one or more evidence rows, each `pending` | Every row cites a real ref code and shows a connection sentence |
| 5 | Review each row and Keep / decline | Your judgement, on **truthfulness only** | Do not weigh whether it will print — that is C3's job now |
| 6 | **Approve map** when done | Rows go green | Anything left `pending` is deleted by the next C2 run, silently |

**Judge on truth, not space.** The Keep gate stopped being about CV length the moment C3 started
budgeting. Approving more good evidence costs nothing; selection decides what fits.

---

## D. Tailor — the part that has never had a human pass

| # | Do | Expect | Watch for |
| --- | --- | --- | --- |
| 7 | **Generate** | Progress runs through: reading your career graph → matching each must-have → rewriting evidence into CV bullets → assembling the skills section → writing your tailored profile → assembling your CV → rating the ATS match | Each stage completes; no stage silently skipped |
| 8 | Open the selection view and look at **Pin to CV** / **Take off** | Selected bullets shown with their rank; unselected evidence still visible | **These controls have never been used by a person.** Pin something unselected, take off something selected, and confirm the counts move |
| 9 | Download the CV | Two pages | Skills section reads as a senior CV, not an inventory |

---

## E. Verify

```bash
npx tsx scripts/verify-lead-run.ts <leadId>
```

Prints PASS / FAIL / INFO for every criterion the four CIs set: bullet budget, Core and Important
coverage, category count and size, no language or qualification as a skill, no near-duplicate
surviving into the document, and the ATS rating. It reads the rendered `.docx`, so it is checking the
document you would send, not the intermediate tags.

**Then read the CV yourself.** Two things the checker cannot judge:

- **Register.** Do the Skills entries read the way you would write them — compound, stating the level,
  anchored where it adds precision? That is CI-051's whole subject and no test can score it.
- **Truthfulness.** Does every bullet say something you actually did, at the scale stated?

---

## F. Recording the result

If it passes: move CI-048, CI-050, CI-051 and CI-052 to `3 - Delivered` together, and add a dated §4
entry to each naming this lead and the date. They close as one epic because they were tested as one.

If something fails, log it in whichever note owns the criterion and leave that note at `2 - Testing`.
A partial pass is not a pass — see the CI Procedure on `2 - Testing` vs `3 - Delivered`.

### Known open items at the time of writing (2026-08-25)

- **Julius Baer `ee5c72bf` prints 6 categories**, the sixth being `Additional Skills (1)` — one skill
  the grouping call failed to place. Against C5 §B.1's ceiling of five. ALDI and Aliaxis both pass.
- **Skills counts are 21 / 28 / 26** against a 16–20 benchmark. Aliaxis genuinely holds 26 distinct
  capabilities, so closing that gap further means merging non-duplicates or shedding real ones.
- **Nice-to-Have coverage is structurally zero** — C2 never sees those requirements. That is
  [[C2 Never Sees Nice-to-Have Requirements]], not a failure of this run.
