/**
 * Acceptance verification for CI · Scoring Phase Redesign — Part 2 (§2.4).
 *
 * Runs against the real DB under a throwaway owner id, building the exact
 * application shapes each criterion needs (freshly sent / stale / declined /
 * interview) rather than hoping real data contains them. Everything it creates —
 * DB rows *and* stored files — it deletes; see cleanup() and the finally block.
 *
 * LLM_MODE is forced to mock (./_force-mock must stay the first import — see
 * Part 1's §4 log for why an inline `process.env.LLM_MODE = 'mock'` silently
 * does nothing). Nothing here calls a model; the guard is belt-and-braces so a
 * stray pipeline import can't start spending money.
 *
 * The one criterion no harness can prove is the live drag-and-drop out of
 * Outlook Classic (§2.3 step 13) — that needs a real .msg dragged onto each of
 * the three targets by hand.
 */
import './_force-mock';
import './_env';
import fs from 'node:fs/promises';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../lib/db';
import { applications, jobLeads } from '../lib/db/schema';
import { exists, localPath, readBuffer, writeBuffer } from '../lib/storage';
import {
  applicationStatusLabel,
  emailArtifactLink,
  emailArtifactObjectName,
  emailArtifactPath,
  isStaleApplication,
} from '../lib/applications';

const OWNER = '00000000-0000-0000-0000-0000000ffff2'; // throwaway, not DEMO_OWNER_ID

let passes = 0;
let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    passes++;
    console.log(`  ✓ ${label}${detail ? `  — ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${detail ? `  — ${detail}` : ''}`);
  }
}

const createdLeads: string[] = [];

async function makeLead(title: string, status: 'ready' | 'applied' = 'ready'): Promise<string> {
  const [row] = await db
    .insert(jobLeads)
    .values({ ownerId: OWNER, title, company: 'Testhaus GmbH', status, jdText: 'x' })
    .returning({ id: jobLeads.id });
  createdLeads.push(row.id);
  return row.id;
}

async function cleanup(): Promise<void> {
  if (createdLeads.length) {
    await db.delete(applications).where(inArray(applications.jobLeadId, createdLeads));
    await db.delete(jobLeads).where(inArray(jobLeads.id, createdLeads));
    for (const id of createdLeads) {
      await fs.rm(localPath(`applications/${id}`), { recursive: true, force: true }).catch(() => {});
    }
  }
}

/** §2.3 step 3 — the applications/{leadId}/ prefix against the real adapter. */
async function checkStoragePrefix(): Promise<void> {
  console.log('\n§2.3 step 3 · storage prefix');
  const leadId = await makeLead('Storage probe');
  const objectName = emailArtifactObjectName('confirmation', 'Re Your application.msg');
  const rel = emailArtifactPath(leadId, objectName);

  check('object name is timestamped and keeps the .msg extension', /^confirmation-.+\.msg$/.test(objectName), objectName);
  check('path sits under the new applications/ prefix', rel === `applications/${leadId}/${objectName}`, rel);

  // A CDFV2 compound-binary header — the real first bytes of an Outlook .msg.
  const body = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512, 7)]);
  await writeBuffer(rel, body);
  check('writeBuffer accepted the new prefix', await exists(rel));
  const back = await readBuffer(rel);
  check('readBuffer round-trips the bytes unchanged', Buffer.compare(back, body) === 0, `${back.length} bytes`);
  check(
    'the link column value is an href into this app',
    emailArtifactLink(leadId, objectName) === `/api/applications/${leadId}/email/${encodeURIComponent(objectName)}`
  );

  const other = await makeLead('Storage probe 2');
  await writeBuffer(emailArtifactPath(other, objectName), body);
  check('two leads with the same object name do not collide', await exists(emailArtifactPath(other, objectName)));
}

/** §2.4 — the label map and the stale rule, over the exact statuses in play. */
async function checkLabelsAndStale(): Promise<void> {
  console.log('\n§2.4 · labels and the stale badge');
  check('response_pending reads "Response pending"', applicationStatusLabel('response_pending') === 'Response pending');
  check('interview reads "Interview scheduled"', applicationStatusLabel('interview') === 'Interview scheduled');
  check('screened_out reads "Stopped"', applicationStatusLabel('screened_out') === 'Stopped');

  const old = new Date(Date.now() - 9 * 86_400_000);
  const recent = new Date(Date.now() - 2 * 86_400_000);
  check('9-day-old response_pending is stale', isStaleApplication({ status: 'response_pending', appliedAt: old, updatedAt: old }));
  check('2-day-old response_pending is not stale', !isStaleApplication({ status: 'response_pending', appliedAt: recent, updatedAt: recent }));
  check(
    'a 9-day-old row touched yesterday is not stale',
    !isStaleApplication({ status: 'response_pending', appliedAt: old, updatedAt: new Date(Date.now() - 86_400_000) })
  );
  check('an interview row is never stale', !isStaleApplication({ status: 'interview', appliedAt: old, updatedAt: old }));
}

async function main(): Promise<void> {
  console.log('Verifying CI · Scoring Phase Redesign — Part 2');
  try {
    await checkStoragePrefix();
    await checkLabelsAndStale();
  } finally {
    await cleanup();
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch(async (err) => {
  await cleanup().catch(() => {});
  console.error(err);
  process.exit(1);
});
