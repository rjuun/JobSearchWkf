/**
 * Re-render a lead's CV from what a paid run already stored — no LLM calls, no
 * cost.
 *
 * Built for CI · CV Template Output Format, where every template change had to be
 * looked at on a real page and the only way to get one was to spend a full C1–C8
 * run. That is why the template was the least-verified part of the build. It is
 * also what makes re-templating a back catalogue of finished CVs affordable:
 * the content was already paid for, only the layout changed.
 *
 * WHAT IT REBUILDS, AND FROM WHERE
 *   • evidence rows, profile, positions, education, languages — the database
 *   • the tailored profile text — the latest stored C6 run's `output.profile`
 *   • the tailored bullets — `requirement_tailoring.cv_bullet`, written by C4
 *   • the Skills grouping — parsed back out of the previously rendered .docx
 *
 * THE ONE SEAM, AND WHY BACKUPS ARE NOT OPTIONAL
 * C5's step report stores category NAMES and item COUNTS but not the items, so
 * the merged Skills section cannot be read back from the database — **the
 * rendered document is the only surviving record of it.** Overwrite a CV without
 * keeping the old file and that lead's Skills grouping is gone for good, and only
 * a paid re-run can produce another. Callers that overwrite must back up first;
 * `regenerate-cvs.ts` does.
 */
import fs from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import PizZip from 'pizzip';
import { db } from '../db';
import { jobLeads, profiles, requirementTailoring, pipelineRuns } from '../db/schema';
import { buildCvFromTemplate, templateExists, TEMPLATE_PATH } from '../docx/template';
import { parseSkillGroups, skillsBlock, type SkillGroup } from '../docx/cv-skills';
import { capSkillGroups } from './skills';
import { templateSlotData } from './tailoring';

export type RerenderResult = {
  buffer: Buffer;
  leadId: string;
  title: string;
  company: string;
  city: string;
  /** Distinct evidence refs — one per printed bullet. NOT the green row count,
   *  which reads about a third high because one bullet answers several
   *  requirements. */
  bullets: number;
  skills: number;
  skillGroups: number;
  /** '' when C1 suppressed it. */
  relocation: string;
  headshot: boolean;
  warnings: string[];
};

/** Why a lead cannot be re-rendered from stored data. Thrown, so a batch can
 *  report it per lead and carry on with the rest. */
export class NotRerenderable extends Error {}

/**
 * Plain text of a .docx, one entry per VISIBLE line. A soft break counts as a
 * line ending, which matters here: the document being read back is usually one
 * written BEFORE the re-tag, where the whole Skills section lived inside a single
 * paragraph separated by `<w:br/>`. Ignoring those collapses five categories into
 * one. Deliberately not a general converter.
 */
export function docxLines(file: string): string[] {
  const xml = new PizZip(fs.readFileSync(file, 'binary')).file('word/document.xml')!.asText();
  return xml
    .split(/(?=<w:p[ >])/)
    .slice(1)
    .flatMap((p) =>
      [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>|<w:br\s*\/>/g)]
        .map((m) => (m[1] === undefined ? '\n' : m[1]))
        .join('')
        .split('\n')
    )
    .map((line) => line.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim());
}

/** The Skills grouping from a previously rendered CV. `lib/docx/cv-skills.ts`
 *  knows both layouts, and `verify-lead-run.ts` reads them the same way. */
export function skillsFromRenderedCv(file: string): SkillGroup[] {
  return parseSkillGroups(skillsBlock(docxLines(file)) ?? []);
}

export function storedCvPath(leadId: string): string {
  return path.resolve(process.cwd(), process.env.STORAGE_DIR ?? '.storage', 'cv-output', leadId, 'tailored.docx');
}

export async function rerenderCv(
  leadId: string,
  opts: {
    bulletCap?: number;
    /** Truncate the stored profile to N words before rendering. A MEASUREMENT
     *  handle, not a shipping feature: `PROFILE_WORDS.max` is derived from a
     *  character width, and a derived number has to be checked against a real
     *  page before it is believed. Truncation ends the prose mid-clause, which
     *  is fine — the question being asked is how many LINES N words occupy. */
    profileWords?: number;
    /** Re-shape the stored Skills section to `[categories, perCategory]` before
     *  rendering, so the line cost of a shape can be measured without a paid run
     *  producing it. Defaults to `SKILLS_CEILING`'s shape, which is what a
     *  re-rendered back-catalogue CV must obey like any other. */
    skillsShape?: [number, number];
  } = {}
): Promise<RerenderResult> {
  if (!templateExists()) throw new NotRerenderable(`Template not found at ${TEMPLATE_PATH}`);

  const [lead] = await db.select().from(jobLeads).where(eq(jobLeads.id, leadId));
  if (!lead) throw new NotRerenderable('no lead row — an orphaned storage folder');
  const ownerId = lead.ownerId;
  const warnings: string[] = [];

  const [profile] = await db.select().from(profiles).where(eq(profiles.ownerId, ownerId)).limit(1);

  // Same predicate as `loadGreenRows`, and the same `shortlistRank` gate C3 sets.
  const green = await db
    .select()
    .from(requirementTailoring)
    .where(and(eq(requirementTailoring.jobLeadId, leadId), eq(requirementTailoring.ownerId, ownerId), eq(requirementTailoring.approvalStatus, 'green')));
  let selected = green.filter((g) => g.shortlistRank != null);
  if (selected.length === 0) {
    // A lead whose CV predates C3. Its green rows carry C4 bullets but nothing
    // ever chose among them, so there is no set to re-render — and inventing one
    // here would be running C3 as a side effect of a re-render, which rewrites
    // the lead's selection state and clears the `cv_bullet` of everything it drops.
    throw new NotRerenderable(
      green.length
        ? `${green.length} green rows but no shortlist_rank — this CV predates C3. Run C3 (free) or re-run Generate CV.`
        : 'no green evidence rows'
    );
  }

  // §2.7's budget sweep — keep only the N highest-ranked distinct refs, which is
  // what `SELECTION_DEFAULTS.budget = N` would have chosen. Refs, not rows.
  if (opts.bulletCap) {
    const order = [...new Set([...selected].sort((a, b) => (a.shortlistRank ?? 0) - (b.shortlistRank ?? 0)).map((g) => g.evidenceRef ?? ''))].filter(Boolean);
    const keep = new Set(order.slice(0, opts.bulletCap));
    selected = selected.filter((g) => g.evidenceRef && keep.has(g.evidenceRef));
  }

  // C4's bullets survive on the rows themselves, so this rebuilds exactly.
  const bulletByRef = new Map<string, { bullet: string; skills: string[] }>();
  for (const g of green) {
    if (g.evidenceRef && g.cvBullet) bulletByRef.set(g.evidenceRef, { bullet: g.cvBullet, skills: g.cvBulletSkills ?? [] });
  }

  const runs = await db.select().from(pipelineRuns).where(and(eq(pipelineRuns.jobLeadId, leadId), eq(pipelineRuns.ownerId, ownerId)));
  const c6 = runs
    .filter((r) => r.step === 'C6')
    .sort((a, b) => (a.finishedAt?.getTime() ?? 0) - (b.finishedAt?.getTime() ?? 0))
    .pop();
  let profileText = String((c6?.output as { profile?: string } | null)?.profile ?? '');
  if (!profileText) throw new NotRerenderable('no stored C6 profile — nothing to put in the Profile section');
  if (opts.profileWords) profileText = profileText.trim().split(/\s+/).filter(Boolean).slice(0, opts.profileWords).join(' ');

  const previous = storedCvPath(leadId);
  const parsedSkills = fs.existsSync(previous) ? skillsFromRenderedCv(previous) : [];
  if (!parsedSkills.length) warnings.push('Skills unreadable from the previous render — the section will be EMPTY');
  // The stored section was produced under whatever budget was live when the run
  // was paid for, and several of the back catalogue predate any budget at all —
  // 28 skills in 6 categories, on a document that is supposed to be two pages.
  // The ceiling applies to what REACHES THE PAGE, so it applies here too.
  const shaped = capSkillGroups(parsedSkills, ...(opts.skillsShape ?? []));
  const skillsModel = shaped.groups;
  if (shaped.dropped.length) warnings.push(`${shaped.dropped.length} skill(s) shed at the section ceiling: ${shaped.dropped.join(' · ')}`);

  let trimmed: string[] = [];
  const data = await templateSlotData(ownerId, selected, bulletByRef, profileText, profile ?? null, lead, skillsModel, (refs, cost) => {
    trimmed = refs;
    warnings.push(`C7's page rule trimmed ${refs.length} bullet(s) to hold two pages — ${refs.join(', ')} (line cost now ${cost})`);
  });
  const buffer = buildCvFromTemplate(data, { author: profile?.email?.trim() || profile?.name?.trim() || 'Author' });

  return {
    buffer,
    leadId,
    title: lead.title ?? '',
    company: lead.company ?? '',
    city: lead.city ?? '',
    bullets: new Set(selected.map((g) => g.evidenceRef).filter(Boolean)).size - trimmed.length,
    skills: skillsModel.reduce((n, g) => n + g.items.length, 0),
    skillGroups: skillsModel.length,
    relocation: String(data['Relocation'] ?? '').trim(),
    headshot: Array.isArray(data['Headshot']) && data['Headshot'].length > 0,
    warnings,
  };
}
