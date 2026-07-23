---
ci-area: UX
ci-title: Lead Status Badge vs Pipeline Card Inconsistency
ci-status: 0 - Idea
ci-priority: low
ci-date: 2026-07-23
ci-estimated-time:
ci-time-spent:
pr-source:
pr-target:
---
---
```simple-time-tracker
{"entries":[]}
```
---
## 1. What is the problem or opportunity?

Noticed while testing AI-driven capture (2026-07-23), comparing two leads side by side:

- **UNIQA — Chief of Staff IT (all genders):** the status pill at the top-left of the lead page reads "Applied." The Pipeline card alongside the fit score (Capture → Screen → Tailor → Apply track) does *not* show the Apply step as completed/ticked. The two indicators disagree about the same lead's status.
- **AWS — Abteilungsleitung Strategie und Corporate Governance (freshly captured):** the Pipeline card doesn't render at all — only the top-left "Captured" pill shows. Likely because the Pipeline card only appears once a lead has entered screening (a `pipeline_runs` row exists), not from the moment of capture (`status: captured`).

So there are two separate issues wearing one description: the top badge and the Pipeline card can drift out of sync with each other, and the Pipeline card doesn't exist yet for leads that haven't started screening.

## 2. What would the improvement look like?

Reggie's read: the top-left status pill is probably unnecessary — it's a second, independently-maintained representation of the same underlying state the Pipeline card already shows. The important thing is that the Pipeline card renders **consistently for every lead, from the moment it's captured**, through every later stage (Capture → Screen → Tailor → Apply), rather than only appearing partway through. If the Pipeline card is the single source of truth from the start, there's nothing left for a separate badge to get out of sync with.

Worth deciding, when this gets picked up: drop the top badge entirely, or keep it but derive it from the exact same underlying stage data the Pipeline card reads, so the two can't diverge.

![[Pasted image 20260723173517.png]]

## 3. Resources or references

Two lead pages compared directly, 2026-07-23: `/roleproof/leads/<UNIQA lead id>` (shows "Applied" badge, Pipeline card's Apply step unticked) vs `/roleproof/leads/08bec87c-c797-4804-9f24-081c00ac4395` (AWS, "Captured" badge, no Pipeline card at all).

## 4. Notes / Progress log

Deliberately deferred — not the right moment to fix mid-capture-testing. Revisit once more real leads are populated and the pattern (badge vs. card drift, card absence pre-screening) is easier to evaluate at volume.
