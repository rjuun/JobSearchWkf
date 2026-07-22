import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getLead, getPipelineRuns, getRequirements, getTailoring, tipsForLead } from '@/lib/queries';
import { readText, exists } from '@/lib/storage';
import { journeyState } from '@/lib/journey';
import { recommendationFor } from '@/lib/scoring';
import { hasOpenScreeningGap } from '@/lib/coaching-queue';
import { currentOwnerId } from '@/lib/auth';
import { env } from '@/lib/env';
import { RpShell } from '@/components/roleproof/rp-shell';
import { RpWorkspace, type RpLead, type RpReq, type RpRow } from '@/components/roleproof/workspace';
import { normalizeCvPosition } from '@/lib/cv-slots';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const metadata: Metadata = { title: 'RoleProof — workspace' };

// Act II · the lead workspace — a single two-pane command center (JD left,
// decision rail right). The earlier 2A/2C comparison toggle was retired in the
// redesign_2 consolidation; this is the one canonical workspace.
export default async function RoleProofWorkspacePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { onboarded?: string };
}) {
  const lead = await getLead(params.id);
  if (!lead) notFound();

  const owner = await currentOwnerId();
  const [requirements, jd, tailoring, cvReady, leadTips, runTrace, coachBridge] = await Promise.all([
    getRequirements(lead.id),
    lead.rawJdPath ? readText(lead.rawJdPath).catch(() => null) : Promise.resolve(null),
    getTailoring(lead.id),
    exists(`cv-output/${lead.id}/tailored.docx`),
    tipsForLead(lead.id),
    getPipelineRuns(lead.id),
    hasOpenScreeningGap(owner, lead.id),
  ]);

  const cleanedJd = cleanJd(jd);

  // Hydrate the ATS score from the latest C7 run so it survives a page reload
  // (runs are ordered newest-first). C7 persists its rating in pipeline_runs.output.
  const initialAtsRating = atsRatingFromRuns(runTrace);

  const greenCount = tailoring.filter((t) => t.approvalStatus === 'green').length;
  const recommendation =
    lead.recommendation ??
    (lead.overallFitScore != null ? recommendationFor(lead.overallFitScore) : null);
  const journey = journeyState({
    status: lead.status,
    scored: lead.overallFitScore != null,
    recommendation,
    mappedCount: tailoring.length,
    mappableRequirementCount: requirements.filter((r) => r.rank === 'Core' || r.rank === 'Important').length,
    keptCount: greenCount,
    cvReady,
  });

  const rpLead: RpLead = {
    id: lead.id,
    title: lead.title,
    company: lead.company,
    city: lead.city,
    status: lead.status,
    isTarget: lead.isTarget,
    jdGroupPrimary: lead.jdGroupPrimary,
    atsSystem: lead.atsSystem,
    sourceUrl: lead.sourceUrl,
    jobPostLink: lead.jobPostLink,
    overallFitScore: lead.overallFitScore,
    postedDays: lead.postedDays,
    freshnessBand: lead.freshnessBand,
    saturationBand: lead.saturationBand,
    roadblocks: (lead.roadblocks ?? []) as { dimension: string; detail: string }[],
    misalignments: (lead.misalignments ?? []) as { dimension: string; detail: string }[],
    skillRatings: (lead.skillRatings ?? {}) as Record<string, number>,
  };

  const requirementsRp: RpReq[] = requirements.map((r) => ({
    id: r.id,
    requirementOrder: r.requirementOrder,
    rank: r.rank,
    requirement: r.requirement,
    description: r.description,
    initialScore: r.initialScore,
    initialMatchStrength: r.initialMatchStrength,
    skills: r.skills ?? [],
  }));

  const tailoringRp: RpRow[] = tailoring.map((t) => ({
    id: t.id,
    requirementLine: t.requirementLine,
    evidenceRef: t.evidenceRef,
    originalText: t.originalText,
    cvBullet: t.cvBullet,
    cvPosition: normalizeCvPosition(t.cvPosition),
    approvalStatus: t.approvalStatus,
    provSource: t.provSource,
    approvedAt: t.approvedAt ? t.approvedAt.toISOString() : null,
    mySkills: t.mySkills ?? [],
    requirementSkills: t.requirementSkills ?? [],
  }));

  const dims = [
    { label: 'Relevance', value: lead.scoreRelevance },
    { label: 'Seniority', value: lead.scoreSeniority },
    { label: 'Impact', value: lead.scoreImpact },
    { label: 'Req. align', value: lead.scoreReqAlignment },
    { label: 'ATS', value: lead.scoreAts },
  ];

  return (
    <RpShell back={{ href: '/roleproof', label: 'All leads' }}>
      {searchParams.onboarded === '1' && (
        <div className="mx-auto mb-4 mt-4 flex w-full max-w-6xl items-start gap-3 rounded-card border border-proof-ring bg-proof-soft/60 px-4 py-3 text-[13px] sm:px-6">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-proof text-white">✦</span>
          <span className="text-ink-muted">
            Your Career Graph is born — this verdict is <b className="font-semibold text-proof-deep">based on your imported
            history</b>. Keep the evidence below onto your CV, and it firms up as you approve. Your first coach session is
            waiting on the <a href="/profile/coach" className="font-semibold text-proof-deep underline">Career Graph</a>.
          </span>
        </div>
      )}
      <RpWorkspace
        lead={rpLead}
        requirements={requirementsRp}
        tailoring={tailoringRp}
        jd={cleanedJd}
        journey={journey}
        recommendation={recommendation}
        dims={dims}
        cvReady={cvReady}
        leadTips={leadTips.map((t) => ({ id: t.id, observation: t.observation ?? '' }))}
        runTrace={runTrace.map((run) => ({
          step: run.step,
          model: run.model,
          finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
        }))}
        initialAtsRating={initialAtsRating}
        coachBridge={coachBridge}
        nextInterviewBrief={env.nextInterviewBrief}
      />
    </RpShell>
  );
}

/** Strip captured-markdown noise (YAML frontmatter, fenced code/tracker blocks) so the
 *  posting reads as prose. We keep the body verbatim — no rewriting of the JD. */
const JD_CHROME = [
  /clicked apply/i,
  /responses managed off linkedin/i,
  /job match is high/i,
  /your profile and resume match/i,
  /is this information helpful/i,
  /others in your network/i,
  /^promoted by/i,
  /easy apply/i,
  /see how you compare/i,
];
/** Pull the most recent C7 ATS rating out of the pipeline runs (newest-first). */
function atsRatingFromRuns(runs: { step: string; output: unknown }[]): number | null {
  const c7 = runs.find((r) => r.step === 'C7');
  const out = c7?.output as { atsRating?: unknown } | null | undefined;
  return typeof out?.atsRating === 'number' ? out.atsRating : null;
}

function cleanJd(raw: string | null): string | null {
  if (!raw) return null;
  let t = raw.replace(/\r\n/g, '\n');
  t = t.replace(/^\s*(?:---[\s\S]*?---\s*)+/, ''); // leading YAML frontmatter block(s)
  t = t.replace(/```[\s\S]*?```/g, ''); // fenced code / time-tracker blocks
  // Drop scraped LinkedIn UI chrome lines (conservative — known boilerplate only).
  t = t
    .split('\n')
    .filter((line) => !JD_CHROME.some((re) => re.test(line.trim())))
    .join('\n');
  t = t.replace(/\n{3,}/g, '\n\n').trim();
  return t || null;
}
