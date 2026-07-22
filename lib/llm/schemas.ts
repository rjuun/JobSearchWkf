/**
 * Per-step output contracts. Each step forces a single tool call whose `input`
 * is validated by the matching zod schema. JSON Schema drives the DeepSeek
 * (OpenAI-compatible) tool; zod drives runtime validation (+ one retry on mismatch).
 */
import { z } from 'zod';

export type ToolDef = {
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input_schema: Record<string, any>;
};

const arr = (items: Record<string, unknown>) => ({ type: 'array', items });
const str = { type: 'string' };

// ── B2 · Roadblocks ─────────────────────────────────────────────────────────
export const B2 = {
  zod: z.object({
    roadblocks: z.array(z.object({ dimension: z.string(), detail: z.string() })).default([]),
  }),
  tool: {
    name: 'emit_roadblocks',
    description: 'Hard ineligibility factors across language, technical, certification, geographic, industry. Empty if none.',
    input_schema: {
      type: 'object',
      properties: {
        roadblocks: arr({
          type: 'object',
          properties: {
            dimension: { type: 'string', enum: ['Language', 'Technical', 'Certification', 'Geographic', 'Industry'] },
            detail: str,
          },
          required: ['dimension', 'detail'],
        }),
      },
      required: ['roadblocks'],
    },
  } satisfies ToolDef,
};

// ── B3 · Misalignments ──────────────────────────────────────────────────────
export const B3 = {
  zod: z.object({
    misalignments: z
      .array(z.object({ dimension: z.string(), detail: z.string(), severity: z.string().optional() }))
      .default([]),
  }),
  tool: {
    name: 'emit_misalignments',
    description: 'Soft flags (not blockers) across values/culture, city, seniority. Empty if none.',
    input_schema: {
      type: 'object',
      properties: {
        misalignments: arr({
          type: 'object',
          properties: { dimension: str, detail: str, severity: str },
          required: ['dimension', 'detail'],
        }),
      },
      required: ['misalignments'],
    },
  } satisfies ToolDef,
};

// ── B4 · Skills (A–Q) + JD group + ATS ──────────────────────────────────────
export const B4 = {
  zod: z.object({
    skills: z.array(z.object({ dimension: z.string(), rating: z.number().int().min(1).max(3) })).default([]),
    jdGroupPrimary: z.string().nullable().optional(),
    jdGroupSecondary: z.string().nullable().optional(),
    atsSystem: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  }),
  tool: {
    name: 'emit_skill_mapping',
    description: 'Rate the role against the 17-dimension framework (1=core,2=important,3=supporting), assign JD groups, detect the ATS.',
    input_schema: {
      type: 'object',
      properties: {
        skills: arr({
          type: 'object',
          properties: { dimension: str, rating: { type: 'integer', minimum: 1, maximum: 3 } },
          required: ['dimension', 'rating'],
        }),
        jdGroupPrimary: str,
        jdGroupSecondary: str,
        atsSystem: str,
        notes: str,
      },
      required: ['skills'],
    },
  } satisfies ToolDef,
};

// ── B5 · Requirements ───────────────────────────────────────────────────────
export const B5 = {
  zod: z.object({
    requirements: z
      .array(
        z.object({
          order: z.number().int(),
          requirement: z.string(),
          description: z.string().nullable().optional(),
          rank: z.string(),
          skills: z.array(z.string()).default([]),
        })
      )
      .default([]),
  }),
  tool: {
    name: 'emit_requirements',
    description: 'Break the JD into ranked requirements (Core / Important / Nice-to-Have), in order.',
    input_schema: {
      type: 'object',
      properties: {
        requirements: arr({
          type: 'object',
          properties: {
            order: { type: 'integer' },
            requirement: str,
            description: str,
            rank: { type: 'string', enum: ['Core', 'Important', 'Nice-to-Have'] },
            skills: arr(str),
          },
          required: ['order', 'requirement', 'rank'],
        }),
      },
      required: ['requirements'],
    },
  } satisfies ToolDef,
};

// ── B6 · Role fit (dimensions + per-requirement judgments) ───────────────────
export const B6 = {
  zod: z.object({
    relevance: z.number().min(0).max(10),
    seniority: z.number().min(0).max(10),
    impact: z.number().min(0).max(10),
    ats: z.number().min(0).max(10),
    requirements: z
      .array(
        z.object({
          order: z.number().int().optional(),
          requirement: z.string(),
          score: z.number().min(0).max(10),
          matchStrength: z.string(),
          keyStrengths: z.string().nullable().optional(),
          gaps: z.string().nullable().optional(),
        })
      )
      .default([]),
    summary: z.string().nullable().optional(),
  }),
  tool: {
    name: 'emit_role_fit',
    description:
      'Emit 0–10 judgments for Relevance, Seniority, Impact, ATS, and a per-requirement match score. Do NOT compute the overall — the system does that.',
    input_schema: {
      type: 'object',
      properties: {
        relevance: { type: 'number' },
        seniority: { type: 'number' },
        impact: { type: 'number' },
        ats: { type: 'number' },
        requirements: arr({
          type: 'object',
          properties: {
            order: { type: 'integer', description: 'The requirement number from the list provided.' },
            requirement: str,
            score: { type: 'number' },
            matchStrength: { type: 'string', enum: ['Excellent', 'Very Strong', 'Good', 'Weak', 'No Match'] },
            keyStrengths: str,
            gaps: str,
          },
          required: ['order', 'requirement', 'score', 'matchStrength'],
        }),
        summary: str,
      },
      required: ['relevance', 'seniority', 'impact', 'ats', 'requirements'],
    },
  } satisfies ToolDef,
};

// ── O2 · Import → draft Career Graph ─────────────────────────────────────────
export const IMPORT = {
  zod: z.object({
    profile: z
      .object({
        name: z.string().nullable().optional(),
        headline: z.string().nullable().optional(),
        location: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
    positions: z
      .array(
        z.object({
          company: z.string().nullable().optional(),
          title: z.string().nullable().optional(),
          startDate: z.string().nullable().optional(),
          endDate: z.string().nullable().optional(),
          summary: z.string().nullable().optional(),
          confidence: z.number().min(0).max(1).default(0.5),
        })
      )
      .default([]),
    stories: z
      .array(
        z.object({
          title: z.string(),
          summary: z.string().nullable().optional(),
          confidence: z.number().min(0).max(1).default(0.5),
          actions: z
            .array(
              z.object({
                text: z.string(),
                skills: z.array(z.string()).default([]),
                confidence: z.number().min(0).max(1).default(0.5),
              })
            )
            .default([]),
          results: z
            .array(
              z.object({
                text: z.string(),
                metric: z.string().nullable().optional(),
                confidence: z.number().min(0).max(1).default(0.5),
              })
            )
            .default([]),
        })
      )
      .default([]),
    skills: z
      .array(
        z.object({
          skill: z.string(),
          proficiency: z.string().nullable().optional(),
          atsKeywordVariants: z.array(z.string()).default([]),
          confidence: z.number().min(0).max(1).default(0.5),
        })
      )
      .default([]),
    education: z
      .array(
        z.object({
          institution: z.string().nullable().optional(),
          qualification: z.string().nullable().optional(),
          year: z.string().nullable().optional(),
          confidence: z.number().min(0).max(1).default(0.5),
        })
      )
      .default([]),
    languages: z
      .array(
        z.object({
          language: z.string(),
          cefrLevel: z.string().nullable().optional(),
          confidence: z.number().min(0).max(1).default(0.5),
        })
      )
      .default([]),
  }),
  tool: {
    name: 'emit_career_graph',
    description:
      'Extract a DRAFT career graph from raw CV / LinkedIn / pasted text. Capture only what the text supports — never invent a company, a metric, or a skill. Leave a result metric null unless a number is explicitly present in the text.',
    input_schema: {
      type: 'object',
      properties: {
        profile: { type: 'object', properties: { name: str, headline: str, location: str } },
        positions: arr({
          type: 'object',
          properties: { company: str, title: str, startDate: str, endDate: str, summary: str, confidence: { type: 'number' } },
        }),
        stories: arr({
          type: 'object',
          properties: {
            title: str,
            summary: str,
            confidence: { type: 'number' },
            actions: arr({ type: 'object', properties: { text: str, skills: arr(str), confidence: { type: 'number' } }, required: ['text'] }),
            results: arr({ type: 'object', properties: { text: str, metric: str, confidence: { type: 'number' } }, required: ['text'] }),
          },
          required: ['title'],
        }),
        skills: arr({ type: 'object', properties: { skill: str, proficiency: str, atsKeywordVariants: arr(str), confidence: { type: 'number' } }, required: ['skill'] }),
        education: arr({ type: 'object', properties: { institution: str, qualification: str, year: str, confidence: { type: 'number' } } }),
        languages: arr({ type: 'object', properties: { language: str, cefrLevel: str, confidence: { type: 'number' } }, required: ['language'] }),
      },
      required: [],
    },
  } satisfies ToolDef,
};

// ── C2 · Map requirements → evidence (over the whole graph) ──────────────────
export const C2 = {
  zod: z.object({
    links: z
      .array(
        z.object({
          order: z.number().int(),
          evidenceRef: z.string().nullable().optional(),
          matchStrength: z.string(),
          connection: z.string().nullable().optional(),
          // Free-text hint, not a hard enum: the known slots are offered in the
          // prompt, but evidence that fits none must still map (it falls back to
          // the programmatic CV), so we never reject the call over a slot label.
          cvPosition: z.string().nullable().optional(),
        })
      )
      .default([]),
    gaps: z
      .array(z.object({ order: z.number().int().optional(), requirement: z.string().nullable().optional(), note: z.string() }))
      .default([]),
  }),
  tool: {
    name: 'emit_evidence_map',
    description:
      'For each requirement, pick the SINGLE strongest piece of evidence from the candidate list by its exact ref code, rate the match honestly, and note the connection. If no honest match exists, omit it from links and record it under gaps instead — never force a weak link or invent evidence.',
    input_schema: {
      type: 'object',
      properties: {
        links: arr({
          type: 'object',
          properties: {
            order: { type: 'integer', description: 'The requirement number from the list.' },
            evidenceRef: { type: 'string', description: 'Exact ref code of the chosen evidence (e.g. "5-3", "A-R3", "EDU-1").' },
            matchStrength: { type: 'string', enum: ['Very Strong', 'Strong', 'Moderate', 'Weak', 'No Match'] },
            connection: { type: 'string', description: 'One sentence: why this evidence supports the requirement.' },
            cvPosition: { type: 'string', description: 'Best-matching CV slot label if one fits; otherwise leave blank.' },
          },
          required: ['order', 'evidenceRef', 'matchStrength'],
        }),
        gaps: arr({
          type: 'object',
          properties: { order: { type: 'integer' }, requirement: str, note: { type: 'string', description: 'Honest statement of what is missing.' } },
          required: ['note'],
        }),
      },
      required: ['links'],
    },
  } satisfies ToolDef,
};

// ── C3 · Transform Keep evidence into CV bullets ─────────────────────────────
export const C3 = {
  zod: z.object({
    bullets: z
      .array(z.object({ ref: z.string(), bullet: z.string(), skills: z.array(z.string()).default([]) }))
      .default([]),
  }),
  tool: {
    name: 'emit_cv_bullets',
    description:
      'Rewrite each Keep evidence item into ONE tight CV bullet: lead with a strong past-tense verb, keep every claim supportable by the original text, weave in JD keywords only where genuinely supported, and tag the Requirement Skills demonstrated — the Job-Lead-facing skill language this bullet proves (the bracketed tag), not the candidate\'s own vocabulary for the evidence. Never invent a metric or outcome not present in the original text.',
    input_schema: {
      type: 'object',
      properties: {
        bullets: arr({
          type: 'object',
          properties: {
            ref: { type: 'string', description: 'The evidence ref code this bullet rewrites.' },
            bullet: { type: 'string', description: 'The rewritten CV bullet (no leading dash).' },
            skills: arr({
              type: 'string',
              description: 'A Requirement Skill this bullet demonstrates, in Job-Lead language (not the candidate\'s own skill vocabulary).',
            }),
          },
          required: ['ref', 'bullet'],
        }),
      },
      required: ['bullets'],
    },
  } satisfies ToolDef,
};

// ── C5 · Tailored CV profile ─────────────────────────────────────────────────
export const C5 = {
  zod: z.object({ profile: z.string() }),
  tool: {
    name: 'emit_profile',
    description:
      'Write a tailored CV profile of 4–7 lines (70–110 words): lead with seniority and scope, mirror this role\'s core requirements, use senior leadership language, and stay fully supportable by the evidence. No first person, no fabrication.',
    input_schema: {
      type: 'object',
      properties: { profile: { type: 'string' } },
      required: ['profile'],
    },
  } satisfies ToolDef,
};

// ── C7 · Reviewed ATS matching rating ────────────────────────────────────────
export const C7 = {
  zod: z.object({
    overall: z.number().min(0).max(100),
    requirements: z
      .array(
        z.object({
          requirement: z.string(),
          score: z.number().min(0).max(100),
          matchStrength: z.string(),
          keyStrengths: z.string().nullable().optional(),
          gaps: z.string().nullable().optional(),
        })
      )
      .default([]),
    summary: z.string().nullable().optional(),
  }),
  tool: {
    name: 'emit_ats_rating',
    description:
      'Rate how well the tailored CV addresses the JD requirements through an ATS lens. Emit an overall 0–100, a per-requirement breakdown (score 0–100 + match strength + key strengths + gaps), and a short summary. Weight Core requirements highest. Be truthful — never inflate.',
    input_schema: {
      type: 'object',
      properties: {
        overall: { type: 'number', minimum: 0, maximum: 100 },
        requirements: arr({
          type: 'object',
          properties: {
            requirement: str,
            score: { type: 'number', minimum: 0, maximum: 100 },
            matchStrength: { type: 'string', enum: ['Excellent', 'Very Strong', 'Good', 'Moderate', 'Weak'] },
            keyStrengths: str,
            gaps: str,
          },
          required: ['requirement', 'score', 'matchStrength'],
        }),
        summary: str,
      },
      required: ['overall', 'requirements'],
    },
  } satisfies ToolDef,
};

// ── COACH · structure a coaching answer into a draft evidence node ──────────
// The same anti-fabrication guard as C2/C3: a metric is emitted ONLY when a
// number is explicitly present in the user's own words; otherwise it stays null.
export const COACH_DRAFT = {
  zod: z.object({
    action: z.string(),
    result: z.string().nullable().optional(),
    metric: z.string().nullable().optional(),
    needsMetric: z.boolean().default(false),
    confidence: z.number().min(0).max(1).default(0.6),
  }),
  tool: {
    name: 'emit_evidence_draft',
    description:
      "Turn the user's rough answer into one clean evidence node: a structured action sentence and, if they described an outcome, a result. HARD RULE: emit `metric` ONLY if a number is explicitly present in the user's answer — otherwise set metric=null, and set needsMetric=true when a result was described but no number was given. Never invent or infer a number. Prefer the user's own words; never flatter or exaggerate.",
    input_schema: {
      type: 'object',
      properties: {
        action: str,
        result: str,
        metric: str,
        needsMetric: { type: 'boolean' },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
      required: ['action'],
    },
  } satisfies ToolDef,
};
export type CoachDraftOut = z.infer<typeof COACH_DRAFT.zod>;

// ── STORY · the through-line (Additive Plan · C1) ───────────────────────────
// Narrate the career, don't embellish it. A through-line over the approved
// evidence, plus two copy-out drafts (a cover-letter body and a LinkedIn About).
// Same anti-fabrication guard as the CV steps: every claim must trace to the
// evidence provided; never invent roles, metrics, or skills.
export const STORY = {
  zod: z.object({
    throughLine: z.string(),
    coverLetter: z.string(),
    linkedinAbout: z.string(),
  }),
  tool: {
    name: 'emit_story',
    description:
      "Write the candidate's career through-line from their approved evidence — the thread that connects their roles into one coherent arc (what they repeatedly do well, the scope they operate at, where they're heading). Then emit two copy-out drafts: `coverLetter` (a 3–4 paragraph cover-letter body, no address block) and `linkedinAbout` (a first-person LinkedIn About, 90–160 words). HARD RULE: every claim must be supportable by the evidence provided — never invent a role, metric, employer, or skill. No flattery. Prefer their own scope and language.",
    input_schema: {
      type: 'object',
      properties: {
        throughLine: { type: 'string' },
        coverLetter: { type: 'string' },
        linkedinAbout: { type: 'string' },
      },
      required: ['throughLine', 'coverLetter', 'linkedinAbout'],
    },
  } satisfies ToolDef,
};
export type StoryOut = z.infer<typeof STORY.zod>;

export type C2Out = z.infer<typeof C2.zod>;
export type C3Out = z.infer<typeof C3.zod>;
export type C5Out = z.infer<typeof C5.zod>;
export type C7Out = z.infer<typeof C7.zod>;

export type ImportOut = z.infer<typeof IMPORT.zod>;

export type B2Out = z.infer<typeof B2.zod>;
export type B3Out = z.infer<typeof B3.zod>;
export type B4Out = z.infer<typeof B4.zod>;
export type B5Out = z.infer<typeof B5.zod>;
export type B6Out = z.infer<typeof B6.zod>;
