# Backtest — Process note repoint

Baseline = notes as on `main`; candidate = notes in the working tree. Read-only: no lead's
score, requirements, evidence links or tailoring rows were written.


## B6

| Measure | baseline | candidate |
| --- | --- | --- |
| runs | 9 | 9 |
| **hard failures** | 0 | 0 |
| bad stop_reason | 0 | 0 |
| **collapsed runs** (coverage < 50%) | 1 | 1 |
| **runs with a template leak** | 1 | 1 |
| fabricated citations (total) | 0 | 1 |
| coverage | 89.6 | 90.2 |
| judged | 13.9 | 14 |
| onFile | 15.7 | 15.7 |
| withEvidence | 13.6 | 13.8 |
| refs | 43.2 | 41.8 |
| fabricated | 0 | 0.1 |
| keyStrengths | 87.6 | 99.3 |
| gaps | 88.9 | 99.3 |
| noMatchWithReason | 0/0, 1/1 | 0/0, 1/1 |
| overall | 7 | 7 |
| recommendation | Proceed, Borderline | Borderline, Proceed |
| mean total input tok | 10288 | 10288 |
| mean output tok | 3572 | 3414 |

> Note: 1 fabricated citation(s) vs 0 on baseline — within the tolerance of 1,
> and dropped by `resolveEvidenceLinks` before any write. Worth a look if it recurs.

> **Baseline is not clean here**: 1 collapsed run(s) and 1 template leak(s) on the
> UNEDITED notes. That is a pre-existing defect in this step, not something this change caused,
> and it is why every condition above is relative rather than absolute.

---

## ✅ Gate: PASS

No hard failure, collapse, coverage loss, fabricated citation or template leak **beyond what
the unedited notes already produce**. Score drift, where present, is reported above and is
deliberately not a gate condition — this CI repoints references, it does not re-specify judgment.