'use client';

/**
 * "Your story" view (Additive Plan · C1). Renders the latest through-line and its
 * two copy-out drafts. Generation and copy are the reaction signals — copy-out
 * doubles as the quiet pilot of the missing cover-letter step. Touches nothing
 * existing; it's a pure read of the story versions plus two server actions.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { generateStoryAction, trackStoryCopyAction } from '@/app/actions/story';
import { cn } from './kit';

export type StoryData = {
  throughLine: string;
  coverLetter: string | null;
  linkedinAbout: string | null;
  evidenceCount: number | null;
  createdAt: string | null;
  versions: number;
} | null;

export function StoryView({ story }: { story: StoryData }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function regenerate() {
    start(async () => {
      await generateStoryAction();
      router.refresh();
    });
  }

  return (
    <div className="mt-6">
      {story ? (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-[12px] text-ink-subtle">
              Drawn from {story.evidenceCount ?? 0} approved nodes · v{story.versions}
              {story.createdAt ? ` · ${new Date(story.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}
            </div>
            <button
              type="button"
              onClick={regenerate}
              disabled={pending}
              className="rounded-[9px] border border-hairline bg-surface px-4 py-2 text-[12px] font-bold text-ink transition hover:bg-raised disabled:opacity-60"
            >
              {pending ? 'Rewriting…' : '↻ Regenerate from graph'}
            </button>
          </div>

          <article className="rounded-card border border-hairline bg-surface p-6 shadow-card sm:p-7">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-proof-deep">Through-line</div>
            <div className="mt-3 whitespace-pre-wrap font-serif text-[18px] leading-relaxed text-ink">{story.throughLine}</div>
          </article>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <CopyCard title="Cover letter" body={story.coverLetter} which="cover_letter" />
            <CopyCard title="LinkedIn About" body={story.linkedinAbout} which="linkedin" />
          </div>
          <p className="mt-4 text-[11.5px] text-ink-subtle">
            Every line traces to evidence you approved — nothing invented. Regenerate after a coaching session to see the arc firm up.
          </p>
        </>
      ) : (
        <div className="rounded-card border border-hairline bg-surface p-10 text-center shadow-card">
          <div className="font-serif text-2xl text-ink">Write your through-line</div>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
            One pass over your approved evidence produces the thread connecting your roles — plus copy-out cover-letter and
            LinkedIn drafts. Nothing is invented; it stays supportable by your graph.
          </p>
          <button
            type="button"
            onClick={regenerate}
            disabled={pending}
            className="mt-5 inline-flex rounded-[9px] bg-proof px-5 py-2.5 text-[13px] font-bold text-white transition hover:bg-proof-deep disabled:opacity-60"
          >
            {pending ? 'Writing…' : '✦ Generate my story'}
          </button>
        </div>
      )}
    </div>
  );
}

function CopyCard({ title, body, which }: { title: string; body: string | null; which: 'cover_letter' | 'linkedin' }) {
  const [copied, setCopied] = useState(false);
  if (!body) return null;

  function copy() {
    void trackStoryCopyAction(which);
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(body!).then(
        () => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        },
        () => {}
      );
    }
  }

  return (
    <div className="flex flex-col rounded-card border border-hairline bg-surface p-5 shadow-card">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-subtle">{title}</div>
        <button
          type="button"
          onClick={copy}
          className={cn(
            'rounded-md px-2.5 py-1 text-[11px] font-bold transition',
            copied ? 'bg-proof-soft text-proof-deep' : 'border border-hairline text-ink-muted hover:bg-raised hover:text-ink'
          )}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{body}</div>
    </div>
  );
}
