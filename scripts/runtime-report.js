/**
 * CREATOR-102 authenticated runtime-report. Reuses the developer's EXISTING logged-in
 * Chrome session by launching a persistent context over a read-only COPY of the active
 * profile's session storage (never the live profile). Opens the page, clicks the goal,
 * reads window.__CREATOR_RUNTIME / __CREATOR_LAST_RENDER + the real DOM, screenshots.
 * Live runtime only — no source/bundle. No fake login, no auth bypass.
 *
 *   CREATOR_USER_DATA_DIR=<copied-profile> node scripts/runtime-report.js
 */
const fs = require('fs');
const { chromium } = require('playwright');

const URL = 'http://localhost:3000/command-center/creator-content/image/templates';
const OUT = 'runtime-report.json';
const USER_DATA = process.env.CREATOR_USER_DATA_DIR;

(async () => {
  const report = { url: URL, userDataDir: USER_DATA, mode: 'persistent-context(copied-session)' };
  const ctx = await chromium.launchPersistentContext(USER_DATA, {
    channel: 'chrome', headless: true, viewport: { width: 1366, height: 900 },
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`.slice(0, 300)));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e).slice(0, 300)}`));
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);                       // client auth + render
    report.urlAfterLoad = page.url();
    report.reachedPage = !page.url().includes('/login');
    report.goalScreenText = await page.evaluate(() => document.body.innerText.includes('What do you want to achieve?'));
    await page.screenshot({ path: 'runtime-goal.png' }).catch(() => {});

    if (report.reachedPage && report.goalScreenText) {
      try {
        await page.getByText('Launch a New Product', { exact: false }).first().click({ timeout: 6000 });
        report.clickedGoal = true;
        await page.waitForTimeout(3500);
      } catch (e) { report.clickedGoal = false; report.clickError = String(e).slice(0, 200); }
    } else {
      report.clickedGoal = false;
    }

    report.urlAfterClick = page.url();
    report.runtime = await page.evaluate(() => window.__CREATOR_RUNTIME || []);
    report.lastRender = await page.evaluate(() => window.__CREATOR_LAST_RENDER || null);
    report.domHasSampleGallery = await page.evaluate(() => document.body.innerText.includes('Pick an example you like'));
    report.domShowcaseImgs = await page.evaluate(() => Array.from(document.querySelectorAll('img')).map((i) => i.getAttribute('src') || '').filter((s) => s.includes('creator-showcases')).slice(0, 6));
    await page.screenshot({ path: 'runtime-after-click.png' }).catch(() => {});
    report.consoleTail = logs.slice(-25);
  } catch (e) {
    report.error = String(e).slice(0, 500);
    report.consoleTail = logs.slice(-25);
  }
  await ctx.close();
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ reachedPage: report.reachedPage, clickedGoal: report.clickedGoal, lastRender: report.lastRender, domHasSampleGallery: report.domHasSampleGallery, showcaseImgs: (report.domShowcaseImgs || []).length, runtimeLen: (report.runtime || []).length, urlAfterLoad: report.urlAfterLoad, error: report.error }, null, 2));
})();
