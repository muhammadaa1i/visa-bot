// Runs the real booker against a local fake of the embassy site (never the real one).
import { startFakeSite } from './fake-embassy-site.js';
import { PlaywrightSlotBooker } from '../src/infra/playwright-slot-booker.js';
import { BookSlotsHandler } from '../src/commands/book-slots.handler.js';

const silentLogger = { info() {}, warn() {}, error: (e, f) => console.log('   log.error', e, JSON.stringify(f)) };
const applicant = { fullName: 'TEST PERSON', email: 'test.person@example.com' };

const expectations = {
  simple: { outcome: 'booked', beforeSubmit: 1, detailSubmissions: 1, finalSubmissions: 1 },
  passport: { outcome: 'held_back', beforeSubmit: 0, detailSubmissions: 0, finalSubmissions: 0 },
  katakana: { outcome: 'held_back', beforeSubmit: 0, detailSubmissions: 0, finalSubmissions: 0 },
  'email-link': { outcome: 'awaiting_email_confirmation', beforeSubmit: 1, detailSubmissions: 1, finalSubmissions: 1 },
  rejected: { outcome: 'rejected', beforeSubmit: 1, detailSubmissions: 1, finalSubmissions: 0 },
  'no-open': { outcome: 'no_slot', beforeSubmit: 0, detailSubmissions: 0, finalSubmissions: 0 },
  taken: { outcome: 'no_slot', beforeSubmit: 0, detailSubmissions: 0, finalSubmissions: 0 },
  'book-another': { outcome: 'uncertain', beforeSubmit: 1, detailSubmissions: 1, finalSubmissions: 1 },
};

let failures = 0;
for (const [scenario, expected] of Object.entries(expectations)) {
  const site = await startFakeSite(scenario);
  const booker = new PlaywrightSlotBooker({ calendarUrl: site.url, expectedEventId: '20', monthsToCheck: 1, logger: silentLogger });
  let beforeSubmitCalls = 0;
  const result = await booker.book(applicant, { beforeSubmit: async () => { beforeSubmitCalls++; } });
  site.server.close();

  const actual = { outcome: result.outcome, beforeSubmit: beforeSubmitCalls, ...site.stats };
  const ok = Object.entries(expected).every(([k, v]) => actual[k] === v);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${scenario}: ${JSON.stringify(actual)}`);
  console.log(`     appointment=${JSON.stringify(result.appointment)} reason=${JSON.stringify(result.reason)} unknown=${JSON.stringify(result.unknownFields)}`);
}

// Full handler run: two pending clients, fake repo + notifier, simple form.
{
  const site = await startFakeSite('simple');
  const store = [
    { id: 'c1', telegramChatId: 111, fullName: 'FIRST CLIENT', email: 'first@example.com', status: 'pending' },
    { id: 'c2', telegramChatId: 222, fullName: 'SECOND CLIENT', email: 'second@example.com', status: 'pending' },
    { id: 'c3', telegramChatId: 333, fullName: 'ALREADY BOOKED', email: 'x@example.com', status: 'booked' },
  ];
  const statusHistory = [];
  const repo = {
    findPending: async () => store.filter((c) => c.status === 'pending').map((c) => ({ ...c })),
    update: async (c) => { statusHistory.push(`${c.id}:${c.status}`); store[store.findIndex((s) => s.id === c.id)] = c; },
  };
  const messages = [];
  const notifier = { send: async (chatId, msg) => messages.push(`[${chatId}] ${msg}`) };
  const handler = new BookSlotsHandler({
    clientRepository: repo,
    slotBooker: new PlaywrightSlotBooker({ calendarUrl: site.url, expectedEventId: '20', monthsToCheck: 1, logger: silentLogger }),
    notifier,
    ownerChatId: 999,
    logger: silentLogger,
  });
  await Promise.all([handler.handle(), handler.handle()]); // second call must be ignored while running
  site.server.close();

  const ok = statusHistory.join(',') === 'c1:booking,c1:booked,c2:booking,c2:booked' && site.stats.finalSubmissions === 2;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} handler queue: statuses=${statusHistory.join(',')} finalSubmissions=${site.stats.finalSubmissions}`);
  messages.forEach((m) => console.log(`     ${m}`));
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
