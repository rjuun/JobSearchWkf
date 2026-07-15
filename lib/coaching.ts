/**
 * O3 · Coaching — code computes the enrichment opportunities (no LLM needed).
 *
 * The highest-value coaching for senior profiles is drawing out the impact they under-tell.
 * From the Career Graph we deterministically find: stories with no quantified result, skills with
 * no ATS keyword variants, and positions with no summary — and phrase a targeted question for each.
 * The user's answer becomes real evidence (tagged source='ai_coached').
 */
import type { CareerGraph } from './career-graph';

export type EnrichmentKind = 'metric' | 'ats' | 'summary';

export type EnrichmentTarget = {
  id: string;
  kind: EnrichmentKind;
  title: string;
  question: string;
  hint: string;
  context?: string;
  /** uuid of the node to update (ats / summary) */
  rowId: string;
  /** story ref_code to attach a new result to (metric) */
  starRef?: string;
};

const has = (s: string | null | undefined) => !!s && s.trim().length > 0;

export function enrichmentTargets(g: CareerGraph): EnrichmentTarget[] {
  const out: EnrichmentTarget[] = [];

  const resultsByStar = new Map<string, typeof g.results>();
  for (const r of g.results) {
    const k = r.starRef ?? '';
    (resultsByStar.get(k) ?? resultsByStar.set(k, []).get(k)!).push(r);
  }
  const actionsByStar = new Map<string, typeof g.actions>();
  for (const a of g.actions) {
    const k = a.starRef ?? '';
    (actionsByStar.get(k) ?? actionsByStar.set(k, []).get(k)!).push(a);
  }

  // 1 · stories with no quantified result
  for (const s of g.stars) {
    const results = resultsByStar.get(s.refCode ?? '') ?? [];
    if (results.some((r) => has(r.metric))) continue;
    const firstAction = (actionsByStar.get(s.refCode ?? '') ?? [])[0];
    out.push({
      id: `metric:${s.id}`,
      kind: 'metric',
      title: s.title ?? 'this story',
      question: `What was the measurable impact of "${s.title}"?`,
      hint: 'A number makes it land — cost saved, time, headcount, %. Only if it’s real.',
      context: firstAction?.text ?? s.summary ?? undefined,
      rowId: s.id,
      starRef: s.refCode ?? undefined,
    });
  }

  // 2 · skills with no ATS keyword variants
  for (const sk of g.skills) {
    if ((sk.atsKeywordVariants ?? []).length > 0) continue;
    out.push({
      id: `ats:${sk.id}`,
      kind: 'ats',
      title: sk.skill ?? 'this skill',
      question: `How else might a job ad phrase "${sk.skill}"?`,
      hint: 'ATS keyword variants let tailoring mirror the JD wording — only when genuinely yours.',
      rowId: sk.id,
    });
  }

  // 3 · positions with no summary
  for (const p of g.positions) {
    if (has(p.summary)) continue;
    out.push({
      id: `summary:${p.id}`,
      kind: 'summary',
      title: p.title ?? 'this role',
      question: `In one line, what did you own as ${p.title ?? 'this role'}${p.company ? ` at ${p.company}` : ''}?`,
      hint: 'Scope and ownership — the headline of the role.',
      rowId: p.id,
    });
  }

  return out;
}

/**
 * B3 sometimes records a dimension it checked and found fine ("City: Amsterdam
 * (Primary — no misalignment)", severity 'none'). Such entries aren't real gaps,
 * so neither the screening-gap coach engine nor the workspace bridge should dress
 * them up as one. Shared (pure) so the server engine and the client workspace agree.
 *
 * Trust B3's structured `severity` when it's present ('none' = benign). Only fall
 * back to text when it isn't — and with a CONSERVATIVE regex: no bare "aligned"
 * (it lives inside "misaligned" and matches "not aligned") and no bare
 * "acceptable" (matches "not acceptable") — both would suppress genuine gaps.
 */
const BENIGN_MISALIGNMENT =
  /\bno\s+(misalign|issue|concern|mismatch|gap)|\bnone\b|\bn\/?a\b|not a (problem|concern)|within (the )?(window|range|target)/i;
export function isBenignMisalignment(
  dimension: string | null | undefined,
  detail: string | null | undefined,
  severity?: string | null
): boolean {
  if (severity != null && severity !== '') return severity.toLowerCase() === 'none';
  return BENIGN_MISALIGNMENT.test(`${dimension ?? ''} ${detail ?? ''}`);
}

/** Pull the first number-ish token from a coaching answer (for a result's metric). Never invents. */
export function extractMetric(answer: string): string | null {
  const m = answer.match(/\b\d+([.,]\d+)?\s*(%|percent|k\b|m\b|bn|million|billion|people|fte|months?|weeks?|days?|countries|eur|usd|\$|€)?/i);
  return m ? m[0].trim() : null;
}
