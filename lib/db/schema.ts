/**
 * Database schema (Drizzle / Postgres). Mirrors docs/DATA_MODEL.md.
 *
 * Design notes:
 * - Every table carries owner_id (single-user demo → a fixed DEMO_OWNER_ID;
 *   maps cleanly to Supabase RLS `owner_id = auth.uid()` later).
 * - App-controlled state uses pgEnum (lead_status, approval_status, run_status,
 *   pipeline_step). Data-derived fields imported from the spreadsheets stay as
 *   text (rank, match_strength, recommendation, jd groups) so messy real-world
 *   values never break a seed; TS unions in lib/db/types.ts give callers safety.
 * - Arrays are jsonb (avoids node-postgres array edge cases).
 */
import {
  pgEnum,
  pgTable,
  uuid,
  text,
  integer,
  real,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** Fixed owner for the single-user demo. The profile row uses this id. */
export const DEMO_OWNER_ID = '00000000-0000-0000-0000-000000000001';

// ── Enums (app-controlled state) ────────────────────────────────────────────
export const leadStatusEnum = pgEnum('lead_status', [
  'captured',
  'screening',
  'hold',
  'screened',
  'promoted',
  'tailoring',
  'ready',
  'applied',
  'archived',
]);
// NOTE: the human gate is labelled Keep/Maybe/Drop in the UI; the DB enum stays
// green/yellow/red for now (single source of truth for the labels:
// APPROVAL_LABEL in lib/db/types.ts). A future migration renames the enum to
// keep/maybe/drop — tracked in docs/ROADMAP.md (P6). Until then, map via the helper,
// don't hardcode the colour words in new UI.
export const approvalStatusEnum = pgEnum('approval_status', ['pending', 'green', 'yellow', 'red']);
export const pipelineStepEnum = pgEnum('pipeline_step', [
  'A1',
  'B1',
  'B2',
  'B3',
  'B4',
  'B5',
  'B6',
  'C1',
  'C2',
  'C3',
  'C4',
  'C5',
  'C6',
  'C7',
]);
export const runStatusEnum = pgEnum('run_status', ['pending', 'running', 'done', 'error']);

// ── Shared columns ──────────────────────────────────────────────────────────
const base = {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().default(DEMO_OWNER_ID),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

/** Provenance for evidence rows (O3): how a node entered the graph + extraction confidence. */
const prov = {
  source: text('source').notNull().default('authored'), // authored | imported | ai_coached
  confidence: real('confidence'),
};

// ── Auth (O4: multi-tenant) ─────────────────────────────────────────────────
// A user's `id` IS the owner_id for all their data. The demo user uses DEMO_OWNER_ID.
// This maps 1:1 to Supabase auth.users + RLS (`owner_id = auth.uid()`) on deploy.
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Profile / evidence (the Master Bullet Bank) ─────────────────────────────
export const profiles = pgTable('profiles', {
  ...base,
  name: text('name').notNull(),
  headline: text('headline'),
  email: text('email'),
  phone: text('phone'),
  location: text('location'),
  languagesSummary: text('languages_summary'),
  // Additive Plan · C4 · Proof Link. Opt-in, default OFF — a public, read-only
  // proof summary lives at /p/<publicToken> only while publicEnabled is true.
  // No contact fields are ever exposed there; the token is the unguessable key.
  publicEnabled: boolean('public_enabled').notNull().default(false),
  publicToken: text('public_token'),
  // R2b · The Statement's re-entry ritual. The last time this owner looked at their
  // Statement — the "since you were last here" banner rolls up activity_events newer
  // than this. NULL = never seen (banner stays quiet until there's a prior visit).
  statementSeenAt: timestamp('statement_seen_at', { withTimezone: true }),
  // R5 · The Weekly Triage. How many tailorings this owner can realistically do per
  // week — the triage trims its "this week" picks to this. NULL ⇒ the default of 2.
  weeklyCapacity: integer('weekly_capacity'),
}, (t) => ({
  // A token resolves to at most one profile — a token lookup can never return
  // the wrong user's proof. Partial: NULL tokens (opted-out users) stay distinct.
  publicTokenUq: uniqueIndex('profiles_public_token_uq').on(t.publicToken).where(sql`public_token is not null`),
}));

export const positions = pgTable('positions', {
  ...base,
  ...prov,
  refCode: text('ref_code'),
  company: text('company'),
  title: text('title'),
  startDate: text('start_date'),
  endDate: text('end_date'),
  summary: text('summary'),
});

export const stars = pgTable('stars', {
  ...base,
  ...prov,
  refCode: text('ref_code'),
  positionRef: text('position_ref'),
  title: text('title'),
  summary: text('summary'),
  obsidianNoteRef: text('obsidian_note_ref'),
});

export const starActions = pgTable('star_actions', {
  ...base,
  ...prov,
  refCode: text('ref_code'),
  starRef: text('star_ref'),
  text: text('text'),
  skills: jsonb('skills').$type<string[]>().default([]),
  atsKeywords: jsonb('ats_keywords').$type<string[]>().default([]),
});

export const starResults = pgTable('star_results', {
  ...base,
  ...prov,
  refCode: text('ref_code'),
  starRef: text('star_ref'),
  text: text('text'),
  metric: text('metric'),
  impactType: text('impact_type'),
});

export const starCompetences = pgTable('star_competences', {
  ...base,
  ...prov,
  refCode: text('ref_code'),
  starRef: text('star_ref'),
  competence: text('competence'),
});

export const starAttributes = pgTable('star_attributes', {
  ...base,
  ...prov,
  refCode: text('ref_code'),
  starRef: text('star_ref'),
  attribute: text('attribute'),
});

export const responsibilities = pgTable('responsibilities', {
  ...base,
  ...prov,
  refCode: text('ref_code'),
  positionRef: text('position_ref'),
  text: text('text'),
  skills: jsonb('skills').$type<string[]>().default([]),
});

export const education = pgTable('education', {
  ...base,
  ...prov,
  refCode: text('ref_code'),
  institution: text('institution'),
  qualification: text('qualification'),
  type: text('type'),
  year: text('year'),
});

export const languages = pgTable('languages', {
  ...base,
  ...prov,
  refCode: text('ref_code'),
  language: text('language'),
  cefrLevel: text('cefr_level'),
});

export const bulletBank = pgTable('bullet_bank', {
  ...base,
  ...prov,
  refCode: text('ref_code'),
  text: text('text'),
  tags: jsonb('tags').$type<string[]>().default([]),
  cvPosition: text('cv_position'),
  version: text('version'),
});

export const skillsMaster = pgTable('skills_master', {
  ...base,
  ...prov,
  refCode: text('ref_code'),
  skill: text('skill'),
  proficiency: text('proficiency'),
  atsKeywordVariants: jsonb('ats_keyword_variants').$type<string[]>().default([]),
  starEvidence: jsonb('star_evidence').$type<string[]>().default([]),
});

// ── Operational pipeline ────────────────────────────────────────────────────
export const companies = pgTable('companies', {
  ...base,
  name: text('name').notNull(),
  website: text('website'),
  industry: text('industry'),
  hqCountry: text('hq_country'),
  interestScore: integer('interest_score'),
  notes: text('notes'),
});

export const offices = pgTable('offices', {
  ...base,
  city: text('city'),
  country: text('country'),
  preferenceRank: integer('preference_rank'),
});

export const jdGroups = pgTable('jd_groups', {
  ...base,
  code: text('code').notNull(),
  name: text('name').notNull(),
  description: text('description'),
});

export const jobLeads = pgTable('job_leads', {
  ...base,
  externalId: text('external_id'),
  seq: integer('seq'),
  title: text('title').notNull(),
  company: text('company'),
  companyId: uuid('company_id'),
  city: text('city'),
  sourceUrl: text('source_url'),
  jobPostLink: text('job_post_link'),
  status: leadStatusEnum('status').notNull().default('captured'),
  // A role the user is actively chasing. Flagging one grows the strength meter's
  // relevancy denominator (M1): more to prove → visible headroom, and demand-pull
  // coach prompts for its Core/Important requirements.
  isTarget: boolean('is_target').notNull().default(false),
  // B1
  postedDays: integer('posted_days'),
  applicantCount: integer('applicant_count'),
  freshnessBand: text('freshness_band'),
  saturationBand: text('saturation_band'),
  analysisDate: text('analysis_date'),
  // B2/B3
  roadblocks: jsonb('roadblocks').$type<Roadblock[]>().default([]),
  misalignments: jsonb('misalignments').$type<Misalignment[]>().default([]),
  // B4
  jdGroupPrimary: text('jd_group_primary'),
  jdGroupSecondary: text('jd_group_secondary'),
  skillRatings: jsonb('skill_ratings').$type<Record<string, number>>().default({}),
  atsSystem: text('ats_system'),
  atsSpecifics: text('ats_specifics'),
  keyPatterns: text('key_patterns'),
  // B6 (dimension scores + rollup are computed in lib/scoring, never the LLM)
  scoreRelevance: real('score_relevance'),
  scoreSeniority: real('score_seniority'),
  scoreImpact: real('score_impact'),
  scoreReqAlignment: real('score_req_alignment'),
  scoreAts: real('score_ats'),
  overallFitScore: real('overall_fit_score'),
  recommendation: text('recommendation'),
  bulletBankVersion: text('bullet_bank_version'),
  // capture
  rawJdPath: text('raw_jd_path'),
  // Additive Plan · B4 — where this lead came from (alert name / recruiter / manual /
  // bookmarklet). Free text on purpose: the Sourcing Compass ranks whatever the user
  // actually types, so it learns their real channels rather than a fixed taxonomy.
  source: text('source'),
});

export const jobRequirements = pgTable('job_requirements', {
  ...base,
  jobLeadId: uuid('job_lead_id').notNull(),
  leadTitle: text('lead_title'),
  requirementOrder: integer('requirement_order'),
  rank: text('rank'),
  requirementGroup: text('requirement_group'),
  requirement: text('requirement').notNull(),
  description: text('description'),
  skills: jsonb('skills').$type<string[]>().default([]),
  initialMatchStrength: text('initial_match_strength'),
  initialKeyStrengths: text('initial_key_strengths'),
  initialMissingWeak: text('initial_missing_weak'),
  initialScore: real('initial_score'),
});

export const requirementTailoring = pgTable('requirement_tailoring', {
  ...base,
  jobLeadId: uuid('job_lead_id'),
  requirementId: uuid('requirement_id'),
  leadTitle: text('lead_title'),
  requirementLine: text('requirement_line'),
  connectionToExpertise: text('connection_to_expertise'),
  evidenceRef: text('evidence_ref'),
  originalText: text('original_text'),
  cvPosition: text('cv_position'),
  cvBullet: text('cv_bullet'),
  cvPlacement: text('cv_placement'),
  actualSkills: jsonb('actual_skills').$type<string[]>().default([]),
  approvalStatus: approvalStatusEnum('approval_status').notNull().default('pending'),
  // M7 · provenance backbone — how a CV line entered and when you approved it.
  provSource: text('prov_source').notNull().default('imported'), // imported | coached | swapped
  approvedAt: timestamp('approved_at', { withTimezone: true }),
});

export const cvVariants = pgTable('cv_variants', {
  ...base,
  name: text('name').notNull(),
  focusJdGroups: jsonb('focus_jd_groups').$type<string[]>().default([]),
  storagePath: text('storage_path'),
  description: text('description'),
});

export const applications = pgTable(
  'applications',
  {
    ...base,
    jobLeadId: uuid('job_lead_id').notNull(),
    cvVariantId: uuid('cv_variant_id'),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    status: text('status'),
    outcomeNotes: text('outcome_notes'),
  },
  (t) => ({
    // One application per (owner, lead) — makes the CV-download open and
    // markApplied races safe via ON CONFLICT instead of check-then-insert.
    ownerLead: uniqueIndex('applications_owner_lead_uq').on(t.ownerId, t.jobLeadId),
  })
);

// ── System tables ───────────────────────────────────────────────────────────
export const pipelineRuns = pgTable('pipeline_runs', {
  ...base,
  jobLeadId: uuid('job_lead_id').notNull(),
  step: pipelineStepEnum('step').notNull(),
  status: runStatusEnum('status').notNull().default('pending'),
  inputHash: text('input_hash'),
  output: jsonb('output'),
  error: text('error'),
  model: text('model'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

export const llmCalls = pgTable('llm_calls', {
  ...base,
  jobLeadId: uuid('job_lead_id'),
  step: text('step'),
  model: text('model').notNull(),
  mode: text('mode'),
  inputTokens: integer('input_tokens').default(0),
  outputTokens: integer('output_tokens').default(0),
  latencyMs: integer('latency_ms'),
  // Observability: 'ok' | 'error'. Failed HTTP calls and schema-validation
  // failures used to throw silently; they are now persisted with the reason so
  // the audit log is complete rather than counting only successes.
  status: text('status').default('ok'),
  error: text('error'),
  attempts: integer('attempts').default(1),
});

export const ciInitiatives = pgTable('ci_initiatives', {
  ...base,
  title: text('title').notNull(),
  area: text('area'),
  status: text('status'),
  priority: text('priority'),
  estimatedTime: text('estimated_time'),
  timeSpent: text('time_spent'),
  source: text('source'),
  target: text('target'),
  body: text('body'),
});

export const accuracyTips = pgTable('accuracy_tips', {
  ...base,
  jobLeadId: uuid('job_lead_id'),
  type: text('type'),
  observation: text('observation'),
  suggestedAction: text('suggested_action'),
  whereApplies: text('where_applies'),
  resolved: boolean('resolved').default(false),
});

// ── Onboarding (O2: import → extract → curate) ──────────────────────────────
// One row per owner. Holds the raw import and the AI-extracted *draft* graph
// (jsonb) until the user approves nodes, which then promote into the real tables.
export const onboardingState = pgTable('onboarding_state', {
  ...base,
  step: text('step').notNull().default('welcome'), // welcome | importing | reviewing | done
  source: text('source'), // paste | upload
  rawText: text('raw_text'),
  draftGraph: jsonb('draft_graph'),
  status: text('status'),
});

// ── Coaching (M2: the "never-done" prompt queue) ────────────────────────────
// The queue regenerates from several sources and *persists status*, so a skip is
// remembered and (M3) an approved answer can spawn a deeper follow-up. tier /
// source / status stay text (data-derived) per the schema design note above.
export const coachingPrompts = pgTable('coaching_prompts', {
  ...base,
  tier: text('tier').notNull().default('position_deep'), // basics | position_deep | relevancy
  promptSource: text('prompt_source').notNull().default('seed'), // prior_roles | similar_resumes | target_requirements | screening_gap | seed
  sourceRef: jsonb('source_ref'), // {positionId} | {leadId, requirementId} | {starRef}
  contextLabel: text('context_label'), // eyebrow, e.g. "Director of Shared Services · Acme"
  question: text('question').notNull(),
  why: text('why'), // provenance shown to the user ("Why we're asking")
  payoff: text('payoff'), // "Strengthens 2 Core requirements"
  status: text('status').notNull().default('open'), // open | drafted | inactive | done | skipped
  value: real('value').notNull().default(0), // M2: cross-engine value score → queue order + hero
  spawnedBy: uuid('spawned_by'), // the prompt whose approval surfaced this one (M3)
  targetNode: jsonb('target_node'), // hint: which graph node/type the answer enriches
  dedupeKey: text('dedupe_key'), // stable key so regeneration upserts, never duplicates
}, (t) => ({
  // One prompt per (owner, dedupe_key) — lets concurrent regenerations use ON
  // CONFLICT DO NOTHING instead of racing select-then-insert. NULL keys stay distinct.
  ownerDedupe: uniqueIndex('coaching_prompts_owner_dedupe_uq').on(t.ownerId, t.dedupeKey),
}));

// A coaching answer → an AI-structured draft awaiting the same Keep/Maybe/Drop gate
// as C2. Only an approved answer writes a real evidence node (committedNodeId set).
export const coachingAnswers = pgTable('coaching_answers', {
  ...base,
  promptId: uuid('prompt_id').notNull(),
  rawAnswer: text('raw_answer'), // what the user typed
  draftAction: text('draft_action'), // AI-structured action sentence
  draftResult: text('draft_result'), // AI-structured result (may be null)
  metric: text('metric'), // ONLY if a number was explicitly present; else null
  needsMetric: boolean('needs_metric').notNull().default(false), // result described but no number given
  confidence: real('confidence'),
  committedNodeId: uuid('committed_node_id'), // set on approve → links to the real evidence node
  decision: text('decision'), // keep | maybe | drop (mirrors the C2 gate)
  revert: jsonb('revert'), // M3: how to undo this approval (delete created nodes / restore prior values)
});

// Graph strength is derived (lib/career-graph strengthOf), but we snapshot it on
// each approval so the coach can show the meter climbing (62 → 68 → …).
export const graphStrengthSnapshots = pgTable('graph_strength_snapshots', {
  ...base,
  score: integer('score').notNull(),
  label: text('label'),
  components: jsonb('components'), // the GraphSignals breakdown at capture time
});

// ── Activation funnel (M5) ──────────────────────────────────────────────────
// Timestamped first-win events so we can measure the two numbers that matter when
// triaging real users: time-to-first-CV and decisions-before-win. createdAt is the event time.
export const activationEvents = pgTable('activation_events', {
  ...base,
  kind: text('kind').notNull(), // paste | verdict | keep | cv_generated | warmup
  leadId: uuid('lead_id'),
  meta: jsonb('meta'),
});

// ── Reaction instrumentation (Additive Plan · Wave A) ───────────────────────
// One tiny append-only log — `surface · event · leadId? · ts` — behind every
// additive surface. This IS the "see their reaction" mechanism: each new panel
// emits 2–3 events so a fold decision (does the strip/brief/stop-card earn its
// place?) can be made on evidence, not taste. Distinct from activationEvents,
// which measures the first-win funnel with fixed semantics; this is free-form UX
// telemetry. createdAt is the event time.
export const uxEvents = pgTable('ux_events', {
  ...base,
  surface: text('surface').notNull(), // interview_brief | this_week | coach_session | …
  event: text('event').notNull(), //    open | print | pick_open | session_complete | keep_going | …
  leadId: uuid('lead_id'),
  meta: jsonb('meta'),
});

// ── Story versions → the Through-line (Additive Plan · C1) ──────────────────
// Append-only narrative generated from the user's approved evidence: a through-line
// plus copy-out cover-letter and LinkedIn "About" drafts. Versions accrue (never
// overwritten) so the user can see their story evolve as the graph grows. Every
// field stays supportable by the graph — the LLM narrates, it never invents.
export const storyVersions = pgTable('story_versions', {
  ...base,
  throughLine: text('through_line').notNull(),
  coverLetter: text('cover_letter'),
  linkedinAbout: text('linkedin_about'),
  evidenceCount: integer('evidence_count'), // how many approved nodes it drew from
});

// ── Activity log → the Statement (Additive Plan · B1) ───────────────────────
// One append-only line per meaningful move the user (or the pipeline on their
// behalf) makes — evidence kept, target flagged, a role screened, a CV made, an
// application sent. Existing server actions append here, one line each; the
// read-only Statement page re-projects the stream into a re-entry ritual ("here's
// what you did"). Distinct from activationEvents (fixed first-win funnel) and
// uxEvents (UI reactions): this is the user's own domain history. createdAt is
// the event time.
export const activityEvents = pgTable('activity_events', {
  ...base,
  kind: text('kind').notNull(), // evidence_kept | coach_approved | target_flagged | screening | cv_generated | applied | outcome
  leadId: uuid('lead_id'),
  summary: text('summary'), //     a pre-rendered one-line description, so the Statement needs no joins
  meta: jsonb('meta'),
});

// ── Embedded JSON shapes ────────────────────────────────────────────────────
export type Roadblock = { dimension: string; detail: string };
export type Misalignment = { dimension: string; detail: string; severity?: string };
