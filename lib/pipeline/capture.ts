/** Create a job lead from captured JD text (bookmarklet ingest or manual paste). */
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { jobLeads } from '../db/schema';
import { writeText } from '../storage';

export type CaptureInput = {
  title: string;
  company?: string | null;
  city?: string | null;
  sourceUrl?: string | null;
  /** B4 · free-text channel this lead came from (alert name / recruiter / manual). */
  source?: string | null;
  markdown: string;
};

export async function createLead(input: CaptureInput, ownerId: string): Promise<string> {
  const [row] = await db
    .insert(jobLeads)
    .values({
      ownerId,
      title: input.title,
      company: input.company ?? null,
      city: input.city ?? null,
      sourceUrl: input.sourceUrl ?? null,
      source: input.source?.trim() || null,
      status: 'captured',
    })
    .returning({ id: jobLeads.id });

  const rel = `jd-captures/${row.id}/raw.md`;
  await writeText(rel, input.markdown);
  await db.update(jobLeads).set({ rawJdPath: rel }).where(eq(jobLeads.id, row.id));
  return row.id;
}
