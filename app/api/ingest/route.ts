import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createLead } from '@/lib/pipeline/capture';
import { verifyCaptureToken } from '@/lib/auth';

// Public endpoint (excluded from auth in middleware) so the LinkedIn bookmarklet
// can POST a captured JD. Owner identity comes from the signed capture token.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { headers: cors });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body.markdown !== 'string' || !body.markdown.trim()) {
      return NextResponse.json({ error: 'markdown required' }, { status: 400, headers: cors });
    }
    const ownerId = typeof body.token === 'string' ? await verifyCaptureToken(body.token) : null;
    if (!ownerId) {
      return NextResponse.json({ error: 'valid capture token required' }, { status: 401, headers: cors });
    }
    const id = await createLead(
      {
        title: typeof body.title === 'string' ? body.title.slice(0, 200) : 'Captured lead',
        company: body.company ?? null,
        city: body.city ?? null,
        sourceUrl: body.url ?? null,
        source: typeof body.source === 'string' && body.source.trim() ? body.source : 'Bookmarklet',
        markdown: body.markdown,
      },
      ownerId
    );
    return NextResponse.json({ id, url: `/roleproof/leads/${id}` }, { headers: cors });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500, headers: cors });
  }
}
