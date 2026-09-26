/**
 * @typedef {{
 *   handle: string,
 *   tag: string,
 *   type: string,
 *   name: string,
 *   label: string,
 *   ownLabel: string,
 *   required: boolean,
 *   hasValue: boolean,
 *   visible: boolean,
 *   options: { value: string, text: string }[],
 * }} PageField
 *   `ownLabel` is what names this one box (its <label>, the text right before it, placeholder),
 *   without the row heading `label` adds: one heading can cover two boxes ("Full Name:
 *   Family name [__] First name [__]" on the live form).
 * @typedef {{ handle: string, text: string, formRank: number }} PageButton
 *   `formRank`: 2 = in the form holding the fields, 1 = in some other form, 0 = outside any form.
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
    const OPTIONAL_MARK = /任意|optional|необязательн|ixtiyoriy/i;
    const REQUIRED_CLASS = /(^|[\s_-])req/i;
    const FIELD_TAGS = 'input:not([type=hidden]), select, textarea';

    const rowLabel = (el) => {
      const dd = el.closest('dd');
      if (dd && dd.previousElementSibling?.tagName === 'DT') return dd.previousElementSibling;
      const td = el.closest('td');
      const th = td?.parentElement?.querySelector('th');
      return th ?? null;
    };
    const labelElementOf = (el) =>
      (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('label') || null;
    // Short text just before the box within its row, e.g. "Family name" in "Family name [__] First name [__]".
    // Walks back through earlier siblings (then the parent's), stopping at anything holding another field.
    const inlineTextOf = (el) => {
      let node = el;
      for (let depth = 0; depth < 3 && node && !node.matches?.('dd, td, th, dt, form, body'); depth++) {
        for (let sib = node.previousSibling; sib; sib = sib.previousSibling) {
          if (sib.nodeType === Node.ELEMENT_NODE && (sib.matches(FIELD_TAGS) || sib.querySelector(FIELD_TAGS))) return '';
          const text = clean(sib.textContent);
          if (text !== '') return text.length <= 40 ? text : '';
        }
        node = node.parentElement;
      }
      return '';
    };
    const ownLabelOf = (el) =>
      clean([labelElementOf(el)?.innerText, inlineTextOf(el), el.getAttribute('aria-label'), el.getAttribute('placeholder')].filter(Boolean).join(' | '));
    const labelOf = (el) => clean([ownLabelOf(el), rowLabel(el)?.innerText].filter(Boolean).join(' | '));
    const isRequired = (el) => {
      const row = rowLabel(el);
      if (el.required) return true;
      if (row !== null && OPTIONAL_MARK.test(row.innerText) && !REQUIRED_MARK.test(row.innerText)) return false;
      return (
        el.getAttribute('aria-required') === 'true' ||
        REQUIRED_CLASS.test(el.className) ||
        (row !== null && (REQUIRED_MARK.test(row.innerText) || REQUIRED_CLASS.test(row.className)))
      );
    };

    const SKIPPED_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'image', 'reset']);
    // Styled forms often hide the real checkbox and show a drawn square in its <label> instead.
    const isBox = (el) => el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio');
    const isShown = (el) => isVisible(el) || (isBox(el) && labelElementOf(el) !== null && isVisible(labelElementOf(el)));
    const candidates = [...document.querySelectorAll('input, select, textarea')].filter(
      (el) => !(el.tagName === 'INPUT' && SKIPPED_INPUT_TYPES.has(el.type)) && !el.disabled && !el.readOnly && isShown(el)
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
        ownLabel: ownLabelOf(el),
        required: isRequired(el),
        hasValue: type === 'checkbox' ? el.checked : clean(el.value) !== '',
        visible: isVisible(el),
        options: tag === 'select' ? [...el.options].map((o) => ({ value: o.value, text: clean(o.text) })) : [],
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
        ownLabel: clean(group.els.map(ownLabelOf).join(' / ')),
        required: group.els.some(isRequired),
        hasValue: group.els.some((el) => el.checked),
        visible: group.els.some(isVisible),
        options: group.els.map((el) => ({ value: el.value, text: ownLabelOf(el) })),
      });
    }

    // Buttons in the form that holds the fields rank first, then any form's, then loose header/footer links.
    const fieldForms = new Set(candidates.map((el) => el.closest('form')).filter(Boolean));
    const buttons = [...document.querySelectorAll('button, input[type=submit], input[type=button], a[class*="btn"]')]
      .filter(isVisible)
      .map((el, i) => {
        el.setAttribute('data-vb-button', String(i));
        const form = el.closest('form');
        return { handle: `[data-vb-button="${i}"]`, text: clean(el.innerText || el.value), formRank: fieldForms.has(form) ? 2 : form ? 1 : 0 };
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
