import { chromium } from 'playwright';
import { SlotBooker } from '../ports/slot-booker.port.js';
import { BOOKING_OUTCOME } from '../domain/booking-outcome.js';
import { classifyField, valueFor, FIELD_KIND } from './form-field-classifier.js';
import { readBookingPage } from './booking-page-reader.js';

// A date counts as open unless it carries the "not available" mark (the open mark has never been seen live).
const OPEN_DATE = '.sc_cal_month_itemlist .c_cal_time_cell:not(:has(img[src*="icon_disabled"]))';
const OPEN_TIME = 'a.js_move_reserve:not(.js_not_move):not(:has(img[src*="icon_disabled"]))';
const NEXT_MONTH = 'a.next01.js_change_date';
const MAX_PAGES = 6;
const ATTEMPT_TIMEOUT_MS = 180_000;
const STEP_TIMEOUT_MS = 20_000;

const FORWARD_BUTTON = /確認|次へ|進む|予約|申込|申し込|送信|登録|同意|confirm|next|continue|proceed|reserve|book|submit|send|apply|agree|register|далее|продолж|подтвер|отправ|забронир|соглас|keyingi|davom|tasdiq|yubor|band qil|rozi/i;
const BACKWARD_BUTTON = /戻る|キャンセル|修正|取消|閉じる|back|cancel|edit|modify|return|close|назад|отмен|изменить|закрыть|orqaga|bekor|tahrir|yopish/i;
const EMAIL_ACTION_NEEDED = /仮予約|本予約|(click|open|follow|visit).{0,40}(link|url)|(リンク|URL).{0,30}(クリック|アクセス)|перейдите по ссылке|havola(ga|ni)/i;
const BOOKING_DONE = /予約.{0,6}完了|受付.{0,6}完了|予約番号|受付番号|(reservation|booking|appointment).{0,30}(complete|confirmed|accepted|successful)|thank you|бронирован.{0,20}(заверш|подтвержд)|запись.{0,20}(создан|подтвержд)|успешно|muvaffaqiyatli/i;
const APPLICANT_DATA_KINDS = new Set([FIELD_KIND.FULL_NAME, FIELD_KIND.EMAIL, FIELD_KIND.EMAIL_CONFIRM]);

// NOTHING_SENT → (applicant details submitted) → DETAILS_SENT → (confirmation page submitted) → FINAL_SENT.
// After FINAL_SENT the booker only reads the result and never clicks again, so a "book another"
// button on a completion page can never start a second booking.
const PHASE = Object.freeze({ NOTHING_SENT: 'nothing_sent', DETAILS_SENT: 'details_sent', FINAL_SENT: 'final_sent' });

export class BookingTimeoutError extends Error {
  name = 'BookingTimeoutError';
}

export class CalendarChangedError extends Error {
  name = 'CalendarChangedError';
}

export class PopupNotOpenedError extends Error {
  name = 'PopupNotOpenedError';
}

export class PlaywrightSlotBooker extends SlotBooker {
  /**
   * @param {{ calendarUrl: string, expectedEventId: string, monthsToCheck: number, logger: import('./json-logger.js').Logger }} config
   */
  constructor({ calendarUrl, expectedEventId, monthsToCheck, logger }) {
    super();
    this.calendarUrl = calendarUrl;
    this.expectedEventId = expectedEventId;
    this.monthsToCheck = monthsToCheck;
    this.logger = logger;
  }

  async book(applicant, hooks) {
    const browser = await chromium.launch({ headless: true });
    let timer;
    try {
      const page = await (await browser.newContext()).newPage();
      page.setDefaultTimeout(STEP_TIMEOUT_MS);
      const attempt = this.#attempt(page, applicant, hooks);
      // Closing the browser on timeout makes the abandoned attempt reject; that rejection is expected.
      attempt.catch(() => {});
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new BookingTimeoutError(`booking attempt exceeded ${ATTEMPT_TIMEOUT_MS / 1000}s`)), ATTEMPT_TIMEOUT_MS);
      });
      return await Promise.race([attempt, timeout]);
    } finally {
      clearTimeout(timer);
      await browser.close();
    }
  }

  async #attempt(page, applicant, hooks) {
    await page.goto(this.calendarUrl, { waitUntil: 'networkidle', timeout: 60_000 });
    const eventId = await page.locator('input.js-event').first().inputValue();
    if (eventId !== this.expectedEventId) {
      throw new CalendarChangedError(`expected calendar event ${this.expectedEventId}, got ${eventId}`);
    }

    // Text/warnings shared by every page (headers, step indicators like "Input > Confirm > Complete")
    // must not be read as a result, so each page is only judged on what's new compared to the one before.
    let previous = await readBookingPage(page);
    const opened = await this.#openFirstAvailableSlot(page);
    if (opened === null) return { outcome: BOOKING_OUTCOME.NO_SLOT };
    const { appointment } = opened;
    // The form may live in a popup window; from here on every read and click happens there.
    page = opened.formPage;

    let phase = PHASE.NOTHING_SENT;
    for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
      const current = await readBookingPage(page);
      const decision = await this.#decide(page, current, previous, applicant, phase);
      this.logger.info('booking_page', { pageIndex, phase, fields: current.fields.length, action: decision.action });

      if (decision.action === 'done') return { ...decision.result, appointment };
      if (decision.action === 'stop') {
        return phase === PHASE.NOTHING_SENT
          ? { outcome: BOOKING_OUTCOME.HELD_BACK, reason: decision.reason, unknownFields: decision.unknownFields, appointment }
          : { outcome: BOOKING_OUTCOME.UNCERTAIN, reason: `after submitting: ${decision.reason}`, appointment };
      }

      if (decision.nextPhase !== phase && phase === PHASE.NOTHING_SENT) await hooks.beforeSubmit();
      phase = decision.nextPhase;
      await page.locator(decision.button).click();
      await settle(page);
      previous = current;
    }
    return phase === PHASE.NOTHING_SENT
      ? { outcome: BOOKING_OUTCOME.HELD_BACK, reason: `the form went on for more than ${MAX_PAGES} pages`, appointment }
      : { outcome: BOOKING_OUTCOME.UNCERTAIN, reason: `still no result after ${MAX_PAGES} pages`, appointment };
  }

  /**
   * @returns {Promise<{ appointment: string, formPage: import('playwright').Page } | null>}
   *   a readable appointment description and the page the form continues on, or null if nothing is open
   */
  async #openFirstAvailableSlot(page) {
    for (let month = 0; month < this.monthsToCheck; month++) {
      const openDate = page.locator(OPEN_DATE).first();
      if ((await openDate.count()) > 0) {
        const monthLabel = await page.locator('.c_cal_navex_date .date').innerText().catch(() => '');
        const day = await openDate
          .locator('xpath=ancestor::*[contains(@class,"sc_cal_month_itemlist")]//*[contains(@class,"sc_cal_date")]')
          .first()
          .innerText()
          .catch(() => '');
        await openDate.click();
        await settle(page);

        let time = '';
        let formPage = page;
        const openTime = page.locator(OPEN_TIME).first();
        if ((await openTime.count()) > 0) {
          time = await timeOfSlot(openTime);
          formPage = await clickTimeSlot(page, openTime);
        }
        const appointment = [monthLabel, day, time].map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ');
        return { appointment, formPage };
      }
      const next = page.locator(NEXT_MONTH);
      if ((await next.count()) === 0) return null;
      await next.click({ force: true });
      await settle(page);
    }
    return null;
  }

  /**
   * Decides what to do on one page, filling recognized fields as a side effect when continuing.
   * @param {import('./booking-page-reader.js').BookingPageSnapshot} current
   * @param {import('./booking-page-reader.js').BookingPageSnapshot} previous
   */
  async #decide(page, current, previous, applicant, phase) {
    const previousLines = new Set(previous.lines);
    const previousText = previous.lines.join('\n');
    const newLines = current.lines.filter((l) => !previousLines.has(l));
    const newErrors = current.errors.filter((e) => !previousText.includes(e));

    if (newErrors.length > 0) {
      // Before anything is sent, an error almost always means the slot was taken in the meantime.
      const outcome = phase === PHASE.NOTHING_SENT ? BOOKING_OUTCOME.NO_SLOT : BOOKING_OUTCOME.REJECTED;
      return { action: 'done', result: { outcome, reason: newErrors.join(' / ') } };
    }

    const plan = current.fields.map((field) => {
      const kind = classifyField(field);
      return { field, kind, value: kind === null ? null : valueFor(kind, applicant, field) };
    });
    const asksForApplicantData = plan.some((p) => APPLICANT_DATA_KINDS.has(p.kind));
    const unknownRequired = plan.filter((p) => p.field.required && !p.field.hasValue && p.value === null);
    const forward = current.buttons.find((b) => FORWARD_BUTTON.test(b.text) && !BACKWARD_BUTTON.test(b.text));

    if (phase !== PHASE.NOTHING_SENT) {
      if (asksForApplicantData) return { action: 'stop', reason: "the site asked for the applicant's details again" };
      // A confirmation page has no inputs but repeats what we entered; submitting it is the real booking.
      const isConfirmationPage = current.fields.length === 0 && forward !== undefined && current.lines.some((l) => l.includes(applicant.email));
      if (phase === PHASE.DETAILS_SENT && isConfirmationPage) {
        return { action: 'continue', button: forward.handle, nextPhase: PHASE.FINAL_SENT };
      }
      if (newLines.some((l) => EMAIL_ACTION_NEEDED.test(l))) return { action: 'done', result: { outcome: BOOKING_OUTCOME.AWAITING_EMAIL_CONFIRMATION } };
      if (newLines.some((l) => BOOKING_DONE.test(l))) return { action: 'done', result: { outcome: BOOKING_OUTCOME.BOOKED } };
      if (phase === PHASE.FINAL_SENT) return { action: 'stop', reason: 'the site showed no clear result' };
    }

    if (unknownRequired.length > 0) {
      const unknownFields = unknownRequired.map((p) => p.field.label || p.field.name || p.field.type);
      return { action: 'stop', reason: 'the form asks for details the bot does not have', unknownFields };
    }
    if (!forward) return { action: 'stop', reason: 'no button to continue with' };

    for (const { field, value } of plan) {
      if (value === null) continue;
      const target = page.locator(field.handle).first();
      if (field.type === 'checkbox') await target.check();
      else if (field.tag === 'select') await target.selectOption(String(value));
      else await target.fill(String(value));
    }

    const nextPhase = phase === PHASE.NOTHING_SENT && asksForApplicantData ? PHASE.DETAILS_SENT : phase;
    return { action: 'continue', button: forward.handle, nextPhase };
  }
}

// On the live site the time slot is an icon-only link (seen 2026-09-25) whose href carries the time:
// /reservations/option?...&date=2026%2F10%2F06&time_from=15%3A00
async function timeOfSlot(link) {
  const href = await link.getAttribute('href').catch(() => null);
  const fromHref = href ? new URL(href, 'https://placeholder.invalid').searchParams.get('time_from') : null;
  return fromHref ?? (await link.innerText().catch(() => ''));
}

// The live site's time slots carry "js_window_open_for_time": the site's script opens the booking
// form in a popup window (900x700) instead of navigating the calendar tab, so follow it there.
async function clickTimeSlot(page, link) {
  const opensPopup = await link.evaluate((el) => el.classList.contains('js_window_open_for_time'));
  if (!opensPopup) {
    await link.click();
    await settle(page);
    return page;
  }
  const popupOpened = page.waitForEvent('popup', { timeout: STEP_TIMEOUT_MS });
  popupOpened.catch(() => {}); // awaited below; this only stops an early rejection going unhandled
  await link.click();
  const popup = await popupOpened.catch((err) => {
    throw new PopupNotOpenedError(`the time slot did not open the booking window (${err.message})`);
  });
  popup.setDefaultTimeout(STEP_TIMEOUT_MS);
  await settle(popup);
  return popup;
}

// "networkidle" never arrives on pages that keep a request open; the fixed waits still give the page time to render.
async function settle(page) {
  await page.waitForTimeout(500);
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1500);
}
