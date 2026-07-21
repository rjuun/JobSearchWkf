---
ci-title: Migrating Power Automate Intelligence from Old Sharepoint
ci-area:
ci-status: 1 - Development
ci-priority: medium
ci-date: 2026-06-24
ci-estimated-time: 4
ci-time-spent: 2.5
pr-source: "[[D1. Monitoring Applications]]"
pr-target:
---
---
```simple-time-tracker
{"entries":[{"name":"Draft","startTime":"2026-06-24T08:03:55.000Z","endTime":"2026-06-24T08:17:50.972Z"},{"name":"Development","startTime":"2026-06-24T08:17:59.335Z","endTime":"2026-06-24T10:32:29.635Z"}]}
```

---
## 1. What is the problem or opportunity?

Replace the Tables from [[Job Application Dashboard.xlsx]] to be feed with information from Job Leads Sharepoint List, instead of old Applications Library.

The new link should also allow new statistics:
- Number of Pre-Application Screenings
	- Roadblocked/Misaligned
	- Applied

## 2. What would the improvement look like?

Must first implement the flow to monitor the responses from newly sent applications.
After that, transfer the history so that the tables can reflect the whole history
Lastly, implement the new statistics table

## 3. Resources or references

[Edit your flow | Power Automate](https://make.powerautomate.com/environments/Default-cfa77709-86a8-41a7-86b6-d487977d02b0/flows/73de7286-f147-43fe-b57a-91bbabbd7c6e?v3=false)

## 4. Notes / Progress log


As of today, 24.06, I have finished adjusting [JH 01 - Update Job Leads with Decline Email](https://make.powerautomate.com/environments/Default-cfa77709-86a8-41a7-86b6-d487977d02b0/flows/03f4c8a3-99a8-40b9-a93d-2f3ab03ace40?v3=false)
It is working now with the new negative responses that I receive.

Next step is to:
1. Transfer history from Applications to Job Leads
2. Recreate the tables to refer to Job Leads instead of Applications
3. 

