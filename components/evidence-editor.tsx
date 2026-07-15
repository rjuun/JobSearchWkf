'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { saveRow, deleteRow } from '@/app/actions/profile';
import { Button, Input, Textarea, Field, Badge, cn } from './ui';

export type FieldDef = {
  name: string;
  label: string;
  type?: 'text' | 'textarea' | 'list';
  placeholder?: string;
  required?: boolean;
  /** render at half width on sm+ (paired with another half field) */
  half?: boolean;
};

/**
 * Generic CRUD list for one evidence table. Imports the server actions directly. Row summaries
 * live here (keyed by `kind`) rather than as a prop, because a Server Component page cannot pass a
 * render function across the boundary to this Client Component — only serializable data crosses.
 */
export function EvidenceEditor<R extends { id: string }>({
  kind,
  rows,
  fields,
  addLabel,
  emptyText,
}: {
  kind: string;
  rows: R[];
  fields: FieldDef[];
  addLabel: string;
  emptyText?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null); // row id | 'new' | null
  const [busy, startBusy] = useTransition();

  function submit(fd: FormData) {
    startBusy(async () => {
      await saveRow(fd);
      setEditing(null);
      router.refresh();
    });
  }
  function remove(id: string) {
    const fd = new FormData();
    fd.set('__kind', kind);
    fd.set('id', id);
    startBusy(async () => {
      await deleteRow(fd);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      {rows.map((r) =>
        editing === r.id ? (
          <RowForm key={r.id} kind={kind} fields={fields} row={r as Record<string, unknown>} busy={busy} onSubmit={submit} onCancel={() => setEditing(null)} />
        ) : (
          <div
            key={r.id}
            className="flex items-start justify-between gap-3 rounded-field border border-hairline bg-surface px-3.5 py-2.5 transition hover:border-slate-300"
          >
            <div className="min-w-0">
              {renderSummary(kind, r as Record<string, unknown>)}
              <Prov source={(r as Record<string, unknown>).source as string | undefined} />
            </div>
            <div className="flex shrink-0 gap-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(r.id)} disabled={busy}>
                Edit
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => remove(r.id)}
                disabled={busy}
                className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
              >
                Delete
              </Button>
            </div>
          </div>
        )
      )}

      {rows.length === 0 && editing !== 'new' && (
        <p className="rounded-field border border-dashed border-hairline px-3.5 py-3 text-sm text-ink-subtle">
          {emptyText ?? 'Nothing here yet.'}
        </p>
      )}

      {editing === 'new' ? (
        <RowForm kind={kind} fields={fields} row={null} busy={busy} onSubmit={submit} onCancel={() => setEditing(null)} />
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setEditing('new')}
          disabled={busy}
          leftIcon={<span aria-hidden className="text-base leading-none">+</span>}
        >
          {addLabel}
        </Button>
      )}
    </div>
  );
}

// ── Row summaries (per kind) ─────────────────────────────────────────────────

const s = (v: unknown) => (v == null ? '' : String(v));
const arr = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);
function Ref({ code }: { code: unknown }) {
  return code ? <span className="ref text-ink-subtle">{String(code)}</span> : null;
}

function renderSummary(kind: string, r: Record<string, unknown>): ReactNode {
  switch (kind) {
    case 'positions':
      return (
        <div className="text-sm">
          <div className="flex items-center gap-2">
            <Ref code={r.refCode} />
            <span className="font-medium text-ink">{s(r.title) || '—'}</span>
          </div>
          <div className="text-xs text-ink-subtle">
            {[s(r.company), [s(r.startDate), s(r.endDate)].filter(Boolean).join(' – ')].filter(Boolean).join(' · ')}
          </div>
        </div>
      );
    case 'stars':
      return (
        <div className="text-sm">
          <div className="flex items-center gap-2">
            <Ref code={r.refCode} />
            {r.positionRef ? <span className="ref text-ink-subtle">@ {s(r.positionRef)}</span> : null}
            <span className="font-medium text-ink">{s(r.title) || '—'}</span>
          </div>
          {r.summary ? <div className="line-clamp-1 text-xs text-ink-subtle">{s(r.summary)}</div> : null}
        </div>
      );
    case 'actions':
      return (
        <div className="text-sm">
          <div className="line-clamp-2 text-ink">{s(r.text) || '—'}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Ref code={r.refCode} />
            {arr(r.skills).slice(0, 3).map((x) => (
              <Badge key={x} tone="neutral">{x}</Badge>
            ))}
          </div>
        </div>
      );
    case 'results':
      return (
        <div className="text-sm">
          <div className="line-clamp-2 text-ink">{s(r.text) || '—'}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Ref code={r.refCode} />
            {r.metric ? <Badge tone="green">{s(r.metric)}</Badge> : <Badge tone="amber">no metric</Badge>}
          </div>
        </div>
      );
    case 'competences':
      return (
        <div className="flex items-center gap-2 text-sm">
          <Ref code={r.refCode} />
          <span className="text-ink">{s(r.competence) || '—'}</span>
        </div>
      );
    case 'attributes':
      return (
        <div className="flex items-center gap-2 text-sm">
          <Ref code={r.refCode} />
          <span className="text-ink">{s(r.attribute) || '—'}</span>
        </div>
      );
    case 'responsibilities':
      return (
        <div className="text-sm">
          <div className="flex items-center gap-2">
            <Ref code={r.refCode} />
            {r.positionRef ? <span className="ref text-ink-subtle">@ {s(r.positionRef)}</span> : null}
          </div>
          <div className="line-clamp-2 text-ink">{s(r.text) || '—'}</div>
        </div>
      );
    case 'education':
      return (
        <div className="text-sm">
          <div className="flex items-center gap-2">
            <Ref code={r.refCode} />
            <span className="font-medium text-ink">{s(r.qualification) || '—'}</span>
          </div>
          <div className="text-xs text-ink-subtle">{[s(r.institution), s(r.year)].filter(Boolean).join(' · ')}</div>
        </div>
      );
    case 'languages':
      return (
        <div className="flex items-center gap-2 text-sm">
          <Ref code={r.refCode} />
          <span className="font-medium text-ink">{s(r.language) || '—'}</span>
          {r.cefrLevel ? <Badge tone="neutral">{s(r.cefrLevel)}</Badge> : null}
        </div>
      );
    case 'skills': {
      const ats = arr(r.atsKeywordVariants);
      return (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Ref code={r.refCode} />
          <span className="font-medium text-ink">{s(r.skill) || '—'}</span>
          {r.proficiency ? <span className="text-xs text-ink-subtle">{s(r.proficiency)}</span> : null}
          {ats.length > 0 ? (
            <Badge tone="neutral">{ats.length} ATS variant{ats.length === 1 ? '' : 's'}</Badge>
          ) : (
            <Badge tone="amber">no ATS variants</Badge>
          )}
        </div>
      );
    }
    case 'bullets':
      return (
        <div className="text-sm">
          <div className="line-clamp-2 text-ink">{s(r.text) || '—'}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Ref code={r.refCode} />
            {arr(r.tags).slice(0, 4).map((x) => (
              <Badge key={x} tone="neutral">{x}</Badge>
            ))}
          </div>
        </div>
      );
    default:
      return <span className="ref text-ink-subtle">{s(r.refCode)}</span>;
  }
}

function Prov({ source }: { source?: string }) {
  if (!source || source === 'authored') return null;
  const label = source === 'imported' ? 'imported' : source === 'ai_coached' ? 'AI-coached' : source;
  return (
    <span className="mt-1 inline-flex">
      <Badge tone={source === 'imported' ? 'neutral' : 'green'} className="text-[10px]">
        {label}
      </Badge>
    </span>
  );
}

function RowForm({
  kind,
  fields,
  row,
  busy,
  onSubmit,
  onCancel,
}: {
  kind: string;
  fields: FieldDef[];
  row: Record<string, unknown> | null;
  busy: boolean;
  onSubmit: (fd: FormData) => void;
  onCancel: () => void;
}) {
  return (
    <form action={onSubmit} className="rounded-field border border-brand-200 bg-brand-50/30 p-3.5">
      <input type="hidden" name="__kind" value={kind} />
      {row && <input type="hidden" name="id" value={String(row.id)} />}
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => {
          const raw = row ? row[f.name] : null;
          let defaultValue = '';
          if (Array.isArray(raw)) defaultValue = (raw as string[]).join(', ');
          else if (raw != null) defaultValue = String(raw);
          const id = `${kind}-${f.name}`;
          const full = f.type === 'textarea' || !f.half;
          return (
            <div key={f.name} className={cn(full && 'sm:col-span-2')}>
              <Field label={f.type === 'list' ? `${f.label} (comma-separated)` : f.label} htmlFor={id}>
                {f.type === 'textarea' ? (
                  <Textarea id={id} name={f.name} defaultValue={defaultValue} rows={3} placeholder={f.placeholder} required={f.required} />
                ) : (
                  <Input id={id} name={f.name} defaultValue={defaultValue} placeholder={f.placeholder} required={f.required} />
                )}
              </Field>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex gap-2">
        <Button type="submit" size="sm" loading={busy}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
