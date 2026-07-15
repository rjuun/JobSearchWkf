'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createLead } from '@/lib/pipeline/capture';
import { currentOwnerId } from '@/lib/auth';

export async function createLeadAction(formData: FormData) {
  const title = (String(formData.get('title') ?? '').trim() || 'Captured lead').slice(0, 200);
  const markdown = String(formData.get('markdown') ?? '').trim();
  const company = String(formData.get('company') ?? '').trim() || null;
  const city = String(formData.get('city') ?? '').trim() || null;
  const source = String(formData.get('source') ?? '').trim() || 'Manual';

  if (!markdown) redirect('/roleproof/capture?error=1');

  const id = await createLead({ title, company, city, source, markdown }, await currentOwnerId());
  revalidatePath('/roleproof');
  redirect(`/roleproof/leads/${id}`);
}
