/**
 * Re-render a lead's CV from what its last run already stored — no LLM calls, no
 * cost.
 *
 * WHY: every change to `Group CVs/CV_Template.docx` has to be looked at on a real
 * page before it can be believed, and until now the only way to get one was to
 * spend a full C1–C8 run. That made the template the least-verified part of the
 * build, which is exactly how it accumulated six format defects at once (CI · CV
 * Template Output Format). It is also what §2.7's bullet-budget calibration needs:
 * a page count measured against real content, repeatable for free.
 *
 * WHAT IT REBUILDS, AND FROM WHERE
 *   • evidence rows, profile, positions, education, languages — the database
 *   • the tailored profile text — the stored C6 run's `output.profile`
 *   • the tailored bullets — `requirement_tailoring.cv_bullet`, written by C4
 *   • the Skills grouping — parsed back out of the previously rendered .docx
 *
 * That last one is the one seam. C5's step report stores category NAMES and item
 * COUNTS but not the items, so the grouping cannot be read back from the database;
 * the rendered document is the only surviving record of it. If a lead has no
 * previously rendered CV, its Skills section re-renders empty and the script says
 * so rather than pretending otherwise.
 *
 * CALIBRATING THE BULLET BUDGET (§2.7)
 * `--bullets N` keeps only the N highest-ranked distinct evidence refs, which is
 * what `SELECTION_DEFAULTS.budget = N` would have selected: C3 ranks by marginal
 * coverage and writes the order into `shortlist_rank`, so truncating that order is
 * the same set, and every ref that survives keeps the real bullet C4 wrote for it.
 * Sweep N, count pages in Word, and the budget stops being an estimate:
 *
 *   for n in 14 13 12 11; do npx tsx scripts/render-cv-from-stored.ts <id> _local/b$n.docx --bullets $n; done
 *
 *   npx tsx scripts/render-cv-from-stored.ts <leadId> [outPath] [--bullets N]
 */
import './_env';
import fs from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import PizZip from 'pizzip';
import { db } from '../lib/db';
import { jobLeads, profiles, requirementTailoring, pipelineRuns } from '../lib/db/schema';
import { buildCvFromTemplate, templateExists, TEMPLATE_PATH } from '../lib/docx/template';
import { parseSkillGroups, skillsBlock, type SkillGroup } from '../lib/docx/cv-skills';
import { templateSlotData } from '../lib/pipeline/tailoring';

/**
 * Plain text of a .docx, one entry per VISIBLE line. A soft break counts as a line
 * ending, which matters here: the document this reads back is usually one written
 * before the re-tag, where a whole Skills section lived inside a single paragraph
 * separated by `<w:br/>`. Ignoring those would collapse five categories into one.
 * Deliberately not a general converter.
 */
function docxLines(file: string): string[] {
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

/** The Skills grouping from a previously rendered CV — `lib/docx/cv-skills.ts`
 *  knows the two layouts, and `verify-lead-run.ts` reads them the same way. */
function skillsFromRenderedCv(file: string): SkillGroup[] {
  return parseSkillGroups(skillsBlock(docxLines(file)) ?? []);
}

async function main() {
  const leadId = process.argv[2];
  if (!leadId) throw new Error('usage: npx tsx scripts/render-cv-from-stored.ts <leadId> [outPath]');
  if (!templateExists()) throw new Error(`Template not found at ${TEMPLATE_PATH}`);

  const [lead] = await db.select().from(jobLeads).where(eq(jobLeads.id, leadId));
  if (!lead) throw new Error(`Lead ${leadId} not found`);
  const ownerId = lead.ownerId;

  const [profile] = await db.select().from(profiles).where(eq(profiles.ownerId, ownerId)).limit(1);

  // Same predicate as `loadGreenRows`, and the same `shortlistRank` gate C3 sets.
  const green = await db
    .select()
    .from(requirementTailoring)
    .where(and(eq(requirementTailoring.jobLeadId, leadId), eq(requirementTailoring.ownerId, ownerId), eq(requirementTailoring.approvalStatus, 'green')));
  let selected = green.filter((g) => g.shortlistRank != null);
  if (selected.length === 0) throw new Error(`Lead ${leadId} has no selected evidence — run C3 for it first`);

  // §2.7 — hold the set to N distinct refs. Rows are not bullets: the same bullet
  // answers several requirements, so the budget counts refs and the truncation has
  // to as well, or a "14-bullet" render prints five.
  const cap = Number(process.argv[process.argv.indexOf('--bullets') + 1]);
  if (process.argv.includes('--bullets')) {
    if (!Number.isInteger(cap) || cap < 1) throw new Error('--bullets needs a positive integer');
    const order = [...new Set(
      [...selected].sort((a, b) => (a.shortlistRank ?? 0) - (b.shortlistRank ?? 0)).map((g) => g.evidenceRef ?? '')
    )].filter(Boolean);
    const keep = new Set(order.slice(0, cap));
    selected = selected.filter((g) => g.evidenceRef && keep.has(g.evidenceRef));
  }

  // C4's bullets survive on the rows themselves, so `bulletByRef` rebuilds exactly.
  const bulletByRef = new Map<string, { bullet: string; skills: string[] }>();
  for (const g of green) {
    if (g.evidenceRef && g.cvBullet) bulletByRef.set(g.evidenceRef, { bullet: g.cvBullet, skills: g.cvBulletSkills ?? [] });
  }

  const runs = await db.select().from(pipelineRuns).where(and(eq(pipelineRuns.jobLeadId, leadId), eq(pipelineRuns.ownerId, ownerId)));
  const c6 = runs
    .filter((r) => r.step === 'C6')
    .sort((a, b) => (a.finishedAt?.getTime() ?? 0) - (b.finishedAt?.getTime() ?? 0))
    .pop();
  const profileText = String((c6?.output as { profile?: string } | null)?.profile ?? '');
  if (!profileText) console.warn('!  no stored C6 profile for this lead — the Profile section will render empty');

  const previous = path.resolve(process.cwd(), process.env.STORAGE_DIR ?? '.storage', 'cv-output', leadId, 'tailored.docx');
  const skillsModel = fs.existsSync(previous) ? skillsFromRenderedCv(previous) : [];
  if (!skillsModel.length) console.warn('!  no Skills recoverable from a previous render — the Skills section will render empty');

  const data = await templateSlotData(ownerId, selected, bulletByRef, profileText, profile ?? null, lead, skillsModel);
  const out = (process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : undefined) ?? path.join('_local', `cv-${leadId.slice(0, 8)}.docx`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buildCvFromTemplate(data, { author: profile?.email?.trim() || profile?.name?.trim() || "Author" }));

  console.log(`${lead.title} · ${lead.company ?? ''} · city ${lead.city ?? '(none)'}`);
  // Refs, not rows — the CV prints one bullet per distinct ref, and reporting the
  // row count is the mistake C3's own header warns about (it reads a third high).
  const refs = new Set(selected.map((g) => g.evidenceRef).filter(Boolean)).size;
  console.log(`${refs} bullets (from ${selected.length} green rows) · ${skillsModel.reduce((n, g) => n + g.items.length, 0)} skills in ${skillsModel.length} groups`);
  console.log(`relocation clause: ${data['Relocation'] ? String(data['Relocation']).trim() : '(suppressed)'}`);
  console.log(`\nWrote ${out}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
);
