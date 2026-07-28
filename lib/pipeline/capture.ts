/**
 * Create a job lead from captured JD text (AI-driven capture or manual paste).
 * A1 · runs deterministic enrichment (URL cleanup, ATS detection) synchronously,
 * then one AI extraction pass (company/city/remote/formatSignals) immediately
 * after insert. Section C precedence: fields the caller already supplied (the
 * AI-driven path reads the JD itself) are used as-is and skip the Claude call
 * for whatever's missing; a plain manual paste supplies none of
 * remote/formatSignals, so it always falls back to the model.
 *
 * Since the Scoring Phase Redesign this also fires B1–B3 (`runInitialChecks`)
 * before returning, so a lead arrives on the board already sorted into
 * `selected` or `scoring_queue`. B4–B6 stay out of the capture path on purpose —
 * they run as a batch from Ready to score.
 */
import { and, eq, ilike } from 'drizzle-orm';
import { db } from '../db';
import { companies, jobLeads } from '../db/schema';
import { cleanJobPostLink, detectAtsSystem, mockCaptureExtraction, pickCandidateJobPostLink } from './capture-enrich';
import { runStructured } from '../llm/client';
import { A1, type A1Out } from '../llm/schemas';
import { NON_NEGOTIABLES } from '../prompts';
import { ciGuidanceFor } from '../ci';
import { runInitialChecks } from './screening';

export type CaptureInput = {
  title: string;
  company?: string | null;
  city?: string | null;
  /** Section C · supplied directly by the AI-driven path, which already read the JD. Undefined (not just falsy) means "not supplied — ask the model". */
  remote?: 'on-site' | 'hybrid' | 'remote' | 'unspecified' | null;
  /** Section C · ditto. An explicit '' is a legitimate answer ("nothing explicit stated"), not "missing". */
  formatSignals?: string | null;
  sourceUrl?: string | null;
  /** B4 · free-text channel this lead came from (alert name / recruiter / manual). */
  source?: string | null;
  /** B.3 · off-site anchor hrefs collected by the capturing agent/bookmarklet (LinkedIn-owned domains already excluded client-side). */
  candidateLinks?: string[] | null;
  markdown: string;
};

const A1_PROCEDURE = `--- STEP PROCEDURE (A1 · Capture-time extraction) ---
Read the job description text below and extract only what is explicitly present or unambiguously inferable. Do not guess. Leave a field null/unspecified rather than invent a value.

- company: the hiring company's name.
- city: the primary work location's city.
- remote: one of on-site, hybrid, remote, unspecified. Only set remote or hybrid if the posting says so explicitly; default to unspecified rather than assume on-site.
- formatSignals: verbatim quotes (not paraphrased) of any explicit application-format instructions found in the text: CV length/page limits, required file type, file naming convention, cover-letter requirement, mention of a photo/headshot, language of application, HR/Talent Acquisition contact name. Concatenate whatever is found as short quoted fragments; leave empty if nothing explicit is stated. This is raw material for C1, not a decision.

This is extraction only — no judgment, no scoring, no recommendation.`;

async function resolveCompanyId(name: string | null, ownerId: string): Promise<string | null> {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  const [existing] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.ownerId, ownerId), ilike(companies.name, trimmed)));
  if (existing) return existing.id;
  const [created] = await db.insert(companies).values({ ownerId, name: trimmed }).returning({ id: companies.id });
  return created.id;
}

export async function createLead(input: CaptureInput, ownerId: string): Promise<string> {
  // B.3 · an off-site candidate link matching a known ATS wins over sourceUrl —
  // sourceUrl itself is never a resolvable ATS domain when captured from LinkedIn.
  // No match (Easy Apply, or no candidates at all) falls back to today's B.1/B.2 logic.
  const candidateMatch = pickCandidateJobPostLink(input.candidateLinks);
  const jobPostLink = candidateMatch?.jobPostLink ?? cleanJobPostLink(input.sourceUrl);
  const atsSystem = candidateMatch?.atsSystem ?? detectAtsSystem(jobPostLink);
  // Not just plumbing: hiring through a third-party agency (vs. the ATS
  // directly) is itself a signal worth keeping. Own column, not atsSpecifics —
  // that field already carries unrelated seed data (application-format notes)
  // for a chunk of existing leads.
  const hiringAgency = candidateMatch?.viaAgency ?? null;

  const [row] = await db
    .insert(jobLeads)
    .values({
      ownerId,
      title: input.title,
      company: input.company ?? null,
      city: input.city ?? null,
      sourceUrl: input.sourceUrl ?? null,
      jobPostLink,
      atsSystem,
      hiringAgency,
      source: input.source?.trim() || null,
      status: 'captured',
      jdText: input.markdown,
    })
    .returning({ id: jobLeads.id });

  // Section C precedence: only call the LLM when something is still missing.
  // company/city already had a "non-empty wins" precedence (a manual paste never
  // sets remote/formatSignals at all, so those two alone are enough to force the
  // fallback for that path); remote/formatSignals use presence (!== undefined),
  // since an explicit '' or 'unspecified' is a real answer, not a gap to fill.
  const hasCompany = !!input.company?.trim();
  const hasCity = !!input.city?.trim();
  const hasRemote = input.remote !== undefined;
  const hasFormatSignals = input.formatSignals !== undefined;
  const needsExtraction = !(hasCompany && hasCity && hasRemote && hasFormatSignals);

  // A1 · one-shot AI extraction over the captured markdown, only when needed.
  // Best-effort: a failure here must not lose an already-captured lead, so it's
  // logged (via runStructured's own llm_calls write) and swallowed, not thrown.
  let extraction: A1Out | null = null;
  if (needsExtraction) {
    try {
      const guidance = await ciGuidanceFor('A1', ownerId);
      const r = await runStructured({
        step: 'A1',
        model: 'sonnet',
        system: { cacheable: `${NON_NEGOTIABLES}\n\n${A1_PROCEDURE}`, dynamic: guidance },
        user: `TITLE: ${input.title}\nURL: ${input.sourceUrl ?? 'unknown'}\n\nJOB DESCRIPTION:\n${input.markdown}`,
        tool: A1.tool,
        zod: A1.zod,
        mock: () => mockCaptureExtraction(input.markdown),
        leadId: row.id,
        ownerId,
      });
      extraction = r.data;
    } catch (err) {
      console.error(`[capture] A1 extraction failed for lead ${row.id}: ${String(err instanceof Error ? err.message : err)}`);
    }
  }

  const resolvedCompany = input.company?.trim() || extraction?.company?.trim() || null;
  const resolvedCity = input.city?.trim() || extraction?.city?.trim() || null;
  const resolvedRemote = hasRemote ? (input.remote ?? null) : extraction?.remote ?? null;
  const resolvedFormatSignals = hasFormatSignals ? (input.formatSignals ?? null) : extraction?.formatSignals ?? null;
  const companyId = await resolveCompanyId(resolvedCompany, ownerId);

  await db
    .update(jobLeads)
    .set({
      company: resolvedCompany,
      city: resolvedCity,
      companyId,
      remote: resolvedRemote,
      formatSignals: resolvedFormatSignals,
    })
    .where(eq(jobLeads.id, row.id));

  // B1–B3 · the automatic half of screening, run inline so a captured lead has
  // already sorted itself into `selected` or `scoring_queue` by the time it
  // reaches the board — no manual "Screen" click on leads that can screen
  // themselves. Same contract as the A1 call above: awaited, best-effort,
  // swallowed on error. A failure just leaves the lead at `captured`, where
  // rpNextAction's existing "Screen" affordance is the unchanged manual
  // fallback. B4–B6 deliberately do NOT run here — they belong to the batch
  // (see runScoring's doc comment for the prompt-cache reasoning).
  try {
    await runInitialChecks(row.id, ownerId);
  } catch (err) {
    console.error(`[capture] runInitialChecks failed for lead ${row.id}: ${String(err instanceof Error ? err.message : err)}`);
  }

  return row.id;
}
