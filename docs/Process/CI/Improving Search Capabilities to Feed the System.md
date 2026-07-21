---
ci-title: Improving Search Capabilities to Feed the System
ci-area:
ci-status: 0 - Idea
ci-priority: medium
ci-date: 2026-06-24
ci-estimated-time:
ci-time-spent:
pr-source:
pr-target:
---
## 1. What is the problem or opportunity?

My current bottleneck is the _ingestion_ side — getting relevant job posts into it efficiently

Let me put like this: I am an Austrian citizen searching for jobs in a few cities in Europe, namely Vienna, Zürich, Berlin, Hamburg, Copenhagen, Amsterdam, Barcelona, Madrid, Milan. Although I understand there are specific search tools for each one of these Job Markets, I am relying heavily on LinkedIn cause I believe there I will find the kind of positions I am looking for: positions in companies which are more international and that would accept my imperfect language skills of the local market in consideration to my perfect English together with business conversational level of Spanish and German.

I am working on a System supported by AI which should improve considerably my ability to rate how my skills fit to selected Job Posts and how to tailor my CV to them.

Yet, the work of "searching for the positions, setting Alarms and bringing them to the system" for the best Job Posts can be selected by the system is still very time consuming.

Are there tools better than LinkedIn search mechanism to massively search the Job Descriptions there based on my own queries ?


## 2. What would the improvement look like?

A practical architecture for your situation

Given that you already have an AI system doing the CV-fit scoring, the ideal flow would be:

1. **JobSpy** (scheduled daily, Python script or Apify) → pulls new postings matching your keywords from LinkedIn + Google Jobs across your 9 cities
2. Dumps to a **structured CSV/database** with full descriptions
3. Your **AI system** scores fit and ranks them
4. You review only the top-ranked ones for manual follow-up

The key query parameters that will help you filter for "international companies that accept English + imperfect local language" are: searching in English (not the local language), targeting keywords like _"English working language"_, _"international team"_, or role types typically filled in English (Product, Tech, Finance, Strategy roles in multinationals).

## 3. Resources or references


## 4. Notes / Progress log

---



---
