/**
 * CI · Renumber the C-Phase to Seat Evidence Selection at C3 — the verification tool.
 *
 * Prints one line per loaded step: the step code, the note filename, and a hash
 * of the composed system prompt's NOTE BODY (the prompt minus the
 * `--- STEP PROCEDURE (<code>) ---` marker, which is the one thing a renumber is
 * allowed to change).
 *
 * That makes the renumber's acceptance criterion checkable without spending a
 * single model call: run this before the rename, run it after, and every hash
 * must survive — re-keyed to its new code, never altered. A hash that CHANGES is
 * a note whose text was touched, which a pure renumber must never do; a hash
 * that VANISHES is a note that lost its wiring.
 *
 * The alternative criterion — "Generate CV produces identical bullets" — needs a
 * paid Opus run per lead and proves less, since it exercises one lead's path
 * rather than every step's prompt.
 *
 *   npx tsx scripts/snapshot-step-prompts.ts
 */
import './_env';
import { createHash } from 'node:crypto';
import { loadedSteps, loadStepNote, composeSystemPrompt } from '../lib/prompts';

async function main() {
  const steps = loadedSteps().sort();
  const rows: string[] = [];
  for (const step of steps) {
    // Normalise line endings before hashing. `core.autocrlf=true` + `* text=auto`
    // means a note's WORKING COPY is CRLF in a fresh checkout and LF wherever the
    // owner has re-saved it from Obsidian, while the committed blob is always LF.
    // Without this the same commit hashes differently in two trees — which it did:
    // the first baseline was captured against a mixed main tree, so 3 of its 11
    // rows carried CRLF hashes and a linked worktree "failed" 8 of 11 against it
    // with no content difference at all. Hash the committed content, not the
    // checkout's accidents.
    const note = (await loadStepNote(step)).replace(/\r\n/g, '\n');
    // Strip the marker line the renumber legitimately rewrites, so what is
    // hashed is the note text alone.
    const body = composeSystemPrompt(step, note).replace(/--- STEP PROCEDURE \([^)]*\) ---/, '--- STEP PROCEDURE ---');
    const hash = createHash('sha256').update(body, 'utf8').digest('hex').slice(0, 16);
    rows.push(`${step.padEnd(12)} ${hash}  ${String(note.length).padStart(6)} bytes`);
  }
  console.log(rows.join('\n'));
  console.log(`\n${steps.length} steps loaded as system prompts.`);
  process.exit(0);
}

main();
