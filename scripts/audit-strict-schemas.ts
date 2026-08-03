/**
 * The static audit from CI · "Complete `required` Lists on the Remaining Strict
 * Tool Schemas" §2.1, as a runnable check rather than a hand-maintained table.
 *
 * Walks every exported `*.tool` where `strict === true` and, at each
 * `{type:'object', properties}` node, reports the properties missing from
 * `required`. Under `strict: true` an incomplete `required` list does NOT make
 * the omitted fields optional — it degrades the constrained grammar, and
 * generation collapses to a near-empty result that is still schema-valid, so
 * nothing downstream catches it.
 *
 * No API calls, no DB. Exits non-zero when anything is missing, so it can gate.
 *
 * Usage:  npx tsx scripts/audit-strict-schemas.ts
 */
import * as schemas from '../lib/llm/schemas';

type Finding = { schema: string; path: string; missing: string[] };

const findings: Finding[] = [];

function walk(schemaName: string, node: unknown, path: string): void {
  if (!node || typeof node !== 'object') return;
  const n = node as Record<string, unknown>;

  if (n.type === 'object' && n.properties && typeof n.properties === 'object') {
    const declared = Object.keys(n.properties as Record<string, unknown>);
    const required = new Set((Array.isArray(n.required) ? n.required : []) as string[]);
    const missing = declared.filter((k) => !required.has(k));
    if (missing.length) findings.push({ schema: schemaName, path, missing });
    for (const [key, child] of Object.entries(n.properties as Record<string, unknown>)) {
      walk(schemaName, child, `${path}.${key}`);
    }
  }

  if (n.type === 'array' && n.items) walk(schemaName, n.items, `${path}[]`);
}

let strictCount = 0;
for (const [name, value] of Object.entries(schemas)) {
  const tool = (value as { tool?: { strict?: boolean; input_schema?: unknown } })?.tool;
  if (!tool || tool.strict !== true) continue;
  strictCount++;
  walk(name, tool.input_schema, 'root');
}

console.log(`\nStrict tool schemas audited: ${strictCount}\n`);
if (findings.length === 0) {
  console.log('Clean — every declared property is listed in its `required` array.\n');
  process.exit(0);
}

console.log('| Schema | Path | MISSING from `required` |');
console.log('| --- | --- | --- |');
for (const f of findings) console.log(`| \`${f.schema}\` | \`${f.path}\` | ${f.missing.map((m) => `\`${m}\``).join(', ')} |`);
console.log(`\n${findings.length} object node(s) with an incomplete \`required\` list.\n`);
process.exit(1);
