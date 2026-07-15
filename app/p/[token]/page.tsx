import { notFound } from 'next/navigation';
import type { Metadata, Viewport } from 'next';
import { env } from '@/lib/env';
import { getPublicProof, recordProofVisit } from '@/lib/proof-link';
import { ProofMobileBeacon } from '@/components/proof-mobile-beacon';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'RoleProof — proof', robots: { index: false, follow: false } };
// R7 · 3b · a phone is where a recruiter actually opens this. Pin the mobile viewport.
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

// C4 · The public Proof Link + R7 · 3b (recruiter's phone). A standalone page (NO
// AppShell — no session) showing a read-only proof summary, tuned mobile-first for a
// ~430px screen: a single focused column, phone-legible type, zero contact fields.
// 404s unless the owner has opted in.
export default async function ProofLinkPage({ params }: { params: { token: string } }) {
  if (!env.nextProofLink) notFound();
  const proof = await getPublicProof(params.token);
  if (!proof) notFound();
  void recordProofVisit(proof.ownerId);

  const stats = [
    { label: 'graph strength', value: `${proof.strength}` },
    { label: 'roles', value: `${proof.positions}` },
    { label: 'evidence nodes', value: `${proof.evidenceCount}` },
    { label: 'targets in play', value: `${proof.targets}` },
  ];

  return (
    <main className="min-h-screen bg-canvas px-4 py-10 sm:py-14">
      <ProofMobileBeacon token={params.token} />
      {/* Phone-width column — reads as a focused proof card on any device. */}
      <div className="mx-auto w-full max-w-[440px]">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-[8px] bg-proof text-[15px] font-bold text-white">R</span>
          <span className="text-[14px] font-bold tracking-tight text-ink">RoleProof</span>
          <span className="ml-auto rounded-full bg-proof-soft px-2.5 py-1 text-[11px] font-semibold text-proof-deep">verified proof</span>
        </div>

        <div className="mt-5 rounded-card border border-hairline bg-surface p-5 shadow-card sm:p-7">
          <h1 className="font-serif text-[27px] leading-tight text-ink sm:text-[32px]">{proof.name}</h1>
          {proof.headline && <p className="mt-1 text-[14px] leading-snug text-ink-muted sm:text-[15px]">{proof.headline}</p>}
          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-proof-soft px-3 py-1 text-[12px] font-semibold text-proof-deep">
            {proof.label} · {proof.strength}/100 graph strength
          </div>

          {/* 2×2 on a phone; the numbers stay large and legible at arm's length. */}
          <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-hairline bg-hairline">
            {stats.map((s) => (
              <div key={s.label} className="bg-surface px-4 py-5 text-center">
                <div className="font-serif text-[30px] leading-none tabular-nums text-ink">{s.value}</div>
                <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-subtle">{s.label}</div>
              </div>
            ))}
          </div>

          <p className="mt-6 text-[12.5px] leading-relaxed text-ink-muted">
            A shared proof summary — how much approved, evidence-backed history stands behind this candidate. No contact
            details, no raw evidence; a signal of substance, made public by the candidate.
          </p>
        </div>
        <p className="mt-4 text-center text-[11px] leading-relaxed text-ink-subtle">
          Shared via RoleProof · the candidate can revoke this link at any time
        </p>
      </div>
    </main>
  );
}
