---
ci-title: Introducing Requirement Skills to Job Requirements List
ci-area:
ci-status: 3 - Delivered
ci-priority: medium
ci-date: 2026-06-22
ci-estimated-time: 2
ci-time-spent: 3
pr-source: "[[B5. Extract Requirements from Job Description]]"
pr-target:
---
---
```simple-time-tracker
{"entries":[{"name":"Segment 1","startTime":"2026-06-23T09:25:33.069Z","endTime":"2026-06-23T09:26:35.905Z"},{"name":"Segment 2","startTime":"2026-07-02T20:53:55.708Z","endTime":"2026-07-02T23:56:01.260Z"}]}
```

---
## 1. What is the problem or opportunity?


>I have identified that the columns Skills here is being populated trying to connect the Job Requirements to my own Skills and Areas of Expertise, when the objective was to extract the very Skills from the Job Lead refer to [[Introduce Requirement Skills to Job Requirements List]]


 I mentioned earlier that the column "Skills" were somehow provided as "connection to my own areas of expertise" instead of "connected to the Job Lead Requirements".

## 2. What would the improvement look like?

**Recommended Fix:**

For **C3 (Transform Evidence into CV Bullets)**, the "Skills" column should represent:

> **The key skills from the Job Lead that this specific evidence helps demonstrate.**

In other words:

- We should shift from _"Which of my skills does this map to?"_ to
- _"Which skills required by this Job Lead does this piece of evidence help prove?"_

**Quick Fix for Documentation:**

We don’t need to overhaul the entire C2 table. Instead, we can do the following for the current Job Lead:

1. Keep the existing "Skills" column as **"Original Skill Mapping"** (your Areas of Expertise).
2. Add a **new column** called **"Job Lead Skills Demonstrated"** in the C2 table.
3. Populate this new column with the actual skills/language coming from the Job Lead’s requirements (especially Core and Important ones).

This way we maintain traceability while making C3 and C4 much clearer.



## 3. Resources or references


## 4. Notes / Progress log

I already created a new column labeled "Requirement Skills" and renamed the current Skills column to "My Skills".

---
This is a topic for discussion before clarification:

First, the use of Areas of Expertise in [[B4. Translate Requirements to Areas of Expertise and Define JD Groups]] has the purpose of mapping the job description to a specific *JD Group*. The table Areas of Expertise is a limited set of Broad Skills which are used as a framework to define if a Position is more of a *Chief of Staff & Executive Office* or a *Operations & Shared Services* Job Description.
This is to say that, I am particularly leaning to restrict the use of *Areas of Expertise* purely to JD Group discovery and not to actual Requirements Skills mapping.

Second, during [[C3. Transform Evidences into CV Bullets]] and [[C4. Associate Skills to CV Bullets]], the purpose is to tailor *My Skills* to the *Job Requirement Skills*. At this stage, one needs to understand that:
	a. the same Skill can be announced under different names / variations, and;
	b. the terminology used by numerous companies will not be consistent to the terminology we have followed when creating the `Profile Reference Workbook`, in which we clearly differentiate between *Skills*, *Competences* and *Attributes*.
This is to say that, during the Tailoring Phase, we should not restrict:
	a. C3 -> 5. Skill Association, and;
	b. C4 -> Associate Skills to CV Bullets (since we actually have the "Skill Association" performed during step C3, should we rename step C4 to: "Coordinate the description of Skills between Bullets and Generation of *Skills List*")

to be constrained and populated uniquely by *Skill* entries from `tbl_Skills_Master`, but rather use an expanded interpretation that also considers entries from `tbl_STAR_Competences` and `tbl_STAR_Attributes` as *Skills*.

With this clarifications, my proposal is to have the column *My Skills* actually being populated by entries from these 3 tables which contain truthful and direct evidence of Skills I have:
- `tbl_Skills_Master`
- `tbl_STAR_Competences` and
- `tbl_STAR_Attributes`




Q1: For clarification purposes, should we change the name of the table from *Skills and Areas of Expertise* simply to *Areas of Expertise* ?
Q2: Since we actually have the "Skill Association" performed during step C3, should we rename step C4 to: "Coordinate the description of Skills between Bullets and Generation of *Skills List*"



Can you provide your assessment on - what I believe to be - the refinements we have implemented ? Are they too confusing ? can it be simplified ? is the approach consistent ?


---

%% 
this is a topic for another Improvement:
Later on, during [[C3. Transform Evidences into CV Bullets]] and [[C4. Associate Skills to CV Bullets]], it is possible that Claude is being very restricted in interpreting the "List of Skills" section of the CV as being restrained to be populated uniquely by entries in `tbl_Skills_Master`, that is, not considering `tbl_STAR_Competences` or `tbl_STAR_Attributes`.


It might be that, on a systematic level, my table of *Skills and Areas of Expertise* might actually reflect an overarching "group" or Skills which, on a secondary level are represented by the actual *Skills*, *Competences* and *Attributes*. If that works, they could be the "Major Bullets" on CV Skills Table
%%
