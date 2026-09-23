import { randomUUID } from 'crypto';

export const VISA_CATEGORIES = Object.freeze({
  SHORT_STAY: 'short_stay',
});

export const CLIENT_STATUS = Object.freeze({
  PENDING: 'pending',
  BOOKED: 'booked',
  FAILED: 'failed',
});

/**
 * @param {{ telegramChatId: number, fullName: string, email: string, visaCategory: string }} input
 */
export function createClient({ telegramChatId, fullName, email, visaCategory }) {
  return {
    id: randomUUID(),
    telegramChatId,
    fullName,
    email,
    visaCategory,
    status: CLIENT_STATUS.PENDING,
    registeredAt: new Date().toISOString(),
    bookedAt: null,
  };
}
