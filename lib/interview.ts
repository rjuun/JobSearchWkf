/**
 * R1 · Interview Armament (board #2c/#3c) — the pure projection behind the
 * night-before brief. It invents nothing: it re-projects the C2 evidence mapping
 * (`requirement_tailoring`) and the JD requirements the lead already holds into
 * the *next* moment after the download — the interview.
 *
 * Deterministic by contract (the model never touches this): proof points are the
 * evidence you *kept* (green), probes are the role's must-haves (Core/Important),
 * bridges are the honest thin spots (Weak/No Match/Partial), and "left out, on
 * purpose" are the drops you dropped — an answer kept ready, not faked onto the CV.
 *
 * The inline teaser in `workspace.tsx` shows a capped preview of the same shape;
 * this builder returns the *full* set for the dedicated `/leads/[id]/brief` surface.
 */

/** Minimal structural inputs — kept free of Drizzle row types so this is unit-testable. */
export type BriefReq = {
  requirement: string;
  rank: string | null;
  description: string | null;
  initialMatchStrength: string | null;
};
export type BriefTailoring = {
  requirementLine: string | null;
  cvBullet: string | null;
  originalText: string | null;
  evidenceRef: string | null;
  connectionToExpertise: string | null;
  approvalStatus: string; // pending | green | yellow | red
};

export type ProofPoint = { bullet: string; ref: string | null; connection: string | null };
export type Probe = { requirement: string; rank: string; description: string | null };
export type Bridge = { requirement: string; strength: string };
export type LeftOut = { requirement: string; note: string };

export type InterviewBrief = {
  proofPoints: ProofPoint[];
  probes: Probe[];
  bridges: Bridge[];
  leftOut: LeftOut[];
  graphLesson: string;
  counts: { proof: number; probe: number; bridge: number; leftOut: number };
};

/** Match strengths that need an honest bridge prepared rather than a proof point. */
const WEAK = new Set(['Weak', 'No Match', 'Partial']);

/** Loose key for matching a requirement's text against a tailoring row's requirementLine. */
const reqKey = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase();

/**
 * One honest, deterministic line on "what this taught your graph" — never
 * congratulatory filler; it names the thin spots when there are any.
 */
export function graphLessonLine(proof: number, bridge: number): string {
  if (proof === 0) return 'Keep evidence onto this CV first — then this brief fills in.';
  const pp = `${proof} proof point${proof === 1 ? '' : 's'}`;
  if (bridge === 0) {
    return `This tailoring drew on ${pp} already in your graph — the role's must-haves are covered.`;
  }
  const bb = `${bridge} requirement${bridge === 1 ? '' : 's'}`;
  return `This tailoring drew on ${pp} and surfaced ${bb} your graph is still thin on — worth an evidence pass before the call.`;
}

/** Project the lead's requirements + tailoring into the full interview brief. */
export function buildInterviewBrief(reqs: BriefReq[], rows: BriefTailoring[]): InterviewBrief {
  const proofPoints: ProofPoint[] = rows
    .filter((r) => r.approvalStatus === 'green' && (r.cvBullet ?? r.requirementLine))
    .map((r) => ({
      bullet: (r.cvBullet ?? r.requirementLine) as string,
      ref: r.evidenceRef ?? null,
      connection: r.connectionToExpertise ?? null,
    }));

  const probes: Probe[] = reqs
    .filter((r) => r.rank === 'Core' || r.rank === 'Important')
    .map((r) => ({ requirement: r.requirement, rank: r.rank as string, description: r.description ?? null }));

  // Requirements the user has since *kept* green evidence for (in C2). A weak initial
  // match that's now backed by kept evidence is no longer a thin spot — surfacing it as
  // a bridge would contradict its own proof point, so it's excluded from the honest gaps.
  const covered = new Set(
    rows.filter((r) => r.approvalStatus === 'green' && r.requirementLine).map((r) => reqKey(r.requirementLine))
  );
  const bridges: Bridge[] = reqs
    .filter((r) => WEAK.has(r.initialMatchStrength ?? '') && !covered.has(reqKey(r.requirement)))
    .map((r) => ({ requirement: r.requirement, strength: r.initialMatchStrength as string }));

  const leftOut: LeftOut[] = rows
    .filter((r) => r.approvalStatus === 'red' && (r.originalText || r.cvBullet))
    .map((r) => ({
      requirement: r.requirementLine ?? 'A requirement',
      note: (r.originalText ?? r.cvBullet) as string,
    }));

  return {
    proofPoints,
    probes,
    bridges,
    leftOut,
    graphLesson: graphLessonLine(proofPoints.length, bridges.length),
    counts: {
      proof: proofPoints.length,
      probe: probes.length,
      bridge: bridges.length,
      leftOut: leftOut.length,
    },
  };
}
