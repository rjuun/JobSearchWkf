/**
 * "Your story" — the Through-line (Additive Plan · C1). One LLM pass over the
 * approved career graph produces a narrative arc plus two copy-out drafts (a
 * cover-letter body and a LinkedIn About). It quietly pilots the cover-letter step
 * that the manual process has but the app never had. Versions are append-only, so
 * the story can be seen to evolve as the graph grows.
 *
 * Same non-negotiable as the CV steps: the model narrates the evidence, it never
 * invents. Everything routes through the single runStructured choke point, so it
 * runs deterministically in mock mode with no key.
 */
import { desc, eq } from 'drizzle-orm';
import { db } from './db';
import { storyVersions } from './db/schema';
import { getCareerGraphFor } from './queries';
import { runStructured } from './llm/client';
import { STORY } from './llm/schemas';
import { NON_NEGOTIABLES } from './prompts';
import type { CareerGraph } from './career-graph';

const STORY_SYSTEM = `${NON_NEGOTIABLES}

--- TASK: CAREER THROUGH-LINE ---
You write a senior professional's career through-line and two copy-out drafts from their approved evidence.
- The through-line is the thread connecting their roles into one arc: what they repeatedly do well, the scope they operate at, and where they are heading. 3–5 short paragraphs.
- Ground every sentence in the evidence provided. Never invent a role, metric, employer, or skill. If evidence is thin, write a shorter, honest arc rather than padding it.
- Voice: direct, senior, concrete. No clichés ("results-driven", "passionate"), no flattery.`;

/** Compact the graph into the evidence the story is allowed to draw on. */
function evidenceBlock(g: CareerGraph): { text: string; count: number } {
  const lines: string[] = [];
  const pos = [...g.positions].slice(0, 8);
  for (const p of pos) {
    const when = [p.startDate, p.endDate].filter(Boolean).join('–');
    lines.push(`ROLE: ${[p.title, p.company].filter(Boolean).join(' · ')}${when ? ` (${when})` : ''}`);
  }
  const achievements = [
    ...g.actions.map((a) => a.text),
    ...g.responsibilities.map((r) => r.text),
    ...g.bullets.map((b) => b.text),
  ].filter((t): t is string => !!t);
  for (const a of achievements.slice(0, 24)) lines.push(`- ${a}`);
  const skills = g.skills.map((s) => s.skill).filter(Boolean).slice(0, 20);
  if (skills.length) lines.push(`SKILLS: ${skills.join(', ')}`);
  const edu = g.education.map((e) => [e.qualification, e.institution].filter(Boolean).join(', ')).filter(Boolean);
  if (edu.length) lines.push(`EDUCATION: ${edu.join('; ')}`);
  return { text: lines.join('\n'), count: achievements.length + pos.length };
}

export type StoryVersion = typeof storyVersions.$inferSelect;

/** Generate a fresh story version from the owner's current approved evidence. */
export async function generateStory(owner: string): Promise<StoryVersion> {
  const graph = await getCareerGraphFor(owner);
  const { text, count } = evidenceBlock(graph);
  const headline = graph.profile?.headline ?? 'Senior leader';

  const r = await runStructured({
    step: 'STORY',
    model: 'sonnet',
    system: STORY_SYSTEM,
    user: `CANDIDATE HEADLINE: ${headline}\n\nAPPROVED EVIDENCE (the only material you may draw on):\n${text}\n\nWrite the through-line and the two copy-out drafts.`,
    tool: STORY.tool,
    zod: STORY.zod,
    mock: () => ({
      throughLine: `${headline}. Across ${graph.positions.length} roles, a consistent thread of owning scope end-to-end and turning it into measurable outcomes.`,
      coverLetter: `I am writing to express my interest. ${headline}, with a track record of owning complex mandates and delivering measurable outcomes across ${graph.positions.length} senior roles.`,
      linkedinAbout: `${headline}. I lead by owning outcomes end-to-end — from strategy through delivery — and building the systems that make results repeatable.`,
    }),
    ownerId: owner,
  });

  const [row] = await db
    .insert(storyVersions)
    .values({
      ownerId: owner,
      throughLine: r.data.throughLine.trim(),
      coverLetter: r.data.coverLetter.trim(),
      linkedinAbout: r.data.linkedinAbout.trim(),
      evidenceCount: count,
    })
    .returning();
  return row;
}

export async function latestStory(owner: string): Promise<StoryVersion | null> {
  const [row] = await db
    .select()
    .from(storyVersions)
    .where(eq(storyVersions.ownerId, owner))
    .orderBy(desc(storyVersions.createdAt))
    .limit(1);
  return row ?? null;
}

export async function storyVersionCount(owner: string): Promise<number> {
  const rows = await db.select({ id: storyVersions.id }).from(storyVersions).where(eq(storyVersions.ownerId, owner));
  return rows.length;
}
