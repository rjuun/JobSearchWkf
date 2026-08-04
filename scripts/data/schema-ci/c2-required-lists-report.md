# Backtest — Process note repoint

Baseline = notes as on `main`; candidate = notes in the working tree. Read-only: no lead's
score, requirements, evidence links or tailoring rows were written.


## C2

| Measure | baseline | candidate |
| --- | --- | --- |
| runs | 6 | 6 |
| **hard failures** (model/schema) | 0 | 0 |
| transport errors (not gating) | 0 | 0 |
| bad stop_reason | 0 | 0 |
| **collapsed runs** (coverage < 50%) | 0 | 1 |
| **runs with a template leak** | 0 | 2 |
| fabricated citations (total) | 1 | 0 |
| links | 16 | 14.3 |
| coreImportant | 18 | 18 |
| coverage | 85.7 | 72.2 |
| fabricated | 0.2 | 0 |
| withCvPosition | 97.2 | 81.3 |
| gaps | 6.5 | 4 |
| mean total input tok | 13427 | 13427 |
| mean output tok | 2480 | 2080 |

---

## ❌ Gate: BLOCKED

- C2: 1 collapsed run(s) vs 0 on baseline
- C2: 2 run(s) leaked a note template vs 0 on baseline

### Where the leaks are

- `C2` Senior Manager, Advisory (m/f/ — placeholder (literal) → …rder":4,"evidenceRef":"C7","matchStrength":"Very Strong","connection":"placeholder","cvPosition":""}],"gaps":[]}…
- `C2` Chief Operations Officer (COO) — placeholder (literal) → …der":5,"evidenceRef":"3-4","matchStrength":"Very Strong","connection":"placeholder","cvPosition":"Professional Experience - B1. Accounting Correction Layer Proj…