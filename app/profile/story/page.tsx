import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { AppShell } from '@/components/app-shell';
import { env } from '@/lib/env';
import { currentOwnerId } from '@/lib/auth';
import { latestStory, storyVersionCount } from '@/lib/story';
import { StoryView, type StoryData } from '@/components/roleproof/story-view';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const metadata: Metadata = { title: 'RoleProof — your story' };

// C1 · "Your story" — the through-line generated from approved evidence, with
// copy-out cover-letter and LinkedIn drafts. A new tab; touches nothing existing.
export default async function StoryPage() {
  if (!env.nextStory) redirect('/profile');
  const owner = await currentOwnerId();
  const [v, versions] = await Promise.all([latestStory(owner), storyVersionCount(owner)]);
  const story: StoryData = v
    ? {
        throughLine: v.throughLine,
        coverLetter: v.coverLetter,
        linkedinAbout: v.linkedinAbout,
        evidenceCount: v.evidenceCount,
        createdAt: v.createdAt ? v.createdAt.toISOString() : null,
        versions,
      }
    : null;

  return (
    <AppShell>
      <Link href="/profile" className="inline-flex items-center gap-1.5 text-sm text-ink-muted transition hover:text-ink">
        <span aria-hidden>←</span> Back to your Career Graph
      </Link>
      <div className="mb-2 mt-3 flex items-center gap-2">
        <Link href="/profile" className="rounded-md px-3 py-1.5 text-sm font-medium text-ink-muted transition hover:bg-raised hover:text-ink">
          Strength meter
        </Link>
        <span aria-current="page" className="rounded-md bg-raised px-3 py-1.5 text-sm font-medium text-ink">
          Your story
        </span>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Your story</h1>
      <p className="mt-1 max-w-[62ch] text-sm text-ink-muted">
        The through-line that connects your roles — and ready-to-adapt cover-letter and LinkedIn drafts, all built from the
        evidence you’ve approved.
      </p>
      <StoryView story={story} />
    </AppShell>
  );
}
