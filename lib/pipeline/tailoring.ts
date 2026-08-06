/**
 * C1–C7 tailoring. Two human-gated halves:
 *   runEvidenceMapping  → C1 (format) + C2 (requirement→evidence, builds on B6
 *                         rather than re-deriving — CI-034 — pending review)
 *   ── human approves the whole map in one action ──
 *   generateCv          → C3 (bullets, Keep only) → C4 skills → C5 profile →
 *                         C6 .docx → C7 ATS rating
 *
 * The LLM emits judgments (C2 mapping, C3 bullets, C5 profile, C7 rating); code
 * enforces the gate, the content budget and the skills consistency rule. Every
 * LLM step has a deterministic mock so the pipeline still runs without a key.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import {
  jobLeads,
  jobRequirements,
  requirementTailoring,
  requirementEvidence,
  bulletBank,
  skillsMaster,
  starActions,
  starCompetences,
  starAttributes,
  responsibilities,
  education,
  languages,
  profiles,
  cvVariants,
} from '../db/schema';
import { recordStep, type StepReport } from './runs';
import { writeBuffer } from '../storage';
import { buildCv, type CvModel } from '../docx/cv';
import { systemPromptFor } from '../prompts';
import { runStructured, type UserContentBlock } from '../llm/client';
import { C2, C3, C5, C7 } from '../llm/schemas';
import { CV_SLOTS, normalizeCvPosition, slotCode, templateExists, buildCvFromTemplate } from '../docx/template';
import { evidenceNeedsCvSlot } from '../cv-slots';
import { recordGapTips } from '../ci';
import { matchStrengthToScore } from '../scoring';
import { candidateFactsSummary } from '../profile-context';

export const CORE_AND_IMPORTANT: string[] = ['Core', 'Important'];

const tokens = (s: string): Set<string> => new Set((s || '').toLowerCase().match(/[a-z]{4,}/g) ?? []);
const overlap = (a: Set<string>, b: Set<string>): number => {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
};

function headshotDecision(city: string | null): string {
  const dei = ['amsterdam', 'copenhagen', 'london', 'dublin', 'toronto', 'rotterdam'];
  return city && dei.includes(city.toLowerCase()) ? 'Do not include (D&I norm)' : 'Optional (lean exclude)';
}

/** One evidence candidate the LLM may cite, keyed by its stable ref code. */
export type Evidence = { ref: string; kind: string; text: string; skills: string[]; cvPosition: string | null; source: string | null };

/**
 * C2's user message, as a pure builder — same reasoning as the B-step builders in
 * `screening.ts`: `scripts/backtest-notes.ts` must send what production sends, or
 * it certifies a prompt that is never used.
 *
 * Two blocks: the evidence graph is owner-wide and lead-independent — identical
 * for every lead tailored in the same sitting — so it gets its own 1h cache
 * breakpoint; the per-lead role and requirements follow as the varying suffix.
 *
 * CI · Make C2 Build on B6 Instead of Re-Deriving the Map §2.1 — `numberedReqs`
 * is now the TARGETED subset only (B6's Good/Weak/No Match tiers; Excellent/Very
 * Strong requirements are carried forward without a model call at all, see
 * `runEvidenceMapping`). Each entry optionally carries `b6Pick`, the initial
 * screen's own evidence for that requirement, so a `Good`-tier ask reads as
 * "beat this if you can" rather than starting blind — the anchoring is the
 * targeting signal, not a contaminant (§2.1).
 */
export function c2UserMessage(
  evidence: Evidence[],
  leadTitle: string,
  company: string | null,
  numberedReqs: [number, { rank: string | null; requirement: string; b6Pick?: string | null }][],
  candidateFacts?: string | null
): UserContentBlock[] {
  return [
    {
      type: 'text',
      text: `CANDIDATE EVIDENCE (cite by exact ref code):\n` + evidence.map((e) => `[${e.ref}] (${e.kind}) ${e.text}`).join('\n'),
      cache_control: { type: 'ephemeral', ttl: '1h' },
    },
    {
      type: 'text',
      text:
        (candidateFacts ? `CANDIDATE FACTS (fixed, not skill evidence — weigh for eligibility-type requirements):\n${candidateFacts}\n\n` : '') +
        `ROLE: ${leadTitle}${company ? ` · ${company}` : ''}\n\n` +
        `REQUIREMENTS (map each by its number) — this is only the subset the initial screen rated Good, Weak or ` +
        `No Match; anything already rated Excellent or Very Strong is carried forward untouched and not sent here:\n` +
        numberedReqs
          .map(([n, q]) => `${n}. [${q.rank}] ${q.requirement}` + (q.b6Pick ? `\n   Initial screen found: ${q.b6Pick} — only report a link here if you can genuinely beat it.` : ''))
          .join('\n') +
        `\n\nCV POSITION SLOTS — set each link's cvPosition to the best-matching label:\n` +
        CV_SLOTS.map((s) => `- ${s}`).join('\n') +
        `\n\nFor each requirement, list every genuinely strongest piece of evidence — one link per ref, several where ` +
        `several honestly apply, ranked strongest first — and assign each its own cvPosition slot. If none honestly fits, list it under gaps.`,
    },
  ];
}

/** B6's per-requirement matchStrength decides how hard C2 digs (CI · Make C2
 *  Build on B6 §2.1). `carry`: transpose B6's evidence, no model call. `improve`:
 *  ask the model to beat B6's pick, falling back to it if nothing beats it.
 *  `dig`: the untargeted full search this step has always done. */
export type MatchTier = 'carry' | 'improve' | 'dig';
export function tierFor(matchStrength: string | null): MatchTier {
  if (matchStrength === 'Excellent' || matchStrength === 'Very Strong') return 'carry';
  if (matchStrength === 'Good') return 'improve';
  return 'dig'; // 'Weak' | 'No Match' | null (never judged by B6)
}

/**
 * Recover the matchStrength label C2 stamped at the head of a stored row's
 * `connectionToExpertise` (`"<matchStrength>[ · <connection>]"`), so a re-run's
 * merge can compare against it without a dedicated column. `null` if the text
 * doesn't start with a recognised label (e.g. a legacy row from before this CI).
 */
export function storedMatchStrength(connectionToExpertise: string | null): string | null {
  if (!connectionToExpertise) return null;
  const head = connectionToExpertise.split(' · ')[0]?.trim();
  return head && matchStrengthToScore(head) != null ? head : null;
}

/** One evidence link C2 is proposing to write, fully resolved — no re-lookup
 *  needed at write time, so a B6 ref that has since dropped out of the live
 *  evidence graph still carries B6's own snapshot rather than throwing. */
export type ProposedLink = {
  requirementId: string;
  evidenceRef: string;
  matchStrength: string;
  connection: string | null;
  cvPosition: string | null;
  evidenceText: string;
  evidenceKind: string | null;
  mySkills: string[];
  provSource: string;
};

/**
 * CI · Make C2 Build on B6 §2.2 — the owner's replacement rule, implemented
 * directly: a stored `(requirementId, evidenceRef)` row is replaced only when
 * the newly proposed evidence scores STRICTLY higher on the shared ordinal
 * (`matchStrengthToScore`). Not-stronger proposals and requirements the new run
 * is silent on are left exactly as they were — silence is not a verdict, and an
 * unparseable stored score (pre-CI row) counts as the lowest score so a labelled
 * pick can still improve on it.
 *
 * §2.3 addendum, decided 2026-08-05: "silence is not a verdict" protects a
 * HUMAN decision (green/yellow/red) from being erased by a re-run. It was
 * never meant to protect a `pending` row nobody has looked at — the pre-CI era
 * wrote exactly those (delete-then-replace, one row per requirement, searched
 * over the wrong evidence entirely), and leaving them stranded forever pending
 * would both clutter the Map and let "Approve entire map" Keep leftover
 * pre-CI guesses alongside the real B6-derived evidence. So a stored row is
 * pruned when ALL of: still `pending`, its requirement is one this run
 * actually covers (never touch a row outside `coveredReqIds` — out of scope,
 * not evaluated), and no proposal this run named its exact
 * `(requirementId, evidenceRef)` pair. A row carrying a real verdict is never
 * a deletion candidate, full stop.
 */
export function planMerge(
  proposed: ProposedLink[],
  existing: {
    id: string;
    requirementId: string | null;
    evidenceRef: string | null;
    connectionToExpertise: string | null;
    approvalStatus: string;
    evidenceKind?: string | null;
  }[],
  coveredReqIds: Set<string>
): {
  toInsert: ProposedLink[];
  toReplace: { id: string; link: ProposedLink }[];
  toRefresh: { id: string; link: ProposedLink }[];
  toDelete: string[];
  unchanged: number;
} {
  const byKey = new Map<string, (typeof existing)[number]>();
  for (const e of existing) {
    if (e.requirementId && e.evidenceRef) byKey.set(`${e.requirementId}::${e.evidenceRef}`, e);
  }
  const proposedKeys = new Set(proposed.map((p) => `${p.requirementId}::${p.evidenceRef}`));
  const toInsert: ProposedLink[] = [];
  const toReplace: { id: string; link: ProposedLink }[] = [];
  const toRefresh: { id: string; link: ProposedLink }[] = [];
  let unchanged = 0;
  for (const link of proposed) {
    const row = byKey.get(`${link.requirementId}::${link.evidenceRef}`);
    if (!row) {
      toInsert.push(link);
      continue;
    }
    const newScore = matchStrengthToScore(link.matchStrength) ?? -1;
    const oldScore = matchStrengthToScore(storedMatchStrength(row.connectionToExpertise)) ?? -1;
    if (newScore > oldScore) {
      toReplace.push({ id: row.id, link });
      continue;
    }
    // Not stronger — the stored connection/matchStrength text and any human
    // verdict stay exactly as they are (that's the whole point of "unchanged").
    // But purely descriptive metadata that was never part of that verdict —
    // which kind of evidence this is — can otherwise go stale forever: a row
    // written before `evidence_kind` existed re-matches the same evidence on
    // every future run, is judged "unchanged" every time, and so never picks
    // up the column at all. Backfill it here rather than leaving it NULL
    // indefinitely; nothing about the approval state is touched.
    if (row.evidenceKind == null && link.evidenceKind != null) {
      toRefresh.push({ id: row.id, link });
    } else {
      unchanged++;
    }
  }
  const toDelete = existing
    .filter((e) => e.requirementId && e.evidenceRef)
    .filter((e) => e.approvalStatus === 'pending')
    .filter((e) => e.requirementId && coveredReqIds.has(e.requirementId))
    .filter((e) => !proposedKeys.has(`${e.requirementId}::${e.evidenceRef}`))
    .map((e) => e.id);
  return { toInsert, toReplace, toRefresh, toDelete, unchanged };
}

/**
 * ── C3's collapse floor, as pure functions ──────────────────────────────────
 *
 * Exported and separated from the DB write for the same reason `matchB6Judgments`
 * is: the interesting behaviour is "what counts as an answer", and that has to be
 * testable without Postgres or an API key.
 */
export type C3Bullet = { ref: string; bullet: string; skills?: string[] };

/**
 * Fold one C3 reply into the ref→bullet map, accumulating across re-asks so a
 * second attempt only has to cover what the first missed.
 *
 * A blank `bullet` is deliberately NOT an answer. `bullet` is required in the
 * strict schema, so a degraded call returns the key holding `""` — recording that
 * would satisfy the floor with nothing in it, which is the `placeholder` failure
 * this CI measured on C2 wearing a different hat.
 */
export function absorbC3Bullets(
  into: Map<string, { bullet: string; skills: string[] }>,
  bullets: C3Bullet[]
): Map<string, { bullet: string; skills: string[] }> {
  for (const b of bullets) {
    if (b.ref && b.bullet && b.bullet.trim()) into.set(b.ref, { bullet: b.bullet.trim(), skills: b.skills ?? [] });
  }
  return into;
}

/**
 * The Keep rows C3 owes a bullet for and hasn't delivered.
 *
 * Rows with no `evidenceRef` are excluded on purpose — C3 is keyed by ref, so it
 * was never given a way to answer them, and counting them would make the floor
 * unsatisfiable rather than strict. Duplicate refs collapse to one.
 */
export function missingC3Refs(
  green: { evidenceRef: string | null }[],
  have: Map<string, unknown>
): string[] {
  const wanted = new Set(green.map((g) => g.evidenceRef).filter((ref): ref is string => !!ref));
  return [...wanted].filter((ref) => !have.has(ref));
}

/**
 * ── C5's collapse floor ──────────────────────────────────────────────────────
 *
 * `profile` is required in the strict schema, so a degraded call returns the
 * key holding `""` — schema-valid, `status='ok'`, and from there the empty
 * string reaches the .docx (blank Profile section) and C7 (rating a CV whose
 * profile section says nothing). `Process/C5...md` and the tool description
 * both specify 4–7 lines / 70–110 words; `MIN_PROFILE_WORDS` sits well under
 * that target so ordinary variation never trips it, while still catching a
 * one-line stub. Unlike C3's floor, a profile is a single value rather than a
 * set keyed by ref, so nothing needs to accumulate across re-asks — the last
 * attempt either clears the bar or it doesn't.
 */
export const MIN_PROFILE_WORDS = 40;

export function isProfileTooShort(profile: string): boolean {
  return profile.trim().split(/\s+/).filter(Boolean).length < MIN_PROFILE_WORDS;
}

/** Map an evidence node's source to the tailoring row's provenance label (M7 proof trail). */
function provFromSource(source: string | null | undefined): string {
  return source === 'ai_coached' ? 'coached' : 'imported';
}

/** Gather the owner's whole evidence graph (not just the bullet bank) for C2 to map against. */
export async function gatherEvidence(ownerId: string): Promise<Evidence[]> {
  const [acts, resps, bullets, edu, langs] = await Promise.all([
    db.select().from(starActions).where(eq(starActions.ownerId, ownerId)),
    db.select().from(responsibilities).where(eq(responsibilities.ownerId, ownerId)),
    db.select().from(bulletBank).where(eq(bulletBank.ownerId, ownerId)),
    db.select().from(education).where(eq(education.ownerId, ownerId)),
    db.select().from(languages).where(eq(languages.ownerId, ownerId)),
  ]);
  const out: Evidence[] = [];
  for (const a of acts) if (a.refCode && a.text) out.push({ ref: a.refCode, kind: 'STAR action', text: a.text, skills: a.skills ?? [], cvPosition: null, source: a.source });
  for (const r of resps) if (r.refCode && r.text) out.push({ ref: r.refCode, kind: 'Responsibility', text: r.text, skills: r.skills ?? [], cvPosition: normalizeCvPosition(`${r.positionRef ?? ''}0`), source: r.source });
  for (const b of bullets) if (b.refCode && b.text) out.push({ ref: b.refCode, kind: 'Bullet', text: b.text, skills: b.tags ?? [], cvPosition: normalizeCvPosition(b.cvPosition), source: b.source });
  for (const e of edu) if (e.refCode) out.push({ ref: e.refCode, kind: 'Education', text: [e.qualification, e.institution, e.year].filter(Boolean).join(', '), skills: [], cvPosition: null, source: e.source });
  for (const l of langs) if (l.refCode) out.push({ ref: l.refCode, kind: 'Language', text: `${l.language} (${l.cefrLevel})`, skills: [], cvPosition: null, source: l.source });
  return out;
}

/** Whether the real Word template can faithfully represent this Keep set —
 *  i.e. every Kept row that NEEDS one of the 11 fixed slots has one. Education/
 *  Language rows are exempt (`evidenceNeedsCvSlot`) — they render from the
 *  profile tables regardless, never from a slot. If a genuinely slotless row
 *  remains (a STAR action nobody assigned a slot to, or a non-seed tenant whose
 *  roles don't match these slots), C6 falls back to the programmatic builder,
 *  which represents any evidence. */
function templateFits(green: (typeof requirementTailoring.$inferSelect)[]): boolean {
  return (
    green.length > 0 &&
    green.every((g) => !evidenceNeedsCvSlot(g.evidenceKind) || normalizeCvPosition(g.cvPosition))
  );
}

/** Map Keep bullets into the template's 11 cv_position slots, refilling any slot
 *  the Keep set doesn't cover from the bank (projects) / responsibilities
 *  (role overviews) so the real 2-page template never renders a blank section. */
async function templateSlotData(
  ownerId: string,
  green: (typeof requirementTailoring.$inferSelect)[],
  bulletByRef: Map<string, { bullet: string; skills: string[] }>,
  profileText: string,
  profile?: { citizenship: string | null; relocation: string | null; travel: string | null } | null
): Promise<Record<string, string>> {
  const [bank, resps] = await Promise.all([
    db.select().from(bulletBank).where(eq(bulletBank.ownerId, ownerId)),
    db.select().from(responsibilities).where(eq(responsibilities.ownerId, ownerId)),
  ]);
  // The tailored C5 profile fills the template's <<Profile>> placeholder, so the
  // .docx leads with role-specific positioning rather than the static scaffold.
  // (Skills remain the template's curated thematic block — making them role-dynamic
  // needs the skill_category taxonomy; see ROADMAP P6.)
  const data: Record<string, string> = {};
  if (profileText) data['Profile'] = profileText;
  // Forward-compatible: these keys do nothing until the owner adds matching
  // `<<Citizenship>>`/`<<Relocation>>`/`<<Travel>>` tags to their own
  // Group CVs/CV_Template.docx (gitignored, outside this codebase) —
  // docxtemplater's nullGetter silently ignores unused data keys.
  if (profile?.citizenship) data['Citizenship'] = profile.citizenship;
  if (profile?.relocation) data['Relocation'] = profile.relocation;
  if (profile?.travel) data['Travel'] = profile.travel;
  for (const slot of CV_SLOTS) {
    const code = slotCode(slot);
    const letter = code[0];
    const isOverview = code.endsWith('0');
    let lines = green
      .filter((g) => {
        const normalized = normalizeCvPosition(g.cvPosition);
        return normalized === slot || (normalized ? slotCode(normalized) === code : false);
      })
      // The `|| g.originalText` tail stays a backstop here on purpose. This is a
      // RENDER path, not a write path: C3's floor already guarantees a real
      // bullet for every ref-bearing Keep row before anything reaches the .docx,
      // and throwing at render time would block a CV that is otherwise complete.
      // Same reasoning for `bullets14` in the programmatic builder below.
      .map((g) => (g.evidenceRef && bulletByRef.get(g.evidenceRef)?.bullet) || g.cvBullet || g.originalText || '')
      .filter(Boolean);
    if (lines.length === 0) {
      // Fallback so the section isn't blank: curated bank bullets for a project
      // slot, or the position's responsibilities for a role-overview slot.
      lines = isOverview
        ? resps.filter((r) => (r.positionRef ?? '') === letter).slice(0, 2).map((r) => r.text ?? '').filter(Boolean)
        : bank.filter((b) => slotCode(b.cvPosition ?? '') === code).map((b) => b.text ?? '').filter(Boolean);
    }
    // Trim a trailing period: the template already prints "<<…>>." so content
    // ending in "." would otherwise double up.
    data[slot] = lines.join(isOverview ? ' ' : '\n').replace(/\.\s*$/, '');
  }
  return data;
}

// ── C1 + C2 ──────────────────────────────────────────────────────────────────
export async function runEvidenceMapping(leadId: string, ownerId?: string | null): Promise<StepReport[]> {
  const [lead] = await db
    .select()
    .from(jobLeads)
    .where(ownerId ? and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, ownerId)) : eq(jobLeads.id, leadId));
  if (!lead) throw new Error('Lead not found');
  const effectiveOwnerId = ownerId ?? lead.ownerId;
  const reports: StepReport[] = [];
  const reqs = (
    await db
      .select()
      .from(jobRequirements)
      .where(and(eq(jobRequirements.jobLeadId, leadId), eq(jobRequirements.ownerId, effectiveOwnerId)))
  ).filter((r) => CORE_AND_IMPORTANT.includes(r.rank ?? ''));
  if (reqs.length === 0) {
    throw new Error('No Core or Important requirements have been extracted for this lead yet. Re-run screening first, then map evidence.');
  }

  // C1 — format & headshot decision
  {
    const t = Date.now();
    const headshot = headshotDecision(lead.city);
    reports.push(await recordStep(leadId, { step: 'C1', label: 'Format & compliance', model: 'code', summary: `Headshot: ${headshot}`, output: { headshot }, ms: Date.now() - t }, effectiveOwnerId));
  }

  // C2 — build on B6 rather than re-deriving (CI · Make C2 Build on B6 Instead
  // of Re-Deriving the Map). No wholesale delete: a re-run MERGES into whatever
  // is already stored, so a prior human review survives (§2.3) and a re-run
  // that only digs on the weak spots costs only what it actually improves.
  {
    const evidence = await gatherEvidence(effectiveOwnerId);
    const byRef = new Map(evidence.map((e) => [e.ref, e]));
    const reqById = new Map(reqs.map((q) => [q.id, q]));
    const [c2Profile] = await db.select().from(profiles).where(eq(profiles.ownerId, effectiveOwnerId)).limit(1);
    const candidateFacts = candidateFactsSummary(c2Profile);
    // Stable requirement numbering shared with the LLM.
    const reqByOrder = new Map<number, (typeof reqs)[number]>();
    reqs.forEach((q, i) => reqByOrder.set(q.requirementOrder ?? i + 1, q));

    const b6Rows = await db
      .select()
      .from(requirementEvidence)
      .where(and(eq(requirementEvidence.jobLeadId, leadId), eq(requirementEvidence.ownerId, effectiveOwnerId)));
    const b6ByReq = new Map<string, typeof b6Rows>();
    for (const row of b6Rows) {
      if (!b6ByReq.has(row.requirementId)) b6ByReq.set(row.requirementId, []);
      b6ByReq.get(row.requirementId)!.push(row);
    }

    const existingRows = await db
      .select()
      .from(requirementTailoring)
      .where(and(eq(requirementTailoring.jobLeadId, leadId), eq(requirementTailoring.ownerId, effectiveOwnerId)));

    // §2.1 — B6's own matchStrength decides where C2 spends model effort. `tiers`
    // is mutable: a requirement B6 rated Excellent/Very Strong but left with no
    // evidence row at all (shouldn't happen — resolveEvidenceLinks only drops
    // unknown refs — but never trust a claim with nothing behind it) falls
    // through to the deep pass rather than silently producing nothing.
    const tiers = new Map<number, MatchTier>();
    for (const [order, req] of reqByOrder) tiers.set(order, tierFor(req.initialMatchStrength));

    const proposed: ProposedLink[] = [];

    // Carry EVERY requirement's B6 evidence forward first, regardless of tier —
    // this is what makes C2 unable to produce a result worse than the initial
    // screen already found, which is the defect this CI exists to fix. No model
    // call for it: it's a direct transposition of `requirement_evidence`.
    for (const [order, req] of reqByOrder) {
      const rows = b6ByReq.get(req.id) ?? [];
      for (const row of rows) {
        const ev = byRef.get(row.evidenceRef);
        proposed.push({
          requirementId: req.id,
          evidenceRef: row.evidenceRef,
          matchStrength: req.initialMatchStrength ?? 'Weak',
          connection: row.note ?? 'Carried forward from the initial screen (B6).',
          cvPosition: row.cvPosition,
          // Prefer the live graph's text/skills (an edited bullet since B6 ran);
          // fall back to B6's own snapshot if the ref has since dropped out of
          // the graph rather than throwing on a stale citation.
          evidenceText: ev?.text ?? row.evidenceText ?? '',
          evidenceKind: ev?.kind ?? row.evidenceKind ?? null,
          mySkills: ev?.skills ?? [],
          provSource: provFromSource(ev?.source ?? null),
        });
      }
      // A requirement B6 rated Excellent/Very Strong but left with nothing
      // behind it has no claim to carry — treat it as unscored instead.
      if (tiers.get(order) === 'carry' && rows.length === 0) tiers.set(order, 'dig');
    }

    // Improve/dig tier — only the requirements B6 rated Good, Weak or No Match
    // (or never scored at all) reach the model, to ADD candidates on top of
    // whatever B6 already found above; Excellent/Very Strong are never re-asked
    // (marginal effort-to-score ratio doesn't pay — owner's objective, CI §1.3).
    // The prompt shrinks with them.
    const targeted = [...reqByOrder.entries()].filter(([order]) => tiers.get(order) !== 'carry');
    let gaps: { order?: number; requirement?: string | null; note: string }[] = [];
    let modelUsed = 'code (carried from B6)';
    let ms = 0;

    if (targeted.length > 0) {
      const b6PickText = (req: (typeof reqs)[number]): string | null => {
        const rows = b6ByReq.get(req.id) ?? [];
        if (rows.length === 0) return null;
        return rows.map((r) => `[${r.evidenceRef}] ${r.evidenceText ?? ''}`.trim()).join('; ') + ` (rated ${req.initialMatchStrength})`;
      };
      const r = await runStructured({
        step: 'C2',
        // Truthfulness-critical (Master Instructions §6.1) → Opus tier.
        model: 'opus',
        system: await systemPromptFor('C2', effectiveOwnerId),
        user: c2UserMessage(
          evidence,
          lead.title,
          lead.company ?? null,
          targeted.map(
            ([n, q]): [number, { rank: string | null; requirement: string; b6Pick: string | null }] => [
              n,
              { rank: q.rank, requirement: q.requirement, b6Pick: b6PickText(q) },
            ]
          ),
          candidateFacts
        ),
        tool: C2.tool,
        zod: C2.zod,
        mock: () => mockEvidenceMap(targeted, evidence),
        leadId,
        ownerId: effectiveOwnerId,
      });

      for (const link of r.data.links) {
        const req = reqByOrder.get(link.order);
        const ev = link.evidenceRef ? byRef.get(link.evidenceRef) : undefined;
        if (!req || !ev) continue;
        proposed.push({
          requirementId: req.id,
          evidenceRef: ev.ref,
          matchStrength: link.matchStrength,
          connection: link.connection ?? null,
          // `||`, not `??`: cvPosition is required in the strict schema now, so an
          // unmatched slot arrives as "" rather than absent, and `??` would let
          // that empty string beat the evidence node's own slot.
          cvPosition: normalizeCvPosition(link.cvPosition || ev.cvPosition),
          evidenceText: ev.text,
          evidenceKind: ev.kind,
          mySkills: ev.skills,
          provSource: provFromSource(ev.source),
        });
      }
      gaps = r.data.gaps ?? [];
      modelUsed = r.model;
      ms = r.ms;
    }
    // Idempotent either way: clears prior gap tips even on a run that targeted
    // nothing (every requirement carried), which is correctly zero gaps.
    await recordGapTips(leadId, effectiveOwnerId, gaps);

    // De-dup within this run's own proposals (carry + improve fallback can both
    // propose the same ref for the same requirement).
    const seenKeys = new Set<string>();
    const dedupedProposed = proposed.filter((p) => {
      const key = `${p.requirementId}::${p.evidenceRef}`;
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });

    // §2.2 — replace only where new evidence scores strictly higher; insert what's
    // new; leave everything a human has actually decided on alone regardless of
    // whether this run mentions it. §2.3 addendum — an untouched row that is
    // STILL PENDING (nobody has decided anything about it) is fair game for
    // pruning; see planMerge's docstring.
    const processedReqIds = new Set(reqById.keys());
    const { toInsert, toReplace, toRefresh, toDelete, unchanged } = planMerge(dedupedProposed, existingRows, processedReqIds);

    if (toInsert.length) {
      await db.insert(requirementTailoring).values(
        toInsert.map((link) => {
          const req = reqById.get(link.requirementId)!;
          return {
            ownerId: effectiveOwnerId,
            jobLeadId: leadId,
            requirementId: req.id,
            leadTitle: lead.title,
            requirementLine: `${req.requirementOrder} · ${req.rank} · ${req.requirement}`,
            connectionToExpertise: `${link.matchStrength}${link.connection ? ` · ${link.connection}` : ''}`,
            evidenceRef: link.evidenceRef,
            originalText: link.evidenceText,
            evidenceKind: link.evidenceKind,
            cvPosition: link.cvPosition,
            // My Skills: the evidence's own vocabulary. Requirement Skills: the
            // matched requirement's JD-language skills (B5 output) — CI · Requirement
            // Skills vs My Skills. Never conflate either with B4's AoE codes (A–Q).
            mySkills: link.mySkills,
            requirementSkills: req.skills ?? [],
            provSource: link.provSource,
            approvalStatus: 'pending' as const,
          };
        })
      );
    }
    // §2.3 — only a genuinely replaced row resets to pending; the evidence
    // changed, so the judgement has to be made again.
    for (const { id, link } of toReplace) {
      await db
        .update(requirementTailoring)
        .set({
          connectionToExpertise: `${link.matchStrength}${link.connection ? ` · ${link.connection}` : ''}`,
          originalText: link.evidenceText,
          evidenceKind: link.evidenceKind,
          cvPosition: link.cvPosition,
          mySkills: link.mySkills,
          provSource: link.provSource,
          approvalStatus: 'pending',
          approvedAt: null,
        })
        .where(and(eq(requirementTailoring.id, id), eq(requirementTailoring.ownerId, effectiveOwnerId)));
    }
    // Backfill-only: a row that matched again but didn't score higher keeps its
    // stored connection/matchStrength and approval state untouched — only the
    // descriptive evidence_kind gets patched in, and only when it was missing.
    for (const { id, link } of toRefresh) {
      await db
        .update(requirementTailoring)
        .set({ evidenceKind: link.evidenceKind })
        .where(and(eq(requirementTailoring.id, id), eq(requirementTailoring.ownerId, effectiveOwnerId)));
    }
    // Prune untouched pre-CI leftovers — never a row carrying a real verdict;
    // planMerge already restricted this to `pending` rows this run was silent on.
    if (toDelete.length) {
      await db
        .delete(requirementTailoring)
        .where(and(inArray(requirementTailoring.id, toDelete), eq(requirementTailoring.ownerId, effectiveOwnerId)));
    }
    await db.update(jobLeads).set({ status: 'tailoring' }).where(and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, effectiveOwnerId)));

    // True gap count across ALL requirements, not just the ones sent to the
    // model this run: a requirement with neither a surviving stored row nor a
    // fresh proposal has nothing behind it, carry-tier included. Pruned rows
    // are excluded — they no longer exist after the delete above.
    const deletedIds = new Set(toDelete);
    const coveredReqIds = new Set<string>([
      ...existingRows.filter((r) => !deletedIds.has(r.id)).map((r) => r.requirementId).filter((id): id is string => !!id),
      ...dedupedProposed.map((p) => p.requirementId),
    ]);
    const gapCount = reqs.filter((q) => !coveredReqIds.has(q.id)).length;
    reports.push(
      await recordStep(leadId, {
        step: 'C2',
        label: 'Map requirements → evidence',
        model: modelUsed,
        summary:
          `${toInsert.length} new · ${toReplace.length} improved · ${unchanged} unchanged · ${toDelete.length} pruned · ` +
          `${gapCount} gap${gapCount === 1 ? '' : 's'} · pending review`,
        output: { inserted: toInsert.length, replaced: toReplace.length, unchanged, pruned: toDelete.length, gaps: gapCount },
        ms,
      }, effectiveOwnerId)
    );
  }
  return reports;
}

// ── C3–C7 (Keep evidence only) ───────────────────────────────────────────────
export async function generateCv(
  leadId: string,
  ownerId?: string | null
): Promise<{ reports: StepReport[]; atsRating: number; cvPath: string }> {
  const [lead] = await db
    .select()
    .from(jobLeads)
    .where(ownerId ? and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, ownerId)) : eq(jobLeads.id, leadId));
  if (!lead) throw new Error('Lead not found');
  const effectiveOwnerId = ownerId ?? lead.ownerId;
  const [profile] = await db.select().from(profiles).where(eq(profiles.ownerId, effectiveOwnerId)).limit(1);
  const reports: StepReport[] = [];

  const green = await db
    .select()
    .from(requirementTailoring)
    .where(
      and(
        eq(requirementTailoring.jobLeadId, leadId),
        eq(requirementTailoring.ownerId, effectiveOwnerId),
        eq(requirementTailoring.approvalStatus, 'green')
      )
    );
  if (green.length === 0) throw new Error('No Keep evidence — keep at least one row before generating.');

  const reqs = await db
    .select()
    .from(jobRequirements)
    .where(and(eq(jobRequirements.jobLeadId, leadId), eq(jobRequirements.ownerId, effectiveOwnerId)));
  const coreThemes = reqs.filter((r) => r.rank === 'Core').slice(0, 4).map((r) => r.requirement);

  // C3 — rewrite each Keep evidence item into a tailored CV bullet
  const bulletByRef = new Map<string, { bullet: string; skills: string[] }>();
  {
    // ── The C3 collapse guard ────────────────────────────────────────────────
    // This write path used to read `matched?.bullet || row.originalText || ''`,
    // which is the same silent-substitution shape B6 had before its guard
    // (`j?.score ?? 6`) and B2 had before its floor. When C3 returned no bullet
    // for a ref — a degraded call, or a ref echoed back in a form that doesn't
    // match — `cv_bullet` was filled with the row's RAW, untailored evidence
    // text. Nothing errors, nothing is empty, the lead shows a complete set of
    // bullets and the .docx renders. The only symptom is that the CV says the
    // candidate's generic evidence rather than anything tailored to this job,
    // which is the one thing the C phase exists to produce.
    //
    // Same lesson as the B6 CI, and as this CI's own C2 measurement: a complete
    // `required` list fixes the generation, it cannot make the VALUE meaningful,
    // and the count of rows written is never what breaks.
    //
    // The floor is exact rather than proportional, like B6's and unlike C2's:
    // C3 is handed a known, finite list of Keep rows and told to rewrite each
    // one. There is no legitimate "I decline to rewrite this one" outcome — C2
    // is the step allowed to record a gap, not C3 — so anything short of one
    // bullet per ref is a misfire. Rows with no `evidenceRef` at all are
    // excluded: C3 was never given a key to answer them with.
    const ATTEMPTS = 3;
    const refsWanted = new Set(green.map((g) => g.evidenceRef).filter((ref): ref is string => !!ref));

    const draft = async () =>
      runStructured({
        step: 'C3',
        // Truthfulness-critical (Master Instructions §6.1) → Opus tier.
        model: 'opus',
        system: await systemPromptFor('C3', effectiveOwnerId),
        user:
          `ROLE: ${lead.title}${lead.jdGroupPrimary ? ` · ${lead.jdGroupPrimary}` : ''}` +
          `${lead.atsSystem ? ` · ATS: ${lead.atsSystem}` : ''}\n\n` +
          `Rewrite each Keep evidence item into one CV bullet. Keep every claim supportable by the original text.\n\n` +
          green
            .map((g) => `[${g.evidenceRef}] requirement: ${g.requirementLine}\n   original: ${g.originalText}\n   my skills: ${(g.mySkills ?? []).join(', ')}`)
            .join('\n\n'),
        tool: C3.tool,
        zod: C3.zod,
        // The mock stands in for a HEALTHY call, so it must clear the floor: a
        // row whose `originalText` is null (legacy/seeded data) would otherwise
        // yield a blank bullet and trip the guard with no model involved.
        mock: () => ({
          bullets: green.map((g) => ({
            ref: g.evidenceRef ?? '',
            bullet: g.originalText?.trim() || `Delivered work evidenced by ${g.evidenceRef ?? 'this item'}.`,
            skills: g.requirementSkills ?? g.mySkills ?? [],
          })),
        }),
        leadId,
        ownerId: effectiveOwnerId,
      });

    // r.data.bullets[].skills is C3's judgment of which Job-Lead-facing skills
    // this bullet demonstrates — i.e. Requirement Skills, not My Skills (the
    // bracketed tag per Process/C3...md §B.5). Persist it; previously discarded.
    //
    // Re-asks accumulate into the same map, so a second attempt only has to
    // cover what the first missed — a partial reply is still worth its refs.
    let r = await draft();
    absorbC3Bullets(bulletByRef, r.data.bullets);
    for (let attempt = 2; attempt <= ATTEMPTS && missingC3Refs(green, bulletByRef).length > 0; attempt++) {
      r = await draft();
      absorbC3Bullets(bulletByRef, r.data.bullets);
    }
    const short = missingC3Refs(green, bulletByRef);
    if (short.length > 0) {
      throw new Error(
        `C3 returned no bullet for ${short.length} of ${refsWanted.size} Keep evidence item(s) ` +
          `after ${ATTEMPTS} attempts (${short.slice(0, 5).join(', ')}${short.length > 5 ? ', …' : ''}) — ` +
          'the model call degraded rather than the evidence genuinely being unusable. Nothing was written; ' +
          're-run Generate CV to retry. Falling back to the raw evidence text here would have produced a ' +
          'complete-looking CV built from untailored bullets.'
      );
    }

    for (const row of green) {
      const matched = row.evidenceRef ? bulletByRef.get(row.evidenceRef) : undefined;
      // `|| row.originalText` survives only for rows with no `evidenceRef`, which
      // the floor above deliberately does not cover. For every ref-bearing row
      // `matched` is now guaranteed non-blank, so this is a backstop, not a path.
      const rewritten = matched?.bullet || row.originalText || '';
      await db
        .update(requirementTailoring)
        .set({ cvBullet: rewritten, requirementSkills: matched?.skills ?? row.requirementSkills ?? [] })
        .where(and(eq(requirementTailoring.id, row.id), eq(requirementTailoring.ownerId, effectiveOwnerId)));
    }
    // Past the floor every ref-bearing Keep row has a real bullet, so this count
    // is now a fact rather than `r.data.bullets.length`, which reported whatever
    // the last reply happened to contain.
    reports.push(await recordStep(leadId, { step: 'C3', label: 'Draft CV bullets', model: r.model, summary: `${refsWanted.size} Keep item(s) rewritten`, output: { count: refsWanted.size }, ms: r.ms }, effectiveOwnerId));
  }

  // C4 — skills section. CI · Requirement Skills vs My Skills: the primary
  // source is now the Keep-gated rows' My Skills (single source of truth +
  // consistency rule — every skill a Keep bullet is tagged with goes in,
  // unconditionally), topped up with a requirement-overlap ranking across the
  // profile's Skills, STAR Competences and STAR Attributes tables. All three
  // count as "Skills" on the CV — Job Descriptions don't distinguish them,
  // even though the profile tables do (per Reggie's clarification on this CI).
  let skillsModel: CvModel['skills'] = [];
  {
    const t = Date.now();
    const reqTokens = tokens(reqs.map((r) => `${r.requirement} ${(r.skills ?? []).join(' ')}`).join(' '));
    const [skills, competences, attributes] = await Promise.all([
      db.select().from(skillsMaster).where(eq(skillsMaster.ownerId, effectiveOwnerId)),
      db.select().from(starCompetences).where(eq(starCompetences.ownerId, effectiveOwnerId)),
      db.select().from(starAttributes).where(eq(starAttributes.ownerId, effectiveOwnerId)),
    ]);
    // Unified candidate vocabulary (name → proficiency + ATS variants, when
    // known) so ranking/categorisation works the same regardless of which
    // profile table a name came from.
    type Candidate = { name: string; proficiency: string | null; atsTokens: string };
    const known = new Map<string, Candidate>();
    for (const s of skills) if (s.skill) known.set(s.skill.toLowerCase(), { name: s.skill, proficiency: s.proficiency, atsTokens: (s.atsKeywordVariants ?? []).join(' ') });
    for (const c of competences) if (c.competence && !known.has(c.competence.toLowerCase())) known.set(c.competence.toLowerCase(), { name: c.competence, proficiency: null, atsTokens: '' });
    for (const a of attributes) if (a.attribute && !known.has(a.attribute.toLowerCase())) known.set(a.attribute.toLowerCase(), { name: a.attribute, proficiency: null, atsTokens: '' });

    const byCat = new Map<string, string[]>();
    const inList = new Set<string>();
    const push = (cat: string, name: string) => {
      const key = name.toLowerCase();
      if (inList.has(key)) return;
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat)!.push(name);
      inList.add(key);
    };
    const catFor = (name: string) => ((known.get(name.toLowerCase())?.proficiency ?? '').toLowerCase().includes('expert') ? 'Expert' : 'Proficient');

    // Consistency rule (mandatory, uncapped): every My Skills tag on a Keep row
    // must appear in the top Skills List.
    for (const g of green) for (const name of g.mySkills ?? []) push(catFor(name), name);

    // Top up with a requirement-overlap ranking across the known vocabulary,
    // capped so the section stays scannable (Process/C4...md: 3–5 categories
    // × 4–8 skills).
    const TARGET = 12;
    const ranked = [...known.values()]
      .filter((c) => !inList.has(c.name.toLowerCase()))
      .map((c) => ({ c, score: overlap(reqTokens, tokens(`${c.name} ${c.atsTokens}`)) }))
      .sort((a, b) => b.score - a.score);
    for (const { c } of ranked) {
      if (inList.size >= TARGET) break;
      push(catFor(c.name), c.name);
    }

    skillsModel = [...byCat.entries()].map(([category, items]) => ({ category, items }));
    reports.push(await recordStep(leadId, { step: 'C4', label: 'Skills section', model: 'code', summary: `${inList.size} skills · ${skillsModel.length} groups`, output: { groups: skillsModel.length }, ms: Date.now() - t }, effectiveOwnerId));
  }

  // C5 — tailored profile (4–7 lines, supportable by the evidence)
  let profileText = '';
  {
    // `|| g.cvBullet` was missing here, which made this the one read path that
    // could still feed C5 raw evidence text even when C3 had produced a real
    // bullet for the row — and an untailored bullet here doesn't just degrade
    // one line, it becomes the basis of the tailored profile. C3's floor above
    // now guarantees a bullet for every ref-bearing row, so the `originalText`
    // tail is a backstop for ref-less rows rather than a substitution path.
    const keptBullets = green
      .map((g) => (g.evidenceRef && bulletByRef.get(g.evidenceRef)?.bullet) || g.cvBullet || g.originalText || '')
      .filter(Boolean);

    // ── The C5 collapse guard ─────────────────────────────────────────────────
    // Same family as C3's, but simpler: `profile` is a single value, not a set
    // keyed by ref, so an empty or one-line reply is never a legitimate answer —
    // the honest floor is never "nothing". Re-ask rather than lower the bar
    // (`runStructured`'s own retry can't fire — `""` is schema-valid), and throw
    // rather than degrade — C6 and C7 both consume `profileText`, and shipping a
    // CV with a blank profile and then rating it is worse than failing loudly.
    const ATTEMPTS = 3;
    const draft = async () =>
      runStructured({
        step: 'C5',
        // Truthfulness-critical (Master Instructions §6.1) → Opus tier.
        model: 'opus',
        system: await systemPromptFor('C5', effectiveOwnerId),
        user:
          `ROLE: ${lead.title}${lead.company ? ` · ${lead.company}` : ''}${lead.jdGroupPrimary ? ` · ${lead.jdGroupPrimary}` : ''}\n` +
          `CANDIDATE HEADLINE: ${profile?.headline ?? 'Senior leader'}\n\n` +
          `THIS ROLE'S CORE REQUIREMENTS:\n${coreThemes.map((t) => `- ${t}`).join('\n')}\n\n` +
          `KEEP EVIDENCE (the profile must stay supportable by these):\n${keptBullets.slice(0, 10).map((b) => `- ${b}`).join('\n')}\n\n` +
          `Write the tailored profile.`,
        tool: C5.tool,
        zod: C5.zod,
        // The mock stands in for a HEALTHY call, so it must clear the floor on
        // its own — the static tail guarantees enough words regardless of how
        // short `coreThemes`/`headline`/`jdGroupPrimary` happen to be.
        mock: () => ({
          profile:
            `${profile?.headline ?? 'Senior leader'}. Strong fit for this ${lead.jdGroupPrimary ?? 'senior'} role` +
            `${coreThemes.length ? `, with proven delivery across ${coreThemes.slice(0, 3).join(', ').toLowerCase()}` : ''}. ` +
            `An accomplished senior leader with a consistent record of translating strategy into delivery, and a ` +
            `history of building trust with stakeholders at every level across complex, matrixed organisations. ` +
            `Recognised for combining commercial judgement with hands-on execution, for developing high-performing ` +
            `teams, and for consistently exceeding targets under sustained pressure while maintaining strong ` +
            `stakeholder relationships throughout each engagement.`,
        }),
        leadId,
        ownerId: effectiveOwnerId,
      });

    let r = await draft();
    for (let attempt = 2; attempt <= ATTEMPTS && isProfileTooShort(r.data.profile); attempt++) r = await draft();
    if (isProfileTooShort(r.data.profile)) {
      const words = r.data.profile.trim().split(/\s+/).filter(Boolean).length;
      throw new Error(
        `C5 returned a ${words}-word profile after ${ATTEMPTS} attempts (target 70–110 words) — the model call ` +
          'degraded rather than the evidence genuinely being unusable. Nothing was written; re-run Generate CV to retry.'
      );
    }
    profileText = r.data.profile.trim();
    reports.push(await recordStep(leadId, { step: 'C5', label: 'Tailored profile', model: r.model, summary: `${profileText.split(/\s+/).length} words`, output: { len: profileText.length, profile: profileText }, ms: r.ms }, effectiveOwnerId));
  }

  // C6 — compile the .docx. Preferred path fills the owner's real 2-page Word
  // template (docxtemplater); programmatic build is the fallback if the template
  // is missing or fails to render.
  let cvPath = '';
  const bullets14 = green.map((g) => g.cvBullet ?? g.originalText ?? '').filter(Boolean).slice(0, 14);
  {
    const t = Date.now();
    const eduRows = await db.select().from(education).where(eq(education.ownerId, effectiveOwnerId));
    const langRows = await db.select().from(languages).where(eq(languages.ownerId, effectiveOwnerId));
    const model: CvModel = {
      name: profile?.name ?? 'Candidate',
      contact: [profile?.location, profile?.email, profile?.citizenship, profile?.relocation, profile?.travel]
        .filter(Boolean)
        .join(' · '),
      profile: profileText,
      skills: skillsModel,
      experience: [{ heading: 'Selected Achievements', bullets: bullets14 }],
      education: eduRows.map((e) => [e.qualification, e.institution, e.year].filter(Boolean).join(', ')).filter(Boolean),
      languages: langRows.map((l) => `${l.language} (${l.cefrLevel})`),
    };

    // Use the real Word template only when it exists AND faithfully represents
    // this Keep set; otherwise build the layout programmatically (which handles
    // any evidence, any tenant). Nothing is ever stranded.
    let buf: Buffer;
    let how: string;
    try {
      if (!templateExists()) throw new Error('template not found');
      if (!templateFits(green)) throw new Error('Keep set has evidence outside the template slots');
      buf = buildCvFromTemplate(await templateSlotData(effectiveOwnerId, green, bulletByRef, profileText, profile));
      how = 'real template';
    } catch (e) {
      buf = await buildCv(model);
      how = `programmatic (${e instanceof Error ? e.message : 'fallback'})`;
    }
    cvPath = `cv-output/${leadId}/tailored.docx`;
    await writeBuffer(cvPath, buf);
    reports.push(await recordStep(leadId, { step: 'C6', label: 'Compile 2-page CV', model: 'code', summary: `${bullets14.length} Keep bullets · ${how}`, output: { cvPath, how }, ms: Date.now() - t }, effectiveOwnerId));
  }

  // C7 — reviewed ATS rating (LLM judgment; code persists)
  let atsRating = 0;
  {
    const coreImp = reqs.filter((r) => CORE_AND_IMPORTANT.includes(r.rank ?? ''));
    const r = await runStructured({
      step: 'C7',
      model: 'opus',
      system: await systemPromptFor('C7', effectiveOwnerId),
      user:
        `JOB REQUIREMENTS:\n${reqs.map((q, i) => `${i + 1}. [${q.rank}] ${q.requirement}`).join('\n')}\n\n` +
        `TAILORED CV\nProfile: ${profileText}\n\nSkills: ${skillsModel.map((s) => `${s.category}: ${s.items.join(', ')}`).join(' | ')}\n\n` +
        `Experience bullets:\n${bullets14.map((b) => `- ${b}`).join('\n')}\n\n` +
        `Rate how well this CV addresses the requirements through an ATS lens.`,
      tool: C7.tool,
      zod: C7.zod,
      mock: () => {
        const coverage = Math.min(1, green.length / Math.max(coreImp.length, 1));
        return {
          overall: Math.round(40 + coverage * 55 + (lead.atsSystem ? 5 : 0)),
          requirements: coreImp.slice(0, 8).map((q) => ({ requirement: q.requirement, score: Math.round(coverage * 100), matchStrength: 'Good' as const })),
          summary: 'Mock ATS rating from Keep-evidence coverage.',
        };
      },
      leadId,
      ownerId: effectiveOwnerId,
    });
    atsRating = Math.round(r.data.overall);
    await db.update(jobLeads).set({ status: 'ready' }).where(and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, effectiveOwnerId)));
    reports.push(await recordStep(leadId, { step: 'C7', label: 'ATS matching rating', model: r.model, summary: `${atsRating} / 100`, output: { atsRating, requirements: r.data.requirements, summary: r.data.summary }, ms: r.ms }, effectiveOwnerId));
  }

  // Materialise the B4 JD-group into the CV-variant catalogue: the generated CV
  // is recorded as a variant focused on this role's JD group(s) (idempotent).
  {
    const focus = [lead.jdGroupPrimary, lead.jdGroupSecondary].filter((x): x is string => !!x);
    await db.delete(cvVariants).where(and(eq(cvVariants.storagePath, cvPath), eq(cvVariants.ownerId, effectiveOwnerId)));
    await db.insert(cvVariants).values({
      ownerId: effectiveOwnerId,
      name: `${lead.title}${lead.company ? ` — ${lead.company}` : ''}`,
      focusJdGroups: focus,
      storagePath: cvPath,
      description: `ATS ${atsRating}/100${lead.jdGroupPrimary ? ` · ${lead.jdGroupPrimary}` : ''}`,
    });
  }

  return { reports, atsRating, cvPath };
}

// ── Mock heuristic for C2 (deterministic; whole-graph token overlap) ─────────
// CI · Make C2 Build on B6 §2.7 — must cope with a TIERED, targeted requirement
// set (only what `runEvidenceMapping` actually sends it) and return several
// ranked links per requirement, on the same 5-band scale B6 uses.
function mockEvidenceMap(reqEntries: [number, { requirement: string; rank: string | null; skills: string[] | null }][], evidence: Evidence[]) {
  const links: { order: number; evidenceRef: string; matchStrength: string; connection: string; cvPosition: string | null }[] = [];
  const gaps: { order: number; requirement: string; note: string }[] = [];
  for (const [order, req] of reqEntries) {
    const rt = tokens(`${req.requirement} ${(req.skills ?? []).join(' ')}`);
    const ranked = evidence
      .map((e) => ({ e, score: overlap(rt, tokens(`${e.text} ${e.skills.join(' ')}`)) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2); // ranked, top 2 — exercises the multi-row path in mock mode too
    if (ranked.length === 0) {
      gaps.push({ order, requirement: req.requirement, note: 'No strong evidence match' });
      continue;
    }
    for (const { e, score } of ranked) {
      links.push({
        order,
        evidenceRef: e.ref,
        matchStrength: score >= 5 ? 'Excellent' : score >= 3 ? 'Very Strong' : score >= 2 ? 'Good' : 'Weak',
        connection: `Shared focus on ${[...tokens(req.requirement)].slice(0, 3).join(', ')}`,
        cvPosition: e.cvPosition,
      });
    }
  }
  return { links, gaps };
}
