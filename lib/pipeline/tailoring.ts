/**
 * C1–C7 tailoring. Two human-gated halves:
 *   runEvidenceMapping  → C1 (format) + C2 (requirement→evidence, pending review)
 *   ── human marks rows Keep / Maybe / Drop ──
 *   generateCv          → C3 (bullets, Keep only) → C4 skills → C5 profile →
 *                         C6 .docx → C7 ATS rating
 *
 * The LLM emits judgments (C2 mapping, C3 bullets, C5 profile, C7 rating); code
 * enforces the gate, the content budget and the skills consistency rule. Every
 * LLM step has a deterministic mock so the pipeline still runs without a key.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import {
  jobLeads,
  jobRequirements,
  requirementTailoring,
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
import { recordGapTips } from '../ci';

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
 */
export function c2UserMessage(
  evidence: Evidence[],
  leadTitle: string,
  company: string | null,
  numberedReqs: [number, { rank: string | null; requirement: string }][]
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
        `ROLE: ${leadTitle}${company ? ` · ${company}` : ''}\n\n` +
        `REQUIREMENTS (map each by its number):\n` +
        numberedReqs.map(([n, q]) => `${n}. [${q.rank}] ${q.requirement}`).join('\n') +
        `\n\nCV POSITION SLOTS — set each link's cvPosition to the best-matching label:\n` +
        CV_SLOTS.map((s) => `- ${s}`).join('\n') +
        `\n\nFor each requirement pick the single strongest evidence ref and assign its cvPosition slot. If none honestly fits, list it under gaps.`,
    },
  ];
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
 *  i.e. every Kept row maps to one of the 11 fixed slots. If not (slotless
 *  evidence, or a non-seed tenant whose roles don't match these slots), C6 falls
 *  back to the programmatic builder, which represents any evidence. */
function templateFits(green: (typeof requirementTailoring.$inferSelect)[]): boolean {
  return green.length > 0 && green.every((g) => normalizeCvPosition(g.cvPosition));
}

/** Map Keep bullets into the template's 11 cv_position slots, refilling any slot
 *  the Keep set doesn't cover from the bank (projects) / responsibilities
 *  (role overviews) so the real 2-page template never renders a blank section. */
async function templateSlotData(
  ownerId: string,
  green: (typeof requirementTailoring.$inferSelect)[],
  bulletByRef: Map<string, { bullet: string; skills: string[] }>,
  profileText: string
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

  // C2 — map every Core/Important requirement to its strongest evidence (pending review)
  {
    await db.delete(requirementTailoring).where(and(eq(requirementTailoring.jobLeadId, leadId), eq(requirementTailoring.ownerId, effectiveOwnerId)));
    const evidence = await gatherEvidence(effectiveOwnerId);
    const byRef = new Map(evidence.map((e) => [e.ref, e]));
    // Stable requirement numbering shared with the LLM.
    const reqByOrder = new Map<number, (typeof reqs)[number]>();
    reqs.forEach((q, i) => reqByOrder.set(q.requirementOrder ?? i + 1, q));

    const r = await runStructured({
      step: 'C2',
      // Truthfulness-critical (Master Instructions §6.1) → Opus tier.
      model: 'opus',
      system: await systemPromptFor('C2', effectiveOwnerId),
      user: c2UserMessage(evidence, lead.title, lead.company ?? null, [...reqByOrder.entries()]),
      tool: C2.tool,
      zod: C2.zod,
      mock: () => mockEvidenceMap([...reqByOrder.entries()], evidence),
      leadId,
      ownerId: effectiveOwnerId,
    });

    // Resolve refs → rows (one row per requirement; the LLM already picks the best).
    // Evidence that doesn't resolve to a template slot is still kept (cvPosition
    // null) — it stays Keepable and flows into the programmatic CV; it never
    // strands the requirement.
    const seen = new Set<number>();
    const rows = [];
    for (const link of r.data.links) {
      if (seen.has(link.order)) continue;
      const req = reqByOrder.get(link.order);
      const ev = link.evidenceRef ? byRef.get(link.evidenceRef) : undefined;
      if (!req || !ev) continue;
      seen.add(link.order);
      rows.push({
        ownerId: effectiveOwnerId,
        jobLeadId: leadId,
        requirementId: req.id,
        leadTitle: lead.title,
        requirementLine: `${link.order} · ${req.rank} · ${req.requirement}`,
        connectionToExpertise: `${link.matchStrength}${link.connection ? ` · ${link.connection}` : ''}`,
        evidenceRef: ev.ref,
        originalText: ev.text,
        // `||`, not `??`: cvPosition is required in the strict schema now, so an
        // unmatched slot arrives as "" rather than absent, and `??` would let
        // that empty string beat the evidence node's own slot.
        cvPosition: normalizeCvPosition(link.cvPosition || ev.cvPosition),
        // My Skills: the evidence's own vocabulary. Requirement Skills: the
        // matched requirement's JD-language skills (B5 output) — CI · Requirement
        // Skills vs My Skills. Never conflate either with B4's AoE codes (A–Q).
        mySkills: ev.skills,
        requirementSkills: req.skills ?? [],
        // M7 proof trail: stamp provenance from the matched evidence node's source so
        // coached evidence renders as "Coached", not the default "Imported".
        provSource: provFromSource(ev.source),
        approvalStatus: 'pending' as const,
      });
    }
    if (rows.length) await db.insert(requirementTailoring).values(rows);
    await db.update(jobLeads).set({ status: 'tailoring' }).where(and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, effectiveOwnerId)));
    // Close the CI loop: only genuinely unmatched requirements (the LLM's own
    // gaps) become Profile-Update tips that feed back into future step prompts.
    const gaps = r.data.gaps ?? [];
    await recordGapTips(leadId, effectiveOwnerId, gaps);
    const gapCount = gaps.length || Math.max(0, reqs.length - rows.length);
    reports.push(
      await recordStep(leadId, {
        step: 'C2',
        label: 'Map requirements → evidence',
        model: r.model,
        summary: `${rows.length} links · ${gapCount} gap${gapCount === 1 ? '' : 's'} · pending review`,
        output: { count: rows.length, gaps },
        ms: r.ms,
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
    const r = await runStructured({
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
      mock: () => ({
        profile: `${profile?.headline ?? 'Senior leader'}. Strong fit for this ${lead.jdGroupPrimary ?? 'senior'} role${coreThemes.length ? `, with proven delivery across ${coreThemes.slice(0, 3).join(', ').toLowerCase()}` : ''}.`,
      }),
      leadId,
      ownerId: effectiveOwnerId,
    });
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
      contact: [profile?.location, profile?.email].filter(Boolean).join(' · '),
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
      buf = buildCvFromTemplate(await templateSlotData(effectiveOwnerId, green, bulletByRef, profileText));
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
function mockEvidenceMap(reqEntries: [number, { requirement: string; rank: string | null; skills: string[] | null }][], evidence: Evidence[]) {
  const links: { order: number; evidenceRef: string; matchStrength: string; connection: string; cvPosition: string | null }[] = [];
  for (const [order, req] of reqEntries) {
    const rt = tokens(`${req.requirement} ${(req.skills ?? []).join(' ')}`);
    let best: Evidence | null = null;
    let bestScore = 0;
    for (const e of evidence) {
      const s = overlap(rt, tokens(`${e.text} ${e.skills.join(' ')}`));
      if (s > bestScore) {
        bestScore = s;
        best = e;
      }
    }
    if (best && bestScore > 0) {
      links.push({
        order,
        evidenceRef: best.ref,
        matchStrength: bestScore >= 4 ? 'Strong' : bestScore >= 2 ? 'Moderate' : 'Weak',
        connection: `Shared focus on ${[...tokens(req.requirement)].slice(0, 3).join(', ')}`,
        cvPosition: best.cvPosition,
      });
    }
  }
  return { links, gaps: reqEntries.filter(([o]) => !links.some((l) => l.order === o)).map(([order, req]) => ({ order, requirement: req.requirement, note: 'No strong evidence match' })) };
}
