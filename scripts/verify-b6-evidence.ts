/**
 * Acceptance verification for CI · "B6 Never Receives the Master Bullet Bank"
 * (§2.5). The unit tests cover the pure functions; this covers the part they
 * structurally cannot — that the bank actually reaches the B6 call, and that what
 * comes back survives the write path into `requirement_evidence`,
 * `job_requirements` and `job_leads.bullet_bank_version`.
 *
 * Runs against the real DB under a throwaway owner id with its own small synthetic
 * bullet bank, so the assertions can name exact ref codes instead of hoping the
 * real bank happens to contain something matching. Everything it creates, it
 * deletes — see cleanup() and the finally block. No real lead is touched and no
 * real score is overwritten.
 *
 * LLM_MODE is forced to mock (./_force-mock must stay the FIRST import): what is
 * under test is the plumbing — bank in, refs resolved, rows written, provenance
 * stamped — none of which depends on a real model call. The one thing mock cannot
 * prove is that Opus makes good citations; that needs a live re-score of a real
 * lead, which is §2.5's last criterion and a human call, not a script's.
 */
import './_force-mock';
import './_env';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../lib/db';
import {
  bulletBank,
  education,
  languages,
  jobLeads,
  jobRequirements,
  requirementEvidence,
  pipelineRuns,
  llmCalls,
} from '../lib/db/schema';
import { runInitialChecks, runScoring } from '../lib/pipeline/screening';
import { normalizeCvPosition } from '../lib/cv-slots';

const OWNER = '00000000-0000-0000-0000-0000000ffff6'; // throwaway, not DEMO_OWNER_ID
const EMPTY_OWNER = '00000000-0000-0000-0000-0000000ffff7'; // same, but deliberately bankless
const BANK_VERSION = '9999-01';

let passes = 0;
let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    passes++;
    console.log(`  ✓ ${label}${detail ? `  — ${detail}` : ''}`);
  } else {
    failures++;
    console.error(`  ✗ ${label}${detail ? `  — ${detail}` : ''}`);
  }
}

// Long enough to clear B2's 600-character floor (it demands 4+ requirements past
// that length), and written so the mock extractor picks whole lines as requirements.
const JD = [
  'We are hiring a Head of Finance Transformation to lead the redesign of our monthly close.',
  'You will own the accounting close process end to end and reduce the cycle time materially.',
  'You will build reporting dashboards that give leadership reliable performance analytics.',
  'You will lead transfer pricing documentation and governance across our European entities.',
  'You will partner with senior stakeholders across multiple countries on cost allocation.',
  'A postgraduate qualification in economics, finance or business management is expected.',
  'German at C1 level or above is required for this role, alongside fluent business English.',
  'Experience implementing SAP S/4HANA across a multi-entity landscape is a strong plus.',
].join('\n');

// V1 and V4 deliberately BOTH speak to the close-process requirement: the whole
// point of the Map is that one requirement is routinely carried by several bullets,
// and a fixture where every requirement has exactly one candidate would let a
// one-link-per-requirement regression pass unnoticed.
const BANK = [
  { refCode: 'V1', cvPosition: 'B1', tags: ['Process Transformation'], text: 'Redesigned the accounting close process end to end, reducing the monthly close cycle from twenty days to five.' },
  { refCode: 'V2', cvPosition: 'B1', tags: ['Data Reliability'], text: 'Built automated reporting dashboards giving leadership reliable performance analytics against projection.' },
  { refCode: 'V3', cvPosition: 'B2', tags: ['Transfer Pricing Governance'], text: 'Owned transfer pricing documentation and governance across the European entities, partnering with senior stakeholders on cost allocation.' },
  { refCode: 'V4', cvPosition: 'B1', tags: ['Operational Excellence'], text: 'Automated the month-end close controls, shortening the accounting close cycle and reducing manual process effort across the finance organisation.' },
];

async function seedOwner() {
  await db.insert(bulletBank).values(BANK.map((b) => ({ ownerId: OWNER, version: BANK_VERSION, ...b })));
  await db.insert(education).values({ ownerId: OWNER, refCode: 'EDU-1', qualification: "Master's in Economic Development", institution: 'IUJ', year: '2006', type: 'Masters' });
  await db.insert(languages).values({ ownerId: OWNER, refCode: 'LANG-1', language: 'German', cefrLevel: 'C1' });
}

async function cleanup() {
  for (const owner of [OWNER, EMPTY_OWNER]) {
    const rows = await db.select({ id: jobLeads.id }).from(jobLeads).where(eq(jobLeads.ownerId, owner));
    const ids = rows.map((r) => r.id);
    if (ids.length) {
      await db.delete(pipelineRuns).where(inArray(pipelineRuns.jobLeadId, ids));
      await db.delete(llmCalls).where(inArray(llmCalls.jobLeadId, ids));
      await db.delete(requirementEvidence).where(inArray(requirementEvidence.jobLeadId, ids));
      await db.delete(jobRequirements).where(inArray(jobRequirements.jobLeadId, ids));
    }
    await db.delete(jobLeads).where(eq(jobLeads.ownerId, owner));
    await db.delete(bulletBank).where(eq(bulletBank.ownerId, owner));
    await db.delete(education).where(eq(education.ownerId, owner));
    await db.delete(languages).where(eq(languages.ownerId, owner));
  }
}

async function screen(owner: string) {
  const [row] = await db
    .insert(jobLeads)
    .values({ ownerId: owner, title: 'Head of Finance Transformation', jdText: JD, status: 'captured', postedDays: 3, city: 'Vienna' })
    .returning({ id: jobLeads.id });
  await runInitialChecks(row.id, owner);
  await runScoring(row.id, owner);
  return row.id;
}

async function main() {
  await cleanup(); // in case a previous run died mid-way
  try {
    await seedOwner();

    // ── §2.1 · the bank reaches B6 ──────────────────────────────────────────
    console.log('\n§2.1 · B6 is sent the Master Bullet Bank');
    const leadId = await screen(OWNER);
    const [b6] = await db
      .select({ output: pipelineRuns.output })
      .from(pipelineRuns)
      .where(and(eq(pipelineRuns.jobLeadId, leadId), eq(pipelineRuns.step, 'B6')));
    const out = (b6?.output ?? {}) as { evidenceSent?: number; evidenceLinks?: number; bankVersion?: string | null; unknownRefs?: string[] };
    check('B6 was sent the whole bank plus education and languages', out.evidenceSent === BANK.length + 2, `evidenceSent=${out.evidenceSent}`);

    // ── §2.2/§2.3 · the mapping survives the round trip ─────────────────────
    console.log('\n§2.2/§2.3 · the mapping comes back and is persisted');
    const links = await db.select().from(requirementEvidence).where(eq(requirementEvidence.jobLeadId, leadId));
    const reqs = await db.select().from(jobRequirements).where(eq(jobRequirements.jobLeadId, leadId));
    const reqIds = new Set(reqs.map((r) => r.id));
    const bankRefs = new Set([...BANK.map((b) => b.refCode), 'EDU-1', 'LANG-1']);
    check('evidence links were persisted', links.length > 0, `${links.length} link(s) across ${reqs.length} requirement(s)`);
    check('every link names a requirement of THIS lead', links.every((l) => reqIds.has(l.requirementId)));
    check('every cited ref exists in the bank — no fabricated codes', links.every((l) => bankRefs.has(l.evidenceRef)));
    check('no ref is cited twice for the same requirement', new Set(links.map((l) => `${l.requirementId}|${l.evidenceRef}`)).size === links.length);
    check('bullet links carry a normalized CV slot, so a Map lane can receive them',
      links.filter((l) => l.evidenceKind === 'Bullet').every((l) => normalizeCvPosition(l.cvPosition) !== null),
      [...new Set(links.filter((l) => l.evidenceKind === 'Bullet').map((l) => l.cvPosition))].join(', '));
    check('the many-to-many shape is real — at least one requirement carries several bullets',
      [...new Set(links.map((l) => l.requirementId))].length < links.length);
    check('B6 filled Initial_Missing_Weak / key strengths (columns the write path used to skip)',
      reqs.some((r) => r.initialMissingWeak != null || r.initialKeyStrengths != null));

    // ── §2.0 · the provenance stamp ─────────────────────────────────────────
    console.log('\n§2.0 · bulletBankVersion records what was actually used');
    const [lead] = await db.select().from(jobLeads).where(eq(jobLeads.id, leadId));
    check('stamp is the seeded bank version, not the old hardcoded literal', lead.bulletBankVersion === BANK_VERSION, `${lead.bulletBankVersion}`);
    check('the lead was scored', lead.overallFitScore != null, `${lead.overallFitScore} / 10`);

    // ── re-scoring is idempotent ────────────────────────────────────────────
    console.log('\nRe-scoring replaces the links rather than accumulating them');
    await runScoring(leadId, OWNER);
    const again = await db.select().from(requirementEvidence).where(eq(requirementEvidence.jobLeadId, leadId));
    check('link count is unchanged after a second scoring run', again.length === links.length, `${links.length} → ${again.length}`);

    // ── the bankless owner ──────────────────────────────────────────────────
    console.log('\nAn owner with no bank is handled honestly, not silently');
    const emptyLeadId = await screen(EMPTY_OWNER);
    const [emptyLead] = await db.select().from(jobLeads).where(eq(jobLeads.id, emptyLeadId));
    const emptyLinks = await db.select().from(requirementEvidence).where(eq(requirementEvidence.jobLeadId, emptyLeadId));
    check('no evidence links are invented when there is no bank', emptyLinks.length === 0);
    check('bulletBankVersion is null — "no bank was consulted" stays readable off the row', emptyLead.bulletBankVersion === null, `${emptyLead.bulletBankVersion}`);
  } finally {
    await cleanup();
  }

  console.log(`\n${failures === 0 ? '✓ all checks passed' : `✗ ${failures} check(s) failed`}  (${passes} passed)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
