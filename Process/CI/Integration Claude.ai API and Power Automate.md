---
ci-title: Integration Claude.ai API and Power Automate
ci-area:
ci-status: 5 - Superseded
ci-priority: medium
ci-date: 2026-06-16
ci-estimated-time:
ci-time-spent:
pr-source:
pr-target: "[[Migrate LLM Provider - DeepSeek to Claude (Sonnet 5 + Opus 4.8, Single Provider)]]"
---
---
**Superseded, not abandoned** (relabeled 2026-07-31 — see `++ Continuous Improvement Procedure.md`'s
`ci-status` table: this is scope absorbed elsewhere, not work dropped outright). The Power-Automate-as-
orchestrator design below never got built; the app was built instead, and Claude API access landed there
directly via `[[Migrate LLM Provider - DeepSeek to Claude (Sonnet 5 + Opus 4.8, Single Provider)]]`, which
carries this CI's actual intent (Claude scoring/tailoring calls, live in the app) forward.

---
```simple-time-tracker
{"entries":[{"name":"Draft","startTime":"2026-07-24T13:26:36.000Z","endTime":"2026-07-24T14:00:42.000Z"}]}
```

---
## 1. What is the problem or opportunity?
 
Relevant to fully automate the system without my supervision / work for getting the results from Claude and feeding my Sharepoint Tables

### The One Thing You Need That You Don't Have Yet

**An Anthropic API key.**

The automation backbone runs on the Anthropic API directly, not on your claude.ai subscription. You'll need to create an account at console.anthropic.com, generate an API key, and store it as a secure variable in Power Automate. The cost is usage-based (per token) rather than subscription — for this workflow volume it will be very low.


## 2. What would the improvement look like?

TRIGGER
Candidate saves JD PDF to "Job Lead" SharePoint Library

STEP 1 — Power Automate prep
→ Fetches JD PDF content (convert to text)
→ Fetches LinkedIn URL (scrapes visible text)
→ Fetches scoring instructions from OneDrive
   (your Obsidian step note, exported as .md)
→ Fetches Role Groups reference data from SharePoint List

STEP 2 — Claude API call (Scoring)
→ HTTP POST to Anthropic API
→ System prompt: scoring instructions + role groups data
→ User message: JD text + LinkedIn text + profile summary
→ Response: structured JSON with fit score,
            requirement mapping, JD group classification,
            gaps, ATS system identified

STEP 3 — Power Automate writes to SharePoint
→ Parses JSON response
→ Creates/updates row in "Job Lead" Library
   with all scored fields populated

STEP 4 — Candidate decision
→ Reviews scored entries in SharePoint
→ Sets "Generate Tailored CV" = Yes for chosen roles

STEP 5 — Power Automate detects column change
→ Fetches tailoring instructions from OneDrive
→ Fetches relevant STARs for the identified JD group
   (filtered, not full library)
→ Fetches ATS formatting rules for identified ATS system

STEP 6 — Claude API call (CV Tailoring)
→ HTTP POST to Anthropic API
→ System prompt: tailoring instructions + filtered STARs
                 + ATS rules + master CV structure
→ User message: JD requirements + fit scoring from Step 2
→ Response: tailored CV as structured markdown or JSON

STEP 7 — Power Automate creates application record
→ Creates folder in "Applications" SharePoint Library
→ Converts CV output to .docx
→ Saves JD PDF, tailored CV, and scoring JSON to folder
→ Updates "Job Lead" status to "Applied - In Progress"



---

Camunda (modeler only)
└── BPMN diagrams documenting the process visually
    └── Each step has a linked Obsidian note with the detailed prompt/instructions

Obsidian (OneDrive-synced) ← the actual working layer today
├── 0. Application Process (MOC).md
├── Process notes (one per step, linked from Camunda diagrams)
└── Profile/
    └── Profile_Reference_Workbook.xlsx

Power Automate ← the orchestrator for now
└── Triggers, API calls, SharePoint writes

Anthropic API
└── Called by Power Automate with injected context


## 3. Resources or references


![[Pasted image 20260724160139.png]]


![[Pasted image 20260724160155.png]]

## 4. Notes / Progress log







---
