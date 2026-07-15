import Link from 'next/link';
import { headers } from 'next/headers';
import { AppShell } from '@/components/app-shell';
import { Card, Field, Input, Textarea, Button } from '@/components/ui';
import { createLeadAction } from '@/app/actions/leads';
import { createCaptureToken, currentOwnerId } from '@/lib/auth';

/** Build the bookmarklet against this deployment's origin and include a signed
 *  owner capture token, so cross-origin posting pages do not need app cookies. */
function bookmarkletFor(origin: string, token: string): string {
  const ingestUrl = JSON.stringify(`${origin}/api/ingest`);
  const appOrigin = JSON.stringify(origin);
  const captureToken = JSON.stringify(token);
  return `javascript:(function(){const t=document.title;const u=location.href;const b=(window.getSelection().toString()||document.body.innerText).slice(0,12000);fetch(${ingestUrl},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:t,url:u,markdown:b,token:${captureToken}})}).then(r=>r.json()).then(d=>{if(d.url){location.href=${appOrigin}+d.url}else{alert('Capture failed')}}).catch(e=>alert('Capture failed: '+e));})();`;
}

function requestOrigin(): string {
  const h = headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export default async function CaptureLeadPage({ searchParams }: { searchParams: { error?: string } }) {
  const origin = requestOrigin();
  const token = await createCaptureToken(await currentOwnerId());
  const BOOKMARKLET = bookmarkletFor(origin, token);
  return (
    <AppShell>
      <Link
        href="/roleproof"
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted transition hover:text-ink"
      >
        <span aria-hidden>←</span> Back to the board
      </Link>
      <div className="mb-6 mt-3">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Capture a job lead</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Paste a job description below, or use the bookmarklet to capture straight from a posting.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="p-5 sm:p-6 lg:col-span-2">
          <form action={createLeadAction} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Role title" htmlFor="title">
                <Input id="title" name="title" required placeholder="Director of Operations" />
              </Field>
              <Field label="Company" htmlFor="company">
                <Input id="company" name="company" placeholder="Acme GmbH" />
              </Field>
              <Field label="City" htmlFor="city">
                <Input id="city" name="city" placeholder="Vienna" />
              </Field>
            </div>
            <Field label="Source" htmlFor="source">
              <Input id="source" name="source" placeholder="e.g. “LinkedIn alert: Finance Vienna”, a recruiter’s name, or where you found it" />
            </Field>
            <Field label="Job description" htmlFor="markdown">
              <Textarea
                id="markdown"
                name="markdown"
                required
                rows={12}
                className="font-mono text-xs"
                placeholder="Paste the full job description here..."
              />
            </Field>
            {searchParams.error && (
              <p className="rounded-field bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-100">
                A job description is required.
              </p>
            )}
            <Button type="submit" rightIcon={<span aria-hidden>→</span>}>
              Capture &amp; open lead
            </Button>
          </form>
        </Card>

        <Card className="p-5 sm:p-6">
          <h3 className="text-sm font-semibold text-ink">Bookmarklet</h3>
          <p className="mt-1 text-xs text-ink-muted">
            Create a browser bookmark with this as the URL. On any job posting, click it to capture
            the page straight into your pipeline.
          </p>
          <pre className="mt-3 max-h-48 overflow-auto rounded-field bg-ink p-3 text-[10px] leading-relaxed text-slate-100 ring-1 ring-inset ring-white/10">
            {BOOKMARKLET}
          </pre>
          <p className="mt-2 text-xs text-ink-subtle">
            Points at <code className="ref">{origin}</code> with a 30-day capture token for this account.
          </p>
        </Card>
      </div>
    </AppShell>
  );
}
