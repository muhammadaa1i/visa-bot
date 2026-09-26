import { createClient, VISA_CATEGORIES } from '../domain/client.js';
import { normalizeApplicantDetails, InvalidApplicantDetailsError } from '../domain/applicant-details.js';

export class RegisterClientHandler {
  /** @param {import('../ports/client-repository.port.js').ClientRepository} clientRepository */
  constructor(clientRepository) {
    this.clientRepository = clientRepository;
  }

  /**
   * @param {{ telegramChatId: number, visaCategory: string, familyName: string, firstName: string, phone: string, passportNumber: string, email: string }} command
   * @returns {Promise<string>} the new client's id
   * @throws {InvalidApplicantDetailsError}
   */
  async handle(command) {
    const details = normalizeApplicantDetails(command);
    if (!Object.values(VISA_CATEGORIES).includes(command.visaCategory)) {
      throw new InvalidApplicantDetailsError('Visa category is invalid.');
    }

    const client = createClient({ telegramChatId: command.telegramChatId, visaCategory: command.visaCategory, ...details });
    await this.clientRepository.save(client);
    return client.id;
  }
}
