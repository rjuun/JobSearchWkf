'use server';

/**
 * R5 · The Weekly Triage — the capacity control. Sets how many tailorings/week the
 * owner can realistically do; the triage trims its "this week" picks to it. Owner
 * resolved server-side, value clamped in the query helper, best-effort.
 */
import { revalidatePath } from 'next/cache';
import { setWeeklyCapacity } from '@/lib/queries';

export async function setWeeklyCapacityAction(n: number): Promise<void> {
  try {
    await setWeeklyCapacity(n);
    revalidatePath('/roleproof');
  } catch {
    /* never break the board for a capacity nudge */
  }
}
