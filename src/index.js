import path from 'path';
import { fileURLToPath } from 'url';
import { JsonClientRepository } from './infra/json-client-repository.js';
import { createTelegramBot } from './bot/telegram-bot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const botToken = requireEnv('TELEGRAM_BOT_TOKEN');
const ownerChatId = Number(requireEnv('TELEGRAM_CHAT_ID'));
const clientRepository = new JsonClientRepository(path.join(__dirname, '..', 'data', 'clients.json'));

const bot = createTelegramBot({ botToken, ownerChatId, clientRepository });

bot.launch();
console.log('visa-bot Telegram bot started.');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
