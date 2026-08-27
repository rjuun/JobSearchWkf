/**
 * CI · C7 Space Rules Are Specified and Never Enforced — the calibration handle.
 *
 * `CONTENT_LINE_ALLOWANCE` in `lib/cv-budget.ts` is the one figure in the budget
 * that cannot be derived: it stands for how much variable content two pages hold
 * once the template's fixed furniture has taken its share, and furniture is
 * exactly what a line model cannot predict. So it is CALIBRATED — and this is
 * what calibrates it.
 *
 * For each lead it prints `contentLineCost` over the assembled template data,
 * which is the number the pipeline will act on, so the estimate can be put beside
 * Word's own verdict on the same document:
 *
 *   npx tsx scripts/measure-cv-space.ts <leadId> [<leadId> …] [--skills CxP] [--profile-words N]
 *   powershell -File scripts/cv-pages.ps1 _local/*.docx
 *
 * Pass the SAME `--skills` / `--profile-words` you passed to
 * `render-cv-from-stored.ts`. The estimate is only calibratable against a page
 * count taken from the identical document, and the two flags are what decide
 * which document that is — a stored CV was produced under whatever budget was
 * live when it was paid for, not under this one.
 *
 * The allowance is right when every lead the estimate passes also comes back
 * from Word at two pages, and every lead it fails comes back at three. Re-run
 * both whenever the template's fixed paragraphs change; nothing else here needs
 * to move.
 */
import './_env';
import { and, eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { jobLeads, profiles, requirementTailoring, pipelineRuns } from '../lib/db/schema';
import { templateSlotData, contentLineCost } from '../lib/pipeline/tailoring';
import { skillsFromRenderedCv, storedCvPath } from '../lib/pipeline/rerender-cv';
import { capSkillGroups } from '../lib/pipeline/skills';
import { CONTENT_LINE_ALLOWANCE } from '../lib/cv-budget';
import fs from 'node:fs';

async function main() {
  const argv = process.argv.slice(2);
  const flagIdx = argv.findIndex((a) => a.startsWith('--'));
  const ids = flagIdx === -1 ? argv : argv.slice(0, flagIdx);
  if (!ids.length) throw new Error('usage: npx tsx scripts/measure-cv-space.ts <leadId> [<leadId> …] [--skills CxP] [--profile-words N]');

  const shapeArg = argv[argv.indexOf('--skills') + 1];
  const shapeMatch = argv.includes('--skills') ? /^(\d+)x(\d+)$/.exec(shapeArg ?? '') : null;
  if (argv.includes('--skills') && !shapeMatch) throw new Error('--skills needs a shape like 4x5');
  const skillsShape: [number, number] | [] = shapeMatch ? [Number(shapeMatch[1]), Number(shapeMatch[2])] : [];
  const profileWords = argv.includes('--profile-words') ? Number(argv[argv.indexOf('--profile-words') + 1]) : undefined;
  if (profileWords !== undefined && (!Number.isInteger(profileWords) || profileWords < 1)) throw new Error('--profile-words needs a positive integer');

  for (const leadId of ids) {
    const [lead] = await db.select().from(jobLeads).where(eq(jobLeads.id, leadId));
    if (!lead) {
      console.log(`${leadId}  (no such lead)`);
      continue;
    }
    const ownerId = lead.ownerId;
    const [profile] = await db.select().from(profiles).where(eq(profiles.ownerId, ownerId)).limit(1);
    const green = await db
      .select()
      .from(requirementTailoring)
      .where(and(eq(requirementTailoring.jobLeadId, leadId), eq(requirementTailoring.ownerId, ownerId), eq(requirementTailoring.approvalStatus, 'green')));
    const selected = green.filter((g) => g.shortlistRank != null);
    const bulletByRef = new Map<string, { bullet: string; skills: string[] }>();
    for (const g of green) if (g.evidenceRef && g.cvBullet) bulletByRef.set(g.evidenceRef, { bullet: g.cvBullet, skills: g.cvBulletSkills ?? [] });

    const runs = await db.select().from(pipelineRuns).where(and(eq(pipelineRuns.jobLeadId, leadId), eq(pipelineRuns.ownerId, ownerId)));
    const c6 = runs.filter((r) => r.step === 'C6').sort((a, b) => (a.finishedAt?.getTime() ?? 0) - (b.finishedAt?.getTime() ?? 0)).pop();
    let profileText = String((c6?.output as { profile?: string } | null)?.profile ?? '');
    if (profileWords) profileText = profileText.trim().split(/\s+/).filter(Boolean).slice(0, profileWords).join(' ');

    const previous = storedCvPath(leadId);
    const skills = capSkillGroups(fs.existsSync(previous) ? skillsFromRenderedCv(previous) : [], ...skillsShape).groups;

    const data = await templateSlotData(ownerId, selected, bulletByRef, profileText, profile ?? null, lead, skills);
    const cost = contentLineCost(data);
    const verdict = cost <= CONTENT_LINE_ALLOWANCE ? 'fits ' : 'OVER ';
    console.log(`${verdict} ${String(cost).padStart(3)}/${CONTENT_LINE_ALLOWANCE}  ${leadId.slice(0, 8)}  ${lead.company ?? ''} · ${lead.title ?? ''}`);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
);
