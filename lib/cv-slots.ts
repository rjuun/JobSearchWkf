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
