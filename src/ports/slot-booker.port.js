/**
 * Port for booking one appointment for one applicant on the embassy site.
 * `hooks.beforeSubmit` is awaited right before the first submission that carries
 * the applicant's data, so the caller can persist "booking in progress" first.
 */
export class SlotBooker {
  /**
   * @param {{ fullName: string, email: string }} _applicant
   * @param {{ beforeSubmit: () => Promise<void> }} _hooks
   * @returns {Promise<import('../domain/booking-outcome.js').BookingResult>}
   */
  async book(_applicant, _hooks) {
    throw new Error('not implemented');
  }
}
