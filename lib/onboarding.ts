/**
 * O2 · Import → draft Career Graph.
 *
 * extractCareerGraph() goes through the runStructured choke point (mock or live). In mock mode a
 * deterministic heuristic parses pasted CV / LinkedIn text into a believable draft — and, like the
 * live prompt, never invents a metric (a result only gets a number if the text contains one).
 * The draft is wrapped with stable ids + a `keep` flag so the curation gate can toggle each node.
 */
import { runStructured } from './llm/client';
import { IMPORT, type ImportOut } from './llm/schemas';
import { systemPromptFor } from './prompts';

// ── The stored draft (ids + keep, on top of the extracted content) ───────────

type Node = { id: string; keep: boolean; confidence: number };
export type DraftPosition = Node & {
  company: string | null;
  title: string | null;
  startDate: string | null;
  endDate: string | null;
  summary: string | null;
};
export type DraftAction = Node & { text: string; skills: string[] };
export type DraftResult = Node & { text: string; metric: string | null };
export type DraftStory = Node & {
  title: string;
  summary: string | null;
  actions: DraftAction[];
  results: DraftResult[];
};
export type DraftSkill = Node & { skill: string; proficiency: string | null; atsKeywordVariants: string[] };
export type DraftEducation = Node & { institution: string | null; qualification: string | null; year: string | null };
export type DraftLanguage = Node & { language: string; cefrLevel: string | null };

export type DraftGraph = {
  profile: { name: string | null; headline: string | null; location: string | null } | null;
  positions: DraftPosition[];
  stories: DraftStory[];
  skills: DraftSkill[];
  education: DraftEducation[];
  languages: DraftLanguage[];
};

export function draftCounts(d: DraftGraph) {
  const actions = d.stories.reduce((n, s) => n + s.actions.length, 0);
  const results = d.stories.reduce((n, s) => n + s.results.length, 0);
  return {
    positions: d.positions.length,
    stories: d.stories.length,
    actions,
    results,
    skills: d.skills.length,
    education: d.education.length,
    languages: d.languages.length,
    total: d.positions.length + d.stories.length + actions + results + d.skills.length + d.education.length + d.languages.length,
  };
}

function wrapDraft(raw: ImportOut): DraftGraph {
  return {
    profile: raw.profile
      ? { name: raw.profile.name ?? null, headline: raw.profile.headline ?? null, location: raw.profile.location ?? null }
      : null,
    positions: (raw.positions ?? []).map((p, i) => ({
      id: `p${i}`,
      keep: true,
      confidence: p.confidence,
      company: p.company ?? null,
      title: p.title ?? null,
      startDate: p.startDate ?? null,
      endDate: p.endDate ?? null,
      summary: p.summary ?? null,
    })),
    stories: (raw.stories ?? []).map((s, i) => ({
      id: `s${i}`,
      keep: true,
      confidence: s.confidence,
      title: s.title,
      summary: s.summary ?? null,
      actions: (s.actions ?? []).map((a, j) => ({ id: `s${i}a${j}`, keep: true, confidence: a.confidence, text: a.text, skills: a.skills ?? [] })),
      results: (s.results ?? []).map((r, j) => ({ id: `s${i}r${j}`, keep: true, confidence: r.confidence, text: r.text, metric: r.metric ?? null })),
    })),
    skills: (raw.skills ?? []).map((s, i) => ({
      id: `k${i}`,
      keep: true,
      confidence: s.confidence,
      skill: s.skill,
      proficiency: s.proficiency ?? null,
      atsKeywordVariants: s.atsKeywordVariants ?? [],
    })),
    education: (raw.education ?? []).map((e, i) => ({
      id: `e${i}`,
      keep: true,
      confidence: e.confidence,
      institution: e.institution ?? null,
      qualification: e.qualification ?? null,
      year: e.year ?? null,
    })),
    languages: (raw.languages ?? []).map((l, i) => ({ id: `l${i}`, keep: true, confidence: l.confidence, language: l.language, cefrLevel: l.cefrLevel ?? null })),
  };
}

export async function extractCareerGraph(
  rawText: string
): Promise<{ draft: DraftGraph; model: string; ms: number; mode: 'mock' | 'live' }> {
  const r = await runStructured({
    step: 'O2-extract',
    model: 'sonnet',
    system: await systemPromptFor('O2-extract'),
    user: `RAW CV / PROFILE TEXT:\n\n${rawText.slice(0, 16000)}`,
    tool: IMPORT.tool,
    zod: IMPORT.zod,
    mock: () => mockExtract(rawText),
  });
  return { draft: wrapDraft(r.data), model: r.model, ms: r.ms, mode: r.mode };
}

// ── Deterministic mock extraction (no API key needed) ────────────────────────

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const splitList = (s: string) =>
  s
    .split(/[,;·|•–]|\s{2,}/)
    .map((x) => x.replace(/^[-*•\s]+/, '').trim())
    .filter((x) => x.length >= 2 && x.length <= 40);

function mockExtract(raw: string): ImportOut {
  const lines = raw.split(/\r?\n/).map((l) => l.trim());
  const nonEmpty = lines.filter(Boolean);
  const yearRange = /\b(19|20)\d{2}\s*(?:[-–—]|to)\s*((19|20)\d{2}|present|current|now)\b/i;
  const numRe = /\b\d+([.,]\d+)?\s*(%|percent|k\b|m\b|bn|million|billion|people|fte|months?|weeks?|days?|countries|eur|usd|\$|€)/i;

  // profile
  const name = nonEmpty[0] && nonEmpty[0].split(/\s+/).length <= 5 && !/^[-*•]/.test(nonEmpty[0]) ? nonEmpty[0] : null;
  const headline = nonEmpty.find((l) => /\b(senior|director|head|chief|lead|manager|officer|principal|partner|consultant)\b/i.test(l) && l.length < 90) ?? null;
  const location = nonEmpty.find((l) => /\b(vienna|london|amsterdam|copenhagen|berlin|munich|madrid|barcelona|zurich|dublin|milan|paris|lisbon|new york|toronto|são paulo|sao paulo)\b/i.test(l) && l.length < 60) ?? null;
  const profile = name || headline || location ? { name, headline, location } : null;

  // positions (lines with a year range)
  const positions = nonEmpty
    .filter((l) => yearRange.test(l))
    .slice(0, 6)
    .map((l) => {
      const m = l.match(yearRange);
      const dates = m ? m[0] : null;
      const head = (dates ? l.replace(dates, '') : l).replace(/[()|]/g, ' ').replace(/\s{2,}/g, ' ').trim();
      const parts = head.split(/\s+(?:at|@|—|–|-|·|\|)\s+/i);
      const title = (parts[0] || head).trim();
      const company = parts[1] ? parts[1].trim() : null;
      const [startDate, endDate] = dates ? dates.split(/\s*(?:[-–—]|to)\s*/i).map((s) => s.trim()) : [null, null];
      return { title: title || null, company, startDate: startDate ?? null, endDate: endDate ?? null, summary: null, confidence: 0.6 };
    });

  // bullets → one "Imported highlights" story (honest grouping); results only when a number is present
  const bulletRe = /^[-*•▪▸‣–]\s+/;
  const bullets = lines.filter((l) => bulletRe.test(l)).map((l) => l.replace(bulletRe, '').trim()).filter(Boolean).slice(0, 40);
  const actions = bullets.map((t) => ({ text: t, skills: [], confidence: 0.55 }));
  const results = bullets
    .filter((t) => numRe.test(t))
    .map((t) => ({ text: t, metric: (t.match(numRe) || [null])[0], confidence: 0.5 }));
  const stories = bullets.length ? [{ title: 'Imported highlights', summary: null, confidence: 0.5, actions, results }] : [];

  // skills — prefer the inline list on a "Skills: a, b, c" line; else the lines under a header
  let skillNames: string[] = [];
  const skillsIdx = nonEmpty.findIndex((l) => /^(skills|core competenc|areas of expertise|expertise|key skills|technical skills)\b/i.test(l));
  if (skillsIdx >= 0) {
    const line = nonEmpty[skillsIdx];
    const afterColon = line.includes(':') ? line.slice(line.indexOf(':') + 1) : '';
    skillNames = splitList(afterColon.trim().length > 3 ? afterColon : nonEmpty.slice(skillsIdx + 1, skillsIdx + 3).join(' , '));
  } else {
    const listLine = nonEmpty.find(
      (l) => (l.match(/[,;]/g) || []).length >= 3 && l.length < 200 && !yearRange.test(l) && !/\b(a1|a2|b1|b2|c1|c2|university|mba|msc|bsc)\b/i.test(l)
    );
    if (listLine) skillNames = splitList(listLine);
  }
  const skills = Array.from(new Set(skillNames)).slice(0, 20).map((skill) => ({ skill, proficiency: null, atsKeywordVariants: [], confidence: 0.5 }));

  // education
  const eduRe = /\b(mba|bsc|b\.sc|b\.a\b|ba\b|msc|m\.sc|phd|bachelor|master|diploma|university|institute|business school|cfa|cpa|acca)\b/i;
  const education = nonEmpty
    .filter((l) => eduRe.test(l) && l.length < 120)
    .slice(0, 6)
    .map((l) => {
      const yr = l.match(/\b(19|20)\d{2}\b/);
      return { institution: null, qualification: l.replace(/\b(19|20)\d{2}\b/, '').replace(/[,–—-]\s*$/, '').trim(), year: yr ? yr[0] : null, confidence: 0.5 };
    });

  // languages
  const langRe = /\b(english|german|french|spanish|portuguese|italian|dutch|mandarin|arabic|russian|polish)\b/i;
  const levelRe = /\b(a1|a2|b1|b2|c1|c2|native|fluent|business|conversational|mother tongue)\b/i;
  // split on commas so "English C2, German C1, Spanish B2" yields three languages
  const langSeen = new Set<string>();
  const languages = nonEmpty
    .flatMap((l) => l.split(/[,;]/))
    .map((seg) => seg.trim())
    .filter((seg) => langRe.test(seg) && seg.length < 40)
    .map((seg) => ({ language: cap((seg.match(langRe) || [''])[0]), cefrLevel: (seg.match(levelRe) || [null])[0], confidence: 0.5 }))
    .filter((x) => {
      const k = x.language.toLowerCase();
      if (!k || langSeen.has(k)) return false;
      langSeen.add(k);
      return true;
    })
    .slice(0, 6);

  return { profile, positions, stories, skills, education, languages };
}
