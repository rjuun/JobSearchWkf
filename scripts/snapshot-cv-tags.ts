/**
 * CI · C3 Writes CV-Grade Skill Tags — before/after probe.
 *
 * Read-only. Dumps the Keep-gated `requirement_tailoring` rows for one or more
 * leads: the bullet, the tag C4 wrote (`cv_bullet_skills`), the curated My
 * Skills behind it, and the JD's own asks (`requirement_skills`) — then the set
 * C5 would print from them today, after prioritisation and the language strike.
 *
 * Exists because Generate CV overwrites `cv_bullet` and `cv_bullet_skills` in
 * place. What this CI changes is the REGISTER of those tags, so the only way to
 * judge it is to hold the before beside the after, and the rows themselves do
 * not keep history.
 *
 * Categorisation is deliberately not reproduced: it is a Sonnet call, so running
 * it here would cost a call and still not be the one the real run makes. The
 * selected set is the part that decides what prints.
 *
 *   npx tsx scripts/snapshot-cv-tags.ts <leadId> [leadId...]
 */
import './_env';
import { db } from '../lib/db';
import { requirementTailoring, jobRequirements, jobLeads, languages } from '../lib/db/schema';
import { prioritiseSkills, dropLanguageSkills, SKILLS_ENVELOPE } from '../lib/pipeline/skills';
import { eq } from 'drizzle-orm';

const list = (v: readonly string[] | null | undefined): string => (v?.length ? v.join(' · ') : '—');

async function snapshot(leadId: string) {
  const [lead] = await db.select().from(jobLeads).where(eq(jobLeads.id, leadId));
  if (!lead) {
    console.log(`\n${'='.repeat(100)}\n${leadId} — NO SUCH LEAD\n`);
    return;
  }
  const rows = (await db.select().from(requirementTailoring).where(eq(requirementTailoring.jobLeadId, leadId)))
    .filter((r) => r.approvalStatus === 'green');
  const reqs = await db.select().from(jobRequirements).where(eq(jobRequirements.jobLeadId, leadId));
  const rankById = new Map(reqs.map((r) => [r.id, r.rank]));
  const langRows = await db.select().from(languages).where(eq(languages.ownerId, lead.ownerId));

  console.log(`\n${'='.repeat(100)}`);
  console.log(`${lead.title}${lead.company ? ` · ${lead.company}` : ''}`);
  console.log(`lead ${leadId} · ${rows.length} Keep row(s) of ${reqs.length} requirement(s)`);
  console.log('='.repeat(100));

  for (const r of rows) {
    const rank = (r.requirementId && rankById.get(r.requirementId)) || '(no rank)';
    console.log(`\n[${r.evidenceRef ?? '—'}] ${rank} — ${r.requirementLine ?? '—'}`);
    console.log(`  bullet          : ${r.cvBullet?.replace(/\s+/g, ' ').trim() || '(empty)'}`);
    console.log(`  cv_bullet_skills: ${list(r.cvBulletSkills)}`);
    console.log(`  my_skills       : ${list(r.mySkills)}`);
    console.log(`  requirement_sk. : ${list(r.requirementSkills)}`);
  }

  // Exactly what generateCv does between C4 and the C5 grouping call.
  const selected = dropLanguageSkills(
    prioritiseSkills(
      rows.map((r) => ({ rank: (r.requirementId && rankById.get(r.requirementId)) ?? null, cvBulletSkills: r.cvBulletSkills ?? [] })),
      SKILLS_ENVELOPE + 8
    ),
    langRows.map((l) => l.language ?? '')
  ).slice(0, SKILLS_ENVELOPE);

  console.log(`\n${'-'.repeat(100)}`);
  console.log(`WHAT C5 WOULD PRINT — ${selected.length} entries, before categorisation`);
  console.log('-'.repeat(100));
  selected.forEach((s, i) => console.log(`  ${String(i + 1).padStart(2)}. ${s}`));
}

async function main() {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error('usage: npx tsx scripts/snapshot-cv-tags.ts <leadId> [leadId...]');
    process.exit(1);
  }
  for (const id of ids) await snapshot(id);
  process.exit(0);
}

main();
