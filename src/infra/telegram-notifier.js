import { Notifier } from '../ports/notifier.port.js';

export class TelegramNotifier extends Notifier {
  /** @param {import('telegraf').Telegraf} bot */
  constructor(bot) {
    super();
    this.bot = bot;
  }

  /** @param {number} chatId @param {string} message */
  async send(chatId, message) {
    await this.bot.telegram.sendMessage(chatId, message);
  }
}
