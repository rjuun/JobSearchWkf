import type { Metadata } from 'next';
import { JetBrains_Mono, Instrument_Serif, Hanken_Grotesk } from 'next/font/google';
import './globals.css';

// Self-hosted at build time (no runtime network). Inter carries the UI;
// JetBrains Mono is reserved for evidence ref codes, scores and raw JD text.
// RoleProof rebrand (global) — Hanken Grotesk is the interface face everywhere.
const sans = Hanken_Grotesk({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});
const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
  weight: ['400', '500', '600'],
});

// Instrument Serif — the editorial display face (scores, headlines, big moments).
const serif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'RoleProof',
  description:
    'RoleProof — prove fit with evidence: screen roles, score honestly, and generate tailored, ATS-ready CVs you can defend.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} ${serif.variable}`}
    >
      <body className="min-h-screen bg-canvas font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
