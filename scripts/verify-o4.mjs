/**
 * O4 multi-tenant isolation: the demo user sees their full graph; a brand-new signup sees an
 * empty, isolated graph. Captures o4-demo / o4-signup / o4-new-user. Caller deletes the test user.
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
const TEST_EMAIL = 'alex.rivera.demo@example.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clickText = (page, t) =>
  page.evaluate((txt) => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().includes(txt));
    if (!b) throw new Error('button not found: ' + txt);
    b.click();
  }, t);
async function shot(page, name) {
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, name) });
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

  // 1 · demo user sees their full graph
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  await page.type('input[name="email"]', process.env.APP_EMAIL || '');
  await page.type('input[name="password"]', process.env.APP_PASSWORD || '');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }), page.click('button[type="submit"]')]);
  await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle2' });
  await shot(page, 'o4-demo.png');

  // 2 · log out (clear cookies) and sign up a new user
  const cs = await page.cookies();
  if (cs.length) await page.deleteCookie(...cs);
  await page.goto(`${BASE}/signup`, { waitUntil: 'networkidle2' });
  await shot(page, 'o4-signup.png');
  await page.type('input[name="name"]', 'Alex Rivera');
  await page.type('input[name="email"]', TEST_EMAIL);
  await page.type('input[name="password"]', 'graph1234');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), clickText(page, 'Create account')]);

  // 3 · the new user's graph is empty + isolated
  await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle2' });
  await shot(page, 'o4-new-user.png');

  const txt = await page.evaluate(() => document.body.innerText);
  console.log('new-user sees own name:', txt.includes('Alex Rivera'));
  console.log('new-user graph empty (no STAR stories from demo):', !txt.includes('Servicing Center in Portugal'));
  console.log('O4 flow OK');
} finally {
  await browser.close();
}
