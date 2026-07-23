import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createLead } from '@/lib/pipeline/capture';
import { verifyCaptureToken } from '@/lib/auth';

const ALLOWED_REMOTE = new Set(['on-site', 'hybrid', 'remote', 'unspecified']);

// Public endpoint (excluded from auth in middleware) so an AI-driven capture agent
// can POST a captured JD from its own HTTP call — never a script running inside the
// posting page's own document (see A.1/A.2: that's the CSP wall the bookmarklet
// transport hit and why it was retired). Owner identity comes from the signed
// capture token; no CORS/OPTIONS handling needed since nothing calls this
// cross-origin from a browser page anymore.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body.markdown !== 'string' || !body.markdown.trim()) {
      return NextResponse.json({ error: 'markdown required' }, { status: 400 });
    }
    const ownerId = typeof body.token === 'string' ? await verifyCaptureToken(body.token) : null;
    if (!ownerId) {
      return NextResponse.json({ error: 'valid capture token required' }, { status: 401 });
    }
    const candidateLinks = Array.isArray(body.candidateLinks)
      ? body.candidateLinks.filter((l: unknown): l is string => typeof l === 'string').slice(0, 200)
      : null;
    // Section C precedence: preserve "key absent" (→ undefined, ask DeepSeek) vs
    // "key present" (→ string/null, an agent-supplied answer, even if empty) —
    // `?? null` would collapse both to the same value and defeat the precedence
    // check in createLead().
    const company = 'company' in body ? (typeof body.company === 'string' ? body.company : null) : undefined;
    const city = 'city' in body ? (typeof body.city === 'string' ? body.city : null) : undefined;
    const remote =
      'remote' in body ? (typeof body.remote === 'string' && ALLOWED_REMOTE.has(body.remote) ? body.remote : null) : undefined;
    const formatSignals = 'formatSignals' in body ? (typeof body.formatSignals === 'string' ? body.formatSignals : null) : undefined;
    const id = await createLead(
      {
        title: typeof body.title === 'string' ? body.title.slice(0, 200) : 'Captured lead',
        company,
        city,
        remote: remote as 'on-site' | 'hybrid' | 'remote' | 'unspecified' | null | undefined,
        formatSignals,
        sourceUrl: body.url ?? null,
        source: typeof body.source === 'string' && body.source.trim() ? body.source : 'AI-driven capture',
        candidateLinks,
        markdown: body.markdown,
      },
      ownerId
    );
    return NextResponse.json({ id, url: `/roleproof/leads/${id}` });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
