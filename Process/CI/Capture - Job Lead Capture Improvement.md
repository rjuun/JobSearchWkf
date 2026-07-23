---
ci-area: Capture
ci-title: Job Lead Capture Improvement
ci-status: 3 - Delivered
ci-priority: medium
ci-date: 2026-06-26
ci-estimated-time: 1.5
ci-time-spent: 8
pr-source: "[[A1. Store Job Leads]]"
pr-target: "[[A1. Capture and Store Job Leads]]"
---


---
```simple-time-tracker
{"entries":[{"name":"Draft","startTime":"2026-06-26T09:47:45.000Z","endTime":"2026-06-26T09:49:32.000Z"},{"name":"Draft","startTime":"2026-07-23T08:02:41.000Z","endTime":"2026-07-23T10:01:02.279Z"},{"name":"Development","startTime":"2026-07-23T10:01:03.000Z","endTime":"2026-07-23T10:50:29.358Z"},{"name":"Testing","startTime":"2026-07-23T11:10:15.000Z","endTime":"2026-07-23T12:36:37.000Z"},{"name":"Development","startTime":"2026-07-23T13:45:54.000Z","endTime":"2026-07-23T17:25:43.000Z"}]}
```
---
## 1. What is the problem or opportunity?
 
Every time I import a Job Lead I still need to manually get the target link to the company and indicate which ID the Job Lead has received in Sharepoint.


## 2. What would the improvement look like?


Following the suggestion from Fafs, instead of trying to capture the Job Lead and information with an Script that tries to programmatically capture all the information, best is to have the AI doing it with a hard prompt.

Below is an example

![[Pasted image 20260723100544.png]]

There must be a way that the link to the company, as well as the ID from Sharepoint, should be immediately populated

Here it is important that he tracker is eliminated from the link
- &igbTracker=926613858&utm_source=linkedin
- ?source=LinkedIn
- /?Codes=LinkedIn
- /?feedId=445533
- ?utm_source=linkedin
- ?utm_source=linkedin.com&utm_medium=job_posting
- ?source=LinkedIn&sourceType=PREMIUM_POST_SITE
- &utm_source=linkedin
- &utm_source=linkedin
- apply?source=LinkedIn
- apply?source=LinkedIn
- &source=LinkedIn_Slots


## 3. Resources or references

Considerations prior to implementation

![[Pasted image 20260723114319.png]]

![[Pasted image 20260723114331.png]]
## 4. Notes / Progress log



![[Pasted image 20260723182740.png]]