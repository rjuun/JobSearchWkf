'use client';

import { useMemo, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { startImportAction, commitDraftAction, resetOnboardingAction } from '@/app/actions/onboarding';
import type { DraftGraph } from '@/lib/onboarding';
import { Card, Button, Badge, cn } from './ui';

const SAMPLE = `Jordan Rivera
Senior Operations Director — Vienna, Austria

Experience
Director of Shared Services at Acme Group  2018 - Present
- Led a 40-person shared-services organisation across 6 countries
- Cut operating costs by 22% through process standardisation
- Implemented SAP S/4HANA on time and 8% under budget
Head of Finance Transformation at Beta Industries  2014 - 2018
- Delivered a finance transformation programme saving EUR 4.5m annually
- Built and led a team of 12 analysts

Skills: Process Standardisation, Shared Services, SAP S/4HANA, Change Management, FP&A, Stakeholder Management

Education
MBA, INSEAD, 2013

Languages
English C2, German C1, Spanish B2`;

// ── Step 1 · Import ──────────────────────────────────────────────────────────

export function ImportStep() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, start] = useTransition();

  function submit() {
    const fd = new FormData();
    fd.set('rawText', text);
    fd.set('source', 'paste');
    start(async () => {
      await startImportAction(fd);
      router.refresh();
    });
  }

  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-sm font-semibold text-ink">Paste your CV or LinkedIn export</h2>
      <p className="mt-1 text-sm text-ink-muted">
        We extract a draft — positions, STAR stories, skills, education, languages. You approve every
        node next; nothing is kept until you say so, and we never invent a metric.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={14}
        placeholder="Paste here…"
        className="mt-3 w-full rounded-field border border-hairline bg-surface px-3 py-2.5 font-mono text-xs leading-relaxed text-ink shadow-xs placeholder:text-ink-subtle focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-500/12"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={submit} loading={busy} disabled={text.trim().length < 20} rightIcon={<span aria-hidden>→</span>}>
          Extract draft
        </Button>
        <Button variant="ghost" type="button" onClick={() => setText(SAMPLE)} disabled={busy}>
          Use a sample
        </Button>
        {busy && <span className="text-xs text-ink-subtle">Extracting…</span>}
      </div>
    </Card>
  );
}

// ── Step 2 · Curation gate ───────────────────────────────────────────────────

function collectIds(d: DraftGraph, minConfidence = 0): string[] {
  const ids: string[] = [];
  const ok = (c?: number | null) => (c ?? 0) >= minConfidence;
  d.positions.forEach((p) => ok(p.confidence) && ids.push(p.id));
  d.stories.forEach((s) => {
    if (ok(s.confidence)) ids.push(s.id);
    s.actions.forEach((a) => ok(a.confidence) && ids.push(a.id));
    s.results.forEach((r) => ok(r.confidence) && ids.push(r.id));
  });
  d.skills.forEach((s) => ok(s.confidence) && ids.push(s.id));
  d.education.forEach((e) => ok(e.confidence) && ids.push(e.id));
  d.languages.forEach((l) => ok(l.confidence) && ids.push(l.id));
  return ids;
}

export function CurationGate({ draft }: { draft: DraftGraph }) {
  const router = useRouter();
  const allIds = useMemo(() => collectIds(draft), [draft]);
  // Extraction confidence drives the default: high-confidence nodes start kept,
  // uncertain ones (<0.6) are left for you to consciously opt in.
  const [kept, setKept] = useState<Set<string>>(() => new Set(collectIds(draft, 0.6)));
  const [busy, start] = useTransition();

  const toggle = (id: string) =>
    setKept((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  function commit() {
    start(async () => {
      await commitDraftAction(Array.from(kept));
      router.refresh();
    });
  }
  function reset() {
    start(async () => {
      await resetOnboardingAction();
      router.refresh();
    });
  }

  const empty =
    draft.positions.length + draft.stories.length + draft.skills.length + draft.education.length + draft.languages.length === 0;
  const keptPct = allIds.length ? Math.round((kept.size / allIds.length) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* The dark "commit gate" — the prototype's signature onboarding moment: the
          same Keep/Drop judgement the user makes on every CV, on a dark hero bar. */}
      <div className="sticky top-16 z-10 flex flex-wrap items-center gap-4 rounded-card bg-dark px-4 py-3.5 shadow-card">
        <div className="flex items-baseline gap-1.5">
          <span className="font-serif text-2xl leading-none text-dark-accent">{kept.size}</span>
          <span className="text-[13px] text-dark-muted">of {allIds.length} kept</span>
        </div>
        <div className="h-1.5 min-w-[120px] flex-1 overflow-hidden rounded-full bg-dark-raised">
          <div
            className="h-full rounded-full bg-dark-accent transition-[width] duration-300"
            style={{ width: `${keptPct}%` }}
          />
        </div>
        <span className="text-xs font-semibold text-dark-muted">{keptPct}% of draft kept</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={reset}
            disabled={busy}
            className="rounded-md px-2.5 py-1.5 text-xs font-semibold text-dark-muted transition hover:text-dark-ink disabled:opacity-50"
          >
            Start over
          </button>
          <button
            type="button"
            onClick={commit}
            disabled={busy || kept.size === 0}
            className="rounded-md bg-dark-accent px-4 py-2 text-[13px] font-bold text-[#0C2A1F] transition hover:brightness-105 disabled:opacity-50"
          >
            Commit approved ({kept.size}) →
          </button>
        </div>
      </div>

      {empty && (
        <Card className="p-5 text-center text-sm text-ink-muted sm:p-6">
          The extractor didn&apos;t find structured evidence in that text. Try a fuller CV, or{' '}
          <button className="font-medium text-brand-600 hover:text-brand-700" onClick={reset}>
            start over
          </button>
          .
        </Card>
      )}

      {draft.profile && (draft.profile.name || draft.profile.headline) && (
        <Section title="Identity" hint="Used only if you have none yet — never overwrites your details">
          <div className="rounded-field border border-hairline bg-surface px-3.5 py-2.5 text-sm">
            <span className="font-medium text-ink">{draft.profile.name ?? '—'}</span>
            {draft.profile.headline && <span className="text-ink-muted"> · {draft.profile.headline}</span>}
            {draft.profile.location && <span className="text-ink-subtle"> · {draft.profile.location}</span>}
          </div>
        </Section>
      )}

      {draft.positions.length > 0 && (
        <Section title="Positions" hint={`${draft.positions.length} found`}>
          {draft.positions.map((p) => (
            <NodeRow key={p.id} kept={kept.has(p.id)} confidence={p.confidence} onToggle={() => toggle(p.id)}>
              <span className="font-medium text-ink">{p.title || '—'}</span>
              {(p.company || p.startDate) && (
                <span className="text-xs text-ink-subtle">
                  {' '}
                  {[p.company, [p.startDate, p.endDate].filter(Boolean).join(' – ')].filter(Boolean).join(' · ')}
                </span>
              )}
            </NodeRow>
          ))}
        </Section>
      )}

      {draft.stories.map((s) => (
        <Section key={s.id} title={s.title} hint={`${s.actions.length} actions · ${s.results.length} results`}>
          <NodeRow kept={kept.has(s.id)} confidence={s.confidence} onToggle={() => toggle(s.id)}>
            <span className="font-medium text-ink">Story: {s.title}</span>
          </NodeRow>
          {s.actions.map((a) => (
            <NodeRow key={a.id} kept={kept.has(a.id)} confidence={a.confidence} onToggle={() => toggle(a.id)} indent>
              {a.text}
            </NodeRow>
          ))}
          {s.results.map((r) => (
            <NodeRow key={r.id} kept={kept.has(r.id)} confidence={r.confidence} onToggle={() => toggle(r.id)} indent>
              {r.text}
              {r.metric ? (
                <Badge tone="green" className="ml-2">{r.metric}</Badge>
              ) : (
                <Badge tone="amber" className="ml-2">no metric</Badge>
              )}
            </NodeRow>
          ))}
        </Section>
      ))}

      {draft.skills.length > 0 && (
        <Section title="Skills" hint={`${draft.skills.length} found`}>
          {draft.skills.map((s) => (
            <NodeRow key={s.id} kept={kept.has(s.id)} confidence={s.confidence} onToggle={() => toggle(s.id)}>
              <span className="text-ink">{s.skill}</span>
            </NodeRow>
          ))}
        </Section>
      )}

      {draft.education.length > 0 && (
        <Section title="Education" hint={`${draft.education.length} found`}>
          {draft.education.map((e) => (
            <NodeRow key={e.id} kept={kept.has(e.id)} confidence={e.confidence} onToggle={() => toggle(e.id)}>
              <span className="text-ink">{e.qualification || '—'}</span>
              {e.year && <span className="text-xs text-ink-subtle"> · {e.year}</span>}
            </NodeRow>
          ))}
        </Section>
      )}

      {draft.languages.length > 0 && (
        <Section title="Languages" hint={`${draft.languages.length} found`}>
          {draft.languages.map((l) => (
            <NodeRow key={l.id} kept={kept.has(l.id)} confidence={l.confidence} onToggle={() => toggle(l.id)}>
              <span className="text-ink">{l.language}</span>
              {l.cefrLevel && <span className="text-xs text-ink-subtle"> · {l.cefrLevel}</span>}
            </NodeRow>
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {hint && <span className="text-[11px] text-ink-subtle">{hint}</span>}
      </div>
      <div className="space-y-2">{children}</div>
    </Card>
  );
}

function NodeRow({
  kept,
  confidence,
  onToggle,
  indent,
  children,
}: {
  kept: boolean;
  confidence: number;
  onToggle: () => void;
  indent?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-3 rounded-field border px-3.5 py-2 transition',
        indent && 'ml-4',
        kept ? 'border-hairline bg-surface' : 'border-hairline bg-raised opacity-55'
      )}
    >
      <div className={cn('min-w-0 text-sm', !kept && 'line-through')}>{children}</div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="hidden text-[10px] tabular-nums text-ink-subtle sm:inline" title="extraction confidence">
          {Math.round(confidence * 100)}%
        </span>
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={kept}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition',
            kept ? 'bg-proof text-white ring-transparent' : 'bg-surface text-ink-muted ring-hairline hover:bg-raised'
          )}
        >
          {kept ? 'Keep' : 'Dropped'}
        </button>
      </div>
    </div>
  );
}
