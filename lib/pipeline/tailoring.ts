/**
 * C1–C8 tailoring. Two human-gated halves:
 *   runEvidenceMapping  → C1 (format) + C2 (requirement→evidence, builds on B6
 *                         rather than re-deriving — CI-034 — pending review)
 *   ── human approves the whole map in one action ──
 *   generateCv          → C4 (bullets, Keep only) → C5 skills → C6 profile →
 *                         C7 .docx → C8 ATS rating
 *
 * The LLM emits judgments (C2 mapping, C4 bullets, C6 profile, C8 rating); code
 * enforces the gate, the content budget and the skills consistency rule. Every
 * LLM step has a deterministic mock so the pipeline still runs without a key.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import {
  jobLeads,
  jobRequirements,
  requirementTailoring,
  requirementEvidence,
  bulletBank,
  skillsMaster,
  starActions,
  starResults,
  stars,
  starCompetences,
  starAttributes,
  responsibilities,
  education,
  languages,
  positions,
  profiles,
  cvVariants,
} from '../db/schema';
import { recordStep, type StepReport } from './runs';
import { writeBuffer } from '../storage';
import { buildCv, type CvModel } from '../docx/cv';
import { systemPromptFor } from '../prompts';
import { runStructured, type UserContentBlock } from '../llm/client';
import { C2, C4, C5, C6, C8 } from '../llm/schemas';
import { CV_SLOTS, normalizeCvPosition, slotCode, templateExists, buildCvFromTemplate, type TemplateData, type TemplateValue } from '../docx/template';
import { evidenceNeedsCvSlot, isRoleOverviewSlot, slotProjectName } from '../cv-slots';
import { PROFILE_WORDS, PROFILE_MAX_LINES, SKILL_CATEGORIES, SKILLS_PER_CATEGORY, CONTENT_LINE_ALLOWANCE, MAX_PAGES, profileLines, renderedLines } from '../cv-budget';
import { recordGapTips } from '../ci';
import { matchStrengthToScore } from '../scoring';
import { candidateFactsSummary } from '../profile-context';
import {
  buildVocabIndex,
  resolveVocab,
  prioritiseSkills,
  dropLanguageSkills,
  SKILLS_CEILING,
  SKILLS_TARGET,
  capSkillGroups,
  absorbContainedSkills,
  reconcileSkillGroups,
  ungroupedSkills,
  auditBulletTags,
  type VocabEntry,
} from './skills';
import {
  selectEvidence,
  coverageOf,
  formatCoverage,
  formatCoverageSplit,
  type ExemptGroup,
  DEFAULT_SELECTION_PARAMS,
  type SelectionCandidate,
  type SelectionLink,
} from './selection';

export const CORE_AND_IMPORTANT: string[] = ['Core', 'Important'];
export const NICE_TO_HAVE = 'Nice-to-Have';

const tokens = (s: string): Set<string> => new Set((s || '').toLowerCase().match(/[a-z]{4,}/g) ?? []);
const overlap = (a: Set<string>, b: Set<string>): number => {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
};

/**
 * C1's D&I markets — "Not mentioned + country is UK, IE, DK, NL, CA → Do not
 * include". Countries, because that is how C1 states the rule; the cities are
 * kept alongside because `job_leads.city` does not always carry a country.
 */
const HEADSHOT_DEI_COUNTRIES = new Set([
  'uk', 'gb', 'united kingdom', 'great britain', 'england', 'scotland', 'wales', 'northern ireland',
  'ie', 'ireland', 'republic of ireland',
  'dk', 'denmark',
  'nl', 'netherlands', 'the netherlands', 'holland',
  'ca', 'canada',
]);
const HEADSHOT_DEI_CITIES = new Set(['london', 'dublin', 'copenhagen', 'amsterdam', 'rotterdam', 'the hague', 'toronto', 'vancouver', 'montreal']);

/**
 * C1 · Professional Headshot — the decision C7 renders the header line from.
 *
 * Correction, 2026-08-27: this compared `city.toLowerCase()` against a list of
 * bare city names, and `job_leads.city` holds "London, United Kingdom". The
 * equality never held for any real lead, so every lead in the build's history
 * took the "Optional" branch and the D&I rule had never once fired. It also read
 * the rule off the wrong column: C1 decides by COUNTRY, and only mentions cities
 * as examples.
 *
 * Now every comma-separated part is tested — the tail against C1's country list,
 * the head against the cities in those countries for leads that name no country.
 */
function headshotDecision(city: string | null): string {
  const parts = (city ?? '').split(',').map((p) => p.trim().toLowerCase().replace(/[^\p{L}\s.]+/gu, '').replace(/\./g, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const dei = parts.some((p) => HEADSHOT_DEI_COUNTRIES.has(p) || HEADSHOT_DEI_CITIES.has(p));
  return dei ? 'Do not include (D&I norm)' : 'Optional (lean exclude)';
}

/**
 * The header line under the name — and, until now, fixed text in the template
 * that printed on every CV regardless of what C1 decided.
 *
 * It prints only where the reason it states is true. "In respect to D&I best
 * practices" is an accurate account of a CV built for London or Copenhagen, where
 * C1 says do not include; it is not an account of a Vienna CV, where C1 says the
 * headshot is optional and the build simply has no photo to attach. Printing it
 * there asserts a rationale that does not hold, and costs a line of a CV already
 * over budget.
 *
 * An array of nought or one, so the template's loop removes the whole paragraph
 * rather than leaving an empty one behind.
 */
function headshotNote(decision: string): string[] {
  return decision.startsWith('Do not include') ? ['Headshot not added in respect to D&I best practices.'] : [];
}

/**
 * One evidence candidate the LLM may cite, keyed by its stable ref code.
 *
 * `context` is optional and, today, only `STAR result` rows carry it. A result
 * is not a self-contained claim — `[1-R3]` ("Gradual branch FTE reallocation…
 * following SCE go-live") is the outcome OF something, and a bullet built from
 * it alone would state a consequence with no actor. `context` names the STAR it
 * came out of so C2 and C4 can read the outcome against the work that earned
 * it. It is deliberately NOT folded into `text`: `text` is the row's own words,
 * which is what `evidence_text` snapshots and what C4 is told to stay
 * supportable by. See CI · STAR Results Never Reach the Evidence Graph §2.2.
 */
export type Evidence = {
  ref: string;
  kind: string;
  text: string;
  skills: string[];
  cvPosition: string | null;
  source: string | null;
  context?: string | null;
};

/**
 * C2's user message, as a pure builder — same reasoning as the B-step builders in
 * `screening.ts`: `scripts/backtest-notes.ts` must send what production sends, or
 * it certifies a prompt that is never used.
 *
 * Two blocks: the evidence graph is owner-wide and lead-independent — identical
 * for every lead tailored in the same sitting — so it gets its own 1h cache
 * breakpoint; the per-lead role and requirements follow as the varying suffix.
 *
 * CI · Make C2 Build on B6 Instead of Re-Deriving the Map §2.1 — `numberedReqs`
 * is now the TARGETED subset only (B6's Good/Weak/No Match tiers; Excellent/Very
 * Strong requirements are carried forward without a model call at all, see
 * `runEvidenceMapping`). Each entry optionally carries `b6Pick`, the initial
 * screen's own evidence for that requirement, so a `Good`-tier ask reads as
 * "beat this if you can" rather than starting blind — the anchoring is the
 * targeting signal, not a contaminant (§2.1).
 *
 * CI · C4 Skills Selection Produces Unreadable Overflow — two additions, both
 * following the owner's framing that a requirement and its Requirement Skills
 * are one mutually-explaining pair:
 *
 *  - each requirement now carries its own B2 `skills` (the JD's language for
 *    what it is asking for). C2 was previously sent only the requirement
 *    label, so half the pair it is meant to match against was never supplied.
 *  - the owner's curated vocabulary gets its own cached block, so C2 can name
 *    which of the candidate's OWN skills/competences/attributes the evidence
 *    demonstrates (epic Q3, answered: all three tables). Same 1h breakpoint as
 *    the evidence graph — both are owner-wide and lead-independent.
 */
export function c2UserMessage(
  evidence: Evidence[],
  leadTitle: string,
  company: string | null,
  numberedReqs: [number, { rank: string | null; requirement: string; skills?: string[] | null; b6Pick?: string | null }][],
  candidateFacts?: string | null,
  vocabulary: readonly VocabEntry[] = []
): UserContentBlock[] {
  return [
    {
      type: 'text',
      text:
        `CANDIDATE EVIDENCE (cite by exact ref code):\n` +
        // The indented follow-on line is `context` — today only STAR results
        // carry one, naming the STAR the outcome came out of. It is context for
        // reading the item, never a second citable identity: the ref in
        // brackets is still the only thing C2 may cite.
        evidence
          .map((e) => `[${e.ref}] (${e.kind}) ${e.text}` + (e.context ? `\n    ${e.context}` : ''))
          .join('\n') +
        (vocabulary.length
          ? `\n\nCANDIDATE SKILLS, COMPETENCES & ATTRIBUTES (the candidate's own vocabulary — name these in mySkills, ` +
            `copied exactly; these are NOT citable as evidenceRef):\n` +
            vocabulary.map((v) => `- ${v.name}${v.proficiency ? ` (${v.proficiency})` : ''}`).join('\n')
          : ''),
      cache_control: { type: 'ephemeral', ttl: '1h' },
    },
    {
      type: 'text',
      text:
        (candidateFacts ? `CANDIDATE FACTS (fixed, not skill evidence — weigh for eligibility-type requirements):\n${candidateFacts}\n\n` : '') +
        `ROLE: ${leadTitle}${company ? ` · ${company}` : ''}\n\n` +
        `REQUIREMENTS (map each by its number) — this is only the subset the initial screen rated Good, Weak or ` +
        `No Match; anything already rated Excellent or Very Strong is carried forward untouched and not sent here. ` +
        `Each requirement's "asking for" line is its Requirement Skills, the JD's own language for what it wants — ` +
        `read the two together, they explain each other:\n` +
        numberedReqs
          .map(
            ([n, q]) =>
              `${n}. [${q.rank}] ${q.requirement}` +
              (q.skills?.length ? `\n   asking for: ${q.skills.join(', ')}` : '') +
              (q.b6Pick ? `\n   Initial screen found: ${q.b6Pick} — only report a link here if you can genuinely beat it.` : '')
          )
          .join('\n') +
        `\n\nCV POSITION SLOTS — set each link's cvPosition to the best-matching label:\n` +
        CV_SLOTS.map((s) => `- ${s}`).join('\n') +
        `\n\nFor each requirement, list every genuinely strongest piece of evidence — one link per ref, several where ` +
        `several honestly apply, ranked strongest first — assign each its own cvPosition slot, and set mySkills from the ` +
        `candidate's own vocabulary above. If none honestly fits, list it under gaps.`,
    },
  ];
}

/** B6's per-requirement matchStrength decides how hard C2 digs (CI · Make C2
 *  Build on B6 §2.1). `carry`: transpose B6's evidence, no model call. `improve`:
 *  ask the model to beat B6's pick, falling back to it if nothing beats it.
 *  `dig`: the untargeted full search this step has always done. */
export type MatchTier = 'carry' | 'improve' | 'dig';
export function tierFor(matchStrength: string | null): MatchTier {
  if (matchStrength === 'Excellent' || matchStrength === 'Very Strong') return 'carry';
  if (matchStrength === 'Good') return 'improve';
  return 'dig'; // 'Weak' | 'No Match' | null (never judged by B6)
}

/**
 * CI · C2 Never Sees Nice-to-Have Requirements §2.2 — what C2 is allowed to look
 * at. Core and Important unconditionally, as they always were; a Nice-to-Have
 * requirement joins them ONLY where `tierFor` says `carry`, i.e. B6 already
 * rated it Excellent or Very Strong and already chose its evidence.
 *
 * That is the one intake path with no model call behind it — the carry pass in
 * `runEvidenceMapping` is a direct transposition of `requirement_evidence` — so
 * the door opens exactly as far as costs nothing. `improve` and `dig`, the two
 * tiers that do reach the model, stay gated to Core/Important, which is what
 * keeps C2's prompt and per-run call count where they were.
 *
 * Before this the filter was Core/Important full stop, so a Nice-to-Have
 * requirement was never mapped, never approved and could never reach the CV —
 * the Nice-to-Have term in C3's objective was structurally zero on every lead
 * ever run. Nothing about that objective changes here: at w=1 against Core's 3,
 * such a requirement can still only win a slot once every Core and Important one
 * is saturated. It now merely has rows to be considered from.
 */
export function c2AdmitsRequirement(rank: string | null, initialMatchStrength: string | null): boolean {
  if (CORE_AND_IMPORTANT.includes(rank ?? '')) return true;
  return rank === NICE_TO_HAVE && tierFor(initialMatchStrength) === 'carry';
}

/**
 * Recover the matchStrength label C2 stamped at the head of a stored row's
 * `connectionToExpertise` (`"<matchStrength>[ · <connection>]"`), so a re-run's
 * merge can compare against it without a dedicated column. `null` if the text
 * doesn't start with a recognised label (e.g. a legacy row from before this CI).
 */
export function storedMatchStrength(connectionToExpertise: string | null): string | null {
  if (!connectionToExpertise) return null;
  const head = connectionToExpertise.split(' · ')[0]?.trim();
  return head && matchStrengthToScore(head) != null ? head : null;
}

/** One evidence link C2 is proposing to write, fully resolved — no re-lookup
 *  needed at write time, so a B6 ref that has since dropped out of the live
 *  evidence graph still carries B6's own snapshot rather than throwing. */
export type ProposedLink = {
  requirementId: string;
  evidenceRef: string;
  matchStrength: string;
  connection: string | null;
  cvPosition: string | null;
  evidenceText: string;
  evidenceKind: string | null;
  mySkills: string[];
  provSource: string;
};

/**
 * CI · Make C2 Build on B6 §2.2 — the owner's replacement rule, implemented
 * directly: a stored `(requirementId, evidenceRef)` row is replaced only when
 * the newly proposed evidence scores STRICTLY higher on the shared ordinal
 * (`matchStrengthToScore`). Not-stronger proposals and requirements the new run
 * is silent on are left exactly as they were — silence is not a verdict, and an
 * unparseable stored score (pre-CI row) counts as the lowest score so a labelled
 * pick can still improve on it.
 *
 * §2.3 addendum, decided 2026-08-05: "silence is not a verdict" protects a
 * HUMAN decision (green/yellow/red) from being erased by a re-run. It was
 * never meant to protect a `pending` row nobody has looked at — the pre-CI era
 * wrote exactly those (delete-then-replace, one row per requirement, searched
 * over the wrong evidence entirely), and leaving them stranded forever pending
 * would both clutter the Map and let "Approve entire map" Keep leftover
 * pre-CI guesses alongside the real B6-derived evidence. So a stored row is
 * pruned when ALL of: still `pending`, its requirement is one this run
 * actually covers (never touch a row outside `coveredReqIds` — out of scope,
 * not evaluated), and no proposal this run named its exact
 * `(requirementId, evidenceRef)` pair. A row carrying a real verdict is never
 * a deletion candidate, full stop.
 */
export function planMerge(
  proposed: ProposedLink[],
  existing: {
    id: string;
    requirementId: string | null;
    evidenceRef: string | null;
    connectionToExpertise: string | null;
    approvalStatus: string;
    evidenceKind?: string | null;
  }[],
  coveredReqIds: Set<string>
): {
  toInsert: ProposedLink[];
  toReplace: { id: string; link: ProposedLink }[];
  toRefresh: { id: string; link: ProposedLink }[];
  toDelete: string[];
  unchanged: number;
} {
  const byKey = new Map<string, (typeof existing)[number]>();
  for (const e of existing) {
    if (e.requirementId && e.evidenceRef) byKey.set(`${e.requirementId}::${e.evidenceRef}`, e);
  }
  const proposedKeys = new Set(proposed.map((p) => `${p.requirementId}::${p.evidenceRef}`));
  const toInsert: ProposedLink[] = [];
  const toReplace: { id: string; link: ProposedLink }[] = [];
  const toRefresh: { id: string; link: ProposedLink }[] = [];
  let unchanged = 0;
  for (const link of proposed) {
    const row = byKey.get(`${link.requirementId}::${link.evidenceRef}`);
    if (!row) {
      toInsert.push(link);
      continue;
    }
    const newScore = matchStrengthToScore(link.matchStrength) ?? -1;
    const oldScore = matchStrengthToScore(storedMatchStrength(row.connectionToExpertise)) ?? -1;
    if (newScore > oldScore) {
      toReplace.push({ id: row.id, link });
      continue;
    }
    // Not stronger — the stored connection/matchStrength text and any human
    // verdict stay exactly as they are (that's the whole point of "unchanged").
    // But purely descriptive metadata that was never part of that verdict —
    // which kind of evidence this is — can otherwise go stale forever: a row
    // written before `evidence_kind` existed re-matches the same evidence on
    // every future run, is judged "unchanged" every time, and so never picks
    // up the column at all. Backfill it here rather than leaving it NULL
    // indefinitely; nothing about the approval state is touched.
    if (row.evidenceKind == null && link.evidenceKind != null) {
      toRefresh.push({ id: row.id, link });
    } else {
      unchanged++;
    }
  }
  const toDelete = existing
    .filter((e) => e.requirementId && e.evidenceRef)
    .filter((e) => e.approvalStatus === 'pending')
    .filter((e) => e.requirementId && coveredReqIds.has(e.requirementId))
    .filter((e) => !proposedKeys.has(`${e.requirementId}::${e.evidenceRef}`))
    .map((e) => e.id);
  return { toInsert, toReplace, toRefresh, toDelete, unchanged };
}

/** One Keep row, reduced to what C4 is given to rewrite. */
export type C4Row = {
  evidenceRef: string | null;
  requirementLine: string | null;
  originalText: string | null;
  mySkills: readonly string[] | null;
  /** `Evidence.context`, re-attached by ref in `generateCv`. Only STAR results
   *  have one. Without it C4 sees a result's text alone and cannot obey §B.3
   *  ("start every bullet with a strong action verb") on an outcome that names
   *  no actor — which is the half of the fix C2 alone doesn't deliver. It is
   *  not persisted on `requirement_tailoring`: it is derived from the profile,
   *  so re-deriving it keeps it current and costs no column. */
  context?: string | null;
};

/**
 * C4's user message, as a pure builder — extracted from `generateCv` for the
 * same reason `c2UserMessage` was: the prompt is the deliverable of
 * CI · C3 Writes CV-Grade Skill Tags, and a prompt that can only be read by
 * running the pipeline against Postgres cannot be pinned by a test.
 *
 * Two blocks, mirroring C2's split. The register is owner-wide and
 * lead-independent — identical for every lead tailored in the same sitting — so
 * it takes its own 1h cache breakpoint; the per-lead role and rows follow as the
 * varying suffix.
 *
 * **The register block is the substance of this CI (§1.2).** C4 was previously
 * sent the role line, each row's requirement, original text and My Skills, and
 * nothing else — it had never seen `skills_master`, not the names and not the
 * ATS variants. It was then instructed (old §B.5) to write the tag in the job
 * posting's language. So it wrote "Work Autonomously": obeying an instruction,
 * in the only vocabulary it had been shown.
 *
 * `skills_master` only, not all three tables. C2 matches against skills,
 * competences and attributes and must keep doing so (epic Q3) — a JD asking for
 * discretion is genuinely answered by an attribute. But `skills_master` is the
 * one table written in CV register, and register is what C4 needs. The attribute
 * still comes through; it comes through re-expressed, which is exactly what the
 * owner's hand-built CVs do (`Confidentiality & Trust` → "Confidentiality &
 * Discretion").
 *
 * And it is an EXEMPLAR, not a filter and not a closed list (§2.2). Half the
 * entries in the benchmark CVs — "Board-Grade Synthesis", "Neutral Sounding
 * Board", "Governance Operating Rhythm" — are in no table at all. Building this
 * as a lookup is the way to get it wrong, which is why the block says so in as
 * many words.
 */
export function c4UserMessage(
  rows: readonly C4Row[],
  leadTitle: string,
  jdGroup: string | null,
  atsSystem: string | null,
  register: readonly VocabEntry[] = []
): UserContentBlock[] {
  const blocks: UserContentBlock[] = [];
  if (register.length) {
    blocks.push({
      type: 'text',
      text:
        `THE CANDIDATE'S OWN SKILL REGISTER (from skills_master — the names he uses for his own ` +
        `capabilities, with the alternate wordings each is known by):\n` +
        register
          .map((v) => `- ${v.name}${v.variants.length ? ` — also written: ${v.variants.join('; ')}` : ''}`)
          .join('\n') +
        `\n\nThis is the REGISTER TO WRITE IN, not a list to choose from. Read it for the LEVEL and ` +
        `SHAPE these names have — compound rather than atomised, stating the seniority, scale or scope ` +
        `the capability was exercised at, in the candidate's professional voice rather than a job ` +
        `posting's. Use an entry verbatim when it genuinely fits the bullet; coin a name in the same ` +
        `register when none does. Never stretch a claim to reach an entry.`,
      cache_control: { type: 'ephemeral', ttl: '1h' },
    });
  }
  blocks.push({
    type: 'text',
    text:
      `ROLE: ${leadTitle}${jdGroup ? ` · ${jdGroup}` : ''}${atsSystem ? ` · ATS: ${atsSystem}` : ''}\n\n` +
      `Rewrite each Keep evidence item into one CV bullet. Keep every claim supportable by the ` +
      `original text.\n\n` +
      `Then tag each bullet with the skills it demonstrates, written at CV grade (Process/C4 §B.5): ` +
      `one compound entry per capability rather than several near-duplicate facets of it; state the ` +
      `level the work was done at; add a parenthetical anchor only where it adds real precision; no ` +
      `table-stakes tooling; no phrase lifted whole from the posting; no languages. Each row's ` +
      `"my skills" is the capability the evidence rests on — say it in the register above, do not ` +
      `echo it and do not drop it.\n\n` +
      rows
        .map(
          (g) =>
            `[${g.evidenceRef}] requirement: ${g.requirementLine}\n   original: ${g.originalText}\n` +
            (g.context ? `   context: ${g.context}\n` : '') +
            `   my skills: ${(g.mySkills ?? []).join(', ')}`
        )
        .join('\n\n'),
  });
  return blocks;
}

/**
 * ── C4's collapse floor, as pure functions ──────────────────────────────────
 *
 * Exported and separated from the DB write for the same reason `matchB6Judgments`
 * is: the interesting behaviour is "what counts as an answer", and that has to be
 * testable without Postgres or an API key.
 */
export type C4Bullet = { ref: string; bullet: string; skills?: string[] };

/**
 * Fold one C4 reply into the ref→bullet map, accumulating across re-asks so a
 * second attempt only has to cover what the first missed.
 *
 * A blank `bullet` is deliberately NOT an answer. `bullet` is required in the
 * strict schema, so a degraded call returns the key holding `""` — recording that
 * would satisfy the floor with nothing in it, which is the `placeholder` failure
 * this CI measured on C2 wearing a different hat.
 *
 * Last non-blank answer per ref wins, and that is correct in both directions it
 * happens. ACROSS re-asks it is the point (a second attempt supersedes a weaker
 * first — pinned by a test). WITHIN one reply it looks like a defect and isn't:
 * C4's prompt lists a shared bullet once per Keep row (up to six times for one
 * ref on the Allianz lead), so a reply may legitimately carry several entries
 * for the same ref. Each is a valid rewrite of the same evidence, one bullet per
 * ref is what the CV can show, and any of them is a real answer — so picking the
 * last loses nothing. Flagged as a possible seam on CI · Split cv_bullet_skills
 * from requirement_skills and closed on inspection; noted here so it doesn't get
 * re-filed as a bug.
 */
export function absorbC4Bullets(
  into: Map<string, { bullet: string; skills: string[] }>,
  bullets: C4Bullet[]
): Map<string, { bullet: string; skills: string[] }> {
  for (const b of bullets) {
    if (b.ref && b.bullet && b.bullet.trim()) into.set(b.ref, { bullet: b.bullet.trim(), skills: b.skills ?? [] });
  }
  return into;
}

/**
 * The Keep rows C4 owes a bullet for and hasn't delivered.
 *
 * Rows with no `evidenceRef` are excluded on purpose — C4 is keyed by ref, so it
 * was never given a way to answer them, and counting them would make the floor
 * unsatisfiable rather than strict. Duplicate refs collapse to one.
 */
export function missingC4Refs(
  green: { evidenceRef: string | null }[],
  have: Map<string, unknown>
): string[] {
  const wanted = new Set(green.map((g) => g.evidenceRef).filter((ref): ref is string => !!ref));
  return [...wanted].filter((ref) => !have.has(ref));
}

/**
 * ── C6's collapse floor ──────────────────────────────────────────────────────
 *
 * `profile` is required in the strict schema, so a degraded call returns the
 * key holding `""` — schema-valid, `status='ok'`, and from there the empty
 * string reaches the .docx (blank Profile section) and C8 (rating a CV whose
 * profile section says nothing). `Process/C6...md` and the tool description
 * both specify a word target (`PROFILE_WORDS`); `MIN_PROFILE_WORDS` sits well
 * under it so ordinary variation never trips it, while still catching a
 * one-line stub. Unlike C4's floor, a profile is a single value rather than a
 * set keyed by ref, so nothing needs to accumulate across re-asks — the last
 * attempt either clears the bar or it doesn't.
 */
export const MIN_PROFILE_WORDS = 40;

export function profileWordCount(profile: string): number {
  return profile.trim().split(/\s+/).filter(Boolean).length;
}

export function isProfileTooShort(profile: string): boolean {
  return profileWordCount(profile) < MIN_PROFILE_WORDS;
}

/**
 * ── C6's space ceiling ───────────────────────────────────────────────────────
 *
 * The opposite failure, and the one this CI exists for: a profile that is fine
 * as prose and too long on the page. The owner's rule is about **rendered
 * lines** — *"regardless of the number of words, crossing the 6 lines feels
 * already too long for the attention span of a Headhunter/Talent Acquisition
 * Manager"* — but the model cannot see the rendering, so the instruction it gets
 * is `PROFILE_WORDS.max` and this is the check that the instruction was obeyed.
 *
 * Retried rather than truncated. Cutting a profile at the word limit ends it
 * mid-clause, and the Profile is the first thing on the page; a re-ask costs one
 * cheap call and returns prose that was written to the length.
 */
export function isProfileTooLong(profile: string): boolean {
  return profileWordCount(profile) > PROFILE_WORDS.max;
}

/** Map an evidence node's source to the tailoring row's provenance label (M7 proof trail). */
function provFromSource(source: string | null | undefined): string {
  return source === 'ai_coached' ? 'coached' : 'imported';
}

/**
 * Gather the owner's whole evidence graph (not just the bullet bank) for C2 to
 * map against.
 *
 * CI · STAR Results Never Reach the Evidence Graph — `star_results` used to be
 * absent from this query set, so the 22 rows holding every quantified outcome
 * the candidate has (delivery times, headcounts, cost reductions, audit
 * findings) were not citable, and no CV was ever built on one. `Process/C4…`
 * §B.4 tells the bullet step to include measurable results "when they exist in
 * the Original Text" — a rule it obeyed correctly, over evidence the
 * measurements had been withheld from.
 *
 * Results are emitted as their OWN evidence items (§2.2 option 2), not as a
 * pre-joined action→result composite: a composite would need a ref code of its
 * own, and that is a citable identity tracing to no row in the profile — the
 * same objection that ruled out free-text graph tags as My Skills values. The
 * `stars` join exists only to fill `context`, which points a result back at the
 * work it came out of without inventing anything.
 */
export async function gatherEvidence(ownerId: string): Promise<Evidence[]> {
  const [acts, results, starRows, resps, bullets, edu, langs] = await Promise.all([
    db.select().from(starActions).where(eq(starActions.ownerId, ownerId)),
    db.select().from(starResults).where(eq(starResults.ownerId, ownerId)),
    db.select().from(stars).where(eq(stars.ownerId, ownerId)),
    db.select().from(responsibilities).where(eq(responsibilities.ownerId, ownerId)),
    db.select().from(bulletBank).where(eq(bulletBank.ownerId, ownerId)),
    db.select().from(education).where(eq(education.ownerId, ownerId)),
    db.select().from(languages).where(eq(languages.ownerId, ownerId)),
  ]);
  const starTitleByRef = new Map(starRows.filter((s) => s.refCode && s.title).map((s) => [s.refCode as string, s.title as string]));
  const out: Evidence[] = [];
  for (const a of acts) if (a.refCode && a.text) out.push({ ref: a.refCode, kind: 'STAR action', text: a.text, skills: a.skills ?? [], cvPosition: null, source: a.source });
  for (const r of results) {
    if (!r.refCode || !r.text) continue;
    const parent = r.starRef ? starTitleByRef.get(r.starRef) : undefined;
    out.push({
      ref: r.refCode,
      kind: 'STAR result',
      // `metric` is the row's own column, not a second source, and it is the
      // only place some numbers live at all: [2-R1]'s text names the branches
      // consolidated and never says "EUR 1.5B". Composing a node's text from
      // its own columns is what Education and Language already do below.
      text: r.metric ? `${r.text} — measured: ${r.metric}` : r.text,
      // `star_results` carries no tags of its own. Inheriting the parent
      // action's would attribute a claim to a row that never made it (§2.3).
      skills: [],
      // Same as a STAR action: no slot of its own, C2 assigns one from the
      // CV POSITION SLOTS block. A result's parent STAR does have a derivable
      // slot (`getCareerGraphFor`'s lane logic), but deriving it here would
      // make a result better-slotted than the action it came out of, and that
      // asymmetry belongs to whichever CI fixes slotting for both (§2.3).
      cvPosition: null,
      source: r.source,
      context: parent ? `outcome of STAR ${r.starRef}: ${parent}` : null,
    });
  }
  for (const r of resps) if (r.refCode && r.text) out.push({ ref: r.refCode, kind: 'Responsibility', text: r.text, skills: r.skills ?? [], cvPosition: normalizeCvPosition(`${r.positionRef ?? ''}0`), source: r.source });
  for (const b of bullets) if (b.refCode && b.text) out.push({ ref: b.refCode, kind: 'Bullet', text: b.text, skills: b.tags ?? [], cvPosition: normalizeCvPosition(b.cvPosition), source: b.source });
  for (const e of edu) if (e.refCode) out.push({ ref: e.refCode, kind: 'Education', text: [e.qualification, e.institution, e.year].filter(Boolean).join(', '), skills: [], cvPosition: null, source: e.source });
  for (const l of langs) if (l.refCode) out.push({ ref: l.refCode, kind: 'Language', text: `${l.language} (${l.cefrLevel})`, skills: [], cvPosition: null, source: l.source });
  return out;
}

/**
 * The owner's curated skill vocabulary — every name My Skills is allowed to
 * take, and the only names that may reach the CV's Skills section.
 *
 * Epic Q3, answered on CI · C4 Skills Selection Produces Unreadable Overflow:
 * all three tables count. A Job Description doesn't distinguish a skill from a
 * competence from an attribute, even though the profile tables do.
 *
 * `skills_master` is loaded first on purpose — `buildVocabIndex` keeps the
 * first writer for a name, and only skills_master rows carry a proficiency and
 * ATS keyword variants worth preserving.
 */
export async function gatherSkillVocabulary(ownerId: string): Promise<VocabEntry[]> {
  const [skills, competences, attributes] = await Promise.all([
    db.select().from(skillsMaster).where(eq(skillsMaster.ownerId, ownerId)),
    db.select().from(starCompetences).where(eq(starCompetences.ownerId, ownerId)),
    db.select().from(starAttributes).where(eq(starAttributes.ownerId, ownerId)),
  ]);
  const out: VocabEntry[] = [];
  for (const s of skills) if (s.skill) out.push({ name: s.skill, source: 'skill', proficiency: s.proficiency, variants: s.atsKeywordVariants ?? [] });
  for (const c of competences) if (c.competence) out.push({ name: c.competence, source: 'competence', proficiency: null, variants: [] });
  for (const a of attributes) if (a.attribute) out.push({ name: a.attribute, source: 'attribute', proficiency: null, variants: [] });
  return out;
}

/** Whether the real Word template can faithfully represent this Keep set —
 *  i.e. every Kept row that NEEDS one of the 11 fixed slots has one. Education/
 *  Language rows are exempt (`evidenceNeedsCvSlot`) — they render from the
 *  profile tables regardless, never from a slot. If a genuinely slotless row
 *  remains (a STAR action nobody assigned a slot to, or a non-seed tenant whose
 *  roles don't match these slots), C7 falls back to the programmatic builder,
 *  which represents any evidence. */
function templateFits(green: (typeof requirementTailoring.$inferSelect)[]): boolean {
  return (
    green.length > 0 &&
    green.every((g) => !evidenceNeedsCvSlot(g.evidenceKind) || normalizeCvPosition(g.cvPosition))
  );
}

/**
 * Map Keep bullets into the template's 11 `cv_position` slots. A slot the Keep
 * set does not cover renders NOTHING — no caption, no "Key Projects:" line, no
 * blank paragraph.
 *
 * *Superseded (2026-08-27, CI · C7 Space Rules Are Specified and Never
 * Enforced): this used to refill an uncovered slot from the bullet bank
 * (projects) or the position's responsibilities (role overviews), "so the real
 * 2-page template never renders a blank section".* It had to, because the
 * caption above each project and the "Key Projects:" line above each group were
 * static template text: an empty slot left its caption announcing a project with
 * no bullets under it. The refill filled the hole, and in doing so made the
 * document's length independent of how much evidence was selected — which is why
 * sweeping C3's budget from 14 to 9 never moved the page count.
 *
 * It was worse than neutral. The refill is per-slot and unbounded: a slot losing
 * its single tailored bullet came back with up to FOUR bank bullets, so the line
 * count went *up* as bullets came out. Measured before this change, the five
 * reference leads carried 2 / 4 / 6 / 10 / 12 refilled lines they had not
 * selected.
 *
 * `scripts/retag-cv-template-space.ts` made all three of those paragraphs loops
 * over nought-or-one, so the hole can now be closed by leaving it empty. What
 * fills the eleven slots is exactly what C3 selected, and nothing else.
 */
/** Vienna is Wien is Vienne. A city that a lead and a profile can plausibly write
 *  two ways is a city the relocation clause must not print for — this is the
 *  owner's own city and the one that decides §2.1's "not in Vienna" test, so it
 *  earns the alias. Extend as other home cities appear; a miss only costs a line
 *  that reads "open to relocate to the city you already live in". */
const CITY_ALIASES: Record<string, string> = { wien: 'vienna', vienne: 'vienna' };

/** "Vienna 1020, Austria" → "vienna". Everything before the first comma, with
 *  postcodes and punctuation stripped, lowercased, aliased. Both sides of the
 *  relocation comparison go through this, so the match is on the city alone and
 *  not on how completely either side spelled out the country. */
function cityKey(s: string | null | undefined): string {
  const head = (s ?? '').split(',')[0] ?? '';
  const cleaned = head
    .toLowerCase()
    .replace(/[^\p{L}\s-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return CITY_ALIASES[cleaned] ?? cleaned;
}

/** The lead's city as it should PRINT — original casing, country dropped, any
 *  postcode trimmed off. "Munich, Germany" → "Munich". */
function cityLabel(s: string | null | undefined): string {
  return ((s ?? '').split(',')[0] ?? '').replace(/\b\d[\d\s-]*\b/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * §2.1 — the header's relocation clause, which used to print `profiles.relocation`
 * unconditionally and so told a Vienna employer the candidate was willing to move
 * to somewhere else entirely.
 *
 * Three gates, and silence is the default whenever one cannot be answered:
 *   • the candidate must have stated a willingness at all (`profiles.relocation`
 *     is the fact, and stays the owner's to set — an empty one means never print);
 *   • the lead must actually name a city (no city, no claim);
 *   • that city must differ from the candidate's own.
 *
 * When it does print, it names THIS lead's city rather than repeating the stored
 * free text, which is what the owner asked for. The consequence worth knowing: the
 * stored `profiles.relocation` now GATES the clause instead of being its wording.
 * The wording lives here, in one place, on purpose.
 *
 * Returns the leading separator with it — the template concatenates
 * `<<Location>><<Relocation>>` directly, so a suppressed clause must leave no gap.
 */
function relocationClause(candidateLocation: string | null | undefined, relocation: string | null | undefined, leadCity: string | null | undefined): string {
  if (!relocation?.trim()) return '';
  const label = cityLabel(leadCity);
  if (!label) return '';
  const there = cityKey(leadCity);
  if (!there || there === cityKey(candidateLocation)) return '';
  return ` · Open to relocate to ${label}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** U+00A0, built from its code point rather than typed — a literal non-breaking
 *  space is invisible in a diff and one stray normalisation removes it silently. */
const NBSP = String.fromCharCode(0xa0);

/**
 * Every date the CV prints, in one abbreviated form: `"Aug 2009"`.
 *
 * One function because the owner asked for one format ("the same format and
 * colour should be used for all dates"), and the two families of date reaching
 * the template are stored differently — `positions` holds display strings
 * ("August 2009", or a bare "2003" for the early roles), `education` holds ISO
 * ("1995-08-01"). Both land here.
 *
 * Abbreviating is a space decision as much as a consistency one: "September 2016
 * — Present" is the longest date on the CV and the one that was pushing an
 * Education entry's date onto a second line.
 *
 * Anything it does not recognise — a bare year, "Present" — passes through
 * untouched rather than being guessed at.
 */
function fmtCvDate(s: string | null | undefined): string {
  const raw = (s ?? '').trim();
  if (!raw) return '';
  const iso = raw.match(/^(\d{4})-(\d{2})/);
  if (iso) return `${MONTHS[Number(iso[2]) - 1]?.slice(0, 3) ?? ''} ${iso[1]}`.trim();
  const named = raw.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (named) {
    const i = MONTHS.findIndex((m) => m.toLowerCase() === named[1].toLowerCase());
    if (i >= 0) return `${MONTHS[i].slice(0, 3)} ${named[2]}`;
  }
  return raw;
}

/**
 * An education entry's status qualifier — the short parenthetical that prints on
 * its own line under the qualification, e.g. *(coursework complete, thesis not
 * submitted)*.
 *
 * It reads `education.status`, its own column since migration 0041 (CI · C7
 * Space Rules Are Specified and Never Enforced §2.4a). The column's comment in
 * `lib/db/schema.ts` records why no existing field would do.
 *
 * *Superseded (2026-08-27): this used to read `education.notes` by a FORMATTING
 * CONVENTION — a leading parenthesised line meant "print me", everything after
 * it stayed internal — justified on the grounds that "no other row's notes begin
 * with a bracket, so nothing else starts printing".* That was true of the five
 * rows that existed and of nothing else: it made every future note that happens
 * to open with a bracket into CV-facing text, with no way for whoever wrote it to
 * know. 0041 lifts the one row that used the convention into the column and
 * retires the rule.
 *
 * Returns nought-or-one so the template's loop drops the whole paragraph for the
 * entries that have no qualifier, rather than leaving each of them a blank line.
 */
function educationStatus(status: string | null | undefined): string[] {
  const text = (status ?? '').trim().replace(/\.$/, '');
  return text ? [text] : [];
}

/** "Aug 2009 — Jul 2011", from whatever shape the two ends were stored in. */
function fmtDateRange(from: string | null | undefined, to: string | null | undefined): string {
  return [fmtCvDate(from), fmtCvDate(to)].filter(Boolean).join(' — ');
}

/**
 * The same range, made unbreakable.
 *
 * Every date sits after a right tab stop, so when the text before it fills the
 * line Word takes its wrap at the last opportunity — which is inside the date.
 * The IMD entry printed "Mar 2025 — Apr" on one line and "2025" on the next,
 * which reads worse than the wrap it was supposed to be degrading into. Non-
 * breaking spaces make the range one unit: it moves whole or not at all.
 *
 * Used on EDUCATION dates only, and the restriction is the point. `pandoc -t
 * plain` was checked and does NOT fold U+00A0 back to a space — it survives into
 * extracted text, and a `\s` that does not match it is a real ATS parser (Java's
 * does not; JavaScript's and Python's do). Employment dates are the ones an ATS
 * most wants to read, and the four position headers all fit on one line anyway
 * (measured), so they gain nothing from this and keep ordinary spaces. Education
 * heads are the ones long enough to wrap, and are parsed less and less strictly.
 */
function fmtDateRangeAtomic(from: string | null | undefined, to: string | null | undefined): string {
  return fmtDateRange(from, to).replace(/ /g, NBSP);
}

/**
 * Exported for `scripts/render-cv-from-stored.ts`, which re-renders a lead's CV
 * from data a paid run already stored. Every template change costs a look at a
 * real page, and a look at a real page must not cost a run — that script is how
 * this CI measured its own output, and how the bullet budget gets re-checked the
 * next time the template moves.
 */
export async function templateSlotData(
  ownerId: string,
  /** C3's chosen set — what fills the eleven Professional Experience slots. */
  selected: (typeof requirementTailoring.$inferSelect)[],
  bulletByRef: Map<string, { bullet: string; skills: string[] }>,
  profileText: string,
  profile?: {
    name: string | null;
    location: string | null;
    phone: string | null;
    email: string | null;
    citizenship: string | null;
    relocation: string | null;
    travel: string | null;
  } | null,
  lead?: { jdGroupPrimary: string | null; jdGroupSecondary: string | null; city: string | null } | null,
  skillsModel?: { category: string; items: string[] }[],
  /** Called only when the page trim below had to shed evidence, with the refs it
   *  took and the line cost it reached. C7's step report is what surfaces it. */
  onTrim?: (refs: string[], lineCost: number) => void
): Promise<TemplateData> {
  // `bullet_bank` and `responsibilities` used to be read here too — they were the
  // refill's two sources. Nothing in this function reads them any more, so the
  // two queries went with it. Both tables are still evidence: C2 sees them
  // through `gatherEvidence`, which is where they belong. What they no longer do
  // is top the rendered document back up behind C3's back.
  const [eduRows, langRows, posRows] = await Promise.all([
    db.select().from(education).where(eq(education.ownerId, ownerId)),
    db.select().from(languages).where(eq(languages.ownerId, ownerId)),
    db.select().from(positions).where(eq(positions.ownerId, ownerId)),
  ]);
  // The tailored C6 profile fills the template's <<Profile>> placeholder, so the
  // .docx leads with role-specific positioning rather than the static scaffold.
  const data: TemplateData = {};
  if (profileText) data['Profile'] = profileText;

  // Professional Experience position headers ("<Title> at <Company>, <City,
  // Country>" + dates) — the one part of Professional Experience that stayed
  // static template text even after the CV_SLOTS bullets went fully dynamic.
  // Keyed by CV_SLOTS' own A/B/C/D letters (posByRefCode elsewhere in this file
  // uses the same convention) — positions E/F exist but were never part of the
  // rendered CV, so they're not given template tags here.
  const posByLetter = new Map(posRows.filter((p) => p.refCode).map((p) => [p.refCode as string, p]));
  for (const letter of ['A', 'B', 'C', 'D']) {
    const p = posByLetter.get(letter);
    if (!p) continue;
    const companyLine = [p.company, p.cityCountry].filter(Boolean).join(', ');
    data[`Position ${letter} Header`] = [p.title, companyLine].filter(Boolean).join(' at ');
    const dates = fmtDateRange(p.startDate, p.endDate);
    if (dates) data[`Position ${letter} Dates`] = dates;
  }
  // C1 decides both halves of the headshot question, and they are mutually
  // exclusive: either the photograph prints, or the line explaining its absence
  // does. Empty arrays ⇒ the template's loops drop the drawing and the paragraph
  // entirely, and `dropUnreferencedImages` then takes the JPEG out of the package
  // so a no-headshot CV does not quietly carry one.
  //
  // The rule: include unless C1 says do not. C1's table also marks other European
  // countries "Optional (lean towards exclude)", but the owner's own CVs for
  // Vienna roles carry the photograph, so leaning on that would print a CV he
  // would not send. The hard rule — UK, IE, DK, NL, CA — is the one that decides
  // here. One line to reverse if he wants the lean honoured instead.
  const headshot = headshotDecision(lead?.city ?? null);
  const excludeHeadshot = headshot.startsWith('Do not include');
  data['Headshot'] = excludeHeadshot ? [] : ['x'];
  data['Headshot Note'] = headshotNote(headshot);
  // C5 already computes this per-tailoring (the Keep rows' Requirement Skills,
  // ordered Core → Important → Nice-to-Have) for the programmatic builder's
  // CvModel — reused here so the real template shows the same tailored skills,
  // not a static block.
  //
  // The 24-item display cap that used to sit here is gone. It was added
  // 2026-08-07 as an explicit stopgap over the 67-skill overflow, and this CI
  // removed the cause: C5 no longer prints raw graph tags, and bounds its own
  // output to C5 §B.1's envelope (`SKILLS_ENVELOPE`), shedding Nice-to-Have
  // first. A renderer silently truncating a section it doesn't own was hiding
  // the symptom — if the list is ever too long again, that belongs in C5's
  // selection and its step report, where it is visible.
  //
  // §2.3 — the category is no longer a `"Category: "` prefix on the same line.
  // It is its own BOLD paragraph, with the skills inline beneath it, which a flat
  // string could not express at all: bold is a run inside a paragraph, and every
  // line of a flat value shares one paragraph. The template's `<<#Skills>>` loop
  // owns the two paragraphs; this supplies the pair per group.
  if (skillsModel?.length) {
    data['Skills'] = skillsModel.map((g) => ({ Category: g.category, Items: g.items.join(' · ') }));
  }
  if (profile?.name) data['Name'] = profile.name;
  if (profile?.location) data['Location'] = profile.location;
  if (profile?.phone) data['Phone'] = profile.phone;
  if (profile?.email) data['Email'] = profile.email;
  if (profile?.citizenship) data['Citizenship'] = profile.citizenship;
  // §2.1 — conditional, and it names the LEAD's city. See `relocationClause`.
  const relocation = relocationClause(profile?.location, profile?.relocation, lead?.city);
  if (relocation) data['Relocation'] = relocation;
  if (profile?.travel) data['Travel'] = profile.travel;
  // Header's "positioning" line is this lead's own B5 classification, not
  // profiles.headline (which is only ever an internal seed for the C6 prompt
  // above) — confirmed against a real generated CV, whose header line matched
  // its lead's JD Group names verbatim, not the profile's stored headline.
  if (lead?.jdGroupPrimary) data['JD Group Primary'] = lead.jdGroupPrimary;
  if (lead?.jdGroupSecondary) data['JD Group Secondary'] = lead.jdGroupSecondary;

  // Education / Executive Education — one entry per row, as the template's
  // `<<#Education>>` loop expects. `type` already distinguishes the two sections
  // ('Executive Education' vs everything else) — confirmed against live data, no
  // separate field needed.
  //
  // Correction, 2026-08-27: these used to flatten into a single `\n\n`-joined
  // block "because the template's literal-key parser has no real loop construct
  // to repeat per-row". It has one now (CI · CV Template Output Format §2.6), and
  // the flattening was what pushed every date onto its own line — §2.5's
  // complaint. `Head` and `Dates` are now separate tags either side of a right
  // tab stop.
  //
  // The per-row `summary` notes no longer print, on the owner's instruction
  // (2026-08-27, second review: "eliminate notes from Education and Executive
  // Education"). They were Keep-gated evidence — shown only where C2 had cited
  // that row for THIS job — and the gate was the reason this function took the
  // whole `green` set. Nothing else here reads it, so the parameter went with
  // them. The rows are still evidence; they are simply not printed under the
  // qualification any more, which buys back four lines of a CV that is over
  // budget. Restoring them means restoring both the loop in the template and the
  // Keep gate here, not just a field.
  const eduSortKey = (e: (typeof eduRows)[number]) => e.dateCompleted || e.dateBegin || '';
  const eduEntry = (e: (typeof eduRows)[number]) => ({
    Head: [e.qualification, [e.institution, e.cityCountry].filter(Boolean).join(', ')].filter(Boolean).join(', '),
    // A status qualifier, not the return of the notes — its own column since
    // migration 0041. See `educationStatus`.
    Status: educationStatus(e.status),
    // `||`, not `??`. `date_completed` holds an EMPTY STRING on the in-progress
    // Master's, not null — so `??` accepted it as a completion date and the entry
    // printed "Sep 2016" where it had read "Sep 2016 — Present". A study still
    // under way is the one case this field exists to express; it must not turn on
    // which flavour of empty the row happens to carry.
    Dates: fmtDateRangeAtomic(e.dateBegin, e.dateCompleted || (e.dateBegin ? 'Present' : null)),
  });
  const education_ = eduRows.filter((e) => e.type !== 'Executive Education').sort((a, b) => eduSortKey(b).localeCompare(eduSortKey(a)));
  const execEducation = eduRows.filter((e) => e.type === 'Executive Education').sort((a, b) => eduSortKey(b).localeCompare(eduSortKey(a)));
  if (education_.length) data['Education'] = education_.map(eduEntry);
  if (execEducation.length) data['Executive Education'] = execEducation.map(eduEntry);

  if (langRows.length) {
    // One line, entries separated by ` · ` — the same treatment the Skills
    // entries under a category get, for the same shape of data. C7 §C has always
    // called this "a small separate section at the bottom"; as four bulleted
    // paragraphs it was the whole of the page-3 overflow on three of the five
    // measured leads. See `scripts/retag-cv-template-space.ts` §4.
    data['Languages'] = langRows.map((l) => `${l.language}: ${l.displayLevel ?? l.cefrLevel ?? ''}`.trim()).join(' · ');
  }

  // Per-position caption numbering restarts at 1 and counts only the projects
  // that survived, so a CV whose A1 emptied prints its A2 as "1." rather than
  // leaving a gap in the sequence. Filled as the loop below walks CV_SLOTS,
  // which is already in document order.
  //
  // `dropped` is the trim below asking for a smaller document. Everything from
  // here to `fillSlots`' closing brace is a pure function of it, which is what
  // lets the trim re-run the fill rather than surgically edit its output.
  const fillSlots = (dropped: ReadonlySet<string>) => {
    const projectsSoFar = new Map<string, number>();
    for (const slot of CV_SLOTS) {
      const code = slotCode(slot);
      const letter = code[0];
      const isOverview = isRoleOverviewSlot(slot);
      const seenLines = new Set<string>();
      const lines = selected
        .filter((g) => {
          if (g.evidenceRef && dropped.has(g.evidenceRef)) return false;
          const normalized = normalizeCvPosition(g.cvPosition);
          return normalized === slot || (normalized ? slotCode(normalized) === code : false);
        })
        // The `|| g.originalText` tail stays a backstop here on purpose. This is a
        // RENDER path, not a write path: C4's floor already guarantees a real
        // bullet for every ref-bearing Keep row before anything reaches the .docx,
        // and throwing at render time would block a CV that is otherwise complete.
        // Same reasoning for `bulletsForCv` in the programmatic builder below.
        .map((g) => (g.evidenceRef && bulletByRef.get(g.evidenceRef)?.bullet) || g.cvBullet || g.originalText || '')
        .filter(Boolean)
        // De-dupe: requirement_tailoring is one row per JD requirement, and the
        // same strong bullet legitimately answers several requirements — so the
        // same evidence shows up as multiple green rows for one slot. First
        // exposed 2026-08-07 rendering the real template for the first time
        // (templateExists() had always been false before then, so this loop had
        // never actually run against production data) — a lead with 64 green
        // rows repeated its A1/A2/A3 bullets 3-7x each before this filter.
        .filter((line) => {
          const key = line.trim().toLowerCase();
          if (seenLines.has(key)) return false;
          seenLines.add(key);
          return true;
        });
      // A role overview is prose and stays one paragraph — but a NOUGHT-OR-ONE
      // array rather than a string, so an overview nothing was selected for loses
      // its paragraph instead of leaving a blank line where a description was.
      //
      // A project slot is a LIST, and the template repeats its bulleted paragraph
      // per element — CI · CV Template Output Format §2.4's fix: joining with `\n`
      // gave Word one paragraph, so one bullet, and every line after the first was
      // an unbulleted soft break inside it.
      //
      // The `.replace(/\.\s*$/, '')` that used to close this line is gone with the
      // join. Its stated reason — "the template already prints `<<…>>.`" — was not
      // true of any committed version of the template: no placeholder is followed by
      // a literal period. What it actually did was strip the full stop from the LAST
      // line of every group, so a three-bullet project printed two bullets ending in
      // "." and a third ending in nothing. Visible in the 2026-08-26 CV the owner
      // marked up, under every position.
      data[slot] = isOverview ? (lines.length ? [lines.join(' ')] : []) : lines;
      if (!isOverview) {
        // The caption is data now, and it prints only for a project that has
        // bullets. Numbered over the survivors, not over the slots.
        if (lines.length) {
          const n = (projectsSoFar.get(letter) ?? 0) + 1;
          projectsSoFar.set(letter, n);
          data[`${slot} Caption`] = [`${n}. ${slotProjectName(slot)}`];
        } else {
          data[`${slot} Caption`] = [];
        }
      }
    }
    // "Key Projects:" is a heading over a list, so it prints only where there is
    // one. A position whose projects all emptied keeps its header, its dates and
    // its role overview — dropping the position itself would take a role off the
    // CV, which is a truthfulness question and not a space one.
    for (const letter of ['A', 'B', 'C', 'D']) {
      const any = CV_SLOTS.some((s) => !isRoleOverviewSlot(s) && slotCode(s)[0] === letter && (data[`${s} Caption`] as string[] | undefined)?.length);
      data[`Position ${letter} Key Projects`] = any ? ['Key Projects:'] : [];
    }
  };

  // ── C7 §C · "Maximum Pages: 2, non-negotiable" ──────────────────────────────
  //
  // The one rule C7 keeps, and the only one it alone can enforce: does the
  // document fit, and what gives way when it does not. Every other budget was
  // settled upstream by the step that owns the section — but the sections are
  // budgeted independently and a long lead can still overrun their sum, which is
  // exactly what Aliaxis did (one line, the whole Languages block onto page 3).
  //
  // What gives way is the LOWEST-RANKED PROJECT BULLET, taken from the end of
  // C3's own `shortlist_rank` order — the evidence C3 itself judged least worth
  // its place. Two things deliberately never give way: a role overview, because a
  // position with no description reads as a gap rather than as an edit, and the
  // last surviving bullet of a position, because losing that empties the role's
  // Key Projects entirely.
  //
  // This is a LAST RESORT and should almost never fire. Every bullet it takes is
  // real evidence C3 selected, so it is reported on the C7 step rather than done
  // quietly; a lead that trims more than a bullet or two is a lead whose budget
  // is wrong somewhere upstream.
  const dropped = new Set<string>();
  fillSlots(dropped);
  // Worst rank first — the reverse of the order C3 selected in.
  const trimCandidates = [...selected]
    .filter((g) => g.evidenceRef && !isRoleOverviewSlot(normalizeCvPosition(g.cvPosition) ?? ''))
    .sort((a, b) => (b.shortlistRank ?? 0) - (a.shortlistRank ?? 0))
    .map((g) => g.evidenceRef as string);
  for (const ref of trimCandidates) {
    if (contentLineCost(data) <= CONTENT_LINE_ALLOWANCE) break;
    // Never empty a position: a slot whose last bullet this would take keeps it.
    const slot = CV_SLOTS.find((s) => selected.some((g) => g.evidenceRef === ref && slotCode(normalizeCvPosition(g.cvPosition) ?? '') === slotCode(s)));
    const letter = slot ? slotCode(slot)[0] : '';
    const remaining = new Set(
      selected
        .filter((g) => g.evidenceRef && !dropped.has(g.evidenceRef) && slotCode(normalizeCvPosition(g.cvPosition) ?? '')[0] === letter && !isRoleOverviewSlot(normalizeCvPosition(g.cvPosition) ?? ''))
        .map((g) => g.evidenceRef as string)
    );
    if (remaining.size <= 1) continue;
    dropped.add(ref);
    fillSlots(dropped);
  }
  // Reported, never silent. `onTrim` rather than a key on `data` because
  // `TemplateData` is what gets handed to docxtemplater, and a private field
  // riding along in it is one rename away from being looked up as a tag.
  if (dropped.size) onTrim?.([...dropped], contentLineCost(data));
  return data;
}

/**
 * The rendered line cost of everything in a `TemplateData` that C3, C5 and C6
 * decide — profile, skills, bullets, role overviews, and the captions that come
 * and go with them.
 *
 * The template's fixed furniture is deliberately NOT counted: it is constant for
 * this template and is absorbed into `CONTENT_LINE_ALLOWANCE`, which is
 * calibrated against Word rather than derived. Counting it would mean modelling
 * paragraph spacing, which is where a line estimate stops being checkable.
 */
export function contentLineCost(data: TemplateData): number {
  const cost = (v: TemplateValue | undefined): number => {
    if (typeof v === 'string') return v ? renderedLines(v) : 0;
    if (!Array.isArray(v)) return 0;
    return v.reduce<number>((n, item) => n + (typeof item === 'string' ? renderedLines(item) : Object.values(item).reduce<number>((m, x) => m + (typeof x === 'string' ? renderedLines(x) : (x as string[]).reduce((k, s) => k + renderedLines(s), 0)), 0)), 0);
  };
  let total = cost(data['Profile']);
  total += cost(data['Skills']);
  for (const slot of CV_SLOTS) total += cost(data[slot]) + cost(data[`${slot} Caption`]);
  for (const letter of ['A', 'B', 'C', 'D']) total += cost(data[`Position ${letter} Key Projects`]);
  return total;
}

// ── C1 + C2 ──────────────────────────────────────────────────────────────────
export async function runEvidenceMapping(leadId: string, ownerId?: string | null): Promise<StepReport[]> {
  const [lead] = await db
    .select()
    .from(jobLeads)
    .where(ownerId ? and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, ownerId)) : eq(jobLeads.id, leadId));
  if (!lead) throw new Error('Lead not found');
  const effectiveOwnerId = ownerId ?? lead.ownerId;
  const reports: StepReport[] = [];
  const allReqs = await db
    .select()
    .from(jobRequirements)
    .where(and(eq(jobRequirements.jobLeadId, leadId), eq(jobRequirements.ownerId, effectiveOwnerId)));
  if (!allReqs.some((r) => CORE_AND_IMPORTANT.includes(r.rank ?? ''))) {
    throw new Error('No Core or Important requirements have been extracted for this lead yet. Re-run screening first, then map evidence.');
  }
  const reqs = allReqs.filter((r) => c2AdmitsRequirement(r.rank, r.initialMatchStrength));

  // C1 — format & headshot decision
  {
    const t = Date.now();
    const headshot = headshotDecision(lead.city);
    reports.push(await recordStep(leadId, { step: 'C1', label: 'Format & compliance', model: 'code', summary: `Headshot: ${headshot}`, output: { headshot }, ms: Date.now() - t }, effectiveOwnerId));
  }

  // C2 — build on B6 rather than re-deriving (CI · Make C2 Build on B6 Instead
  // of Re-Deriving the Map). No wholesale delete: a re-run MERGES into whatever
  // is already stored, so a prior human review survives (§2.3) and a re-run
  // that only digs on the weak spots costs only what it actually improves.
  {
    const evidence = await gatherEvidence(effectiveOwnerId);
    const byRef = new Map(evidence.map((e) => [e.ref, e]));
    // CI · C4 Skills overflow — the gate every My Skills value now passes
    // through, on both the model path and the carry-forward path.
    const vocabulary = await gatherSkillVocabulary(effectiveOwnerId);
    const vocabIndex = buildVocabIndex(vocabulary);
    const reqById = new Map(reqs.map((q) => [q.id, q]));
    const [c2Profile] = await db.select().from(profiles).where(eq(profiles.ownerId, effectiveOwnerId)).limit(1);
    const candidateFacts = candidateFactsSummary(c2Profile);
    // Stable requirement numbering shared with the LLM.
    const reqByOrder = new Map<number, (typeof reqs)[number]>();
    reqs.forEach((q, i) => reqByOrder.set(q.requirementOrder ?? i + 1, q));

    const b6Rows = await db
      .select()
      .from(requirementEvidence)
      .where(and(eq(requirementEvidence.jobLeadId, leadId), eq(requirementEvidence.ownerId, effectiveOwnerId)));
    const b6ByReq = new Map<string, typeof b6Rows>();
    for (const row of b6Rows) {
      if (!b6ByReq.has(row.requirementId)) b6ByReq.set(row.requirementId, []);
      b6ByReq.get(row.requirementId)!.push(row);
    }

    const existingRows = await db
      .select()
      .from(requirementTailoring)
      .where(and(eq(requirementTailoring.jobLeadId, leadId), eq(requirementTailoring.ownerId, effectiveOwnerId)));

    // §2.1 — B6's own matchStrength decides where C2 spends model effort. `tiers`
    // is mutable: a requirement B6 rated Excellent/Very Strong but left with no
    // evidence row at all (shouldn't happen — resolveEvidenceLinks only drops
    // unknown refs — but never trust a claim with nothing behind it) falls
    // through to the deep pass rather than silently producing nothing.
    const tiers = new Map<number, MatchTier>();
    for (const [order, req] of reqByOrder) tiers.set(order, tierFor(req.initialMatchStrength));

    // The Nice-to-Have requirements admitted by §2.2 above, which are here on
    // the carry ticket alone. Tracked so the "carry with nothing behind it"
    // fallback below can send a Core/Important requirement to the deep pass
    // without doing the same to one of these — see the comment there.
    const carryOnlyReqIds = new Set(reqs.filter((r) => r.rank === NICE_TO_HAVE).map((r) => r.id));
    const unmappedReqIds = new Set<string>();

    const proposed: ProposedLink[] = [];

    // Carry EVERY requirement's B6 evidence forward first, regardless of tier —
    // this is what makes C2 unable to produce a result worse than the initial
    // screen already found, which is the defect this CI exists to fix. No model
    // call for it: it's a direct transposition of `requirement_evidence`.
    for (const [order, req] of reqByOrder) {
      const rows = b6ByReq.get(req.id) ?? [];
      for (const row of rows) {
        const ev = byRef.get(row.evidenceRef);
        proposed.push({
          requirementId: req.id,
          evidenceRef: row.evidenceRef,
          matchStrength: req.initialMatchStrength ?? 'Weak',
          connection: row.note ?? 'Carried forward from the initial screen (B6).',
          cvPosition: row.cvPosition,
          // Prefer the live graph's text/skills (an edited bullet since B6 ran);
          // fall back to B6's own snapshot if the ref has since dropped out of
          // the graph rather than throwing on a stale citation.
          evidenceText: ev?.text ?? row.evidenceText ?? '',
          evidenceKind: ev?.kind ?? row.evidenceKind ?? null,
          // No model call runs on this path, so there is no C2 selection to
          // take. The evidence node's own tags are resolved against the curated
          // vocabulary instead — an exact hit yields the profile's canonical
          // spelling, and free-text graph vocabulary ("general assembly",
          // "data reliability") resolves to nothing and is dropped, exactly as
          // it would be if the model had proposed it.
          mySkills: resolveVocab(ev?.skills ?? [], vocabIndex),
          provSource: provFromSource(ev?.source ?? null),
        });
      }
      // A requirement B6 rated Excellent/Very Strong but left with nothing
      // behind it has no claim to carry — treat it as unscored instead.
      //
      // A Nice-to-Have requirement is the one exception. It is in this run
      // *because* it carries for free; with no rows to carry there is nothing
      // free left, and demoting it would hand it to the model, growing the
      // prompt by exactly the amount §2.2 rules out of scope. So it leaves the
      // run instead — unmapped, as it was before this CI — rather than
      // becoming a paid deep search nobody asked for.
      if (tiers.get(order) === 'carry' && rows.length === 0) {
        if (carryOnlyReqIds.has(req.id)) {
          reqByOrder.delete(order);
          tiers.delete(order);
          unmappedReqIds.add(req.id);
        } else {
          tiers.set(order, 'dig');
        }
      }
    }

    // Improve/dig tier — only the requirements B6 rated Good, Weak or No Match
    // (or never scored at all) reach the model, to ADD candidates on top of
    // whatever B6 already found above; Excellent/Very Strong are never re-asked
    // (marginal effort-to-score ratio doesn't pay — owner's objective, CI §1.3).
    // The prompt shrinks with them.
    const targeted = [...reqByOrder.entries()].filter(([order]) => tiers.get(order) !== 'carry');
    let gaps: { order?: number; requirement?: string | null; note: string }[] = [];
    let modelUsed = 'code (carried from B6)';
    let ms = 0;

    if (targeted.length > 0) {
      const b6PickText = (req: (typeof reqs)[number]): string | null => {
        const rows = b6ByReq.get(req.id) ?? [];
        if (rows.length === 0) return null;
        return rows.map((r) => `[${r.evidenceRef}] ${r.evidenceText ?? ''}`.trim()).join('; ') + ` (rated ${req.initialMatchStrength})`;
      };
      const r = await runStructured({
        step: 'C2',
        // Truthfulness-critical (Master Instructions §6.1) → Opus tier.
        model: 'opus',
        system: await systemPromptFor('C2', effectiveOwnerId),
        user: c2UserMessage(
          evidence,
          lead.title,
          lead.company ?? null,
          targeted.map(
            ([n, q]): [number, { rank: string | null; requirement: string; skills: string[] | null; b6Pick: string | null }] => [
              n,
              { rank: q.rank, requirement: q.requirement, skills: q.skills ?? null, b6Pick: b6PickText(q) },
            ]
          ),
          candidateFacts,
          vocabulary
        ),
        tool: C2.tool,
        zod: C2.zod,
        mock: () => mockEvidenceMap(targeted, evidence, vocabulary),
        leadId,
        ownerId: effectiveOwnerId,
      });

      for (const link of r.data.links) {
        const req = reqByOrder.get(link.order);
        const ev = link.evidenceRef ? byRef.get(link.evidenceRef) : undefined;
        if (!req || !ev) continue;
        proposed.push({
          requirementId: req.id,
          evidenceRef: ev.ref,
          matchStrength: link.matchStrength,
          connection: link.connection ?? null,
          // `||`, not `??`: cvPosition is required in the strict schema now, so an
          // unmatched slot arrives as "" rather than absent, and `??` would let
          // that empty string beat the evidence node's own slot.
          cvPosition: normalizeCvPosition(link.cvPosition || ev.cvPosition),
          evidenceText: ev.text,
          evidenceKind: ev.kind,
          // C2's own selection from the curated vocabulary — this is the line
          // the epic specified and the build never shipped (it wrote
          // `ev.skills`, the graph's free text, instead). Validated the same
          // way a ref code is: a name that isn't really in the vocabulary is
          // dropped rather than trusted. Falling back to `ev.skills` when the
          // model names nothing would reopen the exact hole this closes.
          mySkills: resolveVocab(link.mySkills ?? [], vocabIndex),
          provSource: provFromSource(ev.source),
        });
      }
      gaps = r.data.gaps ?? [];
      modelUsed = r.model;
      ms = r.ms;
    }
    // Idempotent either way: clears prior gap tips even on a run that targeted
    // nothing (every requirement carried), which is correctly zero gaps.
    await recordGapTips(leadId, effectiveOwnerId, gaps);

    // De-dup within this run's own proposals (carry + improve fallback can both
    // propose the same ref for the same requirement).
    const seenKeys = new Set<string>();
    const dedupedProposed = proposed.filter((p) => {
      const key = `${p.requirementId}::${p.evidenceRef}`;
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });

    // §2.2 — replace only where new evidence scores strictly higher; insert what's
    // new; leave everything a human has actually decided on alone regardless of
    // whether this run mentions it. §2.3 addendum — an untouched row that is
    // STILL PENDING (nobody has decided anything about it) is fair game for
    // pruning; see planMerge's docstring.
    // A carry-only requirement that turned out to have nothing to carry was
    // never evaluated by this run, so it is out of the merge's scope too —
    // leaving it in would let the prune arm delete pending rows for a
    // requirement this run deliberately said nothing about.
    const processedReqIds = new Set([...reqById.keys()].filter((id) => !unmappedReqIds.has(id)));
    const { toInsert, toReplace, toRefresh, toDelete, unchanged } = planMerge(dedupedProposed, existingRows, processedReqIds);

    if (toInsert.length) {
      await db.insert(requirementTailoring).values(
        toInsert.map((link) => {
          const req = reqById.get(link.requirementId)!;
          return {
            ownerId: effectiveOwnerId,
            jobLeadId: leadId,
            requirementId: req.id,
            leadTitle: lead.title,
            requirementLine: `${req.requirementOrder} · ${req.rank} · ${req.requirement}`,
            connectionToExpertise: `${link.matchStrength}${link.connection ? ` · ${link.connection}` : ''}`,
            evidenceRef: link.evidenceRef,
            originalText: link.evidenceText,
            evidenceKind: link.evidenceKind,
            cvPosition: link.cvPosition,
            // My Skills: the candidate's own vocabulary — C2's selection from
            // `skills_master` / `star_competences` / `star_attributes`, already
            // validated against them. Requirement Skills: the matched
            // requirement's JD-language skills, written by B2 (`screening.ts`,
            // the `emit_requirements` insert — B5 never touches
            // `job_requirements.skills`). Snapshotted here and never written
            // again: C4's tag has its own column, `cvBulletSkills`, so this one
            // keeps meaning "what the JD asked for" all the way through. CI ·
            // Requirement Skills vs My Skills; CI · Split cv_bullet_skills from
            // requirement_skills. Never conflate either with B4's AoE codes (A–Q).
            mySkills: link.mySkills,
            requirementSkills: req.skills ?? [],
            provSource: link.provSource,
            approvalStatus: 'pending' as const,
          };
        })
      );
    }
    // §2.3 — only a genuinely replaced row resets to pending; the evidence
    // changed, so the judgement has to be made again.
    //
    // The shortlist goes with it (CI · C3 §2b.5 item 3). A rank describes a
    // choice made over the evidence that was here a moment ago, and a pin says
    // "keep THIS on the CV" about a sentence that has just been swapped out —
    // both now refer to nothing, so neither may survive the replacement.
    for (const { id, link } of toReplace) {
      await db
        .update(requirementTailoring)
        .set({
          connectionToExpertise: `${link.matchStrength}${link.connection ? ` · ${link.connection}` : ''}`,
          originalText: link.evidenceText,
          evidenceKind: link.evidenceKind,
          cvPosition: link.cvPosition,
          mySkills: link.mySkills,
          provSource: link.provSource,
          approvalStatus: 'pending',
          approvedAt: null,
          shortlistRank: null,
          shortlistPin: null,
        })
        .where(and(eq(requirementTailoring.id, id), eq(requirementTailoring.ownerId, effectiveOwnerId)));
    }
    // Backfill-only: a row that matched again but didn't score higher keeps its
    // stored connection/matchStrength and approval state untouched — only the
    // descriptive evidence_kind gets patched in, and only when it was missing.
    for (const { id, link } of toRefresh) {
      await db
        .update(requirementTailoring)
        .set({ evidenceKind: link.evidenceKind })
        .where(and(eq(requirementTailoring.id, id), eq(requirementTailoring.ownerId, effectiveOwnerId)));
    }
    // Prune untouched pre-CI leftovers — never a row carrying a real verdict;
    // planMerge already restricted this to `pending` rows this run was silent on.
    if (toDelete.length) {
      await db
        .delete(requirementTailoring)
        .where(and(inArray(requirementTailoring.id, toDelete), eq(requirementTailoring.ownerId, effectiveOwnerId)));
    }
    await db.update(jobLeads).set({ status: 'tailoring' }).where(and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, effectiveOwnerId)));

    // True gap count across ALL requirements, not just the ones sent to the
    // model this run: a requirement with neither a surviving stored row nor a
    // fresh proposal has nothing behind it, carry-tier included. Pruned rows
    // are excluded — they no longer exist after the delete above.
    const deletedIds = new Set(toDelete);
    const coveredReqIds = new Set<string>([
      ...existingRows.filter((r) => !deletedIds.has(r.id)).map((r) => r.requirementId).filter((id): id is string => !!id),
      ...dedupedProposed.map((p) => p.requirementId),
    ]);
    // A carry-only Nice-to-Have that turned out to have nothing to carry left
    // this run above; it is not a gap C2 has any intention of digging into, so
    // reporting it as one would ask the reader to chase something out of scope.
    const gapCount = reqs.filter((q) => !coveredReqIds.has(q.id) && !unmappedReqIds.has(q.id)).length;
    // §2.2's whole claim is that this number can rise while the model spend
    // does not, so it is worth being able to read it off the step rather than
    // out of the database.
    const niceToHaveCarried = reqs.filter((q) => q.rank === NICE_TO_HAVE && coveredReqIds.has(q.id)).length;
    reports.push(
      await recordStep(leadId, {
        step: 'C2',
        label: 'Map requirements → evidence',
        model: modelUsed,
        summary:
          `${toInsert.length} new · ${toReplace.length} improved · ${unchanged} unchanged · ${toDelete.length} pruned · ` +
          `${gapCount} gap${gapCount === 1 ? '' : 's'}` +
          (niceToHaveCarried ? ` · ${niceToHaveCarried} nice-to-have carried` : '') +
          ` · pending review`,
        output: {
          inserted: toInsert.length,
          replaced: toReplace.length,
          unchanged,
          pruned: toDelete.length,
          gaps: gapCount,
          requirementsMapped: reqs.length - unmappedReqIds.size,
          niceToHaveCarried,
          // What the model was actually asked about — the number §2.2 promises
          // does not move when a Nice-to-Have requirement is admitted.
          targeted: targeted.length,
        },
        ms,
      }, effectiveOwnerId)
    );
  }
  return reports;
}

/**
 * The Keep set — every row the owner approved, in one place.
 *
 * Hoisted because two callers need it and one of them needs it twice:
 * `generateCv` re-reads the set after the legacy fallback has run C3, since
 * selection clears the `cv_bullet` of everything it dropped and the rows loaded
 * beforehand still carry the previous run's tailored prose.
 */
function loadGreenRows(leadId: string, ownerId: string) {
  return db
    .select()
    .from(requirementTailoring)
    .where(
      and(
        eq(requirementTailoring.jobLeadId, leadId),
        eq(requirementTailoring.ownerId, ownerId),
        eq(requirementTailoring.approvalStatus, 'green')
      )
    );
}

/**
 * C3 · Select the CV evidence set — the step that chooses.
 *
 * Runs at the **Approve-map gate**, not inside `generateCv`. That is the whole
 * of CI · C3 Selects the CV Evidence Set §2b: the arithmetic below is Part 1's
 * and is unchanged, but selection now happens *before* anything is written, so
 * every pin and exclude the owner makes lands while a bullet is still an
 * unwritten proposal. Part 1 ran it between C2's output and bullet-writing and
 * showed the result afterwards, which asked the human to judge a choice already
 * spent.
 *
 * It is free — pure code, no model call — which is what makes re-solving on
 * every pin, exclude and Keep change affordable rather than a state to track.
 *
 * `selected` is what C4 is asked to rewrite, what C5 draws skills from, and
 * what C7/C8 see. Education and Language rows are exempt rather than dropped:
 * they never entered the budget (they render from the profile tables
 * regardless), and they still gate their own sections' detail through `green`.
 *
 * Selecting nothing is reported, not thrown. A map holding only Education and
 * Language rows is a real state to show on the Map; it only becomes an error at
 * Generate, where `generateCv` raises it with the message that says what to do.
 */
export async function runEvidenceSelection(leadId: string, ownerId?: string | null): Promise<StepReport[]> {
  const [lead] = await db
    .select()
    .from(jobLeads)
    .where(ownerId ? and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, ownerId)) : eq(jobLeads.id, leadId));
  if (!lead) throw new Error('Lead not found');
  const effectiveOwnerId = ownerId ?? lead.ownerId;
  const reports: StepReport[] = [];

  const green = await loadGreenRows(leadId, effectiveOwnerId);
  if (green.length === 0) throw new Error('No Keep evidence — approve the map before selecting.');

  const reqs = await db
    .select()
    .from(jobRequirements)
    .where(and(eq(jobRequirements.jobLeadId, leadId), eq(jobRequirements.ownerId, effectiveOwnerId)));

  const exemptRows = green.filter((g) => !evidenceNeedsCvSlot(g.evidenceKind));
  const t = Date.now();
  const rankByReqId = new Map(reqs.map((r) => [r.id, r.rank]));
  const byRef = new Map<string, SelectionCandidate>();
  for (const g of green) {
    if (!g.evidenceRef || !evidenceNeedsCvSlot(g.evidenceKind)) continue;
    let cand = byRef.get(g.evidenceRef);
    if (!cand) {
      cand = {
        ref: g.evidenceRef,
        links: [],
        cvPosition: normalizeCvPosition(g.cvPosition),
        // `originalText` is the snapshot C2 wrote, which for a STAR result
        // already carries its `metric` column composed in as "— measured: …".
        // That is what `impact` reads, and reading `cvBullet` instead would
        // score this run against the PREVIOUS run's tailored prose.
        text: g.originalText ?? '',
        pin: g.shortlistPin === 'pin' || g.shortlistPin === 'exclude' ? g.shortlistPin : null,
      };
      byRef.set(g.evidenceRef, cand);
    }
    // A row whose pin disagrees with its siblings' can't happen through the
    // UI (the pin is set per ref), but if it ever did, an explicit exclude
    // wins over a pin — the safer direction for a claim on a CV.
    if (g.shortlistPin === 'exclude') cand.pin = 'exclude';
    if (!g.requirementId) continue;
    (cand.links as SelectionLink[]).push({
      requirementId: g.requirementId,
      rank: rankByReqId.get(g.requirementId) ?? null,
      // C2 stamps the label at the head of `connectionToExpertise`; there is
      // no dedicated column, and `storedMatchStrength` is the same reader the
      // C2 merge uses.
      matchStrength: storedMatchStrength(g.connectionToExpertise),
      requirementSkills: g.requirementSkills ?? [],
    });
  }
  const candidates = [...byRef.values()];
  const result = selectEvidence(candidates, DEFAULT_SELECTION_PARAMS);
  const rankByRef = new Map(result.selected.map((s) => [s.ref, s.rank]));

  // Persist the verdict. Rewritten wholesale every run, so a re-run after the
  // owner pins or excludes something reflects only this run — and the stale
  // `cv_bullet`/`cv_bullet_skills` of a row that is no longer selected are
  // cleared with it. Leaving them would let a previous run's tags reach C5
  // (this is exactly how a degree printed as a skill: EDU-1/2/3 carried tags
  // from a run that did write bullets for them), and would show the Map's
  // proof trail a bullet that is not on the CV.
  for (const g of green) {
    const rank = g.evidenceRef ? rankByRef.get(g.evidenceRef) ?? null : null;
    g.shortlistRank = rank;
    if (rank == null) {
      g.cvBullet = null;
      g.cvBulletSkills = [];
    }
    await db
      .update(requirementTailoring)
      .set(rank == null ? { shortlistRank: null, cvBullet: null, cvBulletSkills: [] } : { shortlistRank: rank })
      .where(and(eq(requirementTailoring.id, g.id), eq(requirementTailoring.ownerId, effectiveOwnerId)));
  }

  // ── The step report (CI §2.7 item 4) ─────────────────────────────────────
  // This is the surface the budget is judged from, so it carries the two
  // coverage readings that differ, and says why they differ. "Bullets" is
  // coverage from the selected set alone; "as printed" adds the Education and
  // Language rows, whose sections appear on the CV unconditionally — a Core
  // requirement answered only by a degree is genuinely answered by the CV
  // even though no bullet carries it, and reporting only the first number
  // would score C3 down for obeying §2.4.
  const universe = reqs.map((r) => ({ id: r.id, rank: r.rank }));
  const asExemptCandidate = (g: (typeof exemptRows)[number]): SelectionCandidate => ({
    ref: g.evidenceRef ?? '',
    links: g.requirementId
      ? [{ requirementId: g.requirementId, rank: rankByReqId.get(g.requirementId) ?? null, matchStrength: storedMatchStrength(g.connectionToExpertise), requirementSkills: g.requirementSkills ?? [] }]
      : [],
    cvPosition: null,
    text: g.originalText ?? '',
  });
  const exemptCandidates: SelectionCandidate[] = exemptRows.map(asExemptCandidate);
  const chosen = candidates.filter((c) => rankByRef.has(c.ref));
  const before = coverageOf([...candidates, ...exemptCandidates], universe);
  const afterBullets = coverageOf(chosen, universe);
  const afterPrinted = coverageOf([...chosen, ...exemptCandidates], universe);
  // CI · C2 Never Sees Nice-to-Have Requirements §2.3 — the headline reading.
  // The exempt rows are split by which section prints them, because "Core 7/8
  // + 1 LAN" says something "Core 8/8" cannot: the eighth is answered, and it
  // is answered by the Languages section rather than by a bullet.
  const exemptGroups: ExemptGroup[] = (
    [
      ['EDU', 'Education'],
      ['LAN', 'Language'],
    ] as const
  )
    .map(([label, kind]) => ({
      label,
      set: exemptRows.filter((g) => g.evidenceKind === kind).map(asExemptCandidate),
    }))
    .filter((g) => g.set.length > 0);
  const split = formatCoverageSplit(afterBullets, universe, exemptGroups);
  // How far into the budget the objective still discriminates. Measured at
  // ~6 on all three real leads against a budget of 14, which is the fact
  // §2.6 says must stay visible rather than settle in as a constant.
  const informative = result.selected.filter((s) => s.gain > 1e-9).length;
  reports.push(
    await recordStep(
      leadId,
      {
        step: 'C3',
        label: 'Select the CV evidence set',
        model: 'code',
        summary:
          `${result.selected.length} of ${candidates.length} candidates · budget ${DEFAULT_SELECTION_PARAMS.budget} · ` +
          `V ${result.objective.total.toFixed(1)} · ${split}` +
          (informative < result.selected.length ? ` · ${result.selected.length - informative} filled past saturation` : ''),
        output: {
          budget: DEFAULT_SELECTION_PARAMS.budget,
          params: result.params,
          candidates: candidates.length,
          exempt: exemptRows.length,
          selectedCount: result.selected.length,
          informative,
          objective: result.objective,
          coverage: {
            beforeAllKeep: formatCoverage(before),
            afterBulletsOnly: formatCoverage(afterBullets),
            afterAsPrinted: formatCoverage(afterPrinted),
            // Both readings in one line — the one a human should be shown.
            // The two above are kept as they were: they are what the acceptance
            // checker parses, and each is still the right answer to its own
            // narrower question.
            split,
          },
          selected: result.selected.map((s) => ({ rank: s.rank, ref: s.ref, position: s.position, gain: Number(s.gain.toFixed(3)), newlyCovered: s.newlyCovered.length, pinned: s.pinned })),
          // The WHOLE dropped list, not the first ten it used to store. The Map
          // ranks every approved card, and held-back ranks come from here
          // (CI §2b.4) — truncating it left the near-misses the owner asked to
          // see with no rank at all on any lead with more than ten of them.
          // Already ordered by the gain each would have added, ties by ref.
          displaced: result.dropped.map((d) => ({ ref: d.ref, position: d.position, wouldAdd: Number(d.gain.toFixed(3)), reason: d.reason })),
          swaps: result.swaps,
          notes: result.notes,
        },
        ms: Date.now() - t,
      },
      effectiveOwnerId
    )
  );

  return reports;
}

// ── C4–C8 (Keep evidence only) ───────────────────────────────────────────────
export async function generateCv(
  leadId: string,
  ownerId?: string | null
): Promise<{ reports: StepReport[]; atsRating: number; cvPath: string }> {
  const [lead] = await db
    .select()
    .from(jobLeads)
    .where(ownerId ? and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, ownerId)) : eq(jobLeads.id, leadId));
  if (!lead) throw new Error('Lead not found');
  const effectiveOwnerId = ownerId ?? lead.ownerId;
  const [profile] = await db.select().from(profiles).where(eq(profiles.ownerId, effectiveOwnerId)).limit(1);
  const reports: StepReport[] = [];

  let green = await loadGreenRows(leadId, effectiveOwnerId);
  if (green.length === 0) throw new Error('No Keep evidence — keep at least one row before generating.');

  const reqs = await db
    .select()
    .from(jobRequirements)
    .where(and(eq(jobRequirements.jobLeadId, leadId), eq(jobRequirements.ownerId, effectiveOwnerId)));
  const coreThemes = reqs.filter((r) => r.rank === 'Core').slice(0, 4).map((r) => r.requirement);

  // ── C3's shortlist — computed at the Approve-map gate, not here ────────────
  //
  // Selection moved out of this function (CI §2b.5 item 1): it fires when the
  // owner approves the map, so the Map can show what it chose and the owner can
  // pin or exclude while nothing has been written yet. `generateCv` starts at
  // C4 and reads the shortlist.
  //
  // What remains is the fallback for a lead approved before that shipped. It is
  // not a nicety: the four existing leads carry hand-made Keep decisions — the
  // one input here that no amount of model spend regenerates — so rather than
  // failing on a missing shortlist, run C3 once, now, and carry them.
  if (!green.some((g) => g.shortlistRank != null)) {
    reports.push(...(await runEvidenceSelection(leadId, effectiveOwnerId)));
    green = await loadGreenRows(leadId, effectiveOwnerId);
  }
  const selected = green.filter((g) => g.shortlistRank != null);
  if (selected.length === 0) {
    throw new Error(
      'C3 selected no evidence. Every Keep row is either Education/Language (which render from the ' +
        'profile tables and never enter the bullet budget) or excluded by you — nothing is left to ' +
        'write bullets from. Keep at least one piece of experience evidence, or clear an exclusion.'
    );
  }

  // C4 — rewrite each selected evidence item into a tailored CV bullet
  const bulletByRef = new Map<string, { bullet: string; skills: string[] }>();
  {
    // ── The C4 collapse guard ────────────────────────────────────────────────
    // This write path used to read `matched?.bullet || row.originalText || ''`,
    // which is the same silent-substitution shape B6 had before its guard
    // (`j?.score ?? 6`) and B2 had before its floor. When C4 returned no bullet
    // for a ref — a degraded call, or a ref echoed back in a form that doesn't
    // match — `cv_bullet` was filled with the row's RAW, untailored evidence
    // text. Nothing errors, nothing is empty, the lead shows a complete set of
    // bullets and the .docx renders. The only symptom is that the CV says the
    // candidate's generic evidence rather than anything tailored to this job,
    // which is the one thing the C phase exists to produce.
    //
    // Same lesson as the B6 CI, and as this CI's own C2 measurement: a complete
    // `required` list fixes the generation, it cannot make the VALUE meaningful,
    // and the count of rows written is never what breaks.
    //
    // The floor is exact rather than proportional, like B6's and unlike C2's:
    // C4 is handed a known, finite list of Keep rows and told to rewrite each
    // one. There is no legitimate "I decline to rewrite this one" outcome — C2
    // is the step allowed to record a gap, not C4 — so anything short of one
    // bullet per ref is a misfire. Rows with no `evidenceRef` at all are
    // excluded: C4 was never given a key to answer them with.
    const ATTEMPTS = 3;
    const refsWanted = new Set(selected.map((g) => g.evidenceRef).filter((ref): ref is string => !!ref));

    // CI · C3 Writes CV-Grade Skill Tags §2.3.1 — the register, cached once per
    // sitting. `skills_master` only: C2 matches against all three tables, C4
    // names in the one written at CV grade. See `c4UserMessage`.
    const register = (await gatherSkillVocabulary(effectiveOwnerId)).filter((v) => v.source === 'skill');

    // CI · STAR Results Never Reach the Evidence Graph §2.2 — re-attach each Keep
    // row's `Evidence.context` by ref. `requirement_tailoring` snapshots the
    // evidence TEXT, not the graph around it, so a STAR result arrives here as a
    // bare outcome and C4 has nothing to lead the bullet with. Re-deriving from
    // the same function C2 was built from is what keeps the two steps reading the
    // same context; only STAR results have one, so every other row is unchanged.
    const contextByRef = new Map(
      (await gatherEvidence(effectiveOwnerId)).flatMap((e) => (e.context ? [[e.ref, e.context] as const] : []))
    );
    const c4Rows: C4Row[] = selected.map((g) => ({ ...g, context: contextByRef.get(g.evidenceRef ?? '') ?? null }));

    const draft = async () =>
      runStructured({
        step: 'C4',
        // Truthfulness-critical (Master Instructions §6.1) → Opus tier.
        model: 'opus',
        system: await systemPromptFor('C4', effectiveOwnerId),
        user: c4UserMessage(c4Rows, lead.title, lead.jdGroupPrimary, lead.atsSystem, register),
        tool: C4.tool,
        zod: C4.zod,
        // The mock stands in for a HEALTHY call, so it must clear the floor: a
        // row whose `originalText` is null (legacy/seeded data) would otherwise
        // yield a blank bullet and trip the guard with no model involved.
        mock: () => ({
          bullets: selected.map((g) => ({
            ref: g.evidenceRef ?? '',
            bullet: g.originalText?.trim() || `Delivered work evidenced by ${g.evidenceRef ?? 'this item'}.`,
            // The mock stands in for C4's own tag judgement, so it echoes the
            // requirement's asks — the closest honest stand-in available
            // without a model. It lands in `cvBulletSkills`, not over
            // `requirementSkills`.
            skills: g.requirementSkills ?? [],
          })),
        }),
        leadId,
        ownerId: effectiveOwnerId,
      });

    // r.data.bullets[].skills is C4's judgment of which Job-Lead-facing skills
    // this bullet demonstrates — i.e. Requirement Skills, not My Skills (the
    // bracketed tag per Process/C4...md §B.5). Persist it; previously discarded.
    //
    // Re-asks accumulate into the same map, so a second attempt only has to
    // cover what the first missed — a partial reply is still worth its refs.
    let r = await draft();
    absorbC4Bullets(bulletByRef, r.data.bullets);
    for (let attempt = 2; attempt <= ATTEMPTS && missingC4Refs(selected, bulletByRef).length > 0; attempt++) {
      r = await draft();
      absorbC4Bullets(bulletByRef, r.data.bullets);
    }
    const short = missingC4Refs(selected, bulletByRef);
    if (short.length > 0) {
      throw new Error(
        `C4 returned no bullet for ${short.length} of ${refsWanted.size} selected evidence item(s) ` +
          `after ${ATTEMPTS} attempts (${short.slice(0, 5).join(', ')}${short.length > 5 ? ', …' : ''}) — ` +
          'the model call degraded rather than the evidence genuinely being unusable. Nothing was written; ' +
          're-run Generate CV to retry. Falling back to the raw evidence text here would have produced a ' +
          'complete-looking CV built from untailored bullets.'
      );
    }

    // §2.4's two counters, summed over the rows so the step report can say what
    // the guard did. An orphan tag dropped is a false claim kept off the CV; an
    // uncovered My Skill is a capability that went in and did not come out.
    let orphanTags = 0;
    let uncoveredCount = 0;
    for (const row of selected) {
      const matched = row.evidenceRef ? bulletByRef.get(row.evidenceRef) : undefined;
      // `|| row.originalText` survives only for rows with no `evidenceRef`, which
      // the floor above deliberately does not cover. For every ref-bearing row
      // `matched` is now guaranteed non-blank, so this is a backstop, not a path.
      const rewritten = matched?.bullet || row.originalText || '';
      // CI · Split cv_bullet_skills from requirement_skills — C4's tag now has
      // its own column and stops overwriting B2's asks. `?? []` and not
      // `?? row.requirementSkills`: a row with no `evidenceRef` is one C4 was
      // never given a way to answer (it is keyed by ref), so its bullet is the
      // untailored `originalText` and genuinely carries no bracketed tag.
      // Substituting the requirement's asks there would print, in the CV's
      // Skills section, skills no bullet actually displays — the same class of
      // false claim as a near-miss vocabulary match. No such row exists in the
      // live data; this is about which way it fails if one ever does.
      //
      // CI · C3 Writes CV-Grade Skill Tags §2.4 — the tag is no longer required
      // to be JD wording, so it is no longer bounded by anything the row was
      // handed. `auditBulletTags` is the replacement floor: a tag that nothing
      // on the row anchors is an orphan and does not print, and whatever the
      // surviving tags failed to carry through from My Skills is counted.
      const audit = auditBulletTags(
        matched?.skills ?? [],
        [rewritten, row.originalText ?? '', row.requirementLine ?? '', ...(row.mySkills ?? []), ...(row.requirementSkills ?? [])],
        row.mySkills ?? []
      );
      orphanTags += audit.dropped.length;
      uncoveredCount += audit.uncovered.length;
      const bulletSkills = audit.kept;
      await db
        .update(requirementTailoring)
        .set({ cvBullet: rewritten, cvBulletSkills: bulletSkills })
        .where(and(eq(requirementTailoring.id, row.id), eq(requirementTailoring.ownerId, effectiveOwnerId)));
      // C5 below builds the Skills section from exactly these values, so the
      // in-memory row has to carry what was just written — otherwise C5 reads
      // the pre-C4 column and the CV's Skills header disagrees with its own
      // bullets' bracketed tags, which is the one thing the consistency rule
      // exists to prevent.
      row.cvBulletSkills = bulletSkills;
    }
    // Past the floor every ref-bearing Keep row has a real bullet, so this count
    // is now a fact rather than `r.data.bullets.length`, which reported whatever
    // the last reply happened to contain.
    reports.push(
      await recordStep(
        leadId,
        {
          step: 'C4',
          label: 'Draft CV bullets',
          model: r.model,
          summary:
            `${refsWanted.size} selected item(s) rewritten` +
            (orphanTags ? ` · ${orphanTags} unanchored tag(s) dropped` : '') +
            (uncoveredCount ? ` · ${uncoveredCount} My Skill(s) not carried into a tag` : ''),
          output: { count: refsWanted.size, orphanTags, uncovered: uncoveredCount, register: register.length },
          ms: r.ms,
        },
        effectiveOwnerId
      )
    );
  }

  // C5 — skills section. CI · C4 Skills Selection Produces Unreadable Overflow.
  //
  // C5 §A, in its own three moves. The step used to conflate the middle one with
  // the last: it grouped by requirement rank and printed the rank names as
  // headings (Core Competencies / Supporting Expertise / Additional Skills).
  // That implements §B.3's prioritisation and leaves §B.1's categorisation
  // unbuilt — and since a typical lead lands almost everything under Core, it
  // did not even deliver the vertical readability §B.1 exists for.
  //
  //   1. collect  — every skill the Keep-gated bullets declare (cv_bullet_skills)
  //   2. prioritise — Core → Important → Nice-to-Have, cut to what fits (§B.3)
  //   3. categorise — 3–5 capability areas over what survived (§B.1)
  //
  // Step 3 is the one model call C5 has ever made, and it is here because naming
  // "Governance, Risk & Compliance" is a judgement about THIS lead's set that no
  // lookup produces. Sonnet, not Opus: this is presentation, not a truth claim —
  // and it cannot become one, because `reconcileSkillGroups` re-checks every name
  // against the prioritised set. The model chooses the arrangement; the content
  // was decided in code before it was asked.
  let skillsModel: CvModel['skills'] = [];
  {
    const t = Date.now();
    const rankByReqId = new Map(reqs.map((r) => [r.id, r.rank]));
    // Languages are struck before prioritisation, not after: they must not
    // occupy a slot that a real skill would otherwise have won. C5 §B.4 — the
    // CV's Languages section already states these, from `languages` itself.
    const langRows = await db.select().from(languages).where(eq(languages.ownerId, effectiveOwnerId));
    const prioritised = dropLanguageSkills(
      prioritiseSkills(
        selected.map((g) => ({
          rank: (g.requirementId && rankByReqId.get(g.requirementId)) ?? null,
          cvBulletSkills: g.cvBulletSkills ?? [],
        })),
        SKILLS_CEILING + 8 // headroom so struck languages don't shrink the section
      ),
      langRows.map((l) => l.language ?? '')
    ).slice(0, SKILLS_CEILING);
    // Consolidation, deterministic half first: a name another name already
    // contains whole is struck before the grouping call ever sees it, so the
    // model spends its judgement on the duplicates that are a question of
    // meaning rather than of spelling.
    const skillNames = absorbContainedSkills(prioritised);

    let model = 'code';
    let ms = 0;
    if (skillNames.length === 0) {
      skillsModel = [];
    } else {
      const r = await runStructured({
        step: 'C5',
        model: 'sonnet',
        system: await systemPromptFor('C5', effectiveOwnerId),
        user:
          `ROLE: ${lead.title}${lead.jdGroupPrimary ? ` · ${lead.jdGroupPrimary}` : ''}\n\n` +
          `Group these ${skillNames.length} skills into ${SKILL_CATEGORIES.min}–${SKILL_CATEGORIES.target} logical categories for ` +
          `the CV Skills section, most relevant to this role first, with at most ${SKILLS_PER_CATEGORY.target} entries under each.\n\n` +
          `These skills were written one bullet at a time, so the same capability arrives more than once ` +
          `under different qualifiers. Consolidate those: print ONE entry and name every skill it replaces ` +
          `in its \`mergedFrom\`. Merge only what is genuinely one capability — two capabilities that ` +
          `share a word are not duplicates. A merged entry must stay WIDER than every skill it replaces, so ` +
          `keep the qualifier that still holds instead of collapsing to a bare capability. ` +
          `Every skill below must be either placed VERBATIM or named in exactly one \`mergedFrom\`; ` +
          `aim for ${Math.min(SKILLS_TARGET, skillNames.length)} entries in total.\n\n` +
          skillNames.map((s) => `- ${s}`).join('\n'),
        tool: C5.tool,
        zod: C5.zod,
        // The mock is not a stand-in for the judgement — inventing plausible
        // category names offline would make mock runs look like live ones. It
        // returns the honest ungrouped shape instead.
        mock: () => ({ groups: [{ category: 'Core Competencies', skills: skillNames.map((name) => ({ name, mergedFrom: [] })) }] }),
        leadId,
        ownerId: effectiveOwnerId,
      });
      model = r.model;
      ms = r.ms;
      skillsModel = reconcileSkillGroups(skillNames, r.data.groups);
      // A grouping call that came back with nothing usable must not cost the CV
      // its Skills section — the skills themselves were never in doubt.
      if (skillsModel.length === 0) skillsModel = ungroupedSkills(skillNames);
    }
    // The ceiling, enforced on whatever came back. The prompt asks for the
    // TARGET (4 × 5); a call that lands at five categories or puts six under one
    // of them has not done anything worth discarding a grouping call over, but
    // nothing above `SKILLS_CEILING` may reach the page — that is the figure the
    // two-page budget was built on. `capSkillGroups` repacks before it sheds, so
    // C5 §B.5's "merge, never drop" holds as far as the grid allows.
    const capped = capSkillGroups(skillsModel);
    skillsModel = capped.groups;

    const count = skillsModel.reduce((n, s) => n + s.items.length, 0);
    const unplaced = skillsModel.find((g) => g.category === 'Additional Skills')?.items.length ?? 0;
    // What consolidation actually did, in the one number that shows it: every
    // selected skill either prints or was absorbed by an entry that declared it,
    // so the shortfall IS the merge count. Worth a place in the step report
    // because merging is the judgement this step now makes — a run that merges
    // nothing has printed the near-duplicates, and a run that merges half the
    // set is one to read before trusting.
    // `capped.dropped` is subtracted out: a skill the ceiling shed was not
    // merged into anything, and counting it as a merge would report the one
    // outcome C5 §B.5 says costs the CV something as if it were the outcome §B.5
    // prefers.
    const absorbed = Math.max(0, prioritised.length - count - capped.dropped.length);
    const shed = capped.dropped.length;
    reports.push(
      await recordStep(
        leadId,
        {
          step: 'C5',
          label: 'Skills section',
          model,
          summary: `${count} skills · ${skillsModel.length} categor${skillsModel.length === 1 ? 'y' : 'ies'}${absorbed ? ` · ${absorbed} merged` : ''}${shed ? ` · ${shed} shed at the ceiling` : ''}${unplaced ? ` · ${unplaced} unplaced` : ''}`,
          output: { categories: skillsModel.map((g) => ({ category: g.category, n: g.items.length })), skills: count, merged: absorbed, shed, droppedAtCeiling: capped.dropped, unplaced },
          ms: ms || Date.now() - t,
        },
        effectiveOwnerId
      )
    );
  }

  // C6 — tailored profile (4–7 lines, supportable by the evidence)
  let profileText = '';
  {
    // `|| g.cvBullet` was missing here, which made this the one read path that
    // could still feed C6 raw evidence text even when C4 had produced a real
    // bullet for the row — and an untailored bullet here doesn't just degrade
    // one line, it becomes the basis of the tailored profile. C4's floor above
    // now guarantees a bullet for every ref-bearing row, so the `originalText`
    // tail is a backstop for ref-less rows rather than a substitution path.
    const keptBullets = selected
      .map((g) => (g.evidenceRef && bulletByRef.get(g.evidenceRef)?.bullet) || g.cvBullet || g.originalText || '')
      .filter(Boolean);

    // ── The C6 collapse guard ─────────────────────────────────────────────────
    // Same family as C4's, but simpler: `profile` is a single value, not a set
    // keyed by ref, so an empty or one-line reply is never a legitimate answer —
    // the honest floor is never "nothing". Re-ask rather than lower the bar
    // (`runStructured`'s own retry can't fire — `""` is schema-valid), and throw
    // rather than degrade — C7 and C8 both consume `profileText`, and shipping a
    // CV with a blank profile and then rating it is worse than failing loudly.
    const ATTEMPTS = 3;
    const draft = async () =>
      runStructured({
        step: 'C6',
        // Truthfulness-critical (Master Instructions §6.1) → Opus tier.
        model: 'opus',
        system: await systemPromptFor('C6', effectiveOwnerId),
        user:
          `ROLE: ${lead.title}${lead.company ? ` · ${lead.company}` : ''}${lead.jdGroupPrimary ? ` · ${lead.jdGroupPrimary}` : ''}\n` +
          `CANDIDATE HEADLINE: ${profile?.headline ?? 'Senior leader'}\n\n` +
          `THIS ROLE'S CORE REQUIREMENTS:\n${coreThemes.map((t) => `- ${t}`).join('\n')}\n\n` +
          `KEEP EVIDENCE (the profile must stay supportable by these):\n${keptBullets.slice(0, 10).map((b) => `- ${b}`).join('\n')}\n\n` +
          `Write the tailored profile.`,
        tool: C6.tool,
        zod: C6.zod,
        // The mock stands in for a HEALTHY call, so it must clear the floor on
        // its own — the static tail guarantees enough words regardless of how
        // short `coreThemes`/`headline`/`jdGroupPrimary` happen to be. It must
        // now also stay under `PROFILE_WORDS.max`: a mock that a live run's own
        // guard would reject is not standing in for a healthy call. Trimmed from
        // 93 words to fit, 2026-08-27. `coreThemes` is capped at two rather than
        // three for the same reason — the variable head must not be able to push
        // the fixed tail over the ceiling.
        mock: () => ({
          profile:
            `${profile?.headline ?? 'Senior leader'}. Strong fit for this ${lead.jdGroupPrimary ?? 'senior'} role` +
            `${coreThemes.length ? `, with proven delivery across ${coreThemes.slice(0, 2).join(' and ').toLowerCase()}` : ''}. ` +
            `An accomplished leader with a record of translating strategy into delivery, and of building trust with ` +
            `stakeholders at every level across complex, matrixed organisations. Recognised for combining commercial ` +
            `judgement with hands-on execution and for developing high-performing teams under sustained pressure.`,
        }),
        leadId,
        ownerId: effectiveOwnerId,
      });

    // Both directions are re-asked, and only the SHORT one is fatal. A collapsed
    // profile is a broken call and shipping it would put a blank section on the
    // page; an over-long one is a real profile that spills onto a seventh line,
    // and refusing to produce a CV over one line of Profile would cost more than
    // it saves. So a persistent overrun is recorded as a warning on the step and
    // caught where it is visible — `scripts/cv-pages.ps1` on the rendered page.
    let r = await draft();
    for (let attempt = 2; attempt <= ATTEMPTS && (isProfileTooShort(r.data.profile) || isProfileTooLong(r.data.profile)); attempt++) r = await draft();
    if (isProfileTooShort(r.data.profile)) {
      const words = profileWordCount(r.data.profile);
      throw new Error(
        `C6 returned a ${words}-word profile after ${ATTEMPTS} attempts (target ${PROFILE_WORDS.min}–${PROFILE_WORDS.max} words) — the model call ` +
          'degraded rather than the evidence genuinely being unusable. Nothing was written; re-run Generate CV to retry.'
      );
    }
    profileText = r.data.profile.trim();
    const profileWords = profileWordCount(profileText);
    const over = profileWords > PROFILE_WORDS.max;
    reports.push(
      await recordStep(
        leadId,
        {
          step: 'C6',
          label: 'Tailored profile',
          model: r.model,
          // The rendered line count is what the rule is actually about, so it is
          // reported beside the words rather than left for someone to open Word
          // to find out. Derived, not measured here — `profileLines` converts at
          // the column width `lib/cv-budget.ts` records.
          summary:
            `${profileWords} words · ~${profileLines(profileWords)} lines` +
            (over ? ` · OVER the ${PROFILE_MAX_LINES}-line budget after ${ATTEMPTS} attempts` : ''),
          output: { len: profileText.length, words: profileWords, lines: profileLines(profileWords), overBudget: over, profile: profileText },
          ms: r.ms,
        },
        effectiveOwnerId
      )
    );
  }

  // C7 — compile the .docx. Preferred path fills the owner's real 2-page Word
  // template (docxtemplater); programmatic build is the fallback if the template
  // is missing or fails to render.
  let cvPath = '';
  // One bullet per distinct evidence ref, which is what C3 selected and what
  // the CV shows. This used to map over Keep ROWS and `slice(0, 14)`, so a lead
  // whose bullets each answered several requirements sent the same line to the
  // .docx and to C8 three to seven times over, and the 14 was a raw cap on rows
  // rather than a budget on content. The budget now lives in C3, so there is
  // nothing left to truncate here.
  const bulletsForCv = [
    ...new Map(
      selected
        .filter((g) => g.evidenceRef)
        .map((g) => [g.evidenceRef as string, g.cvBullet ?? g.originalText ?? ''] as const)
    ).values(),
  ].filter(Boolean);
  // Shared by C7 (the .docx) and C8 (the ATS rating) below — Education/Languages
  // always appear on the CV regardless of Keep status, so C8 needs to see them
  // too, or it judges the CV blind to facts (e.g. language fluency) that are
  // genuinely printed on it.
  const eduRows = await db.select().from(education).where(eq(education.ownerId, effectiveOwnerId));
  const langRows = await db.select().from(languages).where(eq(languages.ownerId, effectiveOwnerId));
  {
    const t = Date.now();
    const model: CvModel = {
      name: profile?.name ?? 'Candidate',
      contact: [profile?.location, profile?.email, profile?.citizenship, profile?.relocation, profile?.travel]
        .filter(Boolean)
        .join(' · '),
      profile: profileText,
      skills: skillsModel,
      experience: [{ heading: 'Selected Achievements', bullets: bulletsForCv }],
      education: eduRows.map((e) => [e.qualification, e.institution, e.year].filter(Boolean).join(', ')).filter(Boolean),
      languages: langRows.map((l) => `${l.language} (${l.cefrLevel})`),
    };

    // Use the real Word template only when it exists AND faithfully represents
    // this Keep set; otherwise build the layout programmatically (which handles
    // any evidence, any tenant). Nothing is ever stranded.
    let buf: Buffer;
    let how: string;
    // What C7 §C's page rule had to take, if anything. Almost always empty — a
    // lead that trims is a lead whose upstream budgets did not add up, and the
    // step report is where that becomes visible instead of being absorbed.
    let trimmed: string[] = [];
    let lineCost = 0;
    try {
      if (!templateExists()) throw new Error('template not found');
      if (!templateFits(selected)) throw new Error('Selected set has evidence outside the template slots');
      // The finished file says the owner wrote it, because he did — the evidence,
      // the wording he approved and the profile are all his. What it must not say
      // is that a template made on 2 July authored it, which is what every CV
      // before this one claimed. `lib/docx/metadata.ts` has the full account.
      const data = await templateSlotData(effectiveOwnerId, selected, bulletByRef, profileText, profile, lead, skillsModel, (refs, cost) => {
        trimmed = refs;
        lineCost = cost;
      });
      buf = buildCvFromTemplate(data, {
        author: profile?.email?.trim() || profile?.name?.trim() || 'Author',
      });
      how = 'real template';
    } catch (e) {
      buf = await buildCv(model);
      how = `programmatic (${e instanceof Error ? e.message : 'fallback'})`;
    }
    cvPath = `cv-output/${leadId}/tailored.docx`;
    await writeBuffer(cvPath, buf);
    reports.push(
      await recordStep(
        leadId,
        {
          step: 'C7',
          label: 'Compile 2-page CV',
          model: 'code',
          summary:
            `${bulletsForCv.length - trimmed.length} bullets printed · ${how}` +
            (trimmed.length ? ` · ${trimmed.length} trimmed to hold ${MAX_PAGES} pages (${trimmed.join(', ')})` : ''),
          output: { cvPath, how, trimmed, lineCost, lineAllowance: CONTENT_LINE_ALLOWANCE },
          ms: Date.now() - t,
        },
        effectiveOwnerId
      )
    );
  }

  // C8 — reviewed ATS rating (LLM judgment; code persists)
  let atsRating = 0;
  {
    const coreImp = reqs.filter((r) => CORE_AND_IMPORTANT.includes(r.rank ?? ''));
    const r = await runStructured({
      step: 'C8',
      model: 'opus',
      system: await systemPromptFor('C8', effectiveOwnerId),
      user:
        `JOB REQUIREMENTS:\n${reqs.map((q, i) => `${i + 1}. [${q.rank}] ${q.requirement}`).join('\n')}\n\n` +
        `TAILORED CV\nProfile: ${profileText}\n\nSkills: ${skillsModel.map((s) => `${s.category}: ${s.items.join(', ')}`).join(' | ')}\n\n` +
        `Experience bullets:\n${bulletsForCv.map((b) => `- ${b}`).join('\n')}\n\n` +
        // Education/Languages always appear on the CV regardless of Keep status
        // (see C7 above) — without these, C8 has previously marked language
        // fluency "unverified" even when it's plainly printed on the CV.
        `Education: ${eduRows.map((e) => e.qualification).filter(Boolean).join(', ')}\n\n` +
        `Languages: ${langRows.map((l) => `${l.language} (${l.displayLevel ?? l.cefrLevel ?? ''})`).join(', ')}\n\n` +
        `Rate how well this CV addresses the requirements through an ATS lens.`,
      tool: C8.tool,
      zod: C8.zod,
      mock: () => {
        const coverage = Math.min(1, selected.length / Math.max(coreImp.length, 1));
        return {
          overall: Math.round(40 + coverage * 55 + (lead.atsSystem ? 5 : 0)),
          requirements: coreImp.slice(0, 8).map((q) => ({ requirement: q.requirement, score: Math.round(coverage * 100), matchStrength: 'Good' as const })),
          summary: 'Mock ATS rating from Keep-evidence coverage.',
        };
      },
      leadId,
      ownerId: effectiveOwnerId,
    });
    atsRating = Math.round(r.data.overall);
    await db.update(jobLeads).set({ status: 'ready' }).where(and(eq(jobLeads.id, leadId), eq(jobLeads.ownerId, effectiveOwnerId)));
    reports.push(await recordStep(leadId, { step: 'C8', label: 'ATS matching rating', model: r.model, summary: `${atsRating} / 100`, output: { atsRating, requirements: r.data.requirements, summary: r.data.summary }, ms: r.ms }, effectiveOwnerId));
  }

  // Materialise the B4 JD-group into the CV-variant catalogue: the generated CV
  // is recorded as a variant focused on this role's JD group(s) (idempotent).
  {
    const focus = [lead.jdGroupPrimary, lead.jdGroupSecondary].filter((x): x is string => !!x);
    await db.delete(cvVariants).where(and(eq(cvVariants.storagePath, cvPath), eq(cvVariants.ownerId, effectiveOwnerId)));
    await db.insert(cvVariants).values({
      ownerId: effectiveOwnerId,
      name: `${lead.title}${lead.company ? ` — ${lead.company}` : ''}`,
      focusJdGroups: focus,
      storagePath: cvPath,
      description: `ATS ${atsRating}/100${lead.jdGroupPrimary ? ` · ${lead.jdGroupPrimary}` : ''}`,
    });
  }

  return { reports, atsRating, cvPath };
}

// ── Mock heuristic for C2 (deterministic; whole-graph token overlap) ─────────
// CI · Make C2 Build on B6 §2.7 — must cope with a TIERED, targeted requirement
// set (only what `runEvidenceMapping` actually sends it) and return several
// ranked links per requirement, on the same 5-band scale B6 uses.
function mockEvidenceMap(
  reqEntries: [number, { requirement: string; rank: string | null; skills: string[] | null }][],
  evidence: Evidence[],
  // CI · C4 Skills overflow — the mock stands in for a HEALTHY call, and a
  // healthy C2 call now names My Skills from the curated vocabulary. Emitting
  // none would make mock mode the one path that still produces skill-less rows.
  vocabulary: readonly VocabEntry[] = []
) {
  const links: { order: number; evidenceRef: string; matchStrength: string; connection: string; cvPosition: string | null; mySkills: string[] }[] = [];
  const gaps: { order: number; requirement: string; note: string }[] = [];
  const vocabTokens = vocabulary.map((v) => ({ v, t: tokens(`${v.name} ${v.variants.join(' ')}`) }));
  for (const [order, req] of reqEntries) {
    const rt = tokens(`${req.requirement} ${(req.skills ?? []).join(' ')}`);
    const mySkills = vocabTokens
      .map(({ v, t }) => ({ v, score: overlap(rt, t) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((x) => x.v.name);
    const ranked = evidence
      .map((e) => ({ e, score: overlap(rt, tokens(`${e.text} ${e.skills.join(' ')}`)) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2); // ranked, top 2 — exercises the multi-row path in mock mode too
    if (ranked.length === 0) {
      gaps.push({ order, requirement: req.requirement, note: 'No strong evidence match' });
      continue;
    }
    for (const { e, score } of ranked) {
      links.push({
        order,
        evidenceRef: e.ref,
        matchStrength: score >= 5 ? 'Excellent' : score >= 3 ? 'Very Strong' : score >= 2 ? 'Good' : 'Weak',
        connection: `Shared focus on ${[...tokens(req.requirement)].slice(0, 3).join(', ')}`,
        cvPosition: e.cvPosition,
        mySkills,
      });
    }
  }
  return { links, gaps };
}
