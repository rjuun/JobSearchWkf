import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { Card, Field, Input, Textarea, Button } from '@/components/ui';
import { createLeadAction } from '@/app/actions/leads';

export default async function CaptureLeadPage({ searchParams }: { searchParams: { error?: string } }) {
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
          Paste a job description below, or hand the posting URL to an agent session to capture it for you.
        </p>
      </div>

      <div className="grid gap-5">
        <Card className="p-5 sm:p-6 lg:max-w-3xl">
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
      </div>
    </AppShell>
  );
}
