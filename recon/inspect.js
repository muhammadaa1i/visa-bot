import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });

const requests = [];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('request', (req) => {
    requests.push({
      type: 'request',
      method: req.method(),
      url: req.url(),
      headers: req.headers(),
      postData: req.postData(),
      resourceType: req.resourceType(),
    });
  });

  page.on('response', async (res) => {
    const req = res.request();
    if (['xhr', 'fetch', 'document'].includes(req.resourceType())) {
      let body = null;
      try {
        const ct = res.headers()['content-type'] || '';
        if (ct.includes('json') || ct.includes('text')) {
          body = await res.text();
          if (body.length > 5000) body = body.slice(0, 5000) + '...[truncated]';
        }
      } catch (e) {
        body = `[error reading body: ${e.message}]`;
      }
      requests.push({
        type: 'response',
        status: res.status(),
        url: res.url(),
        headers: res.headers(),
        body,
      });
    }
  });

  console.log('Navigating to calendar page...');
  await page.goto('https://uzembassyryouji.rsvsys.jp/reservations/calendar', {
    waitUntil: 'networkidle',
    timeout: 60000,
  });

  await page.screenshot({ path: path.join(OUT_DIR, '01-initial.png'), fullPage: true });
  fs.writeFileSync(path.join(OUT_DIR, '01-initial.html'), await page.content());

  console.log('Page title:', await page.title());
  console.log('Current URL:', page.url());

  // Dump visible text to understand structure
  const bodyText = await page.innerText('body').catch(() => '');
  fs.writeFileSync(path.join(OUT_DIR, '01-initial-text.txt'), bodyText);

  await page.waitForTimeout(2000);

  fs.writeFileSync(path.join(OUT_DIR, 'network-log.json'), JSON.stringify(requests, null, 2));
  console.log(`Captured ${requests.length} network events. See recon/out/`);

  await browser.close();
})().catch((err) => {
  console.error('ERROR:', err);
  fs.writeFileSync(path.join(OUT_DIR, 'network-log-partial.json'), JSON.stringify(requests, null, 2));
  process.exit(1);
});
