const STATUS_LABELS = Object.freeze({
  pending: 'waiting for a slot',
  booked: 'booked ✅',
  failed: 'booking failed ⚠️',
});

export class StatusCommands {
  /**
   * @param {import('../queries/get-clients-by-chat-id.handler.js').GetClientsByChatIdHandler} getClientsByChatId
   * @param {import('../queries/get-pending-clients.handler.js').GetPendingClientsHandler} getPendingClients
   * @param {number} ownerChatId
   */
  constructor(getClientsByChatId, getPendingClients, ownerChatId) {
    this.getClientsByChatId = getClientsByChatId;
    this.getPendingClients = getPendingClients;
    this.ownerChatId = ownerChatId;
  }

  /** @param {import('telegraf').Context} ctx */
  async handleMyStatus(ctx) {
    const clients = await this.getClientsByChatId.handle({ telegramChatId: ctx.chat.id });
    if (clients.length === 0) {
      await ctx.reply("You're not registered yet. Send /register to get started.");
      return;
    }
    const lines = clients.map((c) => `- ${c.fullName} (${c.visaCategory}): ${STATUS_LABELS[c.status] ?? c.status}`);
    await ctx.reply(lines.join('\n'));
  }

  /** @param {import('telegraf').Context} ctx */
  async handleListPending(ctx) {
    if (ctx.chat.id !== this.ownerChatId) {
      await ctx.reply('This command is restricted.');
      return;
    }
    const pending = await this.getPendingClients.handle();
    if (pending.length === 0) {
      await ctx.reply('No pending clients.');
      return;
    }
    const lines = pending.map((c, i) => `${i + 1}. ${c.fullName} <${c.email}> — ${c.visaCategory}`);
    await ctx.reply(lines.join('\n'));
  }
}
