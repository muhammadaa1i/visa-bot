/**
 * Port for sending a message to a specific recipient. Concrete adapters
 * (Telegram, email, ...) implement this shape.
 */
export class Notifier {
  /** @param {number|string} _recipientId @param {string} _message @returns {Promise<void>} */
  async send(_recipientId, _message) {
    throw new Error('not implemented');
  }
}
