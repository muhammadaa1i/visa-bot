export const BOOKING_OUTCOME = Object.freeze({
  BOOKED: 'booked',
  // Site accepted it but wants the applicant to click a link in their email to finalize.
  AWAITING_EMAIL_CONFIRMATION: 'awaiting_email_confirmation',
  // Nothing open by the time we got there. Nothing was submitted.
  NO_SLOT: 'no_slot',
  // The form needs something we can't safely fill. Nothing was submitted.
  HELD_BACK: 'held_back',
  // We submitted and the site showed errors.
  REJECTED: 'rejected',
  // We submitted but couldn't tell whether it went through.
  UNCERTAIN: 'uncertain',
});

/**
 * @typedef {{
 *   outcome: string,
 *   appointment?: string,
 *   reason?: string,
 *   unknownFields?: string[],
 * }} BookingResult
 */
