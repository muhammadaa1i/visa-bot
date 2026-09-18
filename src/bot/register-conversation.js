import { Markup } from 'telegraf';
import { VISA_CATEGORIES } from '../domain/client.js';
import { RegisterClientValidationError } from '../commands/register-client.handler.js';

const STEPS = Object.freeze({
  AWAITING_NAME: 'awaiting_name',
  AWAITING_EMAIL: 'awaiting_email',
  AWAITING_CATEGORY: 'awaiting_category',
});

const CATEGORY_LABELS = Object.freeze({
  [VISA_CATEGORIES.SHORT_STAY]: 'Short stay (tourism/business/family, up to 90 days)',
  [VISA_CATEGORIES.COE]: 'With Certificate of Eligibility (COE)',
  [VISA_CATEGORIES.GOVERNMENT_DOCUMENTS]: 'With Government Documents',
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
      this.state.advance(chatId, STEPS.AWAITING_CATEGORY, { email: text });
      await ctx.reply(
        'Which visa category applies?',
        Markup.inlineKeyboard(
          Object.entries(CATEGORY_LABELS).map(([value, label]) => [Markup.button.callback(label, `register_category:${value}`)])
        )
      );
      return true;
    }

    return false;
  }

  /** @param {import('telegraf').Context} ctx @param {string} visaCategory */
  async handleCategorySelected(ctx, visaCategory) {
    const chatId = ctx.chat.id;
    const current = this.state.get(chatId);
    if (!current || current.step !== STEPS.AWAITING_CATEGORY) {
      await ctx.answerCbQuery('This selection has expired, please run /register again.');
      return;
    }

    try {
      await this.registerClientHandler.handle({
        telegramChatId: chatId,
        fullName: current.data.fullName,
        email: current.data.email,
        visaCategory,
      });
      await ctx.answerCbQuery('Registered!');
      await ctx.editMessageText(
        `You're registered, ${current.data.fullName}. You'll be notified here as soon as we book a slot for you.`
      );
    } catch (err) {
      if (err instanceof RegisterClientValidationError) {
        await ctx.answerCbQuery();
        await ctx.editMessageText(`Couldn't register: ${err.message} Please run /register again.`);
      } else {
        await ctx.answerCbQuery('Something went wrong.');
        throw err;
      }
    } finally {
      this.state.clear(chatId);
    }
  }
}
