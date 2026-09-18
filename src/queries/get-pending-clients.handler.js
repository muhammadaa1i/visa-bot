export class GetPendingClientsHandler {
  /** @param {import('../ports/client-repository.port.js').ClientRepository} clientRepository */
  constructor(clientRepository) {
    this.clientRepository = clientRepository;
  }

  /** @returns {Promise<import('../domain/client.js').Client[]>} */
  async handle() {
    return this.clientRepository.findPending();
  }
}
