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
const MONTHS_TO_CHECK = 12;
const CALENDAR_URL = 'https://uzembassyryouji.rsvsys.jp/reservations/calendar';

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function notifyDesktop(title, message) {
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
        found.push({ monthLabel: monthLabel.trim(), circleCount });

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        await page.screenshot({ path: path.join(OUT_DIR, `AVAILABLE-${timestamp}.png`), fullPage: true });
        fs.writeFileSync(path.join(OUT_DIR, `AVAILABLE-${timestamp}.html`), await page.content());
      }

      const nextBtn = page.locator('a.next01.js_change_date');
      if (await nextBtn.count() === 0) break;
      await nextBtn.click();
      await page.waitForTimeout(1200);
    }
  } finally {
    await browser.close();
  }

  return found;
}

(async () => {
  log('Monitor run starting...');
  try {
    const found = await checkAvailability();

    if (found.length > 0) {
      const summary = found.map((f) => `${f.monthLabel} (${f.circleCount} slot cell(s))`).join(', ');
      log(`SLOT FOUND: ${summary}`);
      fs.writeFileSync(
        ALERT_FILE,
        `Available slot(s) detected at ${new Date().toISOString()}\n${summary}\n\nOpen ${CALENDAR_URL} now.\nScreenshots/HTML saved in recon/out/AVAILABLE-*.\n`
      );
      notifyDesktop('Visa slot available!', `Found availability: ${summary}. Open the calendar now.`);
      await notifyTelegram(`🚨 Visa slot available!\n${summary}\n\nOpen ${CALENDAR_URL} now.`);
    } else {
      log(`No slots found in the next ${MONTHS_TO_CHECK} months.`);
      if (fs.existsSync(ALERT_FILE)) fs.unlinkSync(ALERT_FILE);
    }
  } catch (err) {
    log(`ERROR: ${err.stack || err.message}`);
  }
  log('Monitor run finished.');
})();
