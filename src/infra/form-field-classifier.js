// Recognizes booking-form fields by their label/name so the booker can fill forms it has never seen.
// Anything not positively recognized returns null; the booker refuses to submit if a required
// field is unrecognized, so every pattern here errs toward "don't know" rather than a wrong guess.

export const FIELD_KIND = Object.freeze({
  FULL_NAME: 'full_name',
  EMAIL: 'email',
  EMAIL_CONFIRM: 'email_confirm',
  CONSENT: 'consent',
  NUMBER_OF_PEOPLE: 'number_of_people',
});

// Someone else's details (inviter, employer, emergency contact...) — never fill with the applicant's.
const OTHER_PARTY = /company|organi[sz]ation|hotel|guarantor|invit|employer|school|agency|representative|father|mother|spouse|emergency|会社|勤務|学校|代理|緊急|招へい|организац|компани|работодат|представит/i;
const KANA = /kana|カナ|かな|フリガナ|ふりがな|katakana|hiragana/i;
const PART_OF_NAME = /first[\s_-]?name|given[\s_-]?name|last[\s_-]?name|family[\s_-]?name|middle[\s_-]?name|surname|姓|отчество/i;
const SURNAME_ONLY = (text) => /фамилия|familiya/i.test(text) && !/имя|\bism\b/i.test(text);
const FULL_NAME_EXPLICIT = /full[\s_-]?name|applicant'?s?\s+name|氏名|お名前|名前|фио|ф\.и\.о|полное имя|имя и фамилия|фамилия,?\s+имя|to'?liq ism|ism[\s-]?familiya/i;
const ENGLISH_NAME = /\bname\b/i;
const EMAIL = /e-?mail|\bmail\b|メール|почт|pochta/i;
const CONFIRM = /confirm|確認|again|re-?type|re-?enter|повтор|подтвер|takror|qayta/i;
const CONSENT = /agree|consent|accept|同意|承諾|了承|согла|принима|rozi|qabul qilaman|privacy|個人情報|terms|規約/i;
const PEOPLE_COUNT_LABEL = /人数|number of (people|persons|applicants|visitors)|количество (человек|заявителей)|soni/i;
const PEOPLE_COUNT_NAME = /^(stock|number|num|people|persons)$/i;
const TEXT_TYPES = new Set(['text', 'email', '']);

/**
 * @typedef {{ tag: string, type: string, name: string, label: string, options: string[] }} FormField
 * @param {FormField} field
 * @returns {string|null} a FIELD_KIND, or null if not confidently recognized
 */
export function classifyField(field) {
  const text = `${field.label} ${field.name}`;
  if (OTHER_PARTY.test(text)) return null;

  if (field.tag === 'select') {
    return PEOPLE_COUNT_NAME.test(field.name) || PEOPLE_COUNT_LABEL.test(text) ? FIELD_KIND.NUMBER_OF_PEOPLE : null;
  }
  if (field.tag === 'input' && field.type === 'checkbox') {
    return CONSENT.test(text) ? FIELD_KIND.CONSENT : null;
  }

  const isTextLike = field.tag === 'textarea' || (field.tag === 'input' && TEXT_TYPES.has(field.type));
  if (field.tag === 'input' && field.type === 'email') {
    return CONFIRM.test(text) ? FIELD_KIND.EMAIL_CONFIRM : FIELD_KIND.EMAIL;
  }
  if (!isTextLike) return null;

  if (EMAIL.test(text)) return CONFIRM.test(text) ? FIELD_KIND.EMAIL_CONFIRM : FIELD_KIND.EMAIL;

  if (KANA.test(text) || PART_OF_NAME.test(text) || SURNAME_ONLY(text)) return null;
  if (FULL_NAME_EXPLICIT.test(text) || ENGLISH_NAME.test(text) || field.name.toLowerCase() === 'name') {
    return FIELD_KIND.FULL_NAME;
  }
  return null;
}

/**
 * @param {string} kind a FIELD_KIND
 * @param {{ fullName: string, email: string }} applicant
 * @param {FormField} field
 * @returns {string|boolean|null} the value to enter, or null if we can't supply one
 */
export function valueFor(kind, applicant, field) {
  switch (kind) {
    case FIELD_KIND.FULL_NAME:
      return applicant.fullName;
    case FIELD_KIND.EMAIL:
    case FIELD_KIND.EMAIL_CONFIRM:
      return applicant.email;
    case FIELD_KIND.CONSENT:
      return true;
    case FIELD_KIND.NUMBER_OF_PEOPLE:
      return field.options.includes('1') ? '1' : null;
    default:
      return null;
  }
}
