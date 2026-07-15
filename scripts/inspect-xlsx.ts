import ExcelJS from 'exceljs';

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('text' in o) return String(o.text);
    if ('result' in o) return String(o.result);
    if ('richText' in o && Array.isArray(o.richText))
      return (o.richText as Array<{ text: string }>).map((r) => r.text).join('');
    if ('hyperlink' in o) return String(o.hyperlink);
    return JSON.stringify(v).slice(0, 40);
  }
  return String(v).replace(/\s+/g, ' ').slice(0, 50);
}

async function inspect(file: string, maxRows = 4) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  console.log(`\n${'='.repeat(80)}\nFILE: ${file}\n${'='.repeat(80)}`);
  wb.eachSheet((ws) => {
    console.log(`\n### SHEET: "${ws.name}"  (rows=${ws.rowCount}, cols=${ws.columnCount})`);
    for (let r = 1; r <= Math.min(maxRows, ws.rowCount); r++) {
      const row = ws.getRow(r);
      const vals: string[] = [];
      for (let c = 1; c <= Math.min(ws.columnCount, 40); c++) vals.push(cell(row.getCell(c).value));
      console.log(`  r${r}: ${vals.map((v, i) => `[${i + 1}]${v}`).join(' | ')}`);
    }
  });
}

async function main() {
  await inspect(process.argv[2]);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
