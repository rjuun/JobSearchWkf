/**
 * Drives the O2 onboarding flow end-to-end and captures the review screenshots:
 *   import → extract → curation gate → commit → done → graph.
 * Run after a clean onboarding_state. Commits a real (sample) draft — caller cleans up via marker.
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://localhost:3000';
const OUT = 'docs/phases/img';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--hide-scrollbars'],
  defaultViewport: { width: 1320, height: 1100, deviceScaleFactor: 2 },
});

const clickText = (page, t) =>
  page.evaluate((txt) => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().includes(txt));
    if (!b) throw new Error('button not found: ' + txt);
    b.click();
  }, t);
async function shot(page, name, full = false) {
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, name), fullPage: full });
  console.log('shot:', name);
}

try {
  const page = await browser.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  if (page.url().includes('/login')) {
    await page.type('input[name="email"]', process.env.APP_EMAIL || '');
    await page.type('input[name="password"]', process.env.APP_PASSWORD || '');
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  }

  // Step 1 · import
  await page.goto(`${BASE}/profile/onboarding`, { waitUntil: 'networkidle2' });
  await shot(page, 'o2-import.png');

  // fill sample + extract
  await clickText(page, 'Use a sample');
  await sleep(300);
  await clickText(page, 'Extract draft');
  await page.waitForFunction(() => document.body.innerText.includes('nodes kept'), { timeout: 20000 });
  await shot(page, 'o2-gate.png', true);

  // commit
  await clickText(page, 'Commit approved');
  await page.waitForFunction(() => document.body.innerText.includes('Added to your Career Graph'), { timeout: 20000 });
  await shot(page, 'o2-done.png');

  // resulting graph
  await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle2' });
  await shot(page, 'o2-graph.png');

  console.log('O2 flow OK');
} finally {
  await browser.close();
}
