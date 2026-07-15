/**
 * O3 flow: import (to create gaps) → coach → answer → provenance badges.
 * Run after a clean onboarding_state; caller cleans up imported/coached rows via marker.
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

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--hide-scrollbars'],
  defaultViewport: { width: 1320, height: 1000, deviceScaleFactor: 2 },
});
try {
  const page = await browser.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  if (page.url().includes('/login')) {
    await page.type('input[name="email"]', process.env.APP_EMAIL || '');
    await page.type('input[name="password"]', process.env.APP_PASSWORD || '');
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  }

  // 1 · import the sample to create gaps (skills without ATS variants, positions without summary)
  await page.goto(`${BASE}/profile/onboarding`, { waitUntil: 'networkidle2' });
  await clickText(page, 'Use a sample');
  await sleep(300);
  await clickText(page, 'Extract draft');
  await page.waitForFunction(() => document.body.innerText.includes('nodes kept'), { timeout: 20000 });
  await clickText(page, 'Commit approved');
  await page.waitForFunction(() => document.body.innerText.includes('Added to your Career Graph'), { timeout: 20000 });

  // 2 · coach
  await page.goto(`${BASE}/profile/coach`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.body.innerText.includes('opportunit'), { timeout: 15000 });
  await shot(page, 'o3-coach.png', true);

  // 3 · answer the first target (an ATS skill) so it becomes AI-coached
  await page.type('main input', 'Corporate Governance, Governance Digitisation');
  await clickText(page, 'Add');
  await sleep(1200);
  await shot(page, 'o3-after.png', true);

  // 4 · provenance badges on the skills editor (imported + AI-coached)
  await page.goto(`${BASE}/profile/skills`, { waitUntil: 'networkidle2' });
  await shot(page, 'o3-prov.png');

  console.log('O3 flow OK');
} finally {
  await browser.close();
}
