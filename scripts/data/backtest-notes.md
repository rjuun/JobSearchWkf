# Backtest — Process note repoint

Baseline = notes as on `main`; candidate = notes in the working tree. Read-only: no lead's
score, requirements, evidence links or tailoring rows were written.


## B2

| Measure | baseline | candidate |
| --- | --- | --- |
| runs | 6 | 6 |
| **hard failures** (model/schema) | 0 | 0 |
| transport errors (not gating) | 0 | 0 |
| bad stop_reason | 0 | 0 |
| **collapsed runs** (coverage < 50%) | 0 | 0 |
| **runs with a template leak** | 0 | 0 |
| fabricated citations (total) | 0 | 0 |
| count | 15.2 | 15.5 |
| onFile | 15.7 | 15.7 |
| withSourceText | 100 | 100 |
| withGroupRank | 100 | 100 |
| ranksSeen | Core/Important/Nice-to-Have | Core/Important/Nice-to-Have |
| mean total input tok | 5251 | 4863 |
| mean output tok | 2376 | 2420 |

## B3

| Measure | baseline | candidate |
| --- | --- | --- |
| runs | 6 | 6 |
| **hard failures** (model/schema) | 0 | 0 |
| transport errors (not gating) | 0 | 0 |
| bad stop_reason | 0 | 0 |
| **collapsed runs** (coverage < 50%) | 0 | 0 |
| **runs with a template leak** | 0 | 0 |
| fabricated citations (total) | 0 | 0 |
| flagged | 0 | 0 |
| mappedToReq | 0 | 0 |
| mean total input tok | 5356 | 5791 |
| mean output tok | 37 | 37 |

> ⚠️ Candidate input tokens ROSE (5356 → 5791). These notes get shorter — a rise
> means something was added rather than removed. Investigate; not an automatic block.

## B4

| Measure | baseline | candidate |
| --- | --- | --- |
| runs | 6 | 6 |
| **hard failures** (model/schema) | 0 | 0 |
| transport errors (not gating) | 0 | 0 |
| bad stop_reason | 0 | 0 |
| **collapsed runs** (coverage < 50%) | 0 | 0 |
| **runs with a template leak** | 0 | 0 |
| fabricated citations (total) | 0 | 0 |
| flagged | 1.7 | 1.7 |
| withSeverity | 0.7 | 0.7 |
| mean total input tok | 3768 | 4196 |
| mean output tok | 129 | 134 |

> ⚠️ Candidate input tokens ROSE (3768 → 4196). These notes get shorter — a rise
> means something was added rather than removed. Investigate; not an automatic block.

## B5

| Measure | baseline | candidate |
| --- | --- | --- |
| runs | 6 | 6 |
| **hard failures** (model/schema) | 0 | 0 |
| transport errors (not gating) | 0 | 0 |
| bad stop_reason | 0 | 0 |
| **collapsed runs** (coverage < 50%) | 0 | 0 |
| **runs with a template leak** | 0 | 0 |
| fabricated citations (total) | 0 | 0 |
| dimensions | 17 | 17 |
| expected | 17 | 17 |
| jdGroup | Transformation & Project Management, Controlling, FP&A & Finance | Transformation & Project Management, Controlling, FP&A & Finance |
| notesChars | 633.8 | 585.7 |
| mean total input tok | 7759 | 6953 |
| mean output tok | 575 | 597 |

## B6

| Measure | baseline | candidate |
| --- | --- | --- |
| runs | 21 | 21 |
| **hard failures** (model/schema) | 0 | 0 |
| transport errors (not gating) | 0 | 1 |
| bad stop_reason | 0 | 0 |
| **collapsed runs** (coverage < 50%) | 4 | 2 |
| **runs with a template leak** | 4 | 2 |
| fabricated citations (total) | 0 | 0 |
| coverage | 83.8 | 90.8 |
| judged | 12 | 13.8 |
| onFile | 15.4 | 15.5 |
| withEvidence | 11.6 | 13.3 |
| refs | 35.9 | 44.6 |
| fabricated | 0 | 0 |
| keyStrengths | 86.5 | 92.8 |
| gaps | 87.1 | 94.1 |
| noMatchWithReason | 0/0, 1/1, 2/2 | 0/0, 1/1, 4/4, 3/3 |
| overall | 7.1 | 7.1 |
| recommendation | Proceed, Borderline | Borderline, Proceed |
| mean total input tok | 10504 | 10260 |
| mean output tok | 3123 | 3599 |

> **Baseline is not clean here**: 4 collapsed run(s) and 4 template leak(s) on the
> UNEDITED notes. That is a pre-existing defect in this step, not something this change caused,
> and it is why every condition above is relative rather than absolute.

## C2

| Measure | baseline | candidate |
| --- | --- | --- |
| runs | 6 | 6 |
| **hard failures** (model/schema) | 0 | 0 |
| transport errors (not gating) | 0 | 0 |
| bad stop_reason | 0 | 0 |
| **collapsed runs** (coverage < 50%) | 2 | 1 |
| **runs with a template leak** | 0 | 0 |
| fabricated citations (total) | 1 | 0 |
| links | 8.7 | 10.7 |
| coreImportant | 14 | 14 |
| coverage | 63.5 | 79 |
| fabricated | 0.2 | 0 |
| withCvPosition | 91.7 | 100 |
| gaps | 1 | 1.2 |
| mean total input tok | 12953 | 13258 |
| mean output tok | 1100 | 1334 |

> ⚠️ Candidate input tokens ROSE (12953 → 13258). These notes get shorter — a rise
> means something was added rather than removed. Investigate; not an automatic block.

> **Baseline is not clean here**: 2 collapsed run(s) and 0 template leak(s) on the
> UNEDITED notes. That is a pre-existing defect in this step, not something this change caused,
> and it is why every condition above is relative rather than absolute.

---

## ✅ Gate: PASS

No hard failure, collapse, coverage loss, fabricated citation or template leak **beyond what
the unedited notes already produce**. Score drift, where present, is reported above and is
deliberately not a gate condition — this CI repoints references, it does not re-specify judgment.