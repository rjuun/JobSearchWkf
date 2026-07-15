---
ci-title: Untitled
ci-area:
ci-status: 1 - Development
ci-priority: medium
ci-date: 2026-06-23
ci-estimated-time: "3"
ci-time-spent: 1.5
pr-source: "[[+ Continuous Improvement Procedure]]"
pr-target:
---
---
```simple-time-tracker
{"entries":[{"name":"Draft","startTime":"2026-06-23T12:11:26.000Z","endTime":"2026-06-23T12:48:40.706Z"},{"name":"Segment 2","startTime":"2026-06-23T15:44:15.638Z","endTime":"2026-06-23T16:28:21.094Z"}]}
```

---
## 1. What is the problem or opportunity?

As the General Development process is concluded, we see now the need to review certain aspects of the process which are not needed anymore, or that need to be done differently.
In order to keep control over the changes, it is important to introduce a specific Change Procedure in which we control what was and what is the system now.
## 2. What would the improvement look like?

The idea is to have a procedure that allows us to use the Continuous Improvements notes and bring them into focus.
As we do it, the old procedures will become old, but we do not want to loose track of it.

1. A template for the Procedures itself will be needed, bringing a set of properties that allows control over changes
	1. Look into my old "Policies and Procedures" for inspiration, meaning, which properties do we need from the "Change Log table"
		- Valid since
		- Status: Valid, Retired
		- Retirement Date
		- Connection to "Continuous Improvement" file
		- 
	2. These properties will be used for the versioning
	3. 


## 3. Resources or references


## 4. Notes / Progress log



My situation is the following.
I have a system created in Obsidian.
The system is composed of a main Folder labeled `Process`. In this folder you will find a the Main process described in a Master of Content MOC document plus notes which details the many steps of the process referenced in the MOC.
As the system was in Development Phase, whenever a new idea, possibility for improvement, automation, simplification, etc appeared, I created an Continuous Improvement Admonition on the Process Note, close to where the Process Step should be impacted, and linked this Admonition to a new Continuous Improvement Template Note.
Now, As the system is relatively stable, I am tackling some of these Continuous Improvement notes.
The idea is to have a proper procedure to implement change.
This procedure should allow me to:
1. Based on the Continuous Improvement Note create a Copy of the connected Procedure Note to a safe `Focus` folder and set the ci-target property of the CI (Continuous Improvement) Note as a link to the new Procedure Note
2. Have the following properties of this New Procedure set to
	1. pr-creation: date of the creation
	2. pr-status: "Development"
3. I would them work to implement and test the changes in this New Procedure Note version and, when it is read to replace the old version
4. Retire the Old Procedure Note by
	1. Moving the old Procedure Note to a `Past Versions` folder
	2. Set its properties to
		1. ci-status: Retired
		2. ci-retired: date of retirement
		3. Change all the dependencies



