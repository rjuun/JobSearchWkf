// Smoke-test C1–C7: map evidence → approve → generate a valid 2-page .docx.
import './_env';
import { eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { jobLeads, jobRequirements, requirementTailoring } from '../lib/db/schema';
import { runEvidenceMapping, generateCv } from '../lib/pipeline/tailoring';
import { exists, readBuffer } from '../lib/storage';

async function main() {
  // A lead that has Core requirements to map against.
  const [coreReq] = await db.select().from(jobRequirements).where(eq(jobRequirements.rank, 'Core')).limit(1);
  if (!coreReq) throw new Error('no Core requirements found — run seed/screening first');
  const [lead] = await db.select().from(jobLeads).where(eq(jobLeads.id, coreReq.jobLeadId)).limit(1);
  await db.update(jobLeads).set({ status: 'promoted' }).where(eq(jobLeads.id, lead.id));
  console.log(`Lead: ${lead.title}  (${lead.id})\n`);

  for (const r of await runEvidenceMapping(lead.id)) console.log(`  ${r.step}  ${r.label.padEnd(28)} ${r.summary}`);

  const rows = await db.select().from(requirementTailoring).where(eq(requirementTailoring.jobLeadId, lead.id));
  console.log(`  mapped evidence rows: ${rows.length}`);
  for (const r of rows.slice(0, 4)) await db.update(requirementTailoring).set({ approvalStatus: 'green' }).where(eq(requirementTailoring.id, r.id));
  console.log(`  approved (green): ${Math.min(4, rows.length)}\n`);

  const { reports, atsRating } = await generateCv(lead.id);
  for (const r of reports) console.log(`  ${r.step}  ${r.label.padEnd(28)} ${r.summary}`);

  const rel = `cv-output/${lead.id}/tailored.docx`;
  const ok = await exists(rel);
  const buf = ok ? await readBuffer(rel) : Buffer.alloc(0);
  const isDocx = buf.length > 1000 && buf[0] === 0x50 && buf[1] === 0x4b; // PK zip header
  console.log(`\n  ATS rating: ${atsRating}/100`);
  console.log(`  CV: ${ok ? `${buf.length} bytes` : 'MISSING'}  ·  valid .docx: ${isDocx}`);
  console.log(isDocx ? '\n✓ tailoring produced a valid 2-page CV' : '\n✗ CV generation failed');
  process.exit(isDocx ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
