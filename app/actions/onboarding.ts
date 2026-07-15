'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  onboardingState,
  profiles,
  positions,
  stars,
  starActions,
  starResults,
  skillsMaster,
  education,
  languages,
} from '@/lib/db/schema';
import { extractCareerGraph, type DraftGraph } from '@/lib/onboarding';
import { createLead } from '@/lib/pipeline/capture';
import { runScreening } from '@/lib/pipeline/screening';
import { generatePrompts } from '@/lib/coaching-queue';
import { recordActivation } from '@/lib/activation';
import { currentOwnerId } from '@/lib/auth';

/** Every node id in a draft graph — used to commit the whole import as starting history. */
function allDraftIds(d: DraftGraph): string[] {
  const ids: string[] = [];
  for (const p of d.positions) ids.push(p.id);
  for (const s of d.stories) {
    ids.push(s.id);
    for (const a of s.actions) ids.push(a.id);
    for (const r of s.results) ids.push(r.id);
  }
  for (const s of d.skills) ids.push(s.id);
  for (const e of d.education) ids.push(e.id);
  for (const l of d.languages) ids.push(l.id);
  return ids;
}

async function upsertOnboarding(values: Record<string, unknown>, owner: string) {
  const [existing] = await db
    .select({ id: onboardingState.id })
    .from(onboardingState)
    .where(eq(onboardingState.ownerId, owner));
  if (existing) {
    await db.update(onboardingState).set({ ...values, updatedAt: new Date() }).where(eq(onboardingState.ownerId, owner));
  } else {
    await db.insert(onboardingState).values({ ownerId: owner, ...values } as never);
  }
}

/** Step 1 → 2: extract a draft from pasted text and stage it for review. */
export async function startImportAction(formData: FormData) {
  const rawText = String(formData.get('rawText') ?? '').trim();
  const source = String(formData.get('source') ?? 'paste');
  if (rawText.length < 20) return;
  const owner = await currentOwnerId();
  const { draft } = await extractCareerGraph(rawText);
  await upsertOnboarding({ step: 'reviewing', source, rawText, draftGraph: draft, status: 'reviewing' }, owner);
  revalidatePath('/profile/onboarding');
}

export async function resetOnboardingAction() {
  const owner = await currentOwnerId();
  await db.delete(onboardingState).where(eq(onboardingState.ownerId, owner));
  revalidatePath('/profile/onboarding');
}

/**
 * M4 · The screen-first cold start (Phase 3, Path A). Paste CV + one job ad → draft the
 * Career Graph from the CV and commit it as imported history → create the lead and screen
 * it → land in the workspace on a real verdict, with the coach's first session queued from
 * the screening. Replaces the curate-everything wall as the default entry.
 *
 * A cold user reaches a verdict (and, after ~6 Keeps + generate in the workspace, a
 * downloadable CV) with no manual forms — well inside the ≤5 min / ≤10 decisions bar.
 */
export async function startScreenFirstAction(formData: FormData) {
  const owner = await currentOwnerId();
  const cv = String(formData.get('cv') ?? '').trim();
  const jd = String(formData.get('jd') ?? '').trim();
  const title = (String(formData.get('title') ?? '').trim() || 'Target role').slice(0, 200);
  const company = String(formData.get('company') ?? '').trim() || null;
  if (cv.length < 20 || jd.length < 80) redirect('/start?error=1');

  await recordActivation(owner, 'paste', { meta: { path: 'screen-first' } });

  // 1. Draft the graph from the CV. Extraction is an LLM call — guard it so a failure
  //    lands back on /start, not a crash, before any state has been mutated.
  const extracted = await extractCareerGraph(cv).catch(() => null);
  if (!extracted) redirect('/start?error=1');
  const { draft } = extracted;

  // 2. Stage the draft and capture the job ad as a lead FIRST — before committing the graph
  //    (which flips onboarding to "done"). If capture fails we redirect with onboarding still
  //    'reviewing', never stranding a "done" onboarding + imported graph with no lead to land on.
  let leadId: string;
  try {
    await upsertOnboarding({ step: 'reviewing', source: 'screen-first', rawText: cv, draftGraph: draft, status: 'reviewing' }, owner);
    leadId = await createLead({ title, company, city: null, markdown: jd }, owner);
  } catch {
    redirect('/start?error=1');
  }

  // 3. Commit the graph as imported history (marks onboarding done), then screen the lead
  //    against it. Screening/queue steps are best-effort — the user still lands on the verdict.
  await commitDraftAction(allDraftIds(draft));
  await runScreening(leadId, owner).catch(() => {});
  await recordActivation(owner, 'verdict', { leadId });
  await generatePrompts(owner).catch(() => {});

  revalidatePath('/roleproof');
  redirect(`/roleproof/leads/${leadId}?onboarded=1`);
}

/**
 * M5 · No-job-ad fallback (Path C). A user without a posting must not dead-end: paste just
 * the CV → draft + commit the graph → the coach's warm-up questions (engines 1/2) are queued
 * → land on the coach rail, which nudges "now paste a role" once the graph has some shape.
 */
export async function startWarmUpAction(formData: FormData) {
  const owner = await currentOwnerId();
  const cv = String(formData.get('cv') ?? '').trim();
  if (cv.length < 20) redirect('/start?error=1');

  await recordActivation(owner, 'warmup', { meta: { path: 'no-job-ad' } });
  const extracted = await extractCareerGraph(cv).catch(() => null);
  if (!extracted) redirect('/start?error=1');
  const { draft } = extracted;
  await upsertOnboarding({ step: 'reviewing', source: 'warm-up', rawText: cv, draftGraph: draft, status: 'reviewing' }, owner);
  await commitDraftAction(allDraftIds(draft)); // also revalidates /profile
  await generatePrompts(owner).catch(() => {});

  redirect('/profile/coach?warmup=1');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function countOf(table: any): Promise<number> {
  const owner = await currentOwnerId();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(table).where(eq(table.ownerId, owner));
  return n ?? 0;
}
const posLetter = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `P${i + 1}`);

/**
 * Step 2 → 3: promote the kept draft nodes into the real evidence tables, continuing ref_code
 * numbering from what exists. Never overwrites an existing identity.
 */
export async function commitDraftAction(keptIds: string[]): Promise<{ committed: number }> {
  const owner = await currentOwnerId();
  const keep = new Set(keptIds);
  const [row] = await db.select().from(onboardingState).where(eq(onboardingState.ownerId, owner));
  if (!row?.draftGraph) return { committed: 0 };
  const draft = row.draftGraph as DraftGraph;
  let committed = 0;

  if (draft.profile) {
    const [p] = await db.select().from(profiles).where(eq(profiles.id, owner));
    if (!p) {
      await db.insert(profiles).values({
        id: owner,
        ownerId: owner,
        name: draft.profile.name ?? 'Me',
        headline: draft.profile.headline,
        location: draft.profile.location,
      });
    } else if (!p.name && draft.profile.name) {
      await db
        .update(profiles)
        .set({ name: draft.profile.name, headline: draft.profile.headline ?? p.headline, location: draft.profile.location ?? p.location })
        .where(eq(profiles.id, owner));
    }
  }

  let pi = await countOf(positions);
  for (const p of draft.positions) {
    if (!keep.has(p.id)) continue;
    await db.insert(positions).values({ ownerId: owner, source: 'imported', refCode: posLetter(pi), company: p.company, title: p.title, startDate: p.startDate, endDate: p.endDate, summary: p.summary });
    pi++;
    committed++;
  }

  let si = await countOf(stars);
  for (const s of draft.stories) {
    if (!keep.has(s.id)) continue;
    const ref = String(si + 1);
    si++;
    await db.insert(stars).values({ ownerId: owner, source: 'imported', refCode: ref, title: s.title, summary: s.summary });
    committed++;
    let ai = 0;
    for (const a of s.actions) {
      if (!keep.has(a.id)) continue;
      ai++;
      await db.insert(starActions).values({ ownerId: owner, source: 'imported', refCode: `${ref}-${ai}`, starRef: ref, text: a.text, skills: a.skills, atsKeywords: [] });
      committed++;
    }
    let ri = 0;
    for (const r of s.results) {
      if (!keep.has(r.id)) continue;
      ri++;
      await db.insert(starResults).values({ ownerId: owner, source: 'imported', refCode: `${ref}-R${ri}`, starRef: ref, text: r.text, metric: r.metric, impactType: null });
      committed++;
    }
  }

  let ki = await countOf(skillsMaster);
  for (const s of draft.skills) {
    if (!keep.has(s.id)) continue;
    ki++;
    await db.insert(skillsMaster).values({ ownerId: owner, source: 'imported', refCode: `SKL-${ki}`, skill: s.skill, proficiency: s.proficiency, atsKeywordVariants: s.atsKeywordVariants, starEvidence: [] });
    committed++;
  }

  let ei = await countOf(education);
  for (const e of draft.education) {
    if (!keep.has(e.id)) continue;
    ei++;
    await db.insert(education).values({ ownerId: owner, source: 'imported', refCode: `EDU-${ei}`, institution: e.institution, qualification: e.qualification, year: e.year, type: null });
    committed++;
  }

  let li = await countOf(languages);
  for (const l of draft.languages) {
    if (!keep.has(l.id)) continue;
    li++;
    await db.insert(languages).values({ ownerId: owner, source: 'imported', refCode: `LANG-${li}`, language: l.language, cefrLevel: l.cefrLevel });
    committed++;
  }

  await db.update(onboardingState).set({ step: 'done', status: 'done', updatedAt: new Date() }).where(eq(onboardingState.ownerId, owner));
  revalidatePath('/profile');
  revalidatePath('/profile/onboarding');
  return { committed };
}
