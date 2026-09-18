import { createClient, VISA_CATEGORIES } from '../domain/client.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class RegisterClientValidationError extends Error {}

export class RegisterClientHandler {
  /** @param {import('../ports/client-repository.port.js').ClientRepository} clientRepository */
  constructor(clientRepository) {
    this.clientRepository = clientRepository;
  }

  /**
   * @param {{ telegramChatId: number, fullName: string, email: string, visaCategory: string }} command
   * @returns {Promise<string>} the new client's id
   */
  async handle(command) {
    const fullName = command.fullName?.trim();
    if (!fullName) {
      throw new RegisterClientValidationError('Full name is required.');
    }
    if (!EMAIL_PATTERN.test(command.email ?? '')) {
      throw new RegisterClientValidationError('Email address is invalid.');
    }
    if (!Object.values(VISA_CATEGORIES).includes(command.visaCategory)) {
      throw new RegisterClientValidationError('Visa category is invalid.');
    }

    const client = createClient({
      telegramChatId: command.telegramChatId,
      fullName,
      email: command.email.trim(),
      visaCategory: command.visaCategory,
    });

    await this.clientRepository.save(client);
    return client.id;
  }
}
