---
ci-title: ATS and Fit Scoring
ci-area:
ci-status: 3 - Delivered
ci-priority: high
ci-date: 2026-06-23
ci-estimated-time: "2"
ci-time-spent: 3.25
pr-source: "[[B6. Run Initial ATS Matching Rating]]"
pr-target: "[[B6. Role Fit & Investment Worthiness Score]]"
---
---
```simple-time-tracker
{"entries":[{"name":"Draft","startTime":"2026-06-23T09:27:55.435Z","endTime":"2026-06-23T09:41:04.044Z"},{"name":"Edit","startTime":"2026-06-23T09:41:13.633Z","endTime":"2026-06-23T10:32:21.192Z"},{"name":"Development","startTime":"2026-06-23T13:34:03.000Z","endTime":"2026-06-23T15:43:45.798Z"}]}
```

---
## 1. What is the problem or opportunity?
 
Lets pause here for a moment, cause I want to tackle an issue here before we move on.

It’s clear for me that as much as I have tried, I could not achieve a better matching score in this last CV (Enpulsion) because, looking in retrospect, basically the role appear sto be "too-far-off" for me! No amount of rewording could bridge it — it's was substantively different kind of role and/or environment from my Profile and it was not captured during our roadblocks, misalignment and/or initial ATS Scoring analysis.

Move from “ATS Matching Score” → “Role Fit & Investment Worthiness Score”.
## 2. What would the improvement look like?

Having said that, I want us to find a solution to improve the job lead rating at the beginning of the process.
I see 3 points needed where things could improve:
	a. Declare the objective of this step NOT as "ATS matching", but rather as "Profile Fit Scoring", by specifying the weight of ATS (not sure how to define it here, but should be something more in words and skills clearly present versus which can be inferred or reworded) to be  lower than the "Profile Fit Analysis"
	b. To achieve it, additional to the individual "C.2 Per-requirement Score", we can refine "C.3 Overall Fit Score" by introducing further dimensions:
	- Relevance to the Role: most significant dimension in the whole Fit Analysis
	- Seniority and Strategic Level
	- Impact & Results
	- ATS Compatibility
		- This could still be part of the Fit Analysis but, like we said before, must be specified in terms of 
	c. lastly, at this initial stage where we still do not have a good CV template for each group, it appears to me that, if the objective is to measure Fit, the best approach should be something like having a big complete CV with the 23 Bullets we developed as a Standard. In this way, we would have a more consistent way to measure "Relevance to the Role", while "ATS" would be derived from how far the bullets would need to be reworded / tailored to reflect the Job Lead Requirements wording 

Please indicate if you see it differently, what are the pros and cons from my proposed approach, and an estimated time to actually implement it.

 based on the 
## 3. Resources or references


## 4. Notes / Progress log

![[Pasted image 20260623114523.png]]


Let me follow-up with your proposed Implementation steps overview:

1. Redefine the screening objective and scoring dimensions
	1. My initial though would be to keep Roadblocks (B2) and Misalignments (B3) as is. They are meant to be quite objective and the parameters appear to be reasonably clear and well defined.
	2. The more subjective part would lay heavily on B5. I will lay down some ideas here, but feel free to reorder and review them
		1. A.1, A.2 and A3 would be retired and replaced to reference to a single "Master CV Bullet"
		2. This "Master CV Bullet" would be composed of the Current CV Template with the following modifications
			1. Generic Profile Section
			2. Larger Skills section composed of all the skill groups and skills present in the 23 bullets
			3. Work Experience section which will run for 5 to 6 pages with all the 23 bullets for each Position
			4. the final standard Education, Executive Education and Language sections
		3. B. Input Documents would remain the same, 
		4. The current B5 will be retired and placed on a "Past Versions" folder with the "Valid Date" [[++ Continuous Improvement Procedure#Introducing Properties to Process Template]]
		5. C.1 and C.2 subsections from C. Scoring Rules are still applied (Per-Requirement Score) and should not be changed.
			1. The "Per-Requirement Score" will still  feed E.1 and E.2 - Export 1 outputs
		6. C.3 Overall fit score will need to be expanded to consider the new dimensions
			- Relevance to the Role: most significant dimension in the whole Fit Analysis
			- Requirement Alignment Score: derived from Per-Requirement Assessment
			- Seniority and Strategic Level
			- Impact & Results
			- ATS Compatibility: now adjusted in terms of "distance" between Job Lead wording/language and the wording/language in "Master CV Bullet"



2. Create a simple scoring rubric (1–5 scale with definitions)
![[Pasted image 20260623123112.png]]

3. Design a lightweight "Master CV Bullet Bank" structure
4. Update the Pre-Application Screening steps (B4 / B5 / B6)
5. Test with 3–5 real job leads

---



---




![[Pasted image 20260623153721.png]]



---
A1: We have both agreed. 
No further action needed.
Done !

A2: 
> Instead of a full 5–6 page Master CV, I suggest we create a **"Master Bullet Bank"** (a structured list of your 23 strongest bullets with clear tags). This is lighter to maintain and easier to score against.

I take your recommendation, but I would make a counterproposal in term of "how". My proposal is to add a new tab labelled "Master Bullet Bank" in  Profile_Reference_Workbook_.xlsx.
In this way we keep a central source for all references regarding my Profile.
Also, if there is any need to update any part of the document, it would be easier to spot an opportunity/need to update/add bullets

A3: I also feel the same way. It is better to treat "Relevance to the Role" and "Requirement Alignment Score" as 2 different dimensions.
I also agree with your Proposed Structure for Overall Fit Score. It is aligned with our objective of "Move from “ATS Matching Score” → “Role Fit & Investment Worthiness Score”


A4: also agreed with your suggestions.
Just a small correction. In "Documentation", the Procedure to be retired is B6. Run Initial ATS Matching Rating and not B5.
B5. Extract Requirements from Job Description is still relevant for B6 > Per-Requirement Rating, as well as further downstream Tailoring Procedures


If we are in agreement, next the steps are:
1. I will create a tab labelled "Master Bullet Bank" in  Profile_Reference_Workbook_.xlsx and save the 23 Bullets there
2. Regarding the B6, I have
	1. made a copy of B6. Run Initial ATS Matching Rating procedure
	2. moved the copy to "Past Versions" folder and set pr-status property to "Retired" with its pr-retired to today.
3. You to propose a new B6. Role Fit & Investment Worthiness Score procedure based on the definitions we have had so far

I have attached the old .md for your support

---



