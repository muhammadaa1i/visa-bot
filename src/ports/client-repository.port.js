/**
 * Port (abstraction) for client persistence. Concrete adapters (JSON file,
 * SQLite, etc.) implement this shape. Callers depend only on this contract,
 * never on a concrete adapter (Dependency Inversion).
 *
 * @typedef {import('../domain/client.js').Client} Client
 */
export class ClientRepository {
  /** @param {Client} _client @returns {Promise<void>} */
  async save(_client) {
    throw new Error('not implemented');
  }

  /** @param {string} _id @returns {Promise<Client|null>} */
  async findById(_id) {
    throw new Error('not implemented');
  }

  /** @param {number} _telegramChatId @returns {Promise<Client[]>} */
  async findByChatId(_telegramChatId) {
    throw new Error('not implemented');
  }

  /** @returns {Promise<Client[]>} */
  async findPending() {
    throw new Error('not implemented');
  }

  /** @param {Client} _client @returns {Promise<void>} */
  async update(_client) {
    throw new Error('not implemented');
  }
}
