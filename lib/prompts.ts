/**
 * Loads the owner's Process/*.md step notes as system prompts. The notes ARE
 * the prompt templates — refining a step = editing its markdown, not code.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { ciGuidanceFor } from './ci';

/**
 * Step code → note filename. Both sides moved together in the B-phase reorder
 * (CI · Lead Page as Pipeline Canvas §2.1): extraction is now B2, and roadblocks
 * / misalignments / translate each shifted down one. The map is literal — a key
 * and its filename must always name the same step, or a step silently loads
 * another step's procedure as its system prompt and still returns a valid-looking
 * tool call. When renumbering, move the pair, never one side.
 *
 * The C-phase moved the same way on 2026-08-24 (CI · Renumber the C-Phase to Seat
 * Evidence Selection at C3): bullets are now C4, skills C5, profile C6, compile C7,
 * ATS rating C8. **C3 and C7 are absent from this map on purpose.** C3 is the new
 * evidence-selection step, which makes no model call until its own CI builds one;
 * C7 is the document build, which has never made one. Neither gap is an oversight.
 */
const STEP_NOTE: Record<string, string> = {
  B2: 'B2. Extract Requirements from Job Description.md',
  B3: 'B3. Identify Roadblocks.md',
  B4: 'B4. Identify Misalignments.md',
  B5: 'B5. Translate Requirements to Areas of Expertise and Define JD Groups.md',
  B6: 'B6. Role Fit & Investment Worthiness Score.md',
  C2: 'C2. Map JD Requirements to Supporting Evidence.md',
  C4: 'C4. Transform Evidence into CV Bullets.md',
  // C5 joined this map on 2026-08-24, when its §B.1 categorisation became a model
  // call. Its note carries the rules the call has to follow (3–5 categories,
  // 4–8 skills, Core-aligned first), so the note IS the prompt — same as every
  // other step here. Selection and prioritisation either side of it stay code.
  C5: 'C5. Build and Manage the Skills Section.md',
  C6: 'C6. Drafting CV Profile (Per Job Lead).md',
  C8: 'C8. Run Reviewed ATS Matching Rating.md',
  'O2-extract': 'Onboarding/O2 Extract Career Graph.md',
};

/** Shared guardrails prepended to every step's system prompt (Master Instructions §1). */
export const NON_NEGOTIABLES = `You operate inside an agentic job-search system. Apply these without exception:
- Truthfulness over optimisation: never fabricate, exaggerate, or imply experience not in the candidate's evidence. Flag genuine gaps honestly (Weak / No Match) rather than inventing a tangential match.
- Evidence-bound ATS: mirror JD keywords only when genuinely supported by evidence.
- Be precise and concise. Emit ONLY the structured tool call requested.`;

// Notes don't change at runtime — read each once.
const noteCache = new Map<string, string>();

export async function loadStepNote(step: string): Promise<string> {
  const cached = noteCache.get(step);
  if (cached !== undefined) return cached;
  const file = STEP_NOTE[step];
  let content = '';
  if (file) {
    try {
      content = await fs.readFile(path.join(process.cwd(), 'Process', file), 'utf8');
    } catch {
      content = '';
    }
  }
  noteCache.set(step, content);
  return content;
}

/**
 * Split system prompt for Claude prompt caching. `cacheable` is byte-identical
 * across every lead/run of a step (NON_NEGOTIABLES + the step's Process/*.md
 * note — stable until the .md is edited) and is sent with a 1h cache_control
 * breakpoint. `dynamic` is the CI guidance, which grows as Accuracy Improvement
 * Tips accrue — it is never cached, so a new tip can't invalidate the prefix.
 */
export type SystemPrompt = { cacheable: string; dynamic: string };

/**
 * The cacheable half, as a pure function of the step and its note text.
 *
 * Separate from `systemPromptFor` so a caller holding note text from somewhere
 * other than `Process/` — `scripts/backtest-notes.ts` reads the baseline via
 * `git show main:…` — composes the prompt through the SAME code the pipeline uses.
 * A backtest that assembled its own prompt would be measuring a prompt production
 * never sends, which is worse than not measuring at all.
 */
export function composeSystemPrompt(step: string, note: string): string {
  return note ? `${NON_NEGOTIABLES}\n\n--- STEP PROCEDURE (${step}) ---\n${note}` : NON_NEGOTIABLES;
}

export async function systemPromptFor(step: string, ownerId?: string | null): Promise<SystemPrompt> {
  const [note, guidance] = await Promise.all([loadStepNote(step), ciGuidanceFor(step, ownerId)]);
  return { cacheable: composeSystemPrompt(step, note), dynamic: guidance };
}

/** The note filename backing a step, for tooling that needs to read it off disk or out of git. */
export function stepNoteFile(step: string): string | undefined {
  return STEP_NOTE[step];
}

/** The steps whose notes are loaded as system prompts — what this CI's audit and backtest cover. */
export function loadedSteps(): string[] {
  return Object.keys(STEP_NOTE);
}
