import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { exists, readBuffer } from '@/lib/storage';
import { currentOwnerId } from '@/lib/auth';
import { db } from '@/lib/db';
import { applications, jobLeads } from '@/lib/db/schema';
import { env } from '@/lib/env';

// Authenticated (gated by middleware) download of a generated CV.
export async function GET(_req: Request, { params }: { params: { leadId: string } }) {
  const owner = await currentOwnerId();
  const [lead] = await db
    .select({ id: jobLeads.id })
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
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="CV-${params.leadId.slice(0, 8)}.docx"`,
    },
  });
}
