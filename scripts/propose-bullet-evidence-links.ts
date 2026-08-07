/**
 * Propose per-bullet evidence provenance for `bullet_evidence` (CI · Real Bullet Evidence
 * Provenance in the Career Graph).
 *
 * A `bullet_bank` row has never recorded which exact `star_action` / `star_result` /
 * `responsibility` / `star_competence` / `star_attribute` / `skills_master` / `star` row it
 * was actually written from — the Career Graph currently falls back to a slot-level guess
 * (CV_SLOT_STAR_REF, see lib/career-graph-view-model.ts). This script closes that gap the
 * same way scripts/propose-skill-star-links.ts closes the skill→STAR one: rank candidates by
 * plain shared-token overlap between the bullet's text and every candidate row's own text,
 * print them for a human to read, and write NOTHING automatically.
 *
 * `bullet_evidence` is provenance data a future Evidence Picker treats as ground truth (CI
 * §2.2) — a wrong confident guess here is worse than a flagged uncertain one, so unlike the
 * skill→STAR script this one has no score-threshold auto-apply at all. The only way to write
 * rows is `--apply-file`, pointing at a JSON file YOU (or whoever reviewed the report) wrote
 * by hand after reading the ranked candidates:
 *
 *   { "C1": [{ "table": "star_actions", "key": "3-1" }, { "table": "star_actions", "key": "3-2" }] }
 *
 * keyed by `bullet_bank.ref_code`. Table values match `bulletEvidence.evidenceTable`:
 * 'responsibilities' | 'stars' | 'star_actions' | 'star_results' | 'star_competences' |
 * 'star_attributes' | 'skills_master'. Re-applying a bullet's key replaces that bullet's rows
 * wholesale (delete-then-insert), so fixing a confirmed mapping is just editing the file and
 * re-running — never a manual DB edit.
 *
 * Usage:
 *   npx tsx scripts/propose-bullet-evidence-links.ts                    # report only
 *   npx tsx scripts/propose-bullet-evidence-links.ts --apply-file x.json  # write confirmed rows from x.json
 */
import './_env';
import fs from 'node:fs';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../lib/db';
import {
  DEMO_OWNER_ID,
  bulletBank,
  bulletEvidence,
  responsibilities,
  stars,
  starActions,
  starResults,
  starCompetences,
  starAttributes,
  skillsMaster,
} from '../lib/db/schema';

const TOP_N = 5; // a bullet can genuinely merge several sources (CI §1: C1 merges three) — show enough to catch that

type EvidenceTable = 'responsibilities' | 'stars' | 'star_actions' | 'star_results' | 'star_competences' | 'star_attributes' | 'skills_master';
type Candidate = { table: EvidenceTable; key: string; label: string; tokens: Set<string> };

const tokens = (s: string): Set<string> => new Set((s || '').toLowerCase().match(/[a-z]{4,}/g) ?? []);
const overlap = (a: Set<string>, b: Set<string>): { n: number; shared: string[] } => {
  const shared = [...a].filter((t) => b.has(t));
  return { n: shared.length, shared };
};

async function main() {
  const applyFileIdx = process.argv.indexOf('--apply-file');
  const applyFile = applyFileIdx !== -1 ? process.argv[applyFileIdx + 1] : null;
  const owner = DEMO_OWNER_ID;

  const [bullets, resp, starRows, actions, results, competences, attributes, skills, existingEvidence] = await Promise.all([
    db.select().from(bulletBank).where(eq(bulletBank.ownerId, owner)).orderBy(bulletBank.refCode),
    db.select().from(responsibilities).where(eq(responsibilities.ownerId, owner)),
    db.select().from(stars).where(eq(stars.ownerId, owner)),
    db.select().from(starActions).where(eq(starActions.ownerId, owner)),
    db.select().from(starResults).where(eq(starResults.ownerId, owner)),
    db.select().from(starCompetences).where(eq(starCompetences.ownerId, owner)),
    db.select().from(starAttributes).where(eq(starAttributes.ownerId, owner)),
    db.select().from(skillsMaster).where(eq(skillsMaster.ownerId, owner)),
    db.select().from(bulletEvidence).where(eq(bulletEvidence.ownerId, owner)),
  ]);

  if (applyFile) {
    await applyConfirmed(applyFile, owner, bullets);
    process.exit(0);
  }

  // One candidate per evidence row, across all six kinds a bullet can point at.
  const candidates: Candidate[] = [];
  for (const r of resp) if (r.refCode && r.text) candidates.push({ table: 'responsibilities', key: r.refCode, label: r.text, tokens: tokens(r.text) });
  for (const s of starRows) if (s.refCode) candidates.push({ table: 'stars', key: s.refCode, label: s.title ?? s.refCode, tokens: tokens(`${s.title ?? ''} ${s.summary ?? ''}`) });
  for (const a of actions) if (a.refCode && a.text) candidates.push({ table: 'star_actions', key: a.refCode, label: a.text, tokens: tokens(a.text) });
  for (const r of results) if (r.refCode && r.text) candidates.push({ table: 'star_results', key: r.refCode, label: r.text, tokens: tokens(r.text) });
  for (const c of competences) if (c.refCode && c.competence) candidates.push({ table: 'star_competences', key: c.refCode, label: c.competence, tokens: tokens(c.competence) });
  for (const a of attributes) if (a.refCode && a.attribute) candidates.push({ table: 'star_attributes', key: a.refCode, label: a.attribute, tokens: tokens(a.attribute) });
  for (const s of skills) if (s.refCode && s.skill) candidates.push({ table: 'skills_master', key: s.refCode, label: s.skill, tokens: tokens(`${s.skill} ${(s.atsKeywordVariants ?? []).join(' ')}`) });

  const confirmedBulletIds = new Set(existingEvidence.map((e) => e.bulletId));
  const pending = bullets.filter((b) => !confirmedBulletIds.has(b.id));

  if (pending.length === 0) {
    console.log('Every bullet already has at least one confirmed bullet_evidence row — nothing to propose.');
    process.exit(0);
  }

  console.log(`${pending.length} of ${bullets.length} bullets have no confirmed evidence source yet.\n`);
  console.log(`Report only — writes nothing. Review, then hand-write a --apply-file JSON for the confirmed mappings.\n`);

  for (const b of pending) {
    const bulletTokens = tokens(b.text ?? '');
    const ranked = candidates
      .map((c) => ({ c, ...overlap(bulletTokens, c.tokens) }))
      .filter((r) => r.n > 0)
      .sort((a, b2) => b2.n - a.n)
      .slice(0, TOP_N);

    console.log(`[${b.refCode ?? '—'}] ${b.text}`);
    if (ranked.length === 0) {
      console.log('    no textual match against any evidence row — needs a manual read, not a keyword guess.\n');
      continue;
    }
    for (const r of ranked) {
      console.log(`    → [${r.c.table}:${r.c.key}] ${r.c.label.slice(0, 90)}${r.c.label.length > 90 ? '…' : ''}  (${r.n} shared term${r.n === 1 ? '' : 's'}: ${r.shared.join(', ')})`);
    }
    console.log('');
  }
}

/** Human-confirmed only. Reads `{ [bulletRefCode]: { table, key }[] }`, resolves ref_codes to
 * ids, validates every evidence ref actually exists (typos fail loudly, not silently), and
 * replaces each named bullet's rows wholesale — never a partial/merged write. */
async function applyConfirmed(path: string, owner: string, bullets: (typeof bulletBank.$inferSelect)[]) {
  const raw = JSON.parse(fs.readFileSync(path, 'utf8')) as Record<string, { table: EvidenceTable; key: string }[]>;
  const bulletByRef = new Map(bullets.filter((b) => b.refCode).map((b) => [b.refCode as string, b]));

  const validators: Record<EvidenceTable, (keys: string[]) => Promise<Set<string>>> = {
    responsibilities: async (keys) => new Set((await db.select({ k: responsibilities.refCode }).from(responsibilities).where(inArray(responsibilities.refCode, keys))).map((r) => r.k as string)),
    stars: async (keys) => new Set((await db.select({ k: stars.refCode }).from(stars).where(inArray(stars.refCode, keys))).map((r) => r.k as string)),
    star_actions: async (keys) => new Set((await db.select({ k: starActions.refCode }).from(starActions).where(inArray(starActions.refCode, keys))).map((r) => r.k as string)),
    star_results: async (keys) => new Set((await db.select({ k: starResults.refCode }).from(starResults).where(inArray(starResults.refCode, keys))).map((r) => r.k as string)),
    star_competences: async (keys) => new Set((await db.select({ k: starCompetences.refCode }).from(starCompetences).where(inArray(starCompetences.refCode, keys))).map((r) => r.k as string)),
    star_attributes: async (keys) => new Set((await db.select({ k: starAttributes.refCode }).from(starAttributes).where(inArray(starAttributes.refCode, keys))).map((r) => r.k as string)),
    skills_master: async (keys) => new Set((await db.select({ k: skillsMaster.refCode }).from(skillsMaster).where(inArray(skillsMaster.refCode, keys))).map((r) => r.k as string)),
  };

  let written = 0;
  for (const [bulletRef, rows] of Object.entries(raw)) {
    const bullet = bulletByRef.get(bulletRef);
    if (!bullet) {
      console.error(`✗ [${bulletRef}] no such bullet_bank ref_code — skipped.`);
      continue;
    }
    const byTable = new Map<EvidenceTable, string[]>();
    for (const r of rows) (byTable.get(r.table) ?? byTable.set(r.table, []).get(r.table)!).push(r.key);
    let allValid = true;
    for (const [table, keys] of byTable) {
      const valid = await validators[table](keys);
      const missing = keys.filter((k) => !valid.has(k));
      if (missing.length) {
        console.error(`✗ [${bulletRef}] ${table} ref(s) not found: ${missing.join(', ')} — skipped, nothing written for this bullet.`);
        allValid = false;
      }
    }
    if (!allValid || rows.length === 0) continue;

    await db.delete(bulletEvidence).where(eq(bulletEvidence.bulletId, bullet.id));
    await db.insert(bulletEvidence).values(
      rows.map((r) => ({ ownerId: owner, bulletId: bullet.id, evidenceTable: r.table, evidenceKey: r.key, source: 'ai_coached' as const }))
    );
    console.log(`✓ [${bulletRef}] wrote ${rows.length} confirmed evidence row${rows.length === 1 ? '' : 's'}.`);
    written += rows.length;
  }
  console.log(`\nDone — ${written} row(s) written.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
