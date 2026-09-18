/**
 * Tracks each chat's in-progress multi-step conversation (e.g. the
 * /register wizard). Single responsibility: hold and mutate per-chat state,
 * nothing else.
 */
export class ConversationState {
  constructor() {
    /** @type {Map<number, { step: string, data: object }>} */
    this.byChat = new Map();
  }

  /** @param {number} chatId @param {string} step @param {object} [data] */
  start(chatId, step, data = {}) {
    this.byChat.set(chatId, { step, data });
  }

  /** @param {number} chatId */
  get(chatId) {
    return this.byChat.get(chatId) ?? null;
  }

  /** @param {number} chatId @param {string} step @param {object} [patch] */
  advance(chatId, step, patch = {}) {
    const current = this.byChat.get(chatId);
    this.byChat.set(chatId, { step, data: { ...current?.data, ...patch } });
  }

  /** @param {number} chatId */
  clear(chatId) {
    this.byChat.delete(chatId);
  }
}
