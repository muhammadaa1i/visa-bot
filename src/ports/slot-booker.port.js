/**
 * Port for booking one appointment for one applicant on the embassy site.
 * `hooks.beforeSubmit` is awaited right before the first submission that carries
 * the applicant's data, so the caller can persist "booking in progress" first.
 * Clients registered before phone/passport were collected lack those fields; the
 * booker then holds back rather than submit an incomplete form.
 *
 * @typedef {{ familyName?: string, firstName?: string, fullName: string, phone?: string, passportNumber?: string, email: string }} Applicant
 */
export class SlotBooker {
  /**
   * @param {Applicant} _applicant
   * @param {{ beforeSubmit: () => Promise<void> }} _hooks
   * @returns {Promise<import('../domain/booking-outcome.js').BookingResult>}
   */
  async book(_applicant, _hooks) {
    throw new Error('not implemented');
  }
}
