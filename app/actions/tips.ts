'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { accuracyTips } from '@/lib/db/schema';
import { currentOwnerId } from '@/lib/auth';

export async function addTipAction(formData: FormData) {
  const observation = String(formData.get('observation') ?? '').trim();
  if (!observation) return;
  const owner = await currentOwnerId();
  await db.insert(accuracyTips).values({
    ownerId: owner,
    jobLeadId: String(formData.get('jobLeadId') ?? '').trim() || null,
    type: String(formData.get('type') ?? 'Process Refinement'),
    observation,
    suggestedAction: String(formData.get('suggestedAction') ?? '').trim() || null,
    whereApplies: String(formData.get('whereApplies') ?? '').trim() || null,
  });
  revalidatePath('/profile');
}

export async function resolveTipAction(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  const owner = await currentOwnerId();
  await db.update(accuracyTips).set({ resolved: true }).where(and(eq(accuracyTips.id, id), eq(accuracyTips.ownerId, owner)));
  revalidatePath('/profile');
}
