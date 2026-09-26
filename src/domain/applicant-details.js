// What the embassy's applicant form asks for (seen live 2026-09-25): family name and first name in
// Latin letters, phone number, email (entered twice) and passport number. Each normalizer returns
// the cleaned value or throws, so /register can check every answer the moment it's typed.

export class InvalidApplicantDetailsError extends Error {
  name = 'InvalidApplicantDetailsError';
}

// Latin letters as in the passport; Uzbek names may carry an apostrophe (Gʻofurov, Oʻktam).
const LATIN_NAME = /^[A-Za-z]+(?:['ʻʼ’`\- ][A-Za-z]+)*$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** @param {string} label */
function latinName(label) {
  return (text) => {
    const value = (text ?? '').trim().replace(/\s+/g, ' ');
    if (!LATIN_NAME.test(value)) {
      throw new InvalidApplicantDetailsError(`${label} must be written in Latin letters, exactly as in the passport.`);
    }
    return value;
  };
}

function phone(text) {
  const value = (text ?? '').trim().replace(/[\s()-]/g, '');
  if (!/^\+?\d{9,15}$/.test(value)) {
    throw new InvalidApplicantDetailsError('Phone number should look like +998901234567.');
  }
  return value;
}

function passportNumber(text) {
  const value = (text ?? '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z0-9]{6,12}$/.test(value) || !/\d/.test(value)) {
    throw new InvalidApplicantDetailsError('Passport number should look like AB1234567.');
  }
  return value;
}

function email(text) {
  const value = (text ?? '').trim();
  if (!EMAIL.test(value)) throw new InvalidApplicantDetailsError('Email address is invalid.');
  return value;
}

export const APPLICANT_FIELDS = Object.freeze({
  familyName: latinName('Family name'),
  firstName: latinName('First name'),
  phone,
  passportNumber,
  email,
});

/** Clients registered before 2026-09-26 have only a full name and email, which the form can't take. */
export function hasAllApplicantDetails(client) {
  return Object.keys(APPLICANT_FIELDS).every((key) => typeof client[key] === 'string' && client[key] !== '');
}

/**
 * @typedef {{ familyName: string, firstName: string, phone: string, passportNumber: string, email: string }} ApplicantDetails
 * @param {Partial<Record<keyof ApplicantDetails, string>>} input
 * @returns {ApplicantDetails}
 */
export function normalizeApplicantDetails(input) {
  return Object.fromEntries(Object.entries(APPLICANT_FIELDS).map(([key, normalize]) => [key, normalize(input[key])]));
}
