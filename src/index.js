import path from 'path';
import { fileURLToPath } from 'url';
import { JsonClientRepository } from './infra/json-client-repository.js';
import { TelegramNotifier } from './infra/telegram-notifier.js';
import { PlaywrightSlotBooker } from './infra/playwright-slot-booker.js';
import { SlotSignalFileWatcher } from './infra/slot-signal-file-watcher.js';
import { createJsonLogger } from './infra/json-logger.js';
import { BookSlotsHandler } from './commands/book-slots.handler.js';
import { createTelegramBot } from './bot/telegram-bot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const logger = createJsonLogger();
const botToken = requireEnv('TELEGRAM_BOT_TOKEN');
const ownerChatId = Number(requireEnv('TELEGRAM_CHAT_ID'));
const clientRepository = new JsonClientRepository(path.join(ROOT, 'data', 'clients.json'));

const bot = createTelegramBot({ botToken, ownerChatId, clientRepository });

const bookSlots = new BookSlotsHandler({
  clientRepository,
  slotBooker: new PlaywrightSlotBooker({
    calendarUrl: 'https://uzembassyryouji.rsvsys.jp/reservations/calendar',
    expectedEventId: '20', // VISA Application for short stay (Applicant)
    monthsToCheck: 3,
    logger,
  }),
  notifier: new TelegramNotifier(bot),
  ownerChatId,
  logger,
});

// Written by recon/monitor.js while slots are open.
const slotSignal = new SlotSignalFileWatcher(path.join(ROOT, 'recon', 'out', 'ALERT.txt'), { pollIntervalMs: 2000 });
slotSignal.start(() => {
  logger.info('slots_opened_signal');
  bookSlots.handle().catch((err) => logger.error('booking_run_failed', { errorName: err.name, error: err.message }));
});

bot.launch();
logger.info('bot_started');

const shutdown = (signal) => {
  slotSignal.stop();
  bot.stop(signal);
};
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
