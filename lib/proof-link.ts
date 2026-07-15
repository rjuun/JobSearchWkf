/**
 * Proof Link (Additive Plan · C4). An opt-in, per-user public page at
 * /p/<publicToken>. Default OFF. It shows a read-only *proof summary* — graph
 * strength, how much approved evidence backs it, targets in play — and never any
 * contact detail or raw evidence text. The token is the unguessable key; toggling
 * off makes the page 404 immediately. This ships last on purpose: it's the only
 * surface that leaves the authenticated app.
 */
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { profiles } from './db/schema';
import { getCareerGraphFor } from './queries';
import { strengthOf } from './career-graph';
import { recordUxEvent } from './ux-events';

export type PublicProof = {
  ownerId: string;
  name: string;
  headline: string | null;
  strength: number;
  label: string;
  positions: number;
  evidenceCount: number;
  targets: number;
};

/** Resolve a public token to its proof summary — only while the owner has opted in. */
export async function getPublicProof(token: string): Promise<PublicProof | null> {
  if (!token) return null;
  // Project only what the public page needs — never load email/phone/location into
  // memory for a page that renders none of it.
  const [p] = await db
    .select({ id: profiles.id, name: profiles.name, headline: profiles.headline })
    .from(profiles)
    .where(and(eq(profiles.publicToken, token), eq(profiles.publicEnabled, true)));
  if (!p) return null;
  const graph = await getCareerGraphFor(p.id);
  const s = strengthOf(graph);
  const evidenceCount = graph.actions.length + graph.responsibilities.length + graph.bullets.length + graph.stars.length;
  return {
    ownerId: p.id,
    name: p.name,
    headline: p.headline,
    strength: s.score,
    label: s.label,
    positions: graph.positions.length,
    evidenceCount,
    targets: graph.targets.flaggedLeads,
  };
}

/** Record a third-party visit to a proof link (reaction signal). Best-effort. */
export async function recordProofVisit(ownerId: string): Promise<void> {
  await recordUxEvent(ownerId, 'proof_link', 'visit');
}
