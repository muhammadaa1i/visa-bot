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

// Slot alerts also go to everyone in SLOT_ALERT_CHAT_IDS (comma-separated numeric chat ids, each of whom
// must have pressed Start in the bot); failure/recovery/heartbeat messages stay with the owner only.
function slotAlertChatIds() {
  const extra = (process.env.SLOT_ALERT_CHAT_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean);
  return [process.env.TELEGRAM_CHAT_ID, ...extra];
}

async function notifyTelegram(message, chatIds = [process.env.TELEGRAM_CHAT_ID]) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatIds[0]) {
    log('WARN: TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set, skipping Telegram notification.');
    return;
  }
  // Sent in parallel so one unreachable recipient doesn't delay the others.
  await Promise.all(chatIds.map(async (chatId) => {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: message }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) log(`WARN: Telegram notification to chat ${chatId} failed: HTTP ${res.status}`);
    } catch (err) {
      log(`WARN: Telegram notification to chat ${chatId} failed: ${err.message}`);
    }
  }));
}

// No open date has ever been observed live, so rather than trusting a guessed "available" icon,
// any date cell whose mark isn't the ✕ counts as possibly open: a false alarm beats a silent miss.
const SHORT_STAY_APPLICANT_EVENT_ID = '20';
const OPEN_CELL ='.sc_cal_month_itemlist .c_cal_time_cell:not(:has(img[src*="icon_disabled"]))';

const MAX_UNEXPECTED_SNAPSHOTS = 20;

async function saveUnexpectedPage(page) {
  const name = `UNEXPECTED-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: true }).catch(() => {});
  fs.writeFileSync(path.join(OUT_DIR, `${name}.html`), await page.content().catch((err) => `[unreadable: ${err.message}]`));

  const old = fs.readdirSync(OUT_DIR).filter((f) => f.startsWith('UNEXPECTED-') && f.endsWith('.html')).sort();
  for (const file of old.slice(0, -MAX_UNEXPECTED_SNAPSHOTS)) {
    fs.rmSync(path.join(OUT_DIR, file), { force: true });
    fs.rmSync(path.join(OUT_DIR, file.replace(/\.html$/, '.png')), { force: true });
  }
  return name;
}

async function checkAvailability() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const found = [];

  try {
    const response = await page.goto(CALENDAR_URL, { waitUntil: 'networkidle', timeout: 60000 });

    // Now and then the site serves a page that isn't the calendar; keep a copy so we can see what it is.
    const eventInput = page.locator('input.js-event').first();
    // The field is type="hidden", so wait for it to exist in the page, not to be visible.
    if (!(await eventInput.waitFor({ state: 'attached', timeout: 10000 }).then(() => true, () => false))) {
      const shot = await saveUnexpectedPage(page);
      const title = await page.title().catch(() => '');
      throw new Error(`Not the calendar page (HTTP ${response?.status() ?? 'none'}, title "${title}", url ${page.url()}); saved ${shot}`);
    }

    // We rely on the site's default calendar being "short stay (Applicant)"; fail loudly if that changes.
    const eventId = await eventInput.inputValue();
    if (eventId !== SHORT_STAY_APPLICANT_EVENT_ID) {
      throw new Error(`Calendar default changed: expected event ${SHORT_STAY_APPLICANT_EVENT_ID} (short stay, Applicant), got ${eventId}`);
    }

    for (let i = 0; i < MONTHS_TO_CHECK; i++) {
      const openCount = await page.locator(OPEN_CELL).count();
      if (openCount > 0) {
        const monthLabel = await page.locator('.c_cal_navex_date .date').innerText().catch(() => `month index ${i}`);
        found.push({ monthIndex: i, monthLabel: monthLabel.replace(/\s+/g, ' ').trim(), openCount });

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

    await page.locator(OPEN_CELL).first().click({ timeout: 15000 });
    await settle();
    await save('02-after-date-click');

    // If the date click opened a time-slot view rather than the form, pick the first open time.
    const timeSlot = page.locator('a.js_move_reserve:not(.js_not_move):not(:has(img[src*="icon_disabled"]))').first();
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

const FAILURE_ALERT_THRESHOLD = 5;
const HEARTBEAT_HOUR_TASHKENT = 9;
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

let lastAlertedSummary = '';
let consecutiveFailures = 0;
let failureAlertSent = false;
let lastHeartbeatDate = '';
let passesSinceHeartbeat = 0;
let failuresSinceHeartbeat = 0;

// A daily "alive" message is the only way to notice the whole server being down: the alert just stops arriving.
async function maybeSendHeartbeat() {
  const tashkentNow = new Date(Date.now() + TASHKENT_OFFSET_MS).toISOString();
  const today = tashkentNow.slice(0, 10);
  const hour = Number(tashkentNow.slice(11, 13));
  if (hour < HEARTBEAT_HOUR_TASHKENT || today === lastHeartbeatDate) return;

  await notifyTelegram(
    `✅ Visa monitor alive.\nChecks since last report: ${passesSinceHeartbeat} (failed: ${failuresSinceHeartbeat}).\n${lastAlertedSummary ? `Open now: ${lastAlertedSummary}` : 'No open slots right now.'}`
  );
  lastHeartbeatDate = today;
  passesSinceHeartbeat = 0;
  failuresSinceHeartbeat = 0;
}

async function recordPassResult(err) {
  passesSinceHeartbeat++;
  if (!err) {
    if (failureAlertSent) await notifyTelegram('✅ Visa monitor recovered, checks are working again.');
    consecutiveFailures = 0;
    failureAlertSent = false;
    return;
  }

  failuresSinceHeartbeat++;
  consecutiveFailures++;
  if (consecutiveFailures >= FAILURE_ALERT_THRESHOLD && !failureAlertSent) {
    await notifyTelegram(
      `⚠️ Visa monitor: the last ${consecutiveFailures} checks failed, so slots may be missed.\nLatest error: ${err.message.slice(0, 300)}`
    );
    failureAlertSent = true;
  }
}

async function runPass() {
  try {
    await checkAndAlert();
    await recordPassResult(null);
  } catch (err) {
    log(`ERROR: ${err.stack || err.message}`);
    await recordPassResult(err);
  }
  await maybeSendHeartbeat();
}

async function checkAndAlert() {
  const found = await checkAvailability();

  if (found.length === 0) {
    log(`No slots found in the next ${MONTHS_TO_CHECK} months.`);
    lastAlertedSummary = '';
    if (fs.existsSync(ALERT_FILE)) fs.unlinkSync(ALERT_FILE);
    return;
  }

  const summary = found.map((f) => `${f.monthLabel} (${f.openCount} date(s) not marked ✕)`).join(', ');
  log(`SLOT FOUND: ${summary}`);
  fs.writeFileSync(
    ALERT_FILE,
    `Available slot(s) detected at ${new Date().toISOString()}\n${summary}\n\nOpen ${CALENDAR_URL} now.\nScreenshots/HTML saved in recon/out/AVAILABLE-*.\n`
  );
  // Alert only when availability changes, so an open slot doesn't spam Telegram every pass.
  if (summary === lastAlertedSummary) return;

  notifyDesktop('Visa slot available!', `Found availability: ${summary}. Open the calendar now.`);
  await notifyTelegram(`🚨 Visa slot available!\n${summary}\n\nOpen ${CALENDAR_URL} now.`, slotAlertChatIds());
  lastAlertedSummary = summary;

  try {
    const dir = await captureBookingFlow(found[0].monthIndex);
    log(`Booking flow captured to ${dir}`);
  } catch (err) {
    log(`ERROR: booking flow capture failed (partial pages may still be saved): ${err.stack || err.message}`);
  }
}

log('Monitor started (continuous mode).');
while (true) {
  await runPass();
  await new Promise((resolve) => setTimeout(resolve, PAUSE_MIN_MS + Math.random() * PAUSE_JITTER_MS));
}
