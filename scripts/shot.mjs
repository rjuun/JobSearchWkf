/**
 * Scripted screenshots for the friendly phase HTMLs. Drives the system Chrome headless via
 * puppeteer-core (no Chromium download), logs in, and writes PNGs to docs/phases/img/.
 *
 * Usage:  node scripts/shot.mjs '[{"url":"/profile","out":"o1-home.png"}, ...]'
 * Shot:   { url, out, width?, height?, fullPage?, selector?, delay? }
 * Env:    APP_EMAIL / APP_PASSWORD (auto-loaded from .env.local), SHOT_BASE, SHOT_OUTDIR
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

function loadEnv() {
  try {
    for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
    }
  } catch {}
}
loadEnv();

const CHROME =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.SHOT_BASE || 'http://localhost:3000';
const OUTDIR = process.env.SHOT_OUTDIR || 'docs/phases/img';
const shots = JSON.parse(process.argv[2] || '[]');

fs.mkdirSync(OUTDIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--hide-scrollbars'],
  defaultViewport: { width: 1320, height: 900, deviceScaleFactor: 2 },
});

try {
  const page = await browser.newPage();

  // Log in (session cookie persists for the rest of the run).
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  if (page.url().includes('/login')) {
    await page.type('input[name="email"]', process.env.APP_EMAIL || '');
    await page.type('input[name="password"]', process.env.APP_PASSWORD || '');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
      page.click('button[type="submit"]').catch(() => page.click('button')),
    ]);
  }

  for (const s of shots) {
    await page.setViewport({ width: s.width || 1320, height: s.height || 900, deviceScaleFactor: 2 });
    await page.goto(`${BASE}${s.url}`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, s.delay || 700));
    const out = path.join(OUTDIR, s.out);
    if (s.selector) {
      const el = await page.$(s.selector);
      if (!el) throw new Error(`selector not found: ${s.selector} on ${s.url}`);
      await el.screenshot({ path: out });
    } else {
      await page.screenshot({ path: out, fullPage: !!s.fullPage });
    }
    const kb = Math.round(fs.statSync(out).size / 1024);
    console.log(`shot: ${out}  ←  ${s.url}  (${kb} KB)`);
  }
} finally {
  await browser.close();
}
