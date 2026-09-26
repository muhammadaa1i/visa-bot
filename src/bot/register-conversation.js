import { VISA_CATEGORIES } from '../domain/client.js';
import { APPLICANT_FIELDS, InvalidApplicantDetailsError } from '../domain/applicant-details.js';

// One question per field of the embassy's applicant form, asked in this order.
const QUESTIONS = Object.freeze([
  { step: 'awaiting_family_name', field: 'familyName', ask: 'Family name (surname), in Latin letters exactly as in the passport?' },
  { step: 'awaiting_first_name', field: 'firstName', ask: 'First name, in Latin letters exactly as in the passport?' },
  { step: 'awaiting_phone', field: 'phone', ask: 'Phone number (e.g. +998901234567)?' },
  { step: 'awaiting_passport', field: 'passportNumber', ask: 'Passport number (e.g. AB1234567)?' },
  { step: 'awaiting_email', field: 'email', ask: 'Email address? The embassy sends the booking confirmation there.' },
]);
const AWAITING_CONFIRMATION = 'awaiting_confirmation';
const YES = /^(yes|y|ha|да|ok)$/i;
const NO = /^(no|n|yo'?q|нет)$/i;

/**
 * Orchestrates the multi-step /register wizard over Telegram: collects every field the embassy
 * form needs, checking each answer as it arrives, then asks the applicant to confirm them all
 * (a typo would make the embassy cancel the booking) before RegisterClientHandler saves them.
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
    this.state.start(ctx.chat.id, QUESTIONS[0].step);
    await ctx.reply(
      "Let's register you for a short-stay visa appointment. Have your passport at hand; the embassy form needs your name, phone, passport number and email.\n\n" +
        QUESTIONS[0].ask
    );
  }

  /** @param {import('telegraf').Context} ctx */
  async handleText(ctx) {
    const chatId = ctx.chat.id;
    const current = this.state.get(chatId);
    if (!current) return false;

    const text = ctx.message.text?.trim() ?? '';
    if (current.step === AWAITING_CONFIRMATION) {
      await this.#handleConfirmation(ctx, current.data, text);
      return true;
    }

    const index = QUESTIONS.findIndex((q) => q.step === current.step);
    if (index === -1) return false;
    const question = QUESTIONS[index];

    let value;
    try {
      value = APPLICANT_FIELDS[question.field](text);
    } catch (err) {
      if (!(err instanceof InvalidApplicantDetailsError)) throw err;
      await ctx.reply(`${err.message} Please send it again.`);
      return true;
    }

    const next = QUESTIONS[index + 1];
    if (next) {
      this.state.advance(chatId, next.step, { [question.field]: value });
      await ctx.reply(next.ask);
      return true;
    }

    this.state.advance(chatId, AWAITING_CONFIRMATION, { [question.field]: value });
    await ctx.reply(summaryOf({ ...current.data, [question.field]: value }));
    return true;
  }

  async #handleConfirmation(ctx, data, text) {
    const chatId = ctx.chat.id;
    if (NO.test(text)) {
      this.state.start(chatId, QUESTIONS[0].step);
      await ctx.reply(`OK, let's start over.\n\n${QUESTIONS[0].ask}`);
      return;
    }
    if (!YES.test(text)) {
      await ctx.reply('Please reply "yes" to register with these details, or "no" to start over.');
      return;
    }

    try {
      await this.registerClientHandler.handle({ telegramChatId: chatId, visaCategory: VISA_CATEGORIES.SHORT_STAY, ...data });
    } finally {
      this.state.clear(chatId);
    }
    await ctx.reply(
      `You're registered, ${data.familyName} ${data.firstName}. We'll book the first short-stay appointment that opens and message you here. Check /mystatus any time.`
    );
  }
}

function summaryOf(data) {
  return [
    'Please check your details. They go into the embassy form exactly like this:',
    '',
    `Family name: ${data.familyName}`,
    `First name: ${data.firstName}`,
    `Phone: ${data.phone}`,
    `Passport number: ${data.passportNumber}`,
    `Email: ${data.email}`,
    '',
    'The bot will also tick the embassy form\'s checklist confirming you have read its notice for applicants.',
    '',
    'Reply "yes" to register, or "no" to start over.',
  ].join('\n');
}
