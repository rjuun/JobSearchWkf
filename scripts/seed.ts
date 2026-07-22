/**
 * Seed the database from the owner's real workbooks + captured JDs.
 * Run locally only: `npm run seed`. Reads gitignored source files; never run in CI.
 *
 * Sources:
 *   Profile/Profile_Reference_Workbook.xlsx  → evidence (STARs, bullet bank, skills…)
 *   Job Hunting Lists.xlsx                    → companies, offices, leads, requirements, tailoring
 *   Job Descriptions/*.md                     → captured JD text → filesystem storage
 *   Group CVs/*.docx                          → CV variants (reference artifacts)
 *   Process/CI/*.md                           → continuous-improvement initiatives
 */
import './_env';
import fs from 'node:fs';
import path from 'node:path';
import { scryptSync, randomBytes } from 'node:crypto';
import ExcelJS from 'exceljs';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../lib/db';
import {
  DEMO_OWNER_ID,
  users,
  profiles,
  positions,
  stars,
  starActions,
  starResults,
  starCompetences,
  starAttributes,
  responsibilities,
  education,
  languages,
  bulletBank,
  skillsMaster,
  companies,
  offices,
  jdGroups,
  jobLeads,
  jobRequirements,
  requirementTailoring,
  cvVariants,
  ciInitiatives,
} from '../lib/db/schema';
import { env } from '../lib/env';
import { generatePrompts } from '../lib/coaching-queue';
import { generateCv } from '../lib/pipeline/tailoring';
import type { LeadStatus } from '../lib/db/types';

const ROOT = process.cwd();
const STORAGE = env.storageDir;
const PROFILE_WB = path.join(ROOT, 'Profile', 'Profile_Reference_Workbook.xlsx');
const LISTS_WB = path.join(ROOT, 'Job Hunting Lists.xlsx');

// The demo persona's contact address — one coherent identity (name ↔ email ↔ history).
const DEMO_PERSONA_EMAIL = 'reginaldo.silvajr@gmail.com';

// ── Demo shaping (M0) ───────────────────────────────────────────────────────
// The real workbooks are rich enough that the graph saturates the strength meter
// and leaves the coach with nothing to ask. For an honest demo we layer a few
// DELIBERATE, believable gaps on top of the raw import — the workbook stays the
// source of truth, and reseeding reproduces these exactly. See docs/DEMO_RUNBOOK.md.
const GAP_STORY_REFS = ['6', '7']; //  stories whose quantified result we hold back
const GAP_SKILL_COUNT = 6; //           skills we leave without ATS keyword variants
const GAP_SUMMARY_COUNT = 1; //         positions we leave without a one-line scope
const READY_CV_LINES = 12; //           traced lines on the golden-path "ready" CV (2-page budget)

// ── cell helpers ────────────────────────────────────────────────────────────
function txt(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' || t === '[List]' ? null : t;
  }
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) {
      const s = (o.richText as Array<{ text: string }>).map((r) => r.text).join('').trim();
      return s || null;
    }
    if (o.text !== undefined) return txt(o.text);
    if (o.hyperlink !== undefined) return txt(o.hyperlink);
    if (o.result !== undefined) return txt(o.result);
  }
  return null;
}
function url(v: unknown): string | null {
  if (v && typeof v === 'object' && 'hyperlink' in v) return String((v as { hyperlink: unknown }).hyperlink);
  return txt(v);
}
function num(v: unknown): number | null {
  const t = txt(v);
  if (t === null) return null;
  const n = Number(t.replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function list(v: unknown): string[] {
  const t = txt(v);
  if (!t) return [];
  return t
    .split(/[;,\n]/)
    .map((s) => s.trim())
    .filter((s) => s && s !== '[List]' && s.toLowerCase() !== 'none');
}
function flags(v: unknown): { dimension: string; detail: string }[] {
  const t = txt(v);
  if (!t || t.toLowerCase() === 'none') return [];
  return t
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf(':');
      return i > 0
        ? { dimension: line.slice(0, i).trim(), detail: line.slice(i + 1).trim() }
        : { dimension: '', detail: line };
    });
}

type Getter = (c: number) => unknown;
function rowsFrom<T>(ws: ExcelJS.Worksheet, headerRow: number, build: (g: Getter, r: number) => T | null): T[] {
  const out: T[] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const obj = build((c) => row.getCell(c).value, r);
    if (obj) out.push(obj);
  }
  return out;
}

async function load(file: string): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  return wb;
}

// 17 skill dimensions (A–Q) live in Job Leads columns 12–28.
const SKILL_COLS: Array<[number, string]> = [
  [12, 'A · Strategic Planning | Corporate Development'],
  [13, 'B · Corporate Governance'],
  [14, 'C · Operations | Back-Office | Shared Services'],
  [15, 'D · Controlling'],
  [16, 'E · Financial Planning and Analysis'],
  [17, 'F · Project Management'],
  [18, 'G · Process Management'],
  [19, 'H · Procurement | Outsourcing'],
  [20, 'I · ESG | Sustainability'],
  [21, 'J · Change | Transformation | Merger Integration'],
  [22, 'K · Reporting and Analytics'],
  [23, 'L · Banking | Financial Services'],
  [24, 'M · Leadership & People Management'],
  [25, 'N · ERP / SAP / Digital Systems'],
  [26, 'O · German Language Proficiency'],
  [27, 'P · Consulting Pedigree'],
  [28, 'Q · Regulatory & Compliance'],
];

function mapStatus(s: string | null, hasScore: boolean): LeadStatus {
  const t = (s ?? '').toLowerCase();
  if (t.includes('applied') || t.includes('interview') || t.includes('submitted')) return 'applied';
  if (t.includes('promot')) return 'promoted';
  if (t.includes('tailor')) return 'tailoring';
  if (t.includes('hold') || t.includes('inactive') || t.includes('pause')) return 'hold';
  if (t.includes('screen') || hasScore) return 'screened';
  return 'captured';
}

// Every domain table carries an owner_id (schema `base`); `users` is the identity
// table and deliberately excluded. Wiping is owner-scoped, so a reset touches only
// the demo tenant and never another user's rows.
const DOMAIN_TABLES = [
  'profiles', 'positions', 'stars', 'star_actions', 'star_results', 'star_competences',
  'star_attributes', 'responsibilities', 'education', 'languages', 'bullet_bank', 'skills_master',
  'companies', 'offices', 'jd_groups', 'job_leads', 'job_requirements', 'requirement_tailoring',
  'cv_variants', 'applications', 'pipeline_runs', 'llm_calls', 'ci_initiatives', 'accuracy_tips',
  'coaching_prompts', 'coaching_answers', 'graph_strength_snapshots', 'activation_events',
] as const;

/**
 * Delete only one owner's rows across every domain table. This is what makes
 * `npm run db:reset` safe to run while experimental accounts exist — their data
 * lives under a different owner_id and is left untouched.
 */
export async function wipeOwner(ownerId: string): Promise<void> {
  for (const t of DOMAIN_TABLES) {
    await db.execute(sql`DELETE FROM ${sql.raw(t)} WHERE owner_id = ${ownerId}`);
  }
}

/**
 * Ensure the demo login exists and matches the current APP_EMAIL / APP_PASSWORD — its
 * id IS DEMO_OWNER_ID, which owns all seeded data. Left intact by wipeOwner (the users
 * table has no owner_id).
 *
 * UPSERT, not insert-if-absent: an earlier version returned early when the row already
 * existed, so re-seeding a DB that had been seeded before silently kept the OLD password
 * — the "invalid credentials" trap after a redeploy. Now every seed re-syncs the login.
 */
export async function ensureDemoUser(): Promise<void> {
  const email = env.appEmail.trim().toLowerCase();
  const salt = randomBytes(16).toString('hex');
  const passwordHash = `${salt}:${scryptSync(env.appPassword, salt, 64).toString('hex')}`;
  await db
    .insert(users)
    .values({ id: DEMO_OWNER_ID, email, passwordHash, name: 'Reginaldo (Reggie) Silva Junior' })
    .onConflictDoUpdate({ target: users.id, set: { email, passwordHash } });
  console.log('  ✓ demo login synced:', email);
}

/**
 * Build the demo tenant (Reggie) from the owner's workbooks. Assumes the demo
 * owner's rows have already been cleared (see wipeOwner) — it only inserts, so
 * both `seed` and `db:reset` call wipeOwner first. Never touches other tenants.
 */
export async function buildDemoTenant(): Promise<void> {
  // ── Profile (single owner row) ────────────────────────────────────────────
  await db.insert(profiles).values({
    id: DEMO_OWNER_ID,
    name: 'Reginaldo (Reggie) Silva Junior',
    headline: 'Senior Finance & Transformation Leader · 15+ yrs · Banking, Shared Services, Governance, Strategy',
    // The persona's own contact address — coherent with the name and history shown
    // in-app. Deliberately NOT the APP_EMAIL login credential (that's the off-screen
    // sign-in secret, and pinning it here is what produced the Reggie/rafael.perez3d
    // mismatch the demo used to contradict itself with).
    email: DEMO_PERSONA_EMAIL,
    location: 'Vienna, Austria',
    languagesSummary: 'English C1 · German C1 · Portuguese C2 (native) · Spanish B2',
  });

  // ── Profile Reference Workbook ────────────────────────────────────────────
  const pwb = await load(PROFILE_WB);
  const ws = (n: string) => {
    const s = pwb.getWorksheet(n);
    if (!s) throw new Error(`missing sheet ${n}`);
    return s;
  };

  await insert('positions', positions, rowsFrom(ws('tbl_Positions'), 3, (g) => {
    const ref = txt(g(1));
    return ref ? { refCode: ref, title: txt(g(2)), company: txt(g(3)), startDate: txt(g(5)), endDate: txt(g(6)), summary: txt(g(9)) } : null;
  }));

  await insert('stars', stars, rowsFrom(ws('tbl_STARs'), 3, (g) => {
    const ref = txt(g(1));
    return ref ? { refCode: ref, positionRef: txt(g(2)), title: txt(g(3)), summary: [txt(g(4)), txt(g(5))].filter(Boolean).join(' — ') } : null;
  }));

  await insert('star_actions', starActions, rowsFrom(ws('tbl_STAR_Actions'), 3, (g) => {
    const ref = txt(g(1));
    return ref ? { refCode: ref, starRef: txt(g(2)), text: txt(g(4)), skills: list(g(5)), atsKeywords: list(g(6)) } : null;
  }));

  await insert('star_results', starResults, rowsFrom(ws('tbl_STAR_Results'), 3, (g) => {
    const ref = txt(g(1));
    return ref ? { refCode: ref, starRef: txt(g(2)), text: txt(g(4)), metric: txt(g(5)), impactType: txt(g(6)) } : null;
  }));

  await insert('star_competences', starCompetences, rowsFrom(ws('tbl_STAR_Competences'), 3, (g) => {
    const ref = txt(g(1));
    return ref ? { refCode: ref, starRef: txt(g(2)), competence: [txt(g(3)), txt(g(4))].filter(Boolean).join(': ') } : null;
  }));

  await insert('star_attributes', starAttributes, rowsFrom(ws('tbl_STAR_Attributes'), 3, (g) => {
    const ref = txt(g(1));
    return ref ? { refCode: ref, starRef: txt(g(2)), attribute: txt(g(3)) } : null;
  }));

  await insert('responsibilities', responsibilities, rowsFrom(ws('tbl_Responsibilities'), 3, (g) => {
    const ref = txt(g(1));
    return ref ? { refCode: ref, positionRef: txt(g(2)), text: txt(g(4)), skills: list(g(6)) } : null;
  }));

  await insert('education', education, rowsFrom(ws('tbl_Education'), 3, (g) => {
    const ref = txt(g(1));
    return ref ? { refCode: ref, type: txt(g(2)), qualification: txt(g(3)), institution: txt(g(4)), year: txt(g(6)) } : null;
  }));

  await insert('languages', languages, rowsFrom(ws('tbl_Languages'), 3, (g) => {
    const ref = txt(g(1));
    return ref ? { refCode: ref, language: txt(g(2)), cefrLevel: txt(g(3)) } : null;
  }));

  // Bullet bank: headers on row 1 (no banner rows).
  await insert('bullet_bank', bulletBank, rowsFrom(ws('tbl_Bullet_Bank'), 1, (g) => {
    const ref = txt(g(1));
    const text = txt(g(3));
    return ref && text ? { refCode: ref, cvPosition: txt(g(2)), text, tags: list(g(4)), version: '2026-06' } : null;
  }));

  await insert('skills_master', skillsMaster, rowsFrom(ws('tbl_Skills_Master'), 3, (g) => {
    const ref = txt(g(1));
    return ref ? { refCode: ref, skill: txt(g(2)), proficiency: txt(g(4)), starEvidence: list(g(5)), atsKeywordVariants: list(g(6)) } : null;
  }));

  // ── Job Hunting Lists workbook ────────────────────────────────────────────
  const lwb = await load(LISTS_WB);
  const lws = (n: string) => {
    const s = lwb.getWorksheet(n);
    if (!s) throw new Error(`missing sheet ${n}`);
    return s;
  };

  // JD groups (static taxonomy).
  await insert('jd_groups', jdGroups, [
    { code: 'SCD', name: 'Strategy & Corporate Development' },
    { code: 'CSEO', name: 'Chief of Staff & Executive Office' },
    { code: 'OSS', name: 'Operations & Shared Services' },
    { code: 'CFPA', name: 'Controlling, FP&A & Finance' },
    { code: 'TPM', name: 'Transformation & Project Management' },
    { code: 'POESG', name: 'Procurement, Outsourcing & ESG' },
  ]);

  await insert('companies', companies, rowsFrom(lws('Companies'), 1, (g) => {
    const name = txt(g(1));
    return name ? { name, industry: txt(g(4)), hqCountry: txt(g(5)), interestScore: num(g(8)), website: url(g(9)), notes: [txt(g(10)), txt(g(11))].filter(Boolean).join(' | ') || null } : null;
  }));

  await insert('offices', offices, rowsFrom(lws('Offices'), 1, (g) => {
    const city = txt(g(1));
    return city ? { city, preferenceRank: num(g(2)) } : null;
  }));

  // Capture JD markdown into storage up front so leads link to it on insert
  // (no per-lead UPDATE round-trips afterwards).
  const jdDir = path.join(ROOT, 'Job Descriptions');
  const jdPathBySeq = new Map<number, string>();
  if (fs.existsSync(jdDir)) {
    for (const file of fs.readdirSync(jdDir).filter((f) => f.endsWith('.md'))) {
      const m = file.match(/^(\d+)/);
      if (!m) continue;
      const seq = Number(m[1]);
      const rel = path.join('jd-captures', String(seq), 'raw.md');
      fs.mkdirSync(path.dirname(path.join(STORAGE, rel)), { recursive: true });
      fs.copyFileSync(path.join(jdDir, file), path.join(STORAGE, rel));
      jdPathBySeq.set(seq, rel);
    }
  }
  console.log(`  ✓ jd captures stored: ${jdPathBySeq.size}`);

  // Job Leads — headers on row 3, data row 4+. Capture and keep seq → id map.
  const leadRows = rowsFrom(lws('Job Leads'), 3, (g) => {
    const idVal = txt(g(2));
    if (!idVal) return null;
    const seq = num(g(2));
    const overall = num(g(40));
    const ratings: Record<string, number> = {};
    for (const [c, label] of SKILL_COLS) {
      const n = num(g(c));
      if (n !== null) ratings[label] = n;
    }
    return {
      externalId: idVal,
      seq: seq ?? undefined,
      title: txt(g(3)) ?? txt(g(1)) ?? 'Untitled role',
      company: txt(g(4)),
      city: txt(g(5)),
      sourceUrl: url(g(6)),
      jobPostLink: url(g(7)),
      roadblocks: flags(g(8)),
      misalignments: flags(g(9)),
      jdGroupPrimary: txt(g(10)),
      jdGroupSecondary: txt(g(11)),
      skillRatings: ratings,
      keyPatterns: txt(g(29)),
      atsSystem: txt(g(30)),
      atsSpecifics: txt(g(31)),
      analysisDate: txt(g(32)),
      applicantCount: num(g(33)),
      postedDays: num(g(34)),
      overallFitScore: overall,
      rawJdPath: seq != null ? jdPathBySeq.get(seq) ?? null : null,
      status: mapStatus(txt(g(36)), overall !== null),
    };
  });
  const insertedLeads = await db.insert(jobLeads).values(leadRows).returning({ id: jobLeads.id, seq: jobLeads.seq });
  const seqToLead = new Map<number, string>();
  for (const l of insertedLeads) if (l.seq != null) seqToLead.set(l.seq, l.id);
  console.log(`  ✓ job_leads: ${insertedLeads.length}`);

  // Job Requirements — link to lead by "Lead: ID" (col 2 = seq).
  const reqRows = rowsFrom(lws('Job Requirements'), 1, (g) => {
    const seq = num(g(2));
    const leadId = seq != null ? seqToLead.get(seq) : undefined;
    const requirement = txt(g(7));
    if (!leadId || !requirement) return null;
    const tier = txt(g(6));
    return {
      jobLeadId: leadId,
      requirementOrder: num(g(4)),
      rank: tier,
      requirementGroup: tier,
      requirement,
      description: txt(g(8)),
      skills: list(g(9)),
      initialMatchStrength: txt(g(11)),
      initialKeyStrengths: txt(g(12)),
      initialMissingWeak: txt(g(13)),
      initialScore: num(g(14)),
    };
  });
  await insert('job_requirements', jobRequirements, reqRows);

  // Requirements Tailoring — historical, approved (green) calibration examples.
  await insert('requirement_tailoring', requirementTailoring, rowsFrom(lws('Requirements Tailoring'), 1, (g) => {
    const evidence = txt(g(9));
    const bullet = txt(g(12));
    if (!evidence && !bullet) return null;
    return {
      leadTitle: txt(g(1)),
      requirementLine: txt(g(7)),
      connectionToExpertise: txt(g(8)),
      evidenceRef: evidence,
      originalText: txt(g(10)),
      cvPosition: txt(g(11)),
      cvBullet: bullet,
      cvPlacement: txt(g(13)),
      mySkills: list(g(14)),
      // No historical "Requirement Skills" column in the source workbook — stays
      // empty until this lead's C2 is re-run under the new two-column model.
      approvalStatus: 'green' as const,
    };
  }));

  // ── CV variants (reference artifacts) ─────────────────────────────────────
  const cvDir = path.join(ROOT, 'Group CVs');
  if (fs.existsSync(cvDir)) {
    const variantRows = fs
      .readdirSync(cvDir)
      .filter((f) => f.endsWith('.docx'))
      .map((f) => {
        const name = f.replace(/\.docx$/, '');
        const isTemplate = /template/i.test(name);
        return {
          name,
          description: isTemplate ? 'Base template' : 'Role-targeted variant',
          focusJdGroups: (name.match(/SCD|CSEO|OSS|CFPA|TPM|POESG/g) ?? []) as string[],
          storagePath: path.join('cv-variants', f),
        };
      });
    await insert('cv_variants', cvVariants, variantRows);
  }

  // ── CI initiatives (from Process/CI/*.md frontmatter) ─────────────────────
  const ciDir = path.join(ROOT, 'Process', 'CI');
  if (fs.existsSync(ciDir)) {
    const ciRows = fs
      .readdirSync(ciDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => {
        const body = fs.readFileSync(path.join(ciDir, f), 'utf8');
        const fm = (key: string) => body.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim() ?? null;
        return {
          title: fm('ci-title') ?? f.replace(/\.md$/, ''),
          area: fm('ci-area'),
          status: fm('ci-status'),
          priority: fm('ci-priority'),
          estimatedTime: fm('ci-estimated-time'),
          timeSpent: fm('ci-time-spent'),
        };
      });
    await insert('ci_initiatives', ciInitiatives, ciRows);
  }

  await shapeDemoTenant();

  // Populate the coach queue now so the tenant tells the right story on first open
  // (the coach page also regenerates on load; doing it here keeps the seed self-contained).
  await generatePrompts(DEMO_OWNER_ID);
  console.log('  ✓ coach queue generated');
}

/**
 * M0 demo shaping — layer deliberate, believable gaps on the raw import so the
 * strength meter reads mid-band and the coach has specific, varied things to ask,
 * seed one golden-path "ready" CV, and round out the funnel so a few leads sit
 * across stages. Deterministic: the same rows are chosen on every reseed.
 */
async function shapeDemoTenant(): Promise<void> {
  // ── Deliberate, believable evidence gaps ──────────────────────────────────
  // 2 stories lose their quantified result → 2 "add a metric" prompts + an honest impact gap.
  // Guarded: if the workbook's STAR refs ever change shape, the miss is loud, not silent.
  const strippedMetrics = await db
    .update(starResults)
    .set({ metric: null })
    .where(and(eq(starResults.ownerId, DEMO_OWNER_ID), inArray(starResults.starRef, GAP_STORY_REFS)))
    .returning({ id: starResults.id });
  if (strippedMetrics.length === 0)
    console.warn(`  ! no star_results matched GAP_STORY_REFS ${JSON.stringify(GAP_STORY_REFS)} — metric gap not applied`);
  // 6 skills lose their ATS keyword variants → 6 "how else phrased?" prompts + an ATS gap.
  await db.execute(
    sql`UPDATE skills_master SET ats_keyword_variants = '[]'::jsonb
        WHERE owner_id = ${DEMO_OWNER_ID}
          AND ref_code IN (
            SELECT ref_code FROM skills_master WHERE owner_id = ${DEMO_OWNER_ID}
            ORDER BY ref_code LIMIT ${GAP_SKILL_COUNT}
          )`
  );
  // 1 position loses its one-line scope → a "what did you own?" prompt (tier variety).
  await db.execute(
    sql`UPDATE positions SET summary = NULL
        WHERE owner_id = ${DEMO_OWNER_ID}
          AND ref_code IN (
            SELECT ref_code FROM positions WHERE owner_id = ${DEMO_OWNER_ID}
            ORDER BY ref_code DESC LIMIT ${GAP_SUMMARY_COUNT}
          )`
  );

  // ── Golden-path "ready" CV ────────────────────────────────────────────────
  // A fresh seed links no requirement_tailoring to any lead, so every workspace's
  // CV is empty. Attach the real, human-approved (green) tailoring set to one
  // well-matched, high-fit, clean lead so the demo can show a finished CV whose
  // every line traces to approved evidence (the provenance ledger). One bullet per
  // requirement, capped to the 2-page budget.
  const heroRows = (await db.execute(
    sql`SELECT id, title FROM job_leads
        WHERE owner_id = ${DEMO_OWNER_ID}
          AND overall_fit_score IS NOT NULL
          AND jsonb_array_length(coalesce(misalignments, '[]'::jsonb)) = 0
          AND (title ILIKE '%process%' OR title ILIKE '%operation%'
               OR title ILIKE '%transformation%' OR title ILIKE '%change%')
        ORDER BY overall_fit_score DESC NULLS LAST, seq ASC
        LIMIT 1`
  )) as unknown as { id: string; title: string }[];
  const hero = heroRows[0];
  if (hero) {
    await db.execute(
      sql`UPDATE requirement_tailoring SET job_lead_id = ${hero.id}
          WHERE owner_id = ${DEMO_OWNER_ID} AND id IN (
            SELECT id FROM (
              SELECT DISTINCT ON (requirement_line) id, requirement_line
              FROM requirement_tailoring WHERE owner_id = ${DEMO_OWNER_ID}
              ORDER BY requirement_line, id
            ) s ORDER BY requirement_line LIMIT ${READY_CV_LINES}
          )`
    );
    // Compile the .docx + C7 ATS so Download works immediately (mock fixtures when
    // keyless). Guarded — a failure leaves the on-screen ledger intact via the rows.
    try {
      await generateCv(hero.id, DEMO_OWNER_ID);
    } catch (e) {
      console.log('  – ready CV compile skipped:', (e as Error).message.slice(0, 80));
    }
    await db.execute(sql`UPDATE job_leads SET status = 'ready' WHERE id = ${hero.id}`);
    console.log(`  ✓ golden-path CV ready on "${hero.title}"`);
  } else {
    console.warn('  ! no hero lead matched — golden-path CV skipped (check title filters / seed data)');
  }

  // Flag a few stretch roles as targets (M1) — the ones Reggie is chasing but doesn't
  // yet strongly match. This puts the strength meter's relevancy dimension in play with
  // real headroom (ceiling 100, mid-band score) and focuses the coach's demand-pull
  // prompts on the Core/Important requirements those roles ask for and the graph is weak on.
  await db.execute(
    sql`UPDATE job_leads SET is_target = true
        WHERE owner_id = ${DEMO_OWNER_ID} AND id IN (
          SELECT l.id FROM job_leads l
          JOIN job_requirements r ON r.job_lead_id = l.id AND r.rank IN ('Core', 'Important')
          WHERE l.owner_id = ${DEMO_OWNER_ID} AND l.status = 'screened' ${hero ? sql`AND l.id <> ${hero.id}` : sql``}
          GROUP BY l.id
          HAVING count(*) FILTER (
            WHERE r.initial_score < 5 OR r.initial_score IS NULL
              OR coalesce(r.initial_match_strength, '') IN ('Weak', 'No Match')
          ) >= 2
          ORDER BY count(*) FILTER (
            WHERE r.initial_score < 5 OR r.initial_score IS NULL
              OR coalesce(r.initial_match_strength, '') IN ('Weak', 'No Match')
          ) DESC, l.overall_fit_score ASC NULLS LAST
          LIMIT 3
        )`
  );

  // Round out the funnel with a couple of sent applications (clean, non-target leads,
  // not the hero — so the open screening gaps and targets stay in play for the coach).
  await db.execute(
    sql`UPDATE job_leads SET status = 'applied'
        WHERE owner_id = ${DEMO_OWNER_ID} AND id IN (
          SELECT id FROM job_leads
          WHERE owner_id = ${DEMO_OWNER_ID} AND status = 'screened' AND is_target = false
            AND jsonb_array_length(coalesce(misalignments, '[]'::jsonb)) = 0
            ${hero ? sql`AND id <> ${hero.id}` : sql``}
          ORDER BY overall_fit_score DESC NULLS LAST
          LIMIT 2
        )`
  );
  // ── R2 · one deliberately thin era ────────────────────────────────────────
  // Guarantee at least one Excavation invitation exists for the demo. engine5 emits
  // an e5 rediscovery prompt for any titled position with < 2 STAR stories; this seeds
  // one early role with none, so the surfaced invitation card is always demonstrable.
  // Demo fixture only (no fabricated employer/dates) — flagged in docs/rethink/wave-d.html
  // for the owner to confirm or replace with their real early era. Idempotent: wipeOwner
  // clears it each reseed, and the guard skips a re-insert within a run.
  const THIN_ERA_REF = 'P0-early';
  const existingThin = (await db.execute(
    sql`SELECT 1 FROM positions WHERE owner_id = ${DEMO_OWNER_ID} AND ref_code = ${THIN_ERA_REF} LIMIT 1`
  )) as unknown as unknown[];
  if (existingThin.length === 0) {
    await db.insert(positions).values({
      ownerId: DEMO_OWNER_ID,
      refCode: THIN_ERA_REF,
      title: 'Financial Analyst',
      company: 'early career',
      summary: null,
    });
    console.log('  ✓ thin era seeded (R2 excavation invite)');
  }

  // ── R3 · a prior Statement visit ──────────────────────────────────────────
  // Backdate the "last seen the Statement" marker so the board's re-entry banner is
  // demonstrable on first demo load (all seeded activity reads as "since you were last
  // here"). Real users get it stamped the first time they open /statement.
  await db.execute(
    sql`UPDATE profiles SET statement_seen_at = now() - interval '40 days' WHERE id = ${DEMO_OWNER_ID}`
  );

  console.log(
    `  ✓ demo gaps shaped (${GAP_STORY_REFS.length} stories, ${GAP_SKILL_COUNT} skills, ${GAP_SUMMARY_COUNT} summary) + funnel rounded`
  );
}

// Insert helper with logging; skips empty arrays.
async function insert(label: string, table: Parameters<typeof db.insert>[0], rows: unknown[]): Promise<void> {
  if (rows.length === 0) {
    console.log(`  – ${label}: 0 (skipped)`);
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.insert(table).values(rows as any);
  console.log(`  ✓ ${label}: ${rows.length}`);
}

/** Full local seed: rebuild the demo tenant from scratch and ensure its login. */
async function main() {
  console.log('▶ Seeding from workbooks…');
  await wipeOwner(DEMO_OWNER_ID);
  await buildDemoTenant();
  await ensureDemoUser();
  console.log('✓ Seed complete.');
}

// Only auto-run when this file is the CLI entry point — importing it (e.g. from
// scripts/reset.ts to reuse wipeOwner/buildDemoTenant) must not trigger a seed.
if (/[/\\]seed\.(ts|js|mts|cts)$/.test(process.argv[1] ?? '')) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
