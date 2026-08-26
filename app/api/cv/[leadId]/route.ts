import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { exists, readBuffer } from '@/lib/storage';
import { currentOwnerId } from '@/lib/auth';
import { db } from '@/lib/db';
import { applications, jobLeads, profiles } from '@/lib/db/schema';
import { cvFileName } from '@/lib/docx/metadata';
import { env } from '@/lib/env';

// Authenticated (gated by middleware) download of a generated CV.
export async function GET(_req: Request, { params }: { params: { leadId: string } }) {
  const owner = await currentOwnerId();
  const [lead] = await db
    .select({ id: jobLeads.id, title: jobLeads.title, company: jobLeads.company })
    .from(jobLeads)
    .where(and(eq(jobLeads.id, params.leadId), eq(jobLeads.ownerId, owner)));
  if (!lead) return new NextResponse('Not found', { status: 404 });
  const rel = `cv-output/${params.leadId}/tailored.docx`;
  if (!(await exists(rel))) return new NextResponse('Not found', { status: 404 });

  // B2 · Returns (tracking first). Downloading the tailored CV is the first honest
  // signal that this lead is going out — open an application row if none exists yet,
  // so the Returns panel can nudge for an outcome later. Best-effort and idempotent:
  // a repeat download never duplicates, and a tracking failure never blocks the file.
  if (env.nextReturns) {
    try {
      // Idempotent via the (owner, lead) unique index — concurrent downloads can't
      // create duplicate rows, and a repeat download is a no-op.
      await db
        .insert(applications)
        .values({ ownerId: owner, jobLeadId: params.leadId, appliedAt: new Date(), status: 'downloaded' })
        .onConflictDoNothing();
    } catch {
      /* tracking must never block the download */
    }
  }

  const buf = await readBuffer(rel);
  // The stored path stays `cv-output/<leadId>/tailored.docx` — four other call
  // sites check for it by that name. Only what the browser SAVES it as changes,
  // to the owner's filing convention: "CV - Reginaldo S Junior - <role> - <company>".
  // A recruiter opening the attachment sees whose CV it is and which role it
  // answers, instead of eight characters of a UUID.
  const [profile] = await db.select({ name: profiles.name }).from(profiles).where(eq(profiles.ownerId, owner)).limit(1);
  const filename = cvFileName({ name: profile?.name, position: lead.title, company: lead.company });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      // Both forms: `filename` for anything old, RFC 5987 `filename*` so the
      // accented and non-ASCII company names survive the trip.
      'Content-Disposition':
        `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; ` +
        `filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
