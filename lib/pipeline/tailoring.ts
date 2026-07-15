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
import { runStructured } from '../llm/client';
import { C2, C3, C5, C7 } from '../llm/schemas';
import { CV_SLOTS, normalizeCvPosition, slotCode, templateExists, buildCvFromTemplate } from '../docx/template';
import { recordGapTips } from '../ci';

const CORE_AND_IMPORTANT: string[] = ['Core', 'Important'];

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
type Evidence = { ref: string; kind: string; text: string; skills: string[]; cvPosition: string | null; source: string | null };

/** Map an evidence node's source to the tailoring row's provenance label (M7 proof trail). */
function provFromSource(source: string | null | undefined): string {
  return source === 'ai_coached' ? 'coached' : 'imported';
}

/** Gather the owner's whole evidence graph (not just the bullet bank) for C2 to map against. */
async function gatherEvidence(ownerId: string): Promise<Evidence[]> {
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
      model: 'sonnet',
      system: await systemPromptFor('C2', effectiveOwnerId),
      user:
        `ROLE: ${lead.title}${lead.company ? ` · ${lead.company}` : ''}\n\n` +
        `REQUIREMENTS (map each by its number):\n` +
        [...reqByOrder.entries()].map(([n, q]) => `${n}. [${q.rank}] ${q.requirement}`).join('\n') +
        `\n\nCANDIDATE EVIDENCE (cite by exact ref code):\n` +
        evidence.map((e) => `[${e.ref}] (${e.kind}) ${e.text}`).join('\n') +
        `\n\nCV POSITION SLOTS — set each link's cvPosition to the best-matching label:\n` +
        CV_SLOTS.map((s) => `- ${s}`).join('\n') +
        `\n\nFor each requirement pick the single strongest evidence ref and assign its cvPosition slot. If none honestly fits, list it under gaps.`,
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
        cvPosition: normalizeCvPosition(link.cvPosition ?? ev.cvPosition),
        actualSkills: ev.skills,
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
    const r = await runStructured({
      step: 'C3',
      model: 'sonnet',
      system: await systemPromptFor('C3', effectiveOwnerId),
      user:
        `ROLE: ${lead.title}${lead.jdGroupPrimary ? ` · ${lead.jdGroupPrimary}` : ''}` +
        `${lead.atsSystem ? ` · ATS: ${lead.atsSystem}` : ''}\n\n` +
        `Rewrite each Keep evidence item into one CV bullet. Keep every claim supportable by the original text.\n\n` +
        green
          .map((g) => `[${g.evidenceRef}] requirement: ${g.requirementLine}\n   original: ${g.originalText}\n   skills: ${(g.actualSkills ?? []).join(', ')}`)
          .join('\n\n'),
      tool: C3.tool,
      zod: C3.zod,
      mock: () => ({ bullets: green.map((g) => ({ ref: g.evidenceRef ?? '', bullet: g.originalText ?? '', skills: g.actualSkills ?? [] })) }),
      leadId,
      ownerId: effectiveOwnerId,
    });
    for (const b of r.data.bullets) if (b.ref) bulletByRef.set(b.ref, { bullet: b.bullet, skills: b.skills ?? [] });
    for (const row of green) {
      const rewritten = (row.evidenceRef && bulletByRef.get(row.evidenceRef)?.bullet) || row.originalText || '';
      await db
        .update(requirementTailoring)
        .set({ cvBullet: rewritten })
        .where(and(eq(requirementTailoring.id, row.id), eq(requirementTailoring.ownerId, effectiveOwnerId)));
    }
    reports.push(await recordStep(leadId, { step: 'C3', label: 'Draft CV bullets', model: r.model, summary: `${r.data.bullets.length} bullets rewritten from Keep evidence`, output: { count: r.data.bullets.length }, ms: r.ms }, effectiveOwnerId));
  }

  // C4 — skills section: top skills by requirement overlap, PLUS every skill used
  // in a bullet (the methodology's consistency rule), grouped by proficiency.
  let skillsModel: CvModel['skills'] = [];
  {
    const t = Date.now();
    const reqTokens = tokens(reqs.map((r) => `${r.requirement} ${(r.skills ?? []).join(' ')}`).join(' '));
    const skills = await db.select().from(skillsMaster).where(eq(skillsMaster.ownerId, effectiveOwnerId));
    const ranked = skills
      .map((s) => ({ s, score: overlap(reqTokens, tokens(`${s.skill ?? ''} ${(s.atsKeywordVariants ?? []).join(' ')}`)) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
    const byCat = new Map<string, string[]>();
    const push = (cat: string, name: string) => {
      if (!byCat.has(cat)) byCat.set(cat, []);
      const list = byCat.get(cat)!;
      if (!list.includes(name)) list.push(name);
    };
    for (const { s } of ranked) {
      if (!s.skill) continue;
      push((s.proficiency ?? '').toLowerCase().includes('expert') ? 'Expert' : 'Proficient', s.skill);
    }
    // Consistency rule: any skill named on a bullet must appear in the skills list.
    const known = new Set(skills.map((s) => (s.skill ?? '').toLowerCase()));
    const inList = new Set([...byCat.values()].flat().map((x) => x.toLowerCase()));
    for (const { skills: bs } of bulletByRef.values()) {
      for (const name of bs) {
        const key = name.toLowerCase();
        if (known.has(key) && !inList.has(key)) {
          push('Proficient', name);
          inList.add(key);
        }
      }
    }
    skillsModel = [...byCat.entries()].map(([category, items]) => ({ category, items }));
    reports.push(await recordStep(leadId, { step: 'C4', label: 'Skills section', model: 'code', summary: `${[...inList].length} skills · ${skillsModel.length} groups`, output: { groups: skillsModel.length }, ms: Date.now() - t }, effectiveOwnerId));
  }

  // C5 — tailored profile (4–7 lines, supportable by the evidence)
  let profileText = '';
  {
    const keptBullets = green.map((g) => (g.evidenceRef && bulletByRef.get(g.evidenceRef)?.bullet) || g.originalText || '').filter(Boolean);
    const r = await runStructured({
      step: 'C5',
      model: 'sonnet',
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
