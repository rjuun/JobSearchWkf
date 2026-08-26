---
ci-title: Eliminating Metadata from Final file
ci-area:
ci-roadmap:
ci-status: 3 - Delivered
ci-priority: medium
ci-date: 2026-06-29
ci-estimated-time:
ci-time-spent:
pr-source: "[[C7. Compile Complete CV Document]]"
pr-target:
---


---
```simple-time-tracker
{"entries":[{"name":"Draft","startTime":"2026-06-28T22:25:51.000Z","endTime":"2026-06-28T22:32:11.000Z"}]}
```
---

> [!IMPORTANT] Delivered 2026-08-27, inside CI · CV Template Output Format
> The manual Word recipe below is superseded: the render does it now
> (`lib/docx/metadata.ts`), because the render is the only place that can. What §2 named — set the
> author — turned out to be the smallest of four leaks. The loudest was that every CV carried the
> TEMPLATE's creation date, modified date and revision number, so a batch of applications shared one
> frozen provenance; and `app.xml` described a different document entirely, claiming 201 words for a
> 990-word CV. Both are fixed at render time, along with the SharePoint content-type bindings.
>
> Point 2 of §2 — make the letter unmistakably yours — is not a metadata matter and stays open as
> advice. Point 1's last line still holds: **open the file in Word and save it once**. That sets the
> editing time and the page and line counts honestly, which is the one thing a renderer should not
> fabricate.

---

## 1. What is the problem or opportunity?

The objective is to insure the CV is not captured by the ATS by eliminating metadatas

## 2. What would the improvement look like?

### Concrete things to do before you submit

1. **Clean the document metadata.** This is the one tangible trace, and it's easy to remove. The simplest reliable method: open each `.docx` in Word → **File → Info → Check for Issues → Inspect Document → Document Properties and Personal Information → Remove All**, then save. That strips author/tool/timestamp fields. (Even better, after inspecting, set the Author to your own name so it reads as a normal personal document.) I can also do this programmatically and hand you cleaned copies if you'd prefer — just say so.
2. **Make the letter unmistakably yours.** Read it aloud once and change a handful of phrasings to your own natural wording — even five or six small edits. This is the highest-value step: it defeats both the statistical detectors (which key on uniform, "average" phrasing) and the human reviewer's pattern-matching, and it costs you ten minutes. The letter is a strong _draft in your voice's direction_; one editing pass makes it genuinely yours.
3. **Don't over-correct.** Avoid the "humanizer" tools the search results are selling — they often introduce odd phrasing that reads worse to a human, and you don't need them. Your content is specific and truthful, which is the actual defense.


## 3. Resources or references


## 4. Notes / Progress log

### 2026-08-27 · Delivered inside the template CI

Absorbed by CI · CV Template Output Format, whose render path is the only place these properties can
be rewritten. See that note's §4 for what was actually leaking and why the author field was the least
of it. Deliberately NOT done: inventing an editing duration. `TotalTime` of 0 is what a document saved
once genuinely looks like; writing a plausible 47 minutes into it would fabricate a record of work
rather than remove a fingerprint.
