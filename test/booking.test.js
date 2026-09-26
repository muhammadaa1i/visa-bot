// Runs the real booker against a local fake of the embassy site (never the real one).
import { startFakeSite } from './fake-embassy-site.js';
import { PlaywrightSlotBooker } from '../src/infra/playwright-slot-booker.js';
import { BookSlotsHandler } from '../src/commands/book-slots.handler.js';
import { SlotSignalFileWatcher } from '../src/infra/slot-signal-file-watcher.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

const silentLogger = { info() {}, warn() {}, error: (e, f) => console.log('   log.error', e, JSON.stringify(f)) };
const applicant = {
  familyName: 'PERSON', firstName: 'TEST', fullName: 'PERSON TEST', phone: '+998901234567', passportNumber: 'AB1234567', email: 'test.person@example.com',
};
// Registered before phone/passport were asked for.
const legacyApplicant = { fullName: 'OLD CLIENT', email: 'old.client@example.com' };

// What the live form's two pages must receive (checked on top of the outcome).
const embassySubmitted = (stats) =>
  JSON.stringify(stats.checklist) === JSON.stringify({ checked: ['1', '2', '3'], arrival: '15：00' }) &&
  stats.applicant?.name1 === 'PERSON' && stats.applicant?.name2 === 'TEST' && stats.applicant?.free1 === '+998901234567' &&
  stats.applicant?.free2 === 'AB1234567' && stats.applicant?.email === applicant.email && stats.applicant?.email_confirm === applicant.email &&
  ['note1', 'note2', 'note3', 'note4'].every((k) => stats.applicant[k] === '');

const expectations = {
  simple: { outcome: 'booked', beforeSubmit: 1, detailSubmissions: 1, finalSubmissions: 1 },
  passport: { outcome: 'booked', beforeSubmit: 1, detailSubmissions: 1, finalSubmissions: 1 },
  katakana: { outcome: 'held_back', beforeSubmit: 0, detailSubmissions: 0, finalSubmissions: 0 },
  'email-link': { outcome: 'awaiting_email_confirmation', beforeSubmit: 1, detailSubmissions: 1, finalSubmissions: 1 },
  rejected: { outcome: 'rejected', beforeSubmit: 1, detailSubmissions: 1, finalSubmissions: 0 },
  'no-open': { outcome: 'no_slot', beforeSubmit: 0, detailSubmissions: 0, finalSubmissions: 0 },
  taken: { outcome: 'no_slot', beforeSubmit: 0, detailSubmissions: 0, finalSubmissions: 0 },
  'book-another': { outcome: 'uncertain', beforeSubmit: 1, detailSubmissions: 1, finalSubmissions: 1 },
  popup: { outcome: 'booked', beforeSubmit: 1, detailSubmissions: 1, finalSubmissions: 1 },
  embassy: { outcome: 'booked', beforeSubmit: 1, detailSubmissions: 1, finalSubmissions: 1, check: embassySubmitted },
  'embassy legacy client': { scenario: 'embassy', applicant: legacyApplicant, outcome: 'held_back', beforeSubmit: 0, detailSubmissions: 0, finalSubmissions: 0 },
};

let failures = 0;
for (const [name, { scenario = name, applicant: who = applicant, check, ...expected }] of Object.entries(expectations)) {
  const site = await startFakeSite(scenario);
  const booker = new PlaywrightSlotBooker({ calendarUrl: site.url, expectedEventId: '20', monthsToCheck: 1, logger: silentLogger });
  let beforeSubmitCalls = 0;
  const result = await booker.book(who, { beforeSubmit: async () => { beforeSubmitCalls++; } });
  site.server.close();

  const actual = { outcome: result.outcome, beforeSubmit: beforeSubmitCalls, ...site.stats };
  const ok = Object.entries(expected).every(([k, v]) => actual[k] === v) && (check === undefined || check(site.stats));
  if (!ok) failures++;
  const { checklist, applicant: submitted, ...counts } = actual;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${JSON.stringify(counts)}`);
  if (!ok && check) console.log(`     submitted: ${JSON.stringify({ checklist, submitted })}`);
  console.log(`     appointment=${JSON.stringify(result.appointment)} reason=${JSON.stringify(result.reason)} unknown=${JSON.stringify(result.unknownFields)}`);
}

// Full handler run: an old incomplete record (set aside, not blocking), two complete pending
// clients, fake repo + notifier, simple form.
{
  const site = await startFakeSite('simple');
  const details = { phone: '+998901234567', passportNumber: 'AB1234567' };
  const store = [
    { id: 'c0', telegramChatId: 100, fullName: 'OLD CLIENT', email: 'old@example.com', status: 'pending' },
    { id: 'c1', telegramChatId: 111, familyName: 'CLIENT', firstName: 'FIRST', fullName: 'FIRST CLIENT', email: 'first@example.com', ...details, status: 'pending' },
    { id: 'c2', telegramChatId: 222, familyName: 'CLIENT', firstName: 'SECOND', fullName: 'SECOND CLIENT', email: 'second@example.com', ...details, status: 'pending' },
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

  const ok = statusHistory.join(',') === 'c0:failed,c1:booking,c1:booked,c2:booking,c2:booked' && site.stats.finalSubmissions === 2;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} handler queue: statuses=${statusHistory.join(',')} finalSubmissions=${site.stats.finalSubmissions}`);
  messages.forEach((m) => console.log(`     ${m}`));
}

// The monitor creates the alert file on every opening and deletes it when slots are gone; each
// reappearance must trigger booking (on 2026-09-25 only the very first one ever did).
{
  const file = path.join(os.tmpdir(), `visa-bot-alert-test-${process.pid}.txt`);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let signals = 0;
  const watcher = new SlotSignalFileWatcher(file, { pollIntervalMs: 50 });
  watcher.start(() => signals++);
  for (let i = 0; i < 3; i++) {
    fs.writeFileSync(file, 'open');
    await wait(300);
    fs.writeFileSync(file, 'still open'); // the monitor rewrites it every pass while slots stay open
    await wait(300);
    fs.unlinkSync(file);
    await wait(300);
  }
  watcher.stop();

  const ok = signals === 3;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} slot signal: file appeared 3 times, signals=${signals}`);
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
