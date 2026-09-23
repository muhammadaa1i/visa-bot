import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });

const LOG_FILE = path.join(OUT_DIR, 'monitor.log');
const ALERT_FILE = path.join(OUT_DIR, 'ALERT.txt');
const MONTHS_TO_CHECK = 3;
const CALENDAR_URL = 'https://uzembassyryouji.rsvsys.jp/reservations/calendar';

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function notifyDesktop(title, message) {
  if (process.platform !== 'win32') return;
  const escaped = message.replace(/"/g, '`"');
  const escapedTitle = title.replace(/"/g, '`"');
  execFile('powershell.exe', [
    '-NoProfile',
    '-Command',
    `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show("${escaped}", "${escapedTitle}") | Out-Null`,
  ], (err) => {
    if (err) log(`WARN: desktop notification failed: ${err.message}`);
  });
}

async function notifyTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    log('WARN: TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set, skipping Telegram notification.');
    return;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message }),
    });
    if (!res.ok) log(`WARN: Telegram notification failed: HTTP ${res.status}`);
  } catch (err) {
    log(`WARN: Telegram notification failed: ${err.message}`);
  }
}

async function checkAvailability() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const found = [];

  try {
    await page.goto(CALENDAR_URL, { waitUntil: 'networkidle', timeout: 60000 });

    for (let i = 0; i < MONTHS_TO_CHECK; i++) {
      const circleCount = await page.locator('img[src*="icon_circle"]').count();
      if (circleCount > 0) {
        const monthLabel = await page.locator('.c_cal_navex_date .date').innerText().catch(() => `month index ${i}`);
        found.push({ monthIndex: i, monthLabel: monthLabel.trim(), circleCount });

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        await page.screenshot({ path: path.join(OUT_DIR, `AVAILABLE-${timestamp}.png`), fullPage: true });
        fs.writeFileSync(path.join(OUT_DIR, `AVAILABLE-${timestamp}.html`), await page.content());
      }

      const nextBtn = page.locator('a.next01.js_change_date');
      if (await nextBtn.count() === 0) break;
      await page.keyboard.press('Escape').catch(() => {});
      await nextBtn.click({ force: true, timeout: 15000 });
      await page.waitForTimeout(1500);
    }
  } finally {
    await browser.close();
  }

  return found;
}

// Walks from an open date to the applicant form and saves every page, so the booking
// flow gets recorded while slots are open. Never fills in or submits anything.
async function captureBookingFlow(monthIndex) {
  const dir = path.join(OUT_DIR, `FLOW-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(dir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  const xhr = [];
  page.on('response', async (res) => {
    const req = res.request();
    if (req.resourceType() !== 'xhr' && req.resourceType() !== 'fetch') return;
    const body = await res.text().catch((err) => `[unreadable: ${err.message}]`);
    xhr.push({ method: req.method(), url: req.url(), postData: req.postData(), status: res.status(), body: body.slice(0, 5000) });
  });

  const save = async (name) => {
    await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
    fs.writeFileSync(path.join(dir, `${name}.html`), await page.content());
    fs.appendFileSync(path.join(dir, 'urls.txt'), `${name}: ${page.url()}\n`);
  };
  const settle = async () => {
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);
  };

  try {
    await page.goto(CALENDAR_URL, { waitUntil: 'networkidle', timeout: 60000 });
    for (let i = 0; i < monthIndex; i++) {
      await page.locator('a.next01.js_change_date').click({ force: true, timeout: 15000 });
      await page.waitForTimeout(1500);
    }
    await save('01-month');

    await page.locator('a:has(img[src*="icon_circle"])').first().click({ timeout: 15000 });
    await settle();
    await save('02-after-date-click');

    // If the date click opened a time-slot view rather than the form, pick the first open time.
    const timeSlot = page.locator('a.js_move_reserve:has(img[src*="icon_circle"])').first();
    if (await timeSlot.count() > 0) {
      await timeSlot.click({ timeout: 15000 });
      await settle();
      await save('03-after-time-click');
    }

    const fields = await page.$$eval('form input, form select, form textarea', (els) =>
      els.map((el) => ({ tag: el.tagName.toLowerCase(), type: el.type, name: el.name, required: el.required }))
    );
    fs.writeFileSync(path.join(dir, 'form-fields.json'), JSON.stringify(fields, null, 2));
  } finally {
    fs.writeFileSync(path.join(dir, 'xhr-log.json'), JSON.stringify(xhr, null, 2));
    await browser.close();
  }

  return dir;
}

// Pause between passes so our traffic looks like a person refreshing, not a bot hammering the site.
const PAUSE_MIN_MS = 30_000;
const PAUSE_JITTER_MS = 15_000;

let lastAlertedSummary = '';

async function runPass() {
  try {
    const found = await checkAvailability();

    if (found.length > 0) {
      const summary = found.map((f) => `${f.monthLabel} (${f.circleCount} slot cell(s))`).join(', ');
      log(`SLOT FOUND: ${summary}`);
      fs.writeFileSync(
        ALERT_FILE,
        `Available slot(s) detected at ${new Date().toISOString()}\n${summary}\n\nOpen ${CALENDAR_URL} now.\nScreenshots/HTML saved in recon/out/AVAILABLE-*.\n`
      );
      // Alert only when availability changes, so an open slot doesn't spam Telegram every pass.
      if (summary !== lastAlertedSummary) {
        notifyDesktop('Visa slot available!', `Found availability: ${summary}. Open the calendar now.`);
        await notifyTelegram(`🚨 Visa slot available!\n${summary}\n\nOpen ${CALENDAR_URL} now.`);
        lastAlertedSummary = summary;

        try {
          const dir = await captureBookingFlow(found[0].monthIndex);
          log(`Booking flow captured to ${dir}`);
        } catch (err) {
          log(`ERROR: booking flow capture failed (partial pages may still be saved): ${err.stack || err.message}`);
        }
      }
    } else {
      log(`No slots found in the next ${MONTHS_TO_CHECK} months.`);
      lastAlertedSummary = '';
      if (fs.existsSync(ALERT_FILE)) fs.unlinkSync(ALERT_FILE);
    }
  } catch (err) {
    log(`ERROR: ${err.stack || err.message}`);
  }
}

log('Monitor started (continuous mode).');
while (true) {
  await runPass();
  await new Promise((resolve) => setTimeout(resolve, PAUSE_MIN_MS + Math.random() * PAUSE_JITTER_MS));
}
