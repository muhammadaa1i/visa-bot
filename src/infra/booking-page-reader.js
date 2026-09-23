/**
 * @typedef {{
 *   handle: string,
 *   tag: string,
 *   type: string,
 *   name: string,
 *   label: string,
 *   required: boolean,
 *   hasValue: boolean,
 *   options: string[],
 * }} PageField
 * @typedef {{ handle: string, text: string }} PageButton
 * @typedef {{ fields: PageField[], buttons: PageButton[], errors: string[], lines: string[] }} BookingPageSnapshot
 */

/**
 * Reads what a person would see on the current page: visible form fields (with labels
 * and required markers), visible buttons, visible error messages, and the page's text lines.
 * Tags fields/buttons with data attributes so the booker can act on them afterwards.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<BookingPageSnapshot>}
 */
export async function readBookingPage(page) {
  return page.evaluate(() => {
    const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const isVisible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const REQUIRED_MARK = /必須|required|обязательн|majburiy|\*/i;
    const REQUIRED_CLASS = /(^|[\s_-])req/i;

    const rowLabel = (el) => {
      const dd = el.closest('dd');
      if (dd && dd.previousElementSibling?.tagName === 'DT') return dd.previousElementSibling;
      const td = el.closest('td');
      const th = td?.parentElement?.querySelector('th');
      return th ?? null;
    };
    const labelOf = (el) => {
      const parts = [];
      if (el.id) parts.push(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText);
      parts.push(el.closest('label')?.innerText, rowLabel(el)?.innerText, el.getAttribute('aria-label'), el.getAttribute('placeholder'));
      return clean(parts.filter(Boolean).join(' | '));
    };
    const isRequired = (el) => {
      const row = rowLabel(el);
      return (
        el.required ||
        el.getAttribute('aria-required') === 'true' ||
        REQUIRED_CLASS.test(el.className) ||
        (row !== null && (REQUIRED_MARK.test(row.innerText) || REQUIRED_CLASS.test(row.className)))
      );
    };

    const SKIPPED_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'image', 'reset']);
    const candidates = [...document.querySelectorAll('input, select, textarea')].filter(
      (el) => !(el.tagName === 'INPUT' && SKIPPED_INPUT_TYPES.has(el.type)) && !el.disabled && !el.readOnly && isVisible(el)
    );

    const fields = [];
    const radioGroups = new Map();
    candidates.forEach((el, i) => {
      const tag = el.tagName.toLowerCase();
      const type = tag === 'input' ? el.type : '';
      if (type === 'radio') {
        const group = radioGroups.get(el.name) ?? { els: [], index: i };
        group.els.push(el);
        radioGroups.set(el.name, group);
        return;
      }
      el.setAttribute('data-vb-field', String(i));
      fields.push({
        handle: `[data-vb-field="${i}"]`,
        tag,
        type,
        name: el.name || '',
        label: labelOf(el),
        required: isRequired(el),
        hasValue: type === 'checkbox' ? el.checked : clean(el.value) !== '',
        options: tag === 'select' ? [...el.options].map((o) => o.value) : [],
      });
    });
    for (const [name, group] of radioGroups) {
      group.els.forEach((el) => el.setAttribute('data-vb-field', String(group.index)));
      const first = group.els[0];
      fields.push({
        handle: `[data-vb-field="${group.index}"]`,
        tag: 'input',
        type: 'radio',
        name,
        label: clean(`${rowLabel(first)?.innerText ?? ''} | ${group.els.map(labelOf).join(' / ')}`),
        required: group.els.some(isRequired),
        hasValue: group.els.some((el) => el.checked),
        options: group.els.map((el) => el.value),
      });
    }

    const buttons = [...document.querySelectorAll('button, input[type=submit], input[type=button], a[class*="btn"]')]
      .filter(isVisible)
      .map((el, i) => {
        el.setAttribute('data-vb-button', String(i));
        return { handle: `[data-vb-button="${i}"]`, text: clean(el.innerText || el.value) };
      })
      .filter((b) => b.text !== '');

    const errors = [...document.querySelectorAll('[class*="error"]')]
      .filter((el) => !['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) && isVisible(el))
      .map((el) => clean(el.innerText))
      .filter((t) => t !== '')
      .slice(0, 5);

    const lines = document.body.innerText.split('\n').map(clean).filter((l) => l !== '');
    return { fields, buttons, errors, lines };
  });
}
