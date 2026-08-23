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
      'Extract only what is explicitly present or unambiguously inferable from the job description: the hiring company, the primary work-location city, remote/hybrid/on-site status, verbatim quotes of any explicit application-format instructions, and the ATS if it is visibly evidenced on the page. Never guess — leave a field empty (or "unspecified") rather than invent a value. Extraction only, no judgment or scoring.',
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
      // Every property is listed — see the B2 note below. `required` means "the
      // key is present", not "the value is non-empty", so the never-guess rule is
      // intact: an unevidenced company/city/atsSystem is emitted as "", which the
      // capture write path already treats as "saw nothing" (it coalesces with `||`).
      required: ['company', 'city', 'remote', 'formatSignals', 'atsSystem'],
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
          groupRank: z.number().int().nullable().optional(),
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
            // The note (§B) calls this the *Requirement Group* and reserves the
            // word "Rank" for the within-group counter below. The field keeps the
            // name `rank` because that is what the whole app reads it as
            // (queries.ts, scoring.ts, tailoring.ts, coaching-queue.ts, the UI).
            rank: {
              type: 'string',
              enum: ['Core', 'Important', 'Nice-to-Have'],
              description: 'The Requirement Group from the procedure: Core, Important, or Nice-to-Have.',
            },
            // §B's actual "Rank": the sequence WITHIN the group. The procedure has
            // always asked for it; until now the tool had nowhere to put it, and a
            // strict schema that cannot express what its own prompt demands is what
            // collapsed this step's generation (see the CI note).
            groupRank: {
              type: 'integer',
              description:
                'The sequential number of this requirement WITHIN its group, starting at 1. The procedure calls this "Rank" — distinct from `order`, which is the global counter across all groups.',
            },
            skills: arr(str),
          },
          // Every property is listed. Under `strict: true` the tool input is
          // grammar-constrained, and a partial `required` list degrades that
          // grammar rather than making fields optional: with three of seven listed
          // this step returned 0-1 requirements on 17 consecutive real JDs. Listing
          // them all took it to 13/14. `required` means "the key is present", not
          // "the value is non-empty" — an unstated sourceText is still "".
          required: ['order', 'requirement', 'description', 'sourceText', 'rank', 'groupRank', 'skills'],
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
                'The number of the requirement from the REQUIREMENTS list that this roadblock blocks, if it maps cleanly onto exactly one of them (e.g. a native-German demand maps onto a German-language requirement). Use 0 when the roadblock is implied across the posting as a whole rather than stated as one requirement — do not force a mapping.',
            },
          },
          // Every property is listed — see the B2 note above. This one needs the 0
          // sentinel in its description: `required` on a STRING field is free
          // (an unstated value is ""), but an integer has no empty form, so the
          // "do not force a mapping" rule needs a value that means "none". The
          // write path in screening.ts treats 0 as unmapped.
          required: ['dimension', 'detail', 'requirementOrder'],
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
          properties: {
            dimension: str,
            detail: str,
            severity: {
              type: 'string',
              description: 'How strongly this flag weighs against the role — one short phrase. Leave empty if the detail already carries it.',
            },
          },
          // Every property is listed — see the B2 note above.
          required: ['dimension', 'detail', 'severity'],
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
      // Every property is listed — see the B2 note above. The write path in
      // screening.ts coalesces these three with `||`, so an empty string keeps a
      // previously stored jdGroup / keyPatterns instead of blanking it.
      required: ['skills', 'jdGroupPrimary', 'jdGroupSecondary', 'notes'],
    },
  } satisfies ToolDef,
};

// ── B6 · Role fit (dimensions + per-requirement judgments + evidence) ────────
// `evidenceRefs` is why this step was rewritten (CI · B6 Never Receives the Master
// Bullet Bank §2.2). B6's note has always required it to "map the requirement to
// the strongest available evidence in the Master Bullet Bank" and to "quote or
// reference the exact bullet text" — and until now the schema had nowhere to put
// the answer, so the mapping the whole step is built around was discarded at the
// tool boundary. An ARRAY, not a single ref: a requirement is routinely carried by
// several bullets across several positions, and that many-to-many relationship is
// the Requirement→Evidence Map's entire subject.
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
          evidenceRefs: z.array(z.string()).default([]),
          evidenceNote: z.string().nullable().optional(),
        })
      )
      .default([]),
    summary: z.string().nullable().optional(),
  }),
  tool: {
    name: 'emit_role_fit',
    strict: true,
    description:
      'Emit 0–10 judgments for Relevance, Seniority, Impact, ATS, and a per-requirement match score backed by named evidence from the CANDIDATE EVIDENCE list. Do NOT compute the overall — the system does that.',
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
            gaps: {
              type: 'string',
              description:
                'What the evidence does NOT cover for this requirement. On "No Match" this is mandatory prose — state what is missing, never leave it blank.',
            },
            evidenceRefs: arr({
              type: 'string',
              description:
                'An exact ref code from the CANDIDATE EVIDENCE list (e.g. "C4", "EDU-2", "LANG-3"). Never invent a code and never cite one that is not in that list.',
            }),
            evidenceNote: {
              type: 'string',
              description:
                'One sentence naming why the cited evidence carries this requirement, quoting the load-bearing phrase from the bullet. Leave empty when evidenceRefs is empty.',
            },
          },
          // Every property is listed — see the B2 note above. Under `strict: true`
          // a partial `required` list degrades the constrained grammar rather than
          // making fields optional, which is what collapsed B2's generation to 0-1
          // requirements on 17 consecutive real JDs. `required` means "the key is
          // present", not "the value is non-empty": an unsupported requirement
          // still emits `evidenceRefs: []` and `evidenceNote: ""`.
          required: ['order', 'requirement', 'score', 'matchStrength', 'keyStrengths', 'gaps', 'evidenceRefs', 'evidenceNote'],
        }),
        summary: str,
      },
      required: ['relevance', 'seniority', 'impact', 'ats', 'requirements', 'summary'],
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
      'Extract a DRAFT career graph from raw CV / LinkedIn / pasted text. Capture only what the text supports — never invent a company, a metric, or a skill. Leave a result metric EMPTY unless a number is explicitly present in the text.',
    // Every property on every object node is listed — see the B2 note above.
    // This also resolves the earlier optional-parameter pressure: strict mode
    // caps optional parameters at 24 per tool (grammar compilation limit) and
    // this schema declared 32, which is why fields were being triaged into
    // `required` one at a time. With the lists complete there are zero optional
    // parameters, so the cap is moot.
    //
    // The anti-fabrication rule is unchanged: `required` means "the key is
    // present", not "the value is non-empty". An absent metric or end date is
    // emitted as "" and the draft-wrapping in onboarding.ts maps "" back to null.
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: {
        profile: {
          type: 'object', additionalProperties: false,
          properties: { name: str, headline: str, location: str },
          required: ['name', 'headline', 'location'],
        },
        positions: arr({
          type: 'object', additionalProperties: false,
          properties: { company: str, title: str, startDate: str, endDate: str, summary: str, confidence: { type: 'number' } },
          required: ['company', 'title', 'startDate', 'endDate', 'summary', 'confidence'],
        }),
        stories: arr({
          type: 'object', additionalProperties: false,
          properties: {
            title: str,
            summary: str,
            confidence: { type: 'number' },
            actions: arr({ type: 'object', additionalProperties: false, properties: { text: str, skills: arr(str), confidence: { type: 'number' } }, required: ['text', 'skills', 'confidence'] }),
            results: arr({
              type: 'object', additionalProperties: false,
              properties: {
                text: str,
                metric: { type: 'string', description: 'The quantified outcome, VERBATIM from the text. Leave empty unless a number is explicitly present — never infer or invent one.' },
                confidence: { type: 'number' },
              },
              required: ['text', 'metric', 'confidence'],
            }),
          },
          required: ['title', 'summary', 'confidence', 'actions', 'results'],
        }),
        skills: arr({ type: 'object', additionalProperties: false, properties: { skill: str, proficiency: str, atsKeywordVariants: arr(str), confidence: { type: 'number' } }, required: ['skill', 'proficiency', 'atsKeywordVariants', 'confidence'] }),
        education: arr({ type: 'object', additionalProperties: false, properties: { institution: str, qualification: str, year: str, confidence: { type: 'number' } }, required: ['institution', 'qualification', 'year', 'confidence'] }),
        languages: arr({ type: 'object', additionalProperties: false, properties: { language: str, cefrLevel: str, confidence: { type: 'number' } }, required: ['language', 'cefrLevel', 'confidence'] }),
      },
      required: ['profile', 'positions', 'stories', 'skills', 'education', 'languages'],
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
          // CI · C4 Skills Selection Produces Unreadable Overflow. My Skills is
          // C2's own selection from the owner's curated vocabulary, not a copy
          // of whatever free text sits on the evidence node — that copy is what
          // produced 67 skills in one CV line. Unrecognised names are dropped at
          // the write path, so a hallucinated skill costs nothing.
          mySkills: z.array(z.string()).default([]),
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
      'For each requirement, list every genuinely strongest piece of evidence from the candidate list by its exact ref code — one entry per ref, ranked strongest first when several apply. Rate each match honestly and note the connection, and name which of the candidate\'s own skills/competences/attributes that evidence demonstrates for this requirement. If no honest match exists, omit the requirement from links and record it under gaps instead — never force a weak link or invent evidence.',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: {
        links: arr({
          type: 'object', additionalProperties: false,
          properties: {
            order: { type: 'integer', description: 'The requirement number from the list. May repeat across several links when more than one piece of evidence genuinely supports it.' },
            evidenceRef: { type: 'string', description: 'Exact ref code of the chosen evidence (e.g. "5-3", "A-R3", "EDU-1").' },
            // Same 5-band ordinal B6 uses (lib/scoring.ts matchStrengthForScore) —
            // CI · Make C2 Build on B6 §2.2 requires one shared scale so a re-run's
            // merge can compare a new pick against B6's or a stored C2 pick.
            matchStrength: { type: 'string', enum: ['Excellent', 'Very Strong', 'Good', 'Weak', 'No Match'] },
            connection: { type: 'string', description: 'One sentence: why this evidence supports the requirement.' },
            cvPosition: {
              type: 'string',
              description:
                'Best-matching CV slot label if one fits; otherwise leave empty. Emit ONLY a slot label — never the evidence text, which the app already resolves from evidenceRef.',
            },
            mySkills: {
              type: 'array',
              items: { type: 'string' },
              description:
                'My Skills: which of the candidate\'s OWN skills, competences or attributes this evidence demonstrates in answer to this requirement. Copy names EXACTLY from the CANDIDATE SKILLS, COMPETENCES & ATTRIBUTES list — a name that is not on that list is dropped. This is the candidate\'s own vocabulary, the counterpart to the requirement\'s JD-language skills; never restate the JD wording here. Empty array if the list holds nothing this evidence honestly demonstrates.',
            },
          },
          // Every property is listed — see the B2 note above. Measured on this
          // step: with `connection` and `cvPosition` declared but not required,
          // roughly one C2 run in three collapsed to a single repeated link and
          // ~90 output tokens instead of 11-14 links and ~1500, and one run
          // appended evidence prose into `cvPosition` — the two omitted fields
          // were exactly the two that misbehaved.
          required: ['order', 'evidenceRef', 'matchStrength', 'connection', 'cvPosition', 'mySkills'],
        }),
        gaps: arr({
          type: 'object', additionalProperties: false,
          properties: {
            // 0 means "not one of the numbered requirements" — an integer has no
            // empty form, so it needs a sentinel where a string would just be "".
            order: { type: 'integer', description: 'The requirement number from the list, or 0 if this gap is not one of them.' },
            requirement: str,
            note: { type: 'string', description: 'Honest statement of what is missing.' },
          },
          required: ['order', 'requirement', 'note'],
        }),
      },
      required: ['links', 'gaps'],
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
          // Every property is listed — see the B2 note above. An array satisfies
          // `required` while empty, so a bullet that proves no named Requirement
          // Skill still emits `skills: []`.
          required: ['ref', 'bullet', 'skills'],
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
          // Every property is listed — see the B2 note above. Both omitted fields
          // are columns the C7 note's own ATS Breakdown Table demands, so leaving
          // them out of `required` risked collapsing the step that produces them.
          required: ['requirement', 'score', 'matchStrength', 'keyStrengths', 'gaps'],
        }),
        summary: str,
      },
      required: ['overall', 'requirements', 'summary'],
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
      "Turn the user's rough answer into one clean evidence node: a structured action sentence and, if they described an outcome, a result. HARD RULE: emit `metric` ONLY if a number is explicitly present in the user's answer — otherwise leave `metric` empty, and set needsMetric=true when a result was described but no number was given. Never invent or infer a number. Prefer the user's own words; never flatter or exaggerate.",
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: {
        action: str,
        result: { type: 'string', description: 'The outcome, if they described one. Leave empty if they did not.' },
        metric: { type: 'string', description: 'The number, VERBATIM from their answer. Leave empty unless a number is explicitly present.' },
        needsMetric: { type: 'boolean' },
        confidence: { type: 'number', description: 'Confidence, 0–1.' },
      },
      // Every property is listed — see the B2 note above. `groundDraft` in
      // coaching-draft.ts already treats an empty metric as no metric, so the
      // anti-fabrication guard is unaffected by the key always being present.
      required: ['action', 'result', 'metric', 'needsMetric', 'confidence'],
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
