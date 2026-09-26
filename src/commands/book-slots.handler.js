import { CLIENT_STATUS } from '../domain/client.js';
import { BOOKING_OUTCOME } from '../domain/booking-outcome.js';
import { hasAllApplicantDetails } from '../domain/applicant-details.js';

const PAUSE_BETWEEN_CLIENTS_MS = 3000;

/**
 * Books appointments for pending clients, oldest registration first, one slot each,
 * until slots run out. Each client is marked BOOKING before their details are submitted,
 * and a client in BOOKING is never retried automatically, so a crash can't double-book.
 */
export class BookSlotsHandler {
  #running = false;

  /**
   * @param {{
   *   clientRepository: import('../ports/client-repository.port.js').ClientRepository,
   *   slotBooker: import('../ports/slot-booker.port.js').SlotBooker,
   *   notifier: import('../ports/notifier.port.js').Notifier,
   *   ownerChatId: number,
   *   logger: import('../infra/json-logger.js').Logger,
   * }} deps
   */
  constructor({ clientRepository, slotBooker, notifier, ownerChatId, logger }) {
    this.clientRepository = clientRepository;
    this.slotBooker = slotBooker;
    this.notifier = notifier;
    this.ownerChatId = ownerChatId;
    this.logger = logger;
  }

  async handle() {
    if (this.#running) return;
    this.#running = true;
    try {
      await this.#bookQueue();
    } finally {
      this.#running = false;
    }
  }

  async #bookQueue() {
    const pending = await this.clientRepository.findPending();
    this.logger.info('booking_run_started', { pendingClients: pending.length });
    if (pending.length === 0) {
      await this.#tellOwner('🤖 Slots are open, but there are no pending clients to book for.');
      return;
    }

    // An incomplete record would make the booker hold back, which stops the whole queue, so set it
    // aside first; the applicant is asked to register again (a new, complete record).
    const bookable = [];
    for (const client of pending) {
      if (hasAllApplicantDetails(client)) bookable.push(client);
      else await this.#setAsideIncomplete(client);
    }

    for (const [index, client] of bookable.entries()) {
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, PAUSE_BETWEEN_CLIENTS_MS));
      const keepGoing = await this.#bookOne(client);
      if (!keepGoing) break;
    }
  }

  async #setAsideIncomplete(client) {
    const reason = 'registered before phone and passport number were collected';
    await this.clientRepository.update({ ...client, status: CLIENT_STATUS.FAILED, lastBookingError: reason });
    this.logger.warn('client_set_aside_incomplete', { clientId: client.id });
    await this.#tellClient(
      client,
      `⚠️ The embassy form now needs your phone number and passport number, which we don't have for you. Please send /register again so we can book for you.`
    );
    await this.#tellOwner(`⚠️ Skipped ${client.fullName}: ${reason}. They've been asked to /register again.`);
  }

  /** @returns {Promise<boolean>} whether to continue with the next client */
  async #bookOne(client) {
    let submitted = false;
    const beforeSubmit = async () => {
      await this.clientRepository.update({ ...client, status: CLIENT_STATUS.BOOKING, bookingStartedAt: new Date().toISOString() });
      submitted = true;
    };

    let result;
    try {
      const { familyName, firstName, fullName, phone, passportNumber, email } = client;
      result = await this.slotBooker.book({ familyName, firstName, fullName, phone, passportNumber, email }, { beforeSubmit });
    } catch (err) {
      this.logger.error('booking_attempt_crashed', { clientId: client.id, submitted, errorName: err.name, error: err.message });
      await this.#tellOwner(
        submitted
          ? `⚠️ Booking for ${client.fullName} crashed AFTER their details were submitted (${err.name}). Check the site or their email to see if it went through. They're marked "booking" and won't be retried automatically.`
          : `⚠️ Booking for ${client.fullName} failed before anything was submitted (${err.name}: ${err.message}). They stay in the queue. Book by hand if slots are still open.`
      );
      return true;
    }

    this.logger.info('booking_attempt_finished', { clientId: client.id, outcome: result.outcome, submitted });
    return this.#applyResult(client, result);
  }

  async #applyResult(client, result) {
    const when = result.appointment ? ` for ${result.appointment}` : '';

    switch (result.outcome) {
      case BOOKING_OUTCOME.BOOKED:
        await this.clientRepository.update({ ...client, status: CLIENT_STATUS.BOOKED, bookedAt: new Date().toISOString(), appointment: result.appointment ?? null });
        await this.#tellClient(client, `✅ Your visa appointment is booked${when}. The embassy will send details to ${client.email}.`);
        await this.#tellOwner(`✅ Booked ${client.fullName}${when}.`);
        return true;

      case BOOKING_OUTCOME.AWAITING_EMAIL_CONFIRMATION:
        await this.clientRepository.update({ ...client, status: CLIENT_STATUS.AWAITING_EMAIL_CONFIRMATION, appointment: result.appointment ?? null });
        await this.#tellClient(
          client,
          `⏳ Your appointment${when} is reserved, but you must confirm it NOW: open the email from the embassy at ${client.email} and click the link inside. Otherwise it may be cancelled.`
        );
        await this.#tellOwner(`⏳ Reserved ${client.fullName}${when}. The site wants them to click a link in their email. They've been told; follow up if needed.`);
        return true;

      case BOOKING_OUTCOME.NO_SLOT:
        await this.#tellOwner(`🤖 No open slot left when booking for ${client.fullName}${result.reason ? ` (site said: ${result.reason})` : ''}. They stay in the queue.`);
        return false;

      case BOOKING_OUTCOME.HELD_BACK: {
        const fields = result.unknownFields?.length ? `\nIt asks for: ${result.unknownFields.join('; ')}` : '';
        await this.#tellOwner(
          `✋ Didn't auto-book: ${result.reason}.${fields}\nNothing was submitted. Book by hand now, and send me this message so the bot can learn these fields.`
        );
        return false;
      }

      case BOOKING_OUTCOME.REJECTED:
        await this.clientRepository.update({ ...client, status: CLIENT_STATUS.FAILED, lastBookingError: result.reason ?? null });
        await this.#tellOwner(`❌ The site rejected the booking for ${client.fullName}: ${result.reason}. Marked failed; check their details.`);
        return true;

      case BOOKING_OUTCOME.UNCERTAIN:
        await this.#tellOwner(
          `⚠️ Submitted a booking for ${client.fullName}${when} but couldn't confirm the result (${result.reason}). Check the site or their email. They're marked "booking" and won't be retried automatically.`
        );
        return true;

      default:
        throw new Error(`Unknown booking outcome: ${result.outcome}`);
    }
  }

  async #tellClient(client, message) {
    await this.#send(client.telegramChatId, message, { clientId: client.id });
  }

  async #tellOwner(message) {
    await this.#send(this.ownerChatId, message, {});
  }

  // A failed Telegram message must not stop the remaining clients from being booked.
  async #send(chatId, message, logFields) {
    try {
      await this.notifier.send(chatId, message);
    } catch (err) {
      this.logger.error('notification_failed', { ...logFields, errorName: err.name, error: err.message });
    }
  }
}
