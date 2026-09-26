// Recognizes booking-form fields by their label/name so the booker can fill forms it has never seen.
// Anything not positively recognized returns null; the booker refuses to submit if a required
// field is unrecognized, so every pattern here errs toward "don't know" rather than a wrong guess.
//
// The live form (seen 2026-09-25) has two pages: a checklist of three boxes labelled only "1", "2",
// "3" under a "確認事項 / Checklist" heading plus an arrival-time dropdown; then family name and
// first name (two boxes under one "Full Name" heading), phone, email, passport number, email again.

export const FIELD_KIND = Object.freeze({
  FULL_NAME: 'full_name',
  FAMILY_NAME: 'family_name',
  GIVEN_NAME: 'given_name',
  EMAIL: 'email',
  EMAIL_CONFIRM: 'email_confirm',
  PHONE: 'phone',
  PASSPORT_NUMBER: 'passport_number',
  CONSENT: 'consent',
  NUMBER_OF_PEOPLE: 'number_of_people',
  ARRIVAL_TIME: 'arrival_time',
});

// Someone else's details (inviter, employer, emergency contact...) — never fill with the applicant's.
const OTHER_PARTY = /company|organi[sz]ation|hotel|guarantor|invit|employer|school|agency|representative|father|mother|spouse|emergency|会社|勤務|学校|代理|緊急|招へい|организац|компани|работодат|представит/i;
const KANA = /kana|カナ|かな|フリガナ|ふりがな|katakana|hiragana/i;
const MIDDLE_NAME = /middle[\s_-]?name|patronym|отчество|otasining ismi/i;
// Matched only against the box's own label ("Family name" next to it), never the shared heading,
// which on the live form names both parts at once ("Ism va familiya / Имя и фамилия").
const FAMILY_NAME = /family[\s_-]?name|last[\s_-]?name|surname|^姓$|фамилия|familiya/i;
const GIVEN_NAME = /first[\s_-]?name|given[\s_-]?name|^名$|^имя$|^ism$/i;
const SURNAME_ONLY = (text) => /фамилия|familiya/i.test(text) && !/имя|\bism\b/i.test(text);
const FULL_NAME_EXPLICIT = /full[\s_-]?name|applicant'?s?\s+name|氏名|お名前|名前|фио|ф\.и\.о|полное имя|имя и фамилия|фамилия,?\s+имя|to'?liq ism|ism[\s-]?(va[\s-])?familiya/i;
const ENGLISH_NAME = /\bname\b/i;
const EMAIL = /e-?mail|\bmail\b|メール|почт|pochta/i;
const CONFIRM = /confirm|確認|again|re-?type|re-?enter|повтор|подтвер|takror|qayta/i;
const PHONE = /phone|\btel\b|電話|携帯|телефон|telefon/i;
const PASSPORT = /passport|pasport|паспорт|旅券|パスポート/i;
const CONSENT = /agree|consent|accept|同意|承諾|了承|согла|принима|rozi|qabul qilaman|privacy|個人情報|terms|規約|checklist|確認事項|tasdiqlash band|пункты для подтвержд|read and understood/i;
const PEOPLE_COUNT_LABEL = /人数|number of (people|persons|applicants|visitors)|количество (человек|заявителей)|soni/i;
const PEOPLE_COUNT_NAME = /^(stock|number|num|people|persons)$/i;
const ARRIVAL_TIME = /arrival time|来館時間|visit(ing)? time|время (посещения|прихода|визита)|tashrif (buyurish )?vaqt|kelish vaqt/i;
const TEXT_TYPES = new Set(['text', 'email', 'tel', '']);

/**
 * @typedef {{ tag: string, type: string, name: string, label: string, ownLabel: string, options: { value: string, text: string }[] }} FormField
 *   `label` is everything that names the field (incl. its row heading); `ownLabel` excludes the heading.
 * @param {FormField} field
 * @returns {string|null} a FIELD_KIND, or null if not confidently recognized
 */
export function classifyField(field) {
  const text = `${field.label} ${field.name}`;
  if (OTHER_PARTY.test(text)) return null;

  if (field.tag === 'select') {
    if (ARRIVAL_TIME.test(text)) return FIELD_KIND.ARRIVAL_TIME;
    return PEOPLE_COUNT_NAME.test(field.name) || PEOPLE_COUNT_LABEL.test(text) ? FIELD_KIND.NUMBER_OF_PEOPLE : null;
  }
  if (field.tag === 'input' && field.type === 'checkbox') {
    return CONSENT.test(text) ? FIELD_KIND.CONSENT : null;
  }

  const isTextLike = field.tag === 'textarea' || (field.tag === 'input' && TEXT_TYPES.has(field.type));
  if (field.tag === 'input' && field.type === 'email') {
    return CONFIRM.test(text) ? FIELD_KIND.EMAIL_CONFIRM : FIELD_KIND.EMAIL;
  }
  if (!isTextLike || field.tag === 'textarea') return null;

  if (EMAIL.test(text)) return CONFIRM.test(text) ? FIELD_KIND.EMAIL_CONFIRM : FIELD_KIND.EMAIL;
  if (field.type === 'tel' || PHONE.test(text)) return FIELD_KIND.PHONE;
  if (PASSPORT.test(text)) return FIELD_KIND.PASSPORT_NUMBER;

  if (KANA.test(text) || MIDDLE_NAME.test(text)) return null;
  const own = `${field.ownLabel}`.trim();
  const ownIsFamily = FAMILY_NAME.test(own) || /^(last|family|sur)[\s_-]?name$/i.test(field.name);
  const ownIsGiven = GIVEN_NAME.test(own) || /^(first|given)[\s_-]?name$/i.test(field.name);
  if (ownIsFamily !== ownIsGiven) return ownIsFamily ? FIELD_KIND.FAMILY_NAME : FIELD_KIND.GIVEN_NAME;
  if (ownIsFamily || /first[\s_-]?name|given[\s_-]?name|last[\s_-]?name|family[\s_-]?name|surname|姓/i.test(own) || SURNAME_ONLY(text)) return null;

  if (FULL_NAME_EXPLICIT.test(text) || ENGLISH_NAME.test(text) || field.name.toLowerCase() === 'name') {
    return FIELD_KIND.FULL_NAME;
  }
  return null;
}

// "9：30", "０９:30" and "09:30 " all mean 9:30.
const normalizeTime = (s) => s.normalize('NFKC').replace(/\s+/g, '').replace(/^0(?=\d:)/, '');

/**
 * @param {string} kind a FIELD_KIND
 * @param {import('../ports/slot-booker.port.js').Applicant} applicant
 * @param {FormField} field
 * @param {{ appointmentTime: string }} slot the time slot being booked ("15:00"; '' if unknown)
 * @returns {string|boolean|null} the value to enter, or null if we can't supply one
 */
export function valueFor(kind, applicant, field, slot) {
  switch (kind) {
    case FIELD_KIND.FULL_NAME:
      return applicant.fullName;
    case FIELD_KIND.FAMILY_NAME:
      return applicant.familyName ?? null;
    case FIELD_KIND.GIVEN_NAME:
      return applicant.firstName ?? null;
    case FIELD_KIND.EMAIL:
    case FIELD_KIND.EMAIL_CONFIRM:
      return applicant.email;
    case FIELD_KIND.PHONE:
      return applicant.phone ?? null;
    case FIELD_KIND.PASSPORT_NUMBER:
      return applicant.passportNumber ?? null;
    case FIELD_KIND.CONSENT:
      return true;
    case FIELD_KIND.NUMBER_OF_PEOPLE:
      return field.options.find((o) => o.value === '1' || o.text.trim() === '1')?.value ?? null;
    case FIELD_KIND.ARRIVAL_TIME: {
      // Arrive at the time of the slot that was clicked; no match means we don't know what to pick.
      if (!slot.appointmentTime) return null;
      const wanted = normalizeTime(slot.appointmentTime);
      return field.options.find((o) => normalizeTime(o.text) === wanted || normalizeTime(o.value) === wanted)?.value ?? null;
    }
    default:
      return null;
  }
}
