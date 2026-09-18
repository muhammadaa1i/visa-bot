export class GetClientsByChatIdHandler {
  /** @param {import('../ports/client-repository.port.js').ClientRepository} clientRepository */
  constructor(clientRepository) {
    this.clientRepository = clientRepository;
  }

  /**
   * @param {{ telegramChatId: number }} query
   * @returns {Promise<import('../domain/client.js').Client[]>}
   */
  async handle(query) {
    return this.clientRepository.findByChatId(query.telegramChatId);
  }
}
