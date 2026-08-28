export const CV_SLOTS = [
  'Professional Experience - A0. Role Overview',
  'Professional Experience - A1. Outsourcing Framework Project',
  'Professional Experience - A2. Governance Transformation Project',
  'Professional Experience - A3. BBAG Wind Down Project',
  'Professional Experience - B0. Role Overview',
  'Professional Experience - B1. Accounting Correction Layer Project',
  'Professional Experience - B2. Transfer Pricing',
  'Professional Experience - C0. Role Overview',
  'Professional Experience - C1. BBSA Merger Project',
  'Professional Experience - D0. Role Overview',
  'Professional Experience - D1. Servicing Center Project',
] as const;

export type CvSlot = (typeof CV_SLOTS)[number];

/**
 * The heading above a position's project bullets.
 *
 * `"Key Project(s):"` on the owner's instruction, 2026-08-28 — three of his four
 * positions carry a single project, and a plural heading over one item read
 * wrongly on every one of them.
 *
 * The WORDS live in the template, inside the `<<#Position … Key Projects>>` loop
 * that decides whether the heading prints at all; `templateSlotData` fills that
 * loop with a one-element array purely as a conditional. This constant exists so
 * the two cannot drift — `scripts/set-key-projects-caption.ts` writes it into the
 * template, and the pipeline measures the same string when it costs the section
 * in rendered lines. Change it here, then run that script.
 */
export const KEY_PROJECTS_CAPTION = 'Key Project(s):';

const SLOT_BY_CODE = new Map(CV_SLOTS.map((slot) => [slotCode(slot), slot]));
const SLOT_SET = new Set<string>(CV_SLOTS);

export function slotCode(slot: string): string {
  return slot.toUpperCase().match(/[A-D][0-9]/)?.[0] ?? slot;
}

export function normalizeCvPosition(value: string | null | undefined): CvSlot | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  if (SLOT_SET.has(raw)) return raw as CvSlot;
  const upper = raw.toUpperCase();
  return SLOT_BY_CODE.get(upper) ?? SLOT_BY_CODE.get(slotCode(upper)) ?? null;
}

/**
 * `CV_SLOTS` has no Education or Language entry — those sections render in the
 * CV straight from the `education`/`languages` profile tables, unconditional of
 * Keep status (see `generateCv` in `lib/pipeline/tailoring.ts`). So a row whose
 * evidence is Education/Language kind was never going to get a `cvPosition`,
 * and gating its approval on one is a mismatched check, not a genuine
 * unresolved slot — unlike a STAR action or Responsibility, which really is
 * blocked until something (today: nothing; needs a manual picker) assigns it
 * one of the 11 real slots. `kind === null` (legacy rows written before this
 * distinction existed) is treated as "needs a slot" — the stricter, pre-
 * existing behaviour, so nothing that used to be blocked silently unblocks.
 */
export function evidenceNeedsCvSlot(kind: string | null): boolean {
  return kind !== 'Education' && kind !== 'Language';
}

/** Which position a slot belongs to — the `A`–`D` of its code. */
export function slotPositionLetter(slot: string): string {
  return slotCode(slot)[0] ?? '';
}

/** A role-overview slot (`A0`) rather than a project slot (`A1`). The two render
 *  differently — an overview is prose in one paragraph, a project is a list. */
export function isRoleOverviewSlot(slot: string): boolean {
  return slotCode(slot).endsWith('0');
}

/**
 * The project's own name, without the slot's code — `"Outsourcing Framework
 * Project"`.
 *
 * The caption printed above a project's bullets used to be STATIC text in the
 * template ("1. Outsourcing Framework Project"), which is why an empty project
 * slot could not simply render nothing: the caption stayed, announcing a project
 * with no bullets under it. That is the whole reason `templateSlotData` refilled
 * empty slots from the bullet bank, and therefore the reason the CV could not be
 * shortened. The caption is now supplied as data and numbered over the projects
 * that actually have content, so a slot with no selected evidence disappears
 * whole — caption included. See CI · C7 Space Rules Are Specified and Never
 * Enforced §2.3.
 */
export function slotProjectName(slot: string): string {
  return slot.replace(/^.*?[A-D][0-9]\.\s*/, '').trim();
}
