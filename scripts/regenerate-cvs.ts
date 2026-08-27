/**
 * Re-render every stored CV into the current template — the back catalogue, in one
 * pass, at no cost.
 *
 * CI · CV Template Output Format changed the template out from under a set of CVs
 * that were already finished and, in several cases, already sent. Their content was
 * paid for and is unchanged; only the layout moved. `rerenderCv` rebuilds each one
 * from what its run stored, so re-templating the catalogue costs nothing.
 *
 *   npx tsx scripts/regenerate-cvs.ts                  # DRY RUN — says what it would do
 *   npx tsx scripts/regenerate-cvs.ts --apply          # overwrite the stored CVs
 *   npx tsx scripts/regenerate-cvs.ts --apply --only 36e63a67,23074f44
 *   npx tsx scripts/regenerate-cvs.ts --out _local/batch   # write elsewhere, touch nothing
 *
 * DRY RUN IS THE DEFAULT, deliberately. This overwrites deliverables, some of which
 * have been sent to employers.
 *
 * BACKUPS ARE NOT OPTIONAL, and `--apply` always takes one. C5's step report records
 * category names and counts but not the items, so a rendered .docx is the ONLY
 * surviving record of that lead's merged Skills section. Overwrite it with no copy
 * and the grouping is gone; only a paid re-run brings it back. Each file is copied
 * to `tailored.<ISO-timestamp>.bak.docx` beside itself first.
 */
import './_env';
import fs from 'node:fs';
import path from 'node:path';
import { rerenderCv, NotRerenderable, storedCvPath } from '../lib/pipeline/rerender-cv';

const CV_ROOT = () => path.resolve(process.cwd(), process.env.STORAGE_DIR ?? '.storage', 'cv-output');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const apply = process.argv.includes('--apply');
  const outDir = arg('--out');
  const only = (arg('--only') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const root = CV_ROOT();
  if (!fs.existsSync(root)) throw new Error(`No stored CVs under ${root}`);
  const ids = fs.readdirSync(root).filter((id) => (only.length ? only.some((p) => id.startsWith(p)) : true));
  if (ids.length === 0) throw new Error('No stored CVs matched');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const done: string[] = [];
  const skipped: string[] = [];

  console.log(`${apply ? 'APPLYING to' : 'DRY RUN over'} ${ids.length} stored CV(s)${outDir ? ` → ${outDir}` : ''}\n`);

  for (const id of ids.sort()) {
    let r;
    try {
      r = await rerenderCv(id);
    } catch (e) {
      if (e instanceof NotRerenderable) {
        skipped.push(`${id.slice(0, 8)}  ${e.message}`);
        continue;
      }
      throw e;
    }

    const head =
      `${id.slice(0, 8)}  ${String(r.bullets).padStart(2)} bullets · ${String(r.skills).padStart(2)} skills/${r.skillGroups} groups · ` +
      `${r.headshot ? 'headshot' : 'no photo '} · ${r.relocation ? r.relocation.replace(/^·\s*/, '') : 'no relocation line'}`;
    console.log(`${head}\n          ${r.title} — ${r.company}, ${r.city}`);
    for (const w of r.warnings) console.log(`          !  ${w}`);

    if (outDir) {
      fs.mkdirSync(outDir, { recursive: true });
      // Named as it will be downloaded, so a folder of these is reviewable.
      const safe = `${r.company} - ${r.title}`.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').slice(0, 90).trim();
      fs.writeFileSync(path.join(outDir, `${safe}.docx`), r.buffer);
    } else if (apply) {
      const target = storedCvPath(id);
      // The old file is the only record of C5's grouping — copy before clobbering.
      if (fs.existsSync(target)) {
        fs.copyFileSync(target, target.replace(/tailored\.docx$/, `tailored.${stamp}.bak.docx`));
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, r.buffer);
    }
    done.push(id);
  }

  console.log(`\n${'='.repeat(78)}`);
  if (skipped.length) {
    console.log(`SKIPPED ${skipped.length}:`);
    for (const s of skipped) console.log(`  ${s}`);
    console.log('');
  }
  if (outDir) console.log(`${done.length} CV(s) written to ${outDir}. Nothing stored was touched.`);
  else if (apply) console.log(`${done.length} CV(s) rewritten in place. Backups: tailored.${stamp}.bak.docx beside each.`);
  else console.log(`${done.length} CV(s) would be rewritten. Re-run with --apply, or --out <dir> to inspect first.`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
);
