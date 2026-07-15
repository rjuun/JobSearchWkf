'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { startScreenFirstAction, startWarmUpAction } from '@/app/actions/onboarding';
import { cn } from './ui';

const SAMPLE_CV = `Reginaldo Silva Junior
Senior Finance & Transformation Leader — Vienna, Austria

Experience
Head of Shared Services at Banco BBSA Europe  2018 - Present
- Established a servicing centre in Portugal, consolidating 6 back-office functions
- Cut operating costs by 22% through process standardisation
- Led the merger integration of two European branches
Finance Transformation Lead at BBAG  2014 - 2018
- Delivered a governance transformation programme across the group
- Built and led a team of 12 analysts

Skills: Process Standardisation, Shared Services, SAP S/4HANA, Change Management, FP&A, Governance, Controlling

Education
MBA, INSEAD, 2013

Languages
English C1, German C1, Portuguese C2, Spanish B2`;

const SAMPLE_JD = `Global Process Owner — Operations & Shared Services
Acme Group · Vienna (hybrid)

About the role
We are looking for a Global Process Owner to lead the harmonisation and standardisation of
our finance and back-office processes across 12 countries.

Core requirements
- Proven global process ownership and harmonisation
- Demonstrated leadership in ERP-enabled process transformation and post-ERP stabilisation
- Success in process standardisation, automation and AI adoption
- Experience designing and running a shared-services or operating model
- Stakeholder management at executive level

Important
- Change / transformation programme delivery
- Controlling or FP&A background`;

function Submit({ ready }: { ready: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || !ready}
      className="rounded-field bg-proof px-6 py-3 text-[14px] font-bold text-white transition hover:bg-proof-deep disabled:opacity-60"
    >
      {pending ? 'Reading & screening…' : 'Screen this role →'}
    </button>
  );
}

/** No-job-ad fallback (M5): build the graph from the CV alone and warm up with the coach. */
function WarmUp({ ready }: { ready: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      formAction={startWarmUpAction}
      disabled={pending || !ready}
      className="text-[12.5px] font-semibold text-proof-deep underline decoration-dotted underline-offset-2 transition hover:text-proof disabled:opacity-50"
    >
      No job ad yet? Build from your CV →
    </button>
  );
}

export function StartForm({ error }: { error?: boolean }) {
  const [cv, setCv] = useState('');
  const [jd, setJd] = useState('');
  // Mirror the server thresholds so a failed submit never navigates away and loses the paste.
  const ready = cv.trim().length >= 20 && jd.trim().length >= 80;
  const cvReady = cv.trim().length >= 20;

  return (
    <form action={startScreenFirstAction} className="mt-6 flex flex-col gap-5">
      {error && (
        <div className="rounded-field border border-caution-ring bg-caution-soft px-4 py-2.5 text-[13px] text-caution-deep">
          Paste both your CV (a few lines is enough) and a full job ad (at least a paragraph) to screen.
        </div>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Your CV or LinkedIn text" hint="Rough paste is fine — we draft your Career Graph from it.">
          <textarea
            name="cv"
            value={cv}
            onChange={(e) => setCv(e.target.value)}
            placeholder="Paste your CV / experience…"
            className={fieldCls}
          />
          <SampleBtn onClick={() => setCv(SAMPLE_CV)} />
        </Field>
        <Field label="One job ad you're eyeing" hint="The role you want to know is worth it.">
          <textarea
            name="jd"
            value={jd}
            onChange={(e) => setJd(e.target.value)}
            placeholder="Paste the full job description…"
            className={fieldCls}
          />
          <SampleBtn onClick={() => setJd(SAMPLE_JD)} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <input name="title" placeholder="Role title (optional)" className={inputCls} />
        <input name="company" placeholder="Company (optional)" className={inputCls} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Submit ready={ready} />
        <span className="text-[12px] text-ink-subtle">
          We draft; you approve. Nothing reaches your CV until you keep it.
        </span>
      </div>
      <div className="border-t border-hairline pt-3">
        <WarmUp ready={cvReady} />
      </div>
    </form>
  );
}

const fieldCls =
  'min-h-[220px] w-full resize-y rounded-field border border-hairline bg-surface px-4 py-3 text-[13px] leading-relaxed text-ink outline-none focus:border-proof-ring focus:ring-4 focus:ring-proof/10';
const inputCls =
  'w-full rounded-field border border-hairline bg-surface px-4 py-2.5 text-[13px] text-ink outline-none focus:border-proof-ring focus:ring-4 focus:ring-proof/10';

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-semibold text-ink">{label}</span>
      <span className="text-[11px] text-ink-subtle">{hint}</span>
      <div className="relative mt-1">{children}</div>
    </label>
  );
}

function SampleBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('absolute bottom-2 right-2 rounded-md border border-hairline bg-raised px-2 py-1 text-[10.5px] font-semibold text-ink-muted transition hover:text-ink')}
    >
      Use a sample
    </button>
  );
}
