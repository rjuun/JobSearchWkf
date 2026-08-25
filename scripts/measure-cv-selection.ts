/**
 * CI · C3 Selects the CV Evidence Set — the acceptance probe.
 *
 * Read-only. For each lead it prints the numbers §2.8 is judged on: Keep rows,
 * distinct evidence refs (= bullets, which is NOT the row count — reasoning about
 * the budget in rows sets it about a third too tight), requirement coverage per
 * rank, and the skills C5 would print.
 *
 * Run it before and after a live Generate CV — `requirement_tailoring` is
 * overwritten in place, so the "before" is not recoverable afterwards.
 *
 *   npx tsx scripts/measure-cv-selection.ts <leadId|prefix> [more...]
 */
import './_env';
import { db } from '../lib/db';
import { requirementTailoring, jobRequirements, jobLeads, languages } from '../lib/db/schema';
import { prioritiseSkills, dropLanguageSkills, SKILLS_ENVELOPE } from '../lib/pipeline/skills';
import { eq, sql } from 'drizzle-orm';

const RANKS = ['Core', 'Important', 'Nice-to-Have'];

/** Accepts a full uuid or the 8-char prefix the CI notes cite leads by. */
async function resolveLead(idOrPrefix: string) {
  const [lead] = await db.select().from(jobLeads).where(sql`${jobLeads.id}::text like ${idOrPrefix + '%'}`);
  return lead;
}

async function measure(idOrPrefix: string) {
  const lead = await resolveLead(idOrPrefix);
  if (!lead) return console.log(`\n${idOrPrefix} — NO SUCH LEAD`);
  const leadId = lead.id;
  const all = await db.select().from(requirementTailoring).where(eq(requirementTailoring.jobLeadId, leadId));
  const green = all.filter((r) => r.approvalStatus === 'green');
  const reqs = await db.select().from(jobRequirements).where(eq(jobRequirements.jobLeadId, leadId));
  const rankById = new Map(reqs.map((r) => [r.id, r.rank]));
  const langRows = await db.select().from(languages).where(eq(languages.ownerId, lead.ownerId));

  const refs = new Set(green.map((r) => r.evidenceRef).filter(Boolean));
  const kinds = new Map<string, number>();
  for (const ref of refs) {
    const kind = green.find((r) => r.evidenceRef === ref)?.evidenceKind ?? '(null)';
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  }
  const covered = new Set(green.map((r) => r.requirementId).filter(Boolean));
  const cov = RANKS.map((rk) => {
    const of = reqs.filter((r) => r.rank === rk);
    return `${rk} ${of.filter((r) => covered.has(r.id)).length}/${of.length}`;
  }).join(' · ');

  const selected = dropLanguageSkills(
    prioritiseSkills(
      green.map((r) => ({ rank: (r.requirementId && rankById.get(r.requirementId)) ?? null, cvBulletSkills: r.cvBulletSkills ?? [] })),
      SKILLS_ENVELOPE + 8
    ),
    langRows.map((l) => l.language ?? '')
  );

  console.log(`\n${'='.repeat(96)}`);
  console.log(`${lead.title}${lead.company ? ` · ${lead.company}` : ''}  [${leadId.slice(0, 8)}]`);
  console.log('='.repeat(96));
  console.log(`  rows          : ${all.length} total · ${green.length} green · ${all.filter((r) => r.approvalStatus === 'pending').length} pending`);
  console.log(`  bullets (refs): ${refs.size}   ${[...kinds].map(([k, n]) => `${k}=${n}`).join(' ')}`);
  console.log(`  links/bullet  : ${(green.length / Math.max(refs.size, 1)).toFixed(2)}`);
  console.log(`  coverage      : ${cov}`);
  console.log(`  reqs/bullet   : ${(covered.size / Math.max(refs.size, 1)).toFixed(2)}`);
  console.log(`  skills        : ${selected.length} after language strike -> ${Math.min(selected.length, SKILLS_ENVELOPE)} printed (envelope ${SKILLS_ENVELOPE})`);
}

async function main() {
  const ids = process.argv.slice(2);
  if (!ids.length) {
    console.error('usage: npx tsx scripts/measure-cv-selection.ts <leadId|prefix> [more...]');
    process.exit(1);
  }
  for (const id of ids) await measure(id);
  process.exit(0);
}
main();
