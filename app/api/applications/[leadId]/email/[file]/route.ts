import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { exists, readBuffer } from '@/lib/storage';
import { currentOwnerId } from '@/lib/auth';
import { db } from '@/lib/db';
import { jobLeads } from '@/lib/db/schema';
import { emailArtifactPath, isSafeObjectName } from '@/lib/applications';

const TYPES: Record<string, string> = {
  '.msg': 'application/vnd.ms-outlook',
  '.eml': 'message/rfc822',
  '.pdf': 'application/pdf',
  '.html': 'text/html',
  '.txt': 'text/plain',
};

/**
 * Authenticated (middleware-gated) download of an email archived by one of the
 * three drop targets — this is what `confirmationEmailLink`/`outcomeEmailLink`
 * point at. Deliberately this app's own route rather than a Supabase signed URL:
 * signed URLs expire, and don't exist at all on the local-filesystem backend.
 * Same shape as /api/cv/[leadId].
 */
export async function GET(_req: Request, { params }: { params: { leadId: string; file: string } }) {
  const owner = await currentOwnerId();
  const name = decodeURIComponent(params.file);
  if (!isSafeObjectName(name)) return new NextResponse('Not found', { status: 404 });

  const [lead] = await db
    .select({ id: jobLeads.id })
    .from(jobLeads)
    .where(and(eq(jobLeads.id, params.leadId), eq(jobLeads.ownerId, owner)));
  if (!lead) return new NextResponse('Not found', { status: 404 });

  const rel = emailArtifactPath(params.leadId, name);
  if (!(await exists(rel))) return new NextResponse('Not found', { status: 404 });

  const buf = await readBuffer(rel);
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': TYPES[ext] ?? 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${name}"`,
    },
  });
}
