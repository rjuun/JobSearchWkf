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
 */
const STEP_NOTE: Record<string, string> = {
  B2: 'B2. Extract Requirements from Job Description.md',
  B3: 'B3. Identify Roadblocks.md',
  B4: 'B4. Identify Misalignments.md',
  B5: 'B5. Translate Requirements to Areas of Expertise and Define JD Groups.md',
  B6: 'B6. Role Fit & Investment Worthiness Score.md',
  C2: 'C2. Map JD Requirements to Supporting Evidence.md',
  C3: 'C3. Transform Evidence into CV Bullets.md',
  C5: 'C5. Drafting CV Profile (Per Job Lead).md',
  C7: 'C7. Run Reviewed ATS Matching Rating.md',
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

export async function systemPromptFor(step: string, ownerId?: string | null): Promise<SystemPrompt> {
  const [note, guidance] = await Promise.all([loadStepNote(step), ciGuidanceFor(step, ownerId)]);
  const cacheable = note ? `${NON_NEGOTIABLES}\n\n--- STEP PROCEDURE (${step}) ---\n${note}` : NON_NEGOTIABLES;
  return { cacheable, dynamic: guidance };
}
