'use client';

/**
 * R7 · 3b · Emits `proof_link · mobile_open` when the public proof page is opened on
 * a phone-sized screen — the recruiter's actual reading surface. Fires once per load;
 * best-effort via a token-scoped server action (the page has no session).
 */
import { useEffect, useRef } from 'react';
import { trackProofMobileAction } from '@/app/actions/proof';

export function ProofMobileBeacon({ token }: { token: string }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 480px)').matches) {
      fired.current = true;
      void trackProofMobileAction(token);
    }
  }, [token]);
  return null;
}
