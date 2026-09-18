import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });

const events = [];

function logXhr(req, res, body) {
  events.push({
    method: req.method(),
    url: req.url(),
    postData: req.postData(),
    status: res ? res.status() : null,
    body,
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('response', async (res) => {
    const req = res.request();
    if (req.resourceType() === 'xhr' || req.resourceType() === 'fetch') {
      let body = null;
      try {
        body = await res.text();
        if (body.length > 3000) body = body.slice(0, 3000) + '...[truncated]';
      } catch (e) {
        body = `[err ${e.message}]`;
      }
      logXhr(req, res, body);
    }
  });

  await page.goto('https://uzembassyryouji.rsvsys.jp/reservations/calendar', {
    waitUntil: 'networkidle',
  });

  console.log('Loaded. Searching for a month with an available (circle icon) date, up to 12 months ahead...');

  let foundAvailable = false;
  for (let i = 0; i < 12 && !foundAvailable; i++) {
    const availableCount = await page.locator('img[alt*="Available"][src*="icon_circle"], .sc_cal_time_cell img[src*="circle"]').count();
    const anyCircle = await page.locator('img[src*="icon_circle"]').count();
    console.log(`Month index ${i}: circle-icon images found = ${anyCircle}`);
    if (anyCircle > 0) {
      foundAvailable = true;
      break;
    }
    // click next month
    const nextBtn = page.locator('a.next01.js_change_date');
    if (await nextBtn.count() === 0) {
      console.log('No next-month button found, stopping.');
      break;
    }
    await nextBtn.click();
    await page.waitForTimeout(1500);
  }

  await page.screenshot({ path: path.join(OUT_DIR, '02-month-search.png'), fullPage: true });
  fs.writeFileSync(path.join(OUT_DIR, '02-month-search.html'), await page.content());

  console.log('foundAvailable =', foundAvailable);

  if (foundAvailable) {
    // find the clickable available date cell/link and click it
    const availableLink = page.locator('a:has(img[src*="icon_circle"])').first();
    const count = await availableLink.count();
    console.log('Clickable available links found:', count);
    if (count > 0) {
      await availableLink.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: path.join(OUT_DIR, '03-after-date-click.png'), fullPage: true });
      fs.writeFileSync(path.join(OUT_DIR, '03-after-date-click.html'), await page.content());
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, 'walkthrough-xhr-log.json'), JSON.stringify(events, null, 2));
  console.log(`Captured ${events.length} XHR events.`);

  await browser.close();
})().catch((err) => {
  console.error('ERROR:', err);
  fs.writeFileSync(path.join(OUT_DIR, 'walkthrough-xhr-log-partial.json'), JSON.stringify(events, null, 2));
  process.exit(1);
});
