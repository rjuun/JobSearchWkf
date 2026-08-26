---
ci-area: CV Tailoring (Evidence Selection)
ci-roadmap:
ci-title: Select 14 Evidence Bullets by Residual Coverage
ci-status: 0 - Idea
ci-priority: high
ci-date: 2026-08-26
ci-estimated-time: 8
ci-time-spent: 0
pr-source: "[[C2 matches career bullets to JD requirements]]"
pr-target: "[[C3. Write CV bullets]], [[C4. Skills section]], [[C7. ATS / whole-score]]"
---

---
```simple-time-tracker
{"entries":[]}
```
---

> [!IMPORTANT] Handover note — written to be picked up in a fresh chat with no prior context
> Read §1–§3 before touching code. The failure mode is treating **Lead Rank** or the map's
> **Assessment badges** as inputs. Rank is an output of add-order. Assessment is a verdict on a
> *set*. The picker must score the **set of at most 14 printed bullets**, not the retrieved pile
> and not list position.
>
> This note also records three defects already caught in this epic. Do not reintroduce them:
> 1. `dropped.slice(0, 10)` is not “all persisted.” Held-back cards past the tenth go blank.
> 2. Rank order is not gain order while swap **appends**. Allianz: 0.3-gain at rank 13 under six zeros.
> 3. Assessment badges on the map are computed against **all retrieved evidence**. They must not
>    enter the keep-rule. They must be recomputed on the final 14 and *honored* as a post-check.

---

## 1. What is the problem?

A lead arrives. The app extracts JD requirements, ranked by the owner as **Core / Important / Nice-to-have**. It retrieves career-history bullets that C2 treats as evidence for those requirements. A CV has two pages. At most **14 bullets** may print.

Today the map shows a many-to-many wiring: one bullet can serve several requirements; one requirement can have several candidate bullets. Selection is the unsolved half.

What selection is *not*:

- sorting bullets by a standalone quality score and cutting at 14
- treating current list position as value
- treating “Excellent / Very Strong / Good / Block” on the map as a reason to keep or skip a row

Those badges answer: “if we kept every matching bullet we found, how proven is this requirement?” They do not answer: “if we keep *these* 14, how proven is it?”

What selection is: **buy coverage of the JD with a budget of 14 cards**, then prove the printed page still earns the bands we claim.

## 2. Design point

Matching and choosing are different jobs.

| Step | Question | Vocabulary / input |
| --- | --- | --- |
| **C2** | Which of my bullets evidence this requirement, and how hard? | Pairwise match \(a_{b,r}\) — **unchanged** |
| **This CI** | Which ≤14 bullets print? | Residual coverage of the *chosen set* |
| **Assessment paint** | How proven is requirement \(r\) *on that set*? | Band function of coverage — **output** |
| **C7** | Does the page still rate? | Run *after* the 14 exist; do not steer v1 |

C2 may keep attributes and competences in the match. This CI does not invent new matches. It only chooses a subset.

`skills_master`, C3 register, and C4 consolidation are out of scope. They consume what this step emits.

## 3. The equation

### 3.1 Objects

- Requirements \(R\). Each \(r\) has a tier \(t_r \in \{\text{core},\text{important},\text{nice}\}\).
- Bullets \(B\) from career history (after the pre-filter in §4.1).
- Match matrix \(A\), with \(a_{b,r} \in [0,1]\) from C2. Zero if no link.
- Budget \(K = 14\).
- Frozen set \(F \subseteq B\): owner pins and cards already committed by an approval gate. \(F \subseteq S\) always. If \(|F| > K\), stop and surface it. Do not evict a pin.
- Chosen set \(S \subseteq B\), \(|S| \le K\).
- Held-back set \(H = B \setminus S\).

### 3.2 Weights — tier only

Assessment badges do **not** appear here.

\[
w(t) =
\begin{cases}
4 & t = \text{core} \\
2 & t = \text{important} \\
1 & t = \text{nice}
\end{cases}
\]

Tune on ALDI / Julius Baer / Aliaxis after the algorithm is correct. Do not retune to make Vestas pretty first.

### 3.3 Coverage of one requirement on a set

Saturating, so the second bullet on the same hole is worth less than the first:

\[
c_r(X) = 1 - \prod_{b \in X} (1 - a_{b,r})
\]

\(c_r(\emptyset) = 0\). One perfect hit \(\Rightarrow c_r = 1\). Two partial hits compound and flatten.

Fallback if product form is too opaque in tests: \(c_r(X) = \min(1, \sum_{b \in X} a_{b,r})\). Pick one and pin it with fixtures. Do not mix.

### 3.4 Whole-page score

\[
\mathrm{Score}(X) = \sum_{r \in R} w(t_r)\, c_r(X)
\]

This is the only objective in v1.

### 3.5 Residual gain — the keep quantity

Diagnostic only (map column, never the keep-rule):

\[
g_0(b) = \mathrm{Score}(\{b\})
\]

Decision quantity:

\[
g(b \mid S) = \mathrm{Score}(S \cup \{b\}) - \mathrm{Score}(S)
= \sum_{r \in R} w(t_r)\, a_{b,r}\,\bigl(1 - c_r(S)\bigr)
\]

Read: **match × remaining hole × how much the hole is worth.**

Saturation threshold \(\varepsilon\) (start at a small fraction of one Core hole, e.g. \(0.05 \times 4 = 0.2\); calibrate later):

if \(\max_{b \notin S} g(b \mid S) < \varepsilon\), stop even when \(|S| < K\).

Empty-looking tails are a finished CV, not a defect.

### 3.6 Assessment — output, then honor check

Let \(\mathrm{band}(\cdot)\) be the existing discretisation that today paints Block / Good / Very Strong / Excellent.

Today the map shows \(A(r \mid B_{\text{retrieved}})\). That is the **ceiling**: what is achievable if every matching card is kept.

The number that may be claimed on a generated CV is:

\[
A(r \mid S) = \mathrm{band}\bigl(c_r(S)\bigr)
\]

Always \(A(r \mid S) \le A(r \mid B_{\text{retrieved}})\).

**Do not put \(A(r \mid B_{\text{retrieved}})\) into \(\mathrm{Score}\), into \(w\), or into “this row is already done.”** Using the full-pile badge as an input treats coverage you have not selected as spent. The picker will skip Cores that only look Excellent because six extra cards exist in \(H\).

After \(S\) is chosen, honor:

| Tier | Floor \(A^\star(r)\) |
| --- | --- |
| Core | must not be Block if any \(a_{b,r} > 0\) exists in \(B\); must not fall more than **one band** below \(A(r \mid B_{\text{retrieved}})\) |
| Important | may drop one band; may not vanish to Block if a cheap card in \(H\) still covers it |
| Nice-to-have | no honor; first to yield |
| Already Block on the retrieved pile | stay Block; not a failure of the 14 |

Do **not** require every map-Excellent to remain Excellent. A row can be Excellent only because eight overlapping bullets exist. There are 14 slots for the whole JD. Honor is a repair *target*, not an infeasibility bomb.

## 4. Algorithm

### 4.1 Pre-filter (before the equation)

Remove from the competing pool, unless the card is in \(F\):

- languages
- degree / education rows that already live in the header
- table-stakes tooling (“MS Office”)
- JD filler with no evidence payload (“team player”, “work autonomously”) as a *bullet*

Leave Block requirements in \(R\) so the map can show the hole. They simply have no useful \(a_{b,r}\). Do not spend a slot on theatre that pretends to close them.

### 4.2 Phase A — greedy fill

```
S ← F
addOrder ← [frozen cards in stable owner order]
while |S| < K:
    score every b in B \ S as g(b | S)
    b* ← argmax g
    if g(b* | S) < ε: break
    S ← S ∪ {b*}
    append b* to addOrder
```

Ties: prefer the card that lifts the most *empty Cores*, then the more senior / later role. Pin the tie-break in a test. Do not leave it to object-key order.

### 4.3 Phase B — Core repair (swap)

Let \(R_{\text{hole}} = \{ r : t_r = \text{core},\ A(r \mid S) < A^\star(r) \}\).

For each hole, while a useful unused card exists:

- \(b^+\) = unused card with the largest lift of that hole (equivalently largest \(g(b \mid S)\) among cards with \(a_{b,r} > 0\))
- \(b^-\) = \(\arg\min_{b \in S \setminus F} g(b \mid S \setminus \{b\})\)  
  i.e. the unpinned kept card whose *removal* hurts \(\mathrm{Score}\) least
- accept

  \((S \setminus \{b^-\}) \cup \{b^+\}\)

  only when \(\mathrm{Score}\) rises **and** the hole shrinks

**After any accepted swap, rebuild add-order from scratch on the new \(S\)** (§4.4). Swap edits the set. It must not append a card onto the tail of rank. That is the Allianz defect.

### 4.4 Phase C — rebuild Lead Rank

Replay greedy *inside \(S\) only*:

```
S0 ← F ∩ S
for k = 1, 2, …:
    bk ← argmax_{b in S \ S_{k-1}} g(b | S_{k-1})
    Sk ← S_{k-1} ∪ {bk}
    rank(bk) ← k
    printedGain(bk) ← g(bk | S_{k-1})
```

Then:

- **Lead Rank** of a printed bullet is \(k\)
- the saturation curve is \(G(k) = \mathrm{Score}(S_k)\)
- the bar on the card is \(g(b_k \mid S_{k-1})\), not \(g_0(b)\)

Held-back cards keep \(g(b \mid S)\) against the *final* \(S\). That is the swap catalogue the owner reads on the map.

### 4.5 Narrative vetoes (not terms in Score)

Apply only as a filter on candidates or as a refused swap, and only after Phase A works in tests:

- do not take more than \(N\) bullets from one tour of duty if another senior role still has unused residual gain (start \(N = 6\))
- do not evict the last card that uniquely covers a Core
- do not evict the last Board-level card if any Core row is board-facing

Do not dump these into \(\mathrm{Score}\) on day one. You will not know why the 14 moved.

### 4.6 Gates that already committed

Selecting nothing, or selecting a replacement via C2, must not throw at a gate that has already committed an approval. Pins and approved evidence stay in \(F\). A “declined row” that cannot be declined through the UI is not a drop candidate.

## 5. Persistence — the load-bearing part

The step output must hold **everything the map needs**. That claim has already been false once.

Store, per lead, per run:

| Field | Required |
| --- | --- |
| \(S\) in add-order | yes |
| \(g(b_k \mid S_{k-1})\) per kept card | yes |
| \(H\) **in full** — no `slice(0, 10)`, no envelope that drops card 11+ | yes |
| \(g(b \mid S)\) per held-back card | yes |
| \(c_r(S)\) and \(A(r \mid S)\) per requirement | yes |
| \(A(r \mid B_{\text{retrieved}})\) as ceiling / ghost badge | yes, display only |
| freeze flags on \(F\) | yes |
| \(\mathrm{Score}(S)\), \(\varepsilon\), whether early-stop fired | yes, step report |

Julius Baer (and any lead with >10 held-back cards) is the fixture for the slice bug. If card 11 has no payload, the work is wrong.

## 6. What the map paints after this CI

Right column, per requirement:

- **live badge** = \(A(r \mid S)\)
- optional ghost = \(A(r \mid B_{\text{retrieved}})\) (“with all evidence”)
- tier chip unchanged (Core / Important / Nice-to-have)

Left column, per bullet:

- in \(S\): rank \(k\) and printed residual gain
- in \(H\): no rank in the 1..14 sense; show \(g(b \mid S)\) as “if swapped in”
- wiring lines still come from \(A\), unchanged

Do not draw a vertical “below this rank, nothing adds value” line on raw list position. After §4.4 the x-axis is monotonic and a cut is *legal* — still prefer stopping on \(\varepsilon\) and showing residual on the next unused card.

## 7. What this CI must not do

- Use map Assessment as an input weight or as “row already covered.”
- Keep by standalone \(g_0\) and cut at 14.
- Cut by current Lead Rank without rebuilding rank from \(g\).
- Let swap append.
- Persist only `dropped.slice(0, 10)`.
- Chase Block rows the stock cannot evidence.
- Spend bullets on degree / English / tooling that already live elsewhere.
- Change C3 voice, C4 consolidation, or C7’s formula in the same pass.
- Fail a run because honor is one band short — repair, then report. Honor is not a throw.

## 8. Acceptance

- [ ] A generated CV still contains ≤14 evidence bullets. Early-stop below 14 is allowed when residual \(< \varepsilon\).
- [ ] Every printed bullet has a stored residual gain against the prefix that preceded it. Rank 1..\(n\) is that prefix order after Phase C, not encounter order, not swap-append order.
- [ ] No Core that had evidence in \(B\) is Block on \(S\). Core bands do not drop more than one versus the retrieved-pile ceiling, or the step report lists the hole and the rejected swaps.
- [ ] Assessment badges on the map after generation match \(A(r \mid S)\), not the pre-selection pile. Ghost ceiling may sit beside them.
- [ ] Held-back set is complete. A lead with 14+ unused cards still hydrates card 11+. Fixture: Julius Baer-class tail.
- [ ] Pins and approved cards are still in \(S\). Replacing evidence through C2 does not throw on a committed gate.
- [ ] Duplicate-family bullets (four near-identical strategy sentences serving Core 1–4) do not all print if one hub closes the holes. The extras sit in \(H\) with near-zero residual.
- [ ] C7 on lead `69bc2e13` (ALDI, baseline 88/100 on 2026-08-24) does not regress. Run ALDI / Julius Baer / Aliaxis. Vestas is a reading check, not the calibration lead.
- [ ] `npm run typecheck` clean. New unit tests cover: residual flattening on overlap; greedy prefers a hub over two specialists that hit the same Core; swap re-ranks; honor repair; persist-all-\(H\); pin immunity; \(\varepsilon\) early-stop.

## 9. Suggested code seams

Inspect before inventing new files. Likely:

- the C2 match artefact that already holds per-bullet, per-requirement strength — that is \(A\)
- whatever today orders / drops / swaps the evidence cards and writes step output (the line that did `result.dropped.slice(0, 10)` is the persistence bug)
- the map’s Assessment painter — point it at \(c_r(S)\) after selection
- step report for the picker (mirror C3’s orphan / uncovered line: hole count, early-stop, swap count, \(|H|\))

Pure functions first: `coverage(X)`, `score(X)`, `residual(b, S)`, `greedyFill`, `repairCores`, `rebuildAddOrder`. The pipeline wrapper only reads C2, writes \(S\)/\(H\), and does not call a model for the 14. This feature should be **zero extra LLM spend**.

## 10. Implementation order

1. Pin \(c_r\), \(\mathrm{Score}\), \(g(\cdot \mid S)\) with fixtures (overlap flattens; empty Core is expensive; filled Core is cheap).
2. Greedy fill + \(\varepsilon\). Persist full \(H\).
3. Rebuild add-order. Paint rank and residual from that, not from the old list index.
4. Recompute Assessment on \(S\). Ghost the ceiling.
5. Core-repair swap + mandatory re-rank.
6. Honor report. Pins.
7. Live generate on ALDI / Julius Baer / Aliaxis. Read the map against §8. Do not tune \(w\) until the three leads are wrong in the *same* direction.

## 11. Notes for the implementer

The owner’s sketch (Gain vs Lead Rank, concave, flattening toward 14) is the *acceptance picture* of Phase C, not a description of current list order.

Per-card gain as the keep-rule is better than a horizontal cut on unsorted rank, and still weaker than residual \(g(b \mid S)\). Do not go back to the rank-axis cut. Do not stop at per-card.

“8 of 14” is not a constant. It is the count of cards added before \(g < \varepsilon\). ALDI and Julius Baer will differ. Do not copy a saturation count from one lead onto another.

When a correction lands, check whether the next proposal is the same mistake in different clothes: inherited claim, un-read line, badge treated as a property of a row rather than of a set.
