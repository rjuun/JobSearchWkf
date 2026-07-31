/**
 * Per-step output contracts. Each step forces a single tool call whose `input`
 * is validated by the matching zod schema. JSON Schema drives the Anthropic
 * tool definition; zod drives runtime validation (+ one retry on mismatch).
 */
import { z } from 'zod';

export type ToolDef = {
  name: string;
  description: string;
  /** Anthropic strict tool use: grammar-constrained sampling guarantees the
   * tool_use input matches input_schema exactly (no wrong-shaped first attempts
   * → no bounded retry burned). Requires `additionalProperties: false` on every
   * object node; numeric minimum/maximum are unsupported in strict schemas, so
   * ranges live in enums/descriptions here and zod enforces them at runtime.
   * Typed as literal `true` so a def can't compile without it. */
  strict: true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input_schema: Record<string, any>;
};

const arr = (items: Record<string, unknown>) => ({ type: 'array', items });
const str = { type: 'string' };

// ── A1 · Capture-time extraction (company/city/remote/format signals/ATS) ───
// `atsSystem` lives here and nowhere else (CI · Lead Page as Pipeline Canvas
// §2.2a). It used to also be a B4 output, but B4 only ever receives JD prose and
// ATS identity isn't in prose — it's in the page chrome. A1 is the only step that
// holds the rendered page, so it's the only step that can honestly answer this.
export const A1 = {
  zod: z.object({
    company: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    remote: z.enum(['on-site', 'hybrid', 'remote', 'unspecified']).default('unspecified'),
    formatSignals: z.string().nullable().optional(),
    atsSystem: z.string().nullable().optional(),
  }),
  tool: {
    name: 'emit_capture_extraction',
    strict: true,
    description:
      'Extract only what is explicitly present or unambiguously inferable from the job description: the hiring company, the primary work-location city, remote/hybrid/on-site status, verbatim quotes of any explicit application-format instructions, and the ATS if it is visibly evidenced on the page. Never guess — leave a field null/unspecified rather than invent a value. Extraction only, no judgment or scoring.',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: {
        company: str,
        city: str,
        remote: { type: 'string', enum: ['on-site', 'hybrid', 'remote', 'unspecified'] },
        formatSignals: {
          type: 'string',
          description:
            'Verbatim (not paraphrased) quotes of explicit application-format instructions: CV length/page limits, required file type, file naming convention, cover-letter requirement, photo/headshot mention, language of application, HR/Talent Acquisition contact name. Concatenate as short quoted fragments; leave empty if nothing explicit is stated.',
        },
        atsSystem: {
          type: 'string',
          description:
            'The Applicant Tracking System this application actually runs through — ONLY if visibly evidenced on the page: the apply form host domain, an embedded apply iframe src, vendor branding in the form or footer ("Powered by Greenhouse"), or the apply button destination. NEVER infer it from job-description prose: a JD requiring SAP skills is not a SuccessFactors posting. Leave empty if nothing on the page evidences it.',
        },
      },
      required: ['remote'],
    },
  } satisfies ToolDef,
};
export type A1Out = z.infer<typeof A1.zod>;

// ── B2 · Requirements (runs FIRST in the B phase — see prompts.ts STEP_NOTE) ─
export const B2 = {
  zod: z.object({
    requirements: z
      .array(
        z.object({
          order: z.number().int(),
          requirement: z.string(),
          description: z.string().nullable().optional(),
          sourceText: z.string().nullable().optional(),
          rank: z.string(),
          skills: z.array(z.string()).default([]),
        })
      )
      .default([]),
  }),
  tool: {
    name: 'emit_requirements',
    strict: true,
    description: 'Break the JD into ranked requirements (Core / Important / Nice-to-Have), in order.',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: {
        requirements: arr({
          type: 'object', additionalProperties: false,
          properties: {
            order: { type: 'integer' },
            requirement: str,
            description: str,
            // Distinct from `description` on purpose: §C.4 of the note lets that
            // be a "faithful close paraphrase", which is the step's reading of the
            // source rather than the source. The Map quotes this back to the user.
            sourceText: {
              type: 'string',
              description:
                'The VERBATIM sentence from the job description this requirement was drawn from — character for character, no tidying, no trimming, no translation, and never stitched together from separated lines. If the requirement synthesises several lines, quote the single most load-bearing one. Leave empty only if the requirement is implied by the posting\'s structure rather than stated in any sentence.',
            },
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

// ── B3 · Roadblocks ────────────────────────────────────────────────────────
// `requirementOrder` (CI · Lead Page as Pipeline Canvas §2.5) is why this step
// had to move after extraction: a roadblock can now name the requirement row it
// blocks, and it can only do that if the rows already exist. Optional by design —
// the five categories are judged against the JD as a whole, so a language demand
// often lands on one requirement while an industry roadblock lands on none.
// Keyed on `order` (not the row UUID) for the same reason B6 is: the model is
// given a numbered list and never sees an id.
export const B3 = {
  zod: z.object({
    roadblocks: z
      .array(z.object({ dimension: z.string(), detail: z.string(), requirementOrder: z.number().int().nullable().optional() }))
      .default([]),
  }),
  tool: {
    name: 'emit_roadblocks',
    strict: true,
    description: 'Hard ineligibility factors across language, technical, certification, geographic, industry. Empty if none.',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: {
        roadblocks: arr({
          type: 'object', additionalProperties: false,
          properties: {
            dimension: { type: 'string', enum: ['Language', 'Technical', 'Certification', 'Geographic', 'Industry'] },
            detail: str,
            requirementOrder: {
              type: 'integer',
              description:
                'The number of the requirement from the REQUIREMENTS list that this roadblock blocks, if it maps cleanly onto exactly one of them (e.g. a native-German demand maps onto a German-language requirement). Omit it when the roadblock is implied across the posting as a whole rather than stated as one requirement — do not force a mapping.',
            },
          },
          required: ['dimension', 'detail'],
        }),
      },
      required: ['roadblocks'],
    },
  } satisfies ToolDef,
};

// ── B4 · Misalignments ─────────────────────────────────────────────────────
export const B4 = {
  zod: z.object({
    misalignments: z
      .array(z.object({ dimension: z.string(), detail: z.string(), severity: z.string().optional() }))
      .default([]),
  }),
  tool: {
    name: 'emit_misalignments',
    strict: true,
    description: 'Soft flags (not blockers) across values/culture, city, seniority. Empty if none.',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: {
        misalignments: arr({
          type: 'object', additionalProperties: false,
          properties: { dimension: str, detail: str, severity: str },
          required: ['dimension', 'detail'],
        }),
      },
      required: ['misalignments'],
    },
  } satisfies ToolDef,
};

// ── B5 · Skills (A–Q) + JD group ────────────────────────────────────────────
// No `atsSystem` here on purpose — see A1 above. This step is passed JD text and
// nothing else, so any ATS value it produced was prose inference, and the write
// path let it overwrite A1's verified hostname match. Do not add it back.
// (This step was B4 before the reorder; its note is now Process/B5.)
export const B5 = {
  zod: z.object({
    skills: z.array(z.object({ dimension: z.string(), rating: z.number().int().min(1).max(3) })).default([]),
    jdGroupPrimary: z.string().nullable().optional(),
    jdGroupSecondary: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  }),
  tool: {
    name: 'emit_skill_mapping',
    strict: true,
    description: 'Rate the role against the 17-dimension framework (1=Central, 2=Contributing, 3=Peripheral) and assign JD groups.',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: {
        skills: arr({
          type: 'object', additionalProperties: false,
          properties: { dimension: str, rating: { type: 'integer', enum: [1, 2, 3] } },
          required: ['dimension', 'rating'],
        }),
        jdGroupPrimary: str,
        jdGroupSecondary: str,
        // "Key Patterns & CV Tailoring Notes" — the B5 process note already asks
        // for this (§B step 3, format rule §D.1) and the whole note reaches the
        // model as the cacheable system prompt, so this per-field description is
        // belt-and-braces clarity, not a fix. Persisted to job_leads.key_patterns.
        notes: { type: 'string', description: '2–4 sentences: lead with the dominant CV theme, then name 2–3 specific tailoring priorities.' },
      },
      required: ['skills'],
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
    strict: true,
    description:
      'Emit 0–10 judgments for Relevance, Seniority, Impact, ATS, and a per-requirement match score. Do NOT compute the overall — the system does that.',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: {
        relevance: { type: 'number' },
        seniority: { type: 'number' },
        impact: { type: 'number' },
        ats: { type: 'number' },
        requirements: arr({
          type: 'object', additionalProperties: false,
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
    strict: true,
    description:
      'Extract a DRAFT career graph from raw CV / LinkedIn / pasted text. Capture only what the text supports — never invent a company, a metric, or a skill. Leave a result metric null unless a number is explicitly present in the text.',
    // Strict mode caps optional parameters at 24 per tool (grammar compilation
    // limit) — this schema had 32. Fields the model can always emit are required
    // (arrays may be empty; confidence is always a judgment); truly
    // sometimes-absent facts (metric, dates, proficiency…) stay optional, which
    // preserves the anti-fabrication rule: omit rather than invent.
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: {
        profile: { type: 'object', additionalProperties: false, properties: { name: str, headline: str, location: str } },
        positions: arr({
          type: 'object', additionalProperties: false,
          properties: { company: str, title: str, startDate: str, endDate: str, summary: str, confidence: { type: 'number' } },
          required: ['confidence'],
        }),
        stories: arr({
          type: 'object', additionalProperties: false,
          properties: {
            title: str,
            summary: str,
            confidence: { type: 'number' },
            actions: arr({ type: 'object', additionalProperties: false, properties: { text: str, skills: arr(str), confidence: { type: 'number' } }, required: ['text', 'skills', 'confidence'] }),
            results: arr({ type: 'object', additionalProperties: false, properties: { text: str, metric: str, confidence: { type: 'number' } }, required: ['text', 'confidence'] }),
          },
          required: ['title', 'confidence', 'actions', 'results'],
        }),
        skills: arr({ type: 'object', additionalProperties: false, properties: { skill: str, proficiency: str, atsKeywordVariants: arr(str), confidence: { type: 'number' } }, required: ['skill', 'confidence'] }),
        education: arr({ type: 'object', additionalProperties: false, properties: { institution: str, qualification: str, year: str, confidence: { type: 'number' } }, required: ['confidence'] }),
        languages: arr({ type: 'object', additionalProperties: false, properties: { language: str, cefrLevel: str, confidence: { type: 'number' } }, required: ['language', 'confidence'] }),
      },
      required: ['positions', 'stories', 'skills', 'education', 'languages'],
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
    strict: true,
    description:
      'For each requirement, pick the SINGLE strongest piece of evidence from the candidate list by its exact ref code, rate the match honestly, and note the connection. If no honest match exists, omit it from links and record it under gaps instead — never force a weak link or invent evidence.',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: {
        links: arr({
          type: 'object', additionalProperties: false,
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
          type: 'object', additionalProperties: false,
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
    strict: true,
    description:
      'Rewrite each Keep evidence item into ONE tight CV bullet: lead with a strong past-tense verb, keep every claim supportable by the original text, weave in JD keywords only where genuinely supported, and tag the Requirement Skills demonstrated — the Job-Lead-facing skill language this bullet proves (the bracketed tag), not the candidate\'s own vocabulary for the evidence. Never invent a metric or outcome not present in the original text.',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: {
        bullets: arr({
          type: 'object', additionalProperties: false,
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
    strict: true,
    description:
      'Write a tailored CV profile of 4–7 lines (70–110 words): lead with seniority and scope, mirror this role\'s core requirements, use senior leadership language, and stay fully supportable by the evidence. No first person, no fabrication.',
    input_schema: {
      type: 'object', additionalProperties: false,
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
    strict: true,
    description:
      'Rate how well the tailored CV addresses the JD requirements through an ATS lens. Emit an overall 0–100, a per-requirement breakdown (score 0–100 + match strength + key strengths + gaps), and a short summary. Weight Core requirements highest. Be truthful — never inflate.',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: {
        overall: { type: 'number', description: 'Overall ATS rating, 0–100.' },
        requirements: arr({
          type: 'object', additionalProperties: false,
          properties: {
            requirement: str,
            score: { type: 'number', description: '0–100.' },
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
    strict: true,
    description:
      "Turn the user's rough answer into one clean evidence node: a structured action sentence and, if they described an outcome, a result. HARD RULE: emit `metric` ONLY if a number is explicitly present in the user's answer — otherwise set metric=null, and set needsMetric=true when a result was described but no number was given. Never invent or infer a number. Prefer the user's own words; never flatter or exaggerate.",
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: {
        action: str,
        result: str,
        metric: str,
        needsMetric: { type: 'boolean' },
        confidence: { type: 'number', description: 'Confidence, 0–1.' },
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
    strict: true,
    description:
      "Write the candidate's career through-line from their approved evidence — the thread that connects their roles into one coherent arc (what they repeatedly do well, the scope they operate at, where they're heading). Then emit two copy-out drafts: `coverLetter` (a 3–4 paragraph cover-letter body, no address block) and `linkedinAbout` (a first-person LinkedIn About, 90–160 words). HARD RULE: every claim must be supportable by the evidence provided — never invent a role, metric, employer, or skill. No flattery. Prefer their own scope and language.",
    input_schema: {
      type: 'object', additionalProperties: false,
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
