'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { profiles } from '@/lib/db/schema';
import { currentOwnerId } from '@/lib/auth';
import { getPublicProof } from '@/lib/proof-link';
import { recordUxEvent } from '@/lib/ux-events';

/**
 * C4 · Turn the public Proof Link on or off. Enabling mints a token once (kept on
 * disable so re-enabling restores the same URL); disabling makes /p/<token> 404
 * immediately. Opt-in — nothing is public until the user flips this.
 */
export async function toggleProofLinkAction(enable: boolean): Promise<{ enabled: boolean; token: string | null }> {
  const owner = await currentOwnerId();
  const [p] = await db.select({ token: profiles.publicToken }).from(profiles).where(eq(profiles.id, owner));
  const firstMint = enable && !p?.token;
  let token = p?.token ?? null;

  if (firstMint) {
    // 96-bit tokens effectively never collide, but the partial unique index makes a
    // collision a hard error (not a wrong-user exposure) — regenerate on the off chance.
    for (let i = 0; i < 3; i++) {
      const candidate = randomBytes(12).toString('base64url');
      try {
        await db.update(profiles).set({ publicEnabled: true, publicToken: candidate }).where(eq(profiles.id, owner));
        token = candidate;
        break;
      } catch (err) {
        if (i === 2) throw err;
      }
    }
  } else {
    await db.update(profiles).set({ publicEnabled: enable, publicToken: token }).where(eq(profiles.id, owner));
  }

  // Emit `create` ONLY on the first mint — re-enabling after disable must not
  // inflate the fold-decision telemetry this feature is measured by.
  if (firstMint) await recordUxEvent(owner, 'proof_link', 'create');
  revalidatePath('/profile');
  return { enabled: enable, token };
}

/**
 * R7 · 3b · A phone-sized visit to a Proof Link. The public page has no session, so
 * the owner is resolved from the token (never from the visitor). Best-effort; emits
 * `proof_link · mobile_open` — the share of proof views that happen where a recruiter
 * actually reads it, the signal for the mobile-proof fold question.
 */
export async function trackProofMobileAction(token: string): Promise<void> {
  try {
    const proof = await getPublicProof(token);
    if (proof) await recordUxEvent(proof.ownerId, 'proof_link', 'mobile_open');
  } catch {
    /* telemetry only — a public page must never error for the visitor */
  }
}
