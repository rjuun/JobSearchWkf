'use server';

import { revalidatePath } from 'next/cache';
import { currentOwnerId } from '@/lib/auth';
import { generateStory } from '@/lib/story';
import { recordActivity } from '@/lib/activity';
import { recordUxEvent } from '@/lib/ux-events';

/** C1 · generate a new through-line version from the current approved evidence. */
export async function generateStoryAction(): Promise<void> {
  const owner = await currentOwnerId();
  const v = await generateStory(owner);
  await recordActivity(owner, 'story_generated', { summary: 'Generated a career through-line' });
  await recordUxEvent(owner, 'story', 'generate', { meta: { evidenceCount: v.evidenceCount ?? 0 } });
  revalidatePath('/profile/story');
}

/** C1 · record a copy-out (cover letter / LinkedIn) — the reaction signal. */
export async function trackStoryCopyAction(which: 'cover_letter' | 'linkedin'): Promise<void> {
  try {
    const owner = await currentOwnerId();
    await recordUxEvent(owner, 'story', 'copy', { meta: { which } });
  } catch {
    /* telemetry only */
  }
}
