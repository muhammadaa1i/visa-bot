import { randomUUID } from 'crypto';

export const VISA_CATEGORIES = Object.freeze({
  SHORT_STAY: 'short_stay',
});

export const CLIENT_STATUS = Object.freeze({
  PENDING: 'pending',
  // Submitted to the site, outcome not yet known. Never retried automatically, to avoid double-booking.
  BOOKING: 'booking',
  AWAITING_EMAIL_CONFIRMATION: 'awaiting_email_confirmation',
  BOOKED: 'booked',
  FAILED: 'failed',
});

/**
 * @param {import('./applicant-details.js').ApplicantDetails & { telegramChatId: number, visaCategory: string }} input
 */
export function createClient({ telegramChatId, familyName, firstName, phone, passportNumber, email, visaCategory }) {
  return {
    id: randomUUID(),
    telegramChatId,
    familyName,
    firstName,
    // For messages and the owner's lists; the booking form gets the two name parts separately.
    fullName: `${familyName} ${firstName}`,
    phone,
    passportNumber,
    email,
    visaCategory,
    status: CLIENT_STATUS.PENDING,
    registeredAt: new Date().toISOString(),
    bookedAt: null,
  };
}
