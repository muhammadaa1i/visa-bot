import { VISA_CATEGORIES } from '../domain/client.js';
import { RegisterClientValidationError } from '../commands/register-client.handler.js';

const STEPS = Object.freeze({
  AWAITING_NAME: 'awaiting_name',
  AWAITING_EMAIL: 'awaiting_email',
});

/**
 * Orchestrates the multi-step /register wizard over Telegram. Delegates the
 * actual write to RegisterClientHandler once all fields are collected.
 */
export class RegisterConversation {
  /**
   * @param {import('./conversation-state.js').ConversationState} state
   * @param {import('../commands/register-client.handler.js').RegisterClientHandler} registerClientHandler
   */
  constructor(state, registerClientHandler) {
    this.state = state;
    this.registerClientHandler = registerClientHandler;
  }

  /** @param {import('telegraf').Context} ctx */
  async handleRegisterCommand(ctx) {
    this.state.start(ctx.chat.id, STEPS.AWAITING_NAME);
    await ctx.reply("Let's register you for visa slot booking. What's your full name (as on your passport)?");
  }

  /** @param {import('telegraf').Context} ctx */
  async handleText(ctx) {
    const chatId = ctx.chat.id;
    const current = this.state.get(chatId);
    if (!current) return false;

    const text = ctx.message.text?.trim() ?? '';

    if (current.step === STEPS.AWAITING_NAME) {
      if (!text) {
        await ctx.reply('Please send your full name as text.');
        return true;
      }
      this.state.advance(chatId, STEPS.AWAITING_EMAIL, { fullName: text });
      await ctx.reply('Got it. What email address should we use for the booking confirmation?');
      return true;
    }

    if (current.step === STEPS.AWAITING_EMAIL) {
      try {
        await this.registerClientHandler.handle({
          telegramChatId: chatId,
          fullName: current.data.fullName,
          email: text,
          visaCategory: VISA_CATEGORIES.SHORT_STAY,
        });
      } catch (err) {
        if (err instanceof RegisterClientValidationError) {
          await ctx.reply(`${err.message} Please send it again.`);
          return true;
        }
        this.state.clear(chatId);
        throw err;
      }

      this.state.clear(chatId);
      await ctx.reply(
        `You're registered for a short-stay visa appointment, ${current.data.fullName}. We'll book an appointment for you as soon as one opens.`
      );
      return true;
    }

    return false;
  }
}
