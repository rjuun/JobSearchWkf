/**
 * The CV's space budget — **one budget, in one place**.
 *
 * WHY IT IS A MODULE AND NOT A PARAGRAPH IN THREE NOTES
 * ----------------------------------------------------
 * It was a paragraph in three notes, and they disagreed. `Process/C7…` §C said
 * the Skills section holds 4 categories of 5; `Process/C5…` §B.1 said 3–5
 * categories of 4–8, and C5 is a LIVE system prompt, so C5's was the number the
 * model was actually given. `Process/C6…` §39 said "4–7 lines / 70–110 words",
 * two limits that do not agree with each other at any column width. Nothing
 * enforced any of them, and the document ran to three pages against a rule that
 * called two pages "non-negotiable".
 *
 * WHO OWNS WHICH NUMBER (owner's decision, 2026-08-27)
 * ---------------------------------------------------
 * Each budget belongs to the step that owns the section: the Skills figures to
 * `Process/C5…` §B.1, the Profile figure to `Process/C6…`. **C7 §C keeps
 * neither** — *"leaving C7 as much as possible as a simple compiler and
 * orchestrator of the 2 page CV"*. That is the design and not a tidy-up: two
 * prompts could disagree about the Skills section only because both claimed
 * authority over it, and after this one does. What stays with C7 is the only
 * rule C7 alone can enforce — `MAX_PAGES`, and what gives way when the document
 * does not fit.
 *
 * Those notes now CITE this file rather than restating it. Change a number here
 * and the prompt, the validator and the renderer move together.
 *
 * CEILING vs TARGET
 * -----------------
 * The Skills figures come in pairs on purpose. The **target** is what the C5
 * prompt asks the model to produce; the **ceiling** is what code refuses to
 * exceed. A model that lands slightly wide is normal and does not need to fail —
 * but nothing may reach the page above the ceiling.
 *
 * MEASURED, NOT ESTIMATED
 * -----------------------
 * `scripts/render-cv-from-stored.ts` rebuilds a real lead's CV at no model cost
 * and `scripts/cv-pages.ps1` asks Word itself for the page and line count, so
 * there is no excuse for a figure nobody checked — which is how
 * `SKILLS_ENVELOPE = 40` and C6's "70–110 words" both came to be wrong. The
 * measurement behind each figure is recorded beside it.
 */

/**
 * Non-negotiable, and the reason every other number here exists
 * (`Process/C7…` §C). Not enforced by a check — enforced by the rest of the
 * budget adding up to it. `scripts/cv-pages.ps1` is what verifies it on a
 * rendered page, which is the only place the claim means anything.
 */
export const MAX_PAGES = 2;

// ── Profile · owned by `Process/C6…` ─────────────────────────────────────────

/**
 * **The Profile's real limit: six rendered lines.** The owner, 2026-08-27:
 * *"regardless of the number of words, crossing the 6 lines feels already too
 * long for the attention span of a Headhunter/Talent Acquisition Manager."*
 *
 * It is stated in lines because lines are what he is judging. It is never
 * INSTRUCTED in lines, because the model cannot see the rendering and has no way
 * to act on a line count — `PROFILE_WORDS` below is the instrument.
 */
export const PROFILE_MAX_LINES = 6;

/**
 * How wide a rendered line is, in characters, in the template's body column.
 *
 * Measured 2026-08-27 across five leads' stored profiles: blocks of 716 / 748 /
 * 781 / 782 characters each filled exactly 7 lines and one of 831 filled 8,
 * which brackets the width to 112–118 characters per line. The **narrow** end is
 * the one a ceiling has to be derived from, so 112 is what is recorded here.
 *
 * Re-derive this whenever the template's column width or body font changes;
 * `PROFILE_MAX_LINES` never moves.
 */
export const CHARS_PER_LINE = 112;

/**
 * Characters per word including the following space, over the same five
 * profiles: 7.4 / 7.7 / 7.9 / 8.0 / 8.2. Again the pessimistic end — a profile
 * written in longer words is the one that overruns.
 */
export const CHARS_PER_WORD = 8.2;

/** The rendered line count a profile of `words` words will occupy. An
 *  OBSERVATION derived from the word count, never an instruction. */
export function profileLines(words: number): number {
  return Math.ceil((words * CHARS_PER_WORD) / CHARS_PER_LINE);
}

/**
 * The Profile as **words**, which is the only form the model can obey.
 *
 * `max` is `PROFILE_MAX_LINES` converted at the pessimistic width above —
 * 6 × 112 / 8.2 = 81.9 — and then verified on a rendered page rather than
 * trusted: `render-cv-from-stored.ts --profile-words N` truncates a stored
 * profile to N words and re-renders for nothing, so the line count at the cap is
 * measured and not assumed. `min` is C6's existing collapse floor, which stops a
 * degraded one-line reply passing as a merely short one.
 *
 * What this replaces: "4–7 lines / 70–110 words". Those two never agreed — 110
 * words is eight rendered lines, not seven — and the five stored profiles that
 * obeyed the word half (93–106 words) all rendered at 7–8 lines against a C7
 * rule that said 5.
 */
export const PROFILE_WORDS = { min: 70, max: 80 } as const;

// ── Skills section · owned by `Process/C5…` §B.1 ─────────────────────────────

/**
 * Categories, and entries under each — **ceiling 5 × 6, target 4 × 5** (owner,
 * 2026-08-27). `min` is what makes the section read as categories rather than as
 * a list; it is a floor, not something to fill up to.
 *
 * Line cost, measured over the same five CVs: a category costs its own heading
 * line plus one line per ~2.2 entries, because a printed entry averages 38
 * characters and they print inline separated by ` · `. So the target shape is
 * 4 heading lines + 8 entry lines = 12, against the 14–19 lines the uncapped
 * section was actually spending.
 */
export const SKILL_CATEGORIES = { min: 3, target: 4, ceiling: 5 } as const;
export const SKILLS_PER_CATEGORY = { min: 3, target: 5, ceiling: 6 } as const;

/**
 * The whole section's ceiling — the product, and the number that decides what is
 * shed when the prioritised set overflows before the model ever sees it.
 *
 * This is what `SKILLS_ENVELOPE = 40` was guessing at. Forty was never checked
 * against a page, and no measured lead has ever printed more than 28, so the cap
 * never bound at all — which is exactly how the section came to spend 21 lines.
 */
export const SKILLS_CEILING = SKILL_CATEGORIES.ceiling * SKILLS_PER_CATEGORY.ceiling;

/** What the C5 prompt asks for, as a number of entries. Merging (C5 §B.5) is how
 *  a wide set is meant to reach it; shedding is what happens past the ceiling. */
export const SKILLS_TARGET = SKILL_CATEGORIES.target * SKILLS_PER_CATEGORY.target;

// ── The page check · owned by `Process/C7…` §C ───────────────────────────────

/**
 * The rendered line cost of one paragraph of `text`.
 *
 * Verified against Word rather than assumed: over every content paragraph of a
 * measured CV — profile blocks, skills lines, indented project bullets, role
 * overviews — `ceil(chars / 112)` predicted Word's own per-paragraph line count
 * correctly in **every** case (21 of 21, 2026-08-27). Body text and the indented
 * bullets share a width close enough that one constant covers both; the bullet
 * indent is 28pt against a much wider column.
 */
export function renderedLines(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_LINE));
}

/**
 * How many lines of VARIABLE content two pages hold.
 *
 * "Variable" is everything C3/C5/C6 decide — the profile, the skills, the
 * bullets, the role overviews, and the captions that come and go with them. The
 * template's fixed furniture (name block, section banners, the four position
 * headers, Education, Languages) is constant for this template, so it is not
 * modelled: it is absorbed into this allowance, which is why the number is
 * calibrated rather than derived.
 *
 * Calibrated 2026-08-27 on five leads rendered at the settled budget and counted
 * in Word: the four that fit two pages estimated at or below this figure and the
 * one that ran to three pages estimated above it. Re-calibrate whenever the
 * template's fixed furniture changes — `scripts/measure-cv-space.ts` prints the
 * estimate beside Word's verdict for exactly that purpose.
 */
export const CONTENT_LINE_ALLOWANCE = 67;
