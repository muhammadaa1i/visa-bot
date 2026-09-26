import http from 'http';

// Minimal stand-in for the embassy site. Every page carries the same header, step indicator
// (which literally contains "予約完了") and a persistent warning with an "error" class, to prove
// the booker only reacts to what's new on each page.
// The header link reads like a forward button ("予約確認") but sits outside every form, so the
// booker must prefer the form's own button.
const COMMON = `
  <div class="header">Embassy of Japan in Uzbekistan <a class="c_btn" href="/calendar">予約確認 / Check reservation</a></div>
  <ol class="steps"><li>入力 / Input</li><li>確認 / Confirm</li><li>予約完了 / Reservation complete</li></ol>
  <p class="c_txt_error">If your selection does not match your input information, your appointment will be canceled.</p>`;

const page = (body) => `<!doctype html><html><head><meta charset="utf-8"></head><body>${COMMON}${body}</body></html>`;

function calendar(open, dateHref) {
  const cell = (day, isOpen) => `<td><div class="sc_cal_month_itemlist"><div class="sc_cal_date">${day}</div>
    <p class="c_cal_time_cell">${isOpen ? `<a href="${dateHref}"><img src="/assets/images/user/icon_circle.svg" width="24" height="24"></a>` : '<img src="/assets/images/user/icon_disabled.svg" width="24" height="24">'}</p></div></td>`;
  return page(`<form><input type="hidden" name="event" class="js-event" value="20"></form>
    <div class="c_cal_navex_date"><a href="#" class="next01 js_change_date">次月</a><div class="date">2026年 10月</div></div>
    <table><tr>${cell(13, false)}${cell(14, open)}${cell(15, false)}</tr></table>`);
}

// Mirrors the live site's day view (captured 2026-09-25): icon-only time links, and the open one
// carries js_window_open_for_time, which makes the site's script open the form in a popup window.
const dayView = (formPath) => page(`<table>
    <tr><th>14:30</th><td><a class="c_cal_time_cell js_move_reserve js_not_move"><img src="/assets/images/user/icon_disabled.svg" width="24" height="24"></a></td></tr>
    <tr><th>15:00</th><td><a href="${formPath}?date=2026%2F10%2F14&amp;time_from=15%3A00" class="c_cal_time_cell js_move_reserve js_check_in_stock js_window_open_for_time"
      data-url="${formPath}?date=2026%2F10%2F14&amp;time_from=15%3A00&amp;isPopUpWindow=1"><img src="/assets/images/user/icon_circle.svg" width="24" height="24"></a></td></tr>
  </table>
  <script>
    document.querySelector('.js_window_open_for_time').addEventListener('click', (e) => {
      e.preventDefault();
      window.open(e.currentTarget.dataset.url, 'reserve', 'width=900,height=700');
    });
  </script>`);

// The live two-page form (screenshots 2026-09-25), in the site's dl.c_form / dt.c_form_term /
// dd.c_form_desc layout. Field names are deliberately uninformative so labels have to do the work.
const ARRIVAL_TIMES = ['9：30', '10：00', '10：30', '11：00', '14：30', '15：00'];
const REQ = '<span class="c_label_req">必須</span>';
const embassyChecklistPage = (error = '') => page(`${error}<form method="post" action="/reservations/user/guest">
  <div style="border:1px solid red"><p>При подаче документов просим вас под личную ответственность обеспечить подачу подлинных документов.</p></div>
  <dl class="c_form">
    <dt class="c_form_term">${REQ}<span class="c_form_label">確認事項 / Checklist / Tasdiqlash bandlari / Пункты для подтверждения</span></dt>
    <dd class="c_form_desc"><ul class="c_form_desc_chklist">${[1, 2, 3].map((n) => `
      <li class="c_form_desc_chkitem"><label><input type="checkbox" name="check[]" value="${n}" style="display:none"><span style="display:inline-block;width:16px;height:16px;border:1px solid #999"></span> ${n}</label></li>`).join('')}
    </ul><p>上記内容を読み、理解された方は、上記チェックボックスにチェックをしてください。If you have read and understood the above content, please check the box above.</p></dd>
    <dt class="c_form_term">${REQ}<span class="c_form_label">来館時間を選択してください。Please select your arrival time (for Visa)</span></dt>
    <dd class="c_form_desc"><select name="arrival" class="c_form_input_req"><option value=""></option>${ARRIVAL_TIMES.map((t, i) => `<option value="${i + 1}">${t}</option>`).join('')}</select>
      <p>ご希望の来館時間を選択してください。Please select your preferred arrival time.</p></dd>
  </dl>
  <a class="c_btn" href="/calendar">Back</a> <button type="submit" class="c_btn">Next</button></form>`);
const embassyApplicantPage = (error = '') => page(`${error}<form method="post" action="/confirm">
  <dl class="c_form">
    <dt class="c_form_term">${REQ}<span class="c_form_label">Full Name/Ism va familiya(Lotin alifbosida)/Имя и фамилия(латинице)</span></dt>
    <dd class="c_form_desc"><div class="c_form_group"><span>Family name</span> <input type="text" name="name1" class="c_form_input_req"> <span>First name</span> <input type="text" name="name2" class="c_form_input_req"></div>
      <p>代理人申請の場合は、書類提出者氏名を入力してください。For proxy applications, please enter the name of the person submitting the documents.</p></dd>
    <dt class="c_form_term">${REQ}<span class="c_form_label">Phone number/Telefon raqami /Номер телефона</span></dt>
    <dd class="c_form_desc"><input type="text" name="free1" class="c_form_input_req"></dd>
    <dt class="c_form_term">${REQ}<span class="c_form_label">Email address / Elektron pochta manzili / Адрес электронной почты</span></dt>
    <dd class="c_form_desc"><input type="text" name="email" class="c_form_input_req"></dd>
    <dt class="c_form_term">${REQ}<span class="c_form_label">Passport number / Pasport raqami / Номер паспорта</span></dt>
    <dd class="c_form_desc"><input type="text" name="free2" class="c_form_input_req"><p>現有パスポート番号を入力してください。Please enter your current passport number.</p></dd>
    <dt class="c_form_term">${REQ}<span class="c_form_label">メールアドレス(確認)/ Email address (re-enter)</span></dt>
    <dd class="c_form_desc"><input type="text" name="email_confirm" class="c_form_input_req"></dd>
    <dt class="c_form_term"><span class="c_label_any">任意</span><span class="c_form_label">備考/Remarks/Izohlar/Примечания</span></dt>
    <dd class="c_form_desc">${[1, 2, 3, 4].map((n) => `<input type="text" name="note${n}" class="c_form_input_req">`).join('')}
      <p>For proxy applications, please enter the travel agency name, e.g., AAA Travel.</p></dd>
  </dl>
  <a class="c_btn" href="/reservations/form">Back</a> <button type="submit" class="c_btn">Next</button></form>`);
const fieldError = '<p class="c_form_error">必須項目を入力してください / Please fill in the required items.</p>';

const FORMS = {
  simple: `
    <dl>
      <dt>Name / Ism / Имя <span>必須</span></dt><dd><input type="text" name="name"></dd>
      <dt>E-mail <span>必須</span></dt><dd><input type="email" name="email"></dd>
      <dt>E-mail (confirm) <span>必須</span></dt><dd><input type="text" name="email_confirm"></dd>
      <dt>人数 / Number of people</dt><dd><select name="stock"><option value="1">1</option><option value="2">2</option></select></dd>
      <dt>Phone (optional)</dt><dd><input type="tel" name="tel"></dd>
      <dt>Remarks</dt><dd><textarea name="note"></textarea></dd>
    </dl>
    <label><input type="checkbox" name="agree" required> I agree to the privacy policy</label>`,
  passport: `
    <dl>
      <dt>Name <span>必須</span></dt><dd><input type="text" name="name"></dd>
      <dt>E-mail <span>必須</span></dt><dd><input type="email" name="email"></dd>
      <dt>Passport number <span>必須</span></dt><dd><input type="text" name="passport"></dd>
    </dl>`,
  katakana: `
    <dl>
      <dt>Name (Katakana) <span>必須</span></dt><dd><input type="text" name="name_kana"></dd>
      <dt>E-mail <span>必須</span></dt><dd><input type="email" name="email"></dd>
    </dl>`,
};

export function startFakeSite(scenario) {
  const stats = { finalSubmissions: 0, detailSubmissions: 0, checklist: null, applicant: null };
  const form = FORMS[scenario] ?? FORMS.simple;

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const params = new URLSearchParams(body);
      const data = Object.fromEntries(params);
      res.setHeader('content-type', 'text/html; charset=utf-8');
      const url = req.url.split('?')[0];

      const usesDayView = scenario === 'popup' || scenario === 'embassy';
      if (url === '/calendar') return res.end(calendar(scenario !== 'no-open', usesDayView ? '/day' : '/form'));
      if (url === '/day') return res.end(dayView(scenario === 'embassy' ? '/reservations/form' : '/form'));

      if (url === '/reservations/form') return res.end(embassyChecklistPage());
      if (url === '/reservations/user/guest') {
        stats.checklist = { checked: params.getAll('check[]'), arrival: ARRIVAL_TIMES[Number(data.arrival) - 1] ?? null };
        if (stats.checklist.checked.length !== 3 || !stats.checklist.arrival) return res.end(embassyChecklistPage(fieldError));
        return res.end(embassyApplicantPage());
      }

      if (url === '/form') {
        if (scenario === 'taken') return res.end(page(`<div class="c_form_error">This slot is no longer available.</div><a class="c_btn" href="/calendar">戻る / Back</a>`));
        return res.end(page(`<form method="post" action="/confirm">${form}
          <button type="submit">確認画面へ / Confirm</button></form>`));
      }

      if (url === '/confirm') {
        stats.detailSubmissions++;
        if (scenario === 'embassy') {
          stats.applicant = data;
          const missing = ['name1', 'name2', 'free1', 'email', 'free2'].some((k) => !data[k]) || data.email !== data.email_confirm;
          if (missing) return res.end(embassyApplicantPage(fieldError));
        }
        if (scenario === 'rejected') {
          return res.end(page(`<p class="error-message">This e-mail address already has a reservation.</p>
            <form method="post" action="/confirm">${form}<button type="submit">確認画面へ / Confirm</button></form>`));
        }
        const hidden = Object.entries(data).map(([k, v]) => `<input type="hidden" name="${k}" value="${v}">`).join('');
        return res.end(page(`<h2>Please check your reservation before it is confirmed</h2>
          <table><tr><th>Name</th><td>${data.name ?? `${data.name1 ?? ''} ${data.name2 ?? ''}`}</td></tr><tr><th>E-mail</th><td>${data.email ?? ''}</td></tr></table>
          <form method="post" action="/complete">${hidden}
            <button type="submit" formaction="/form">戻る / Back</button>
            <button type="submit">予約する / Reserve</button></form>`));
      }

      if (url === '/complete') {
        stats.finalSubmissions++;
        if (scenario === 'email-link') {
          return res.end(page(`<p>仮予約を受け付けました。</p><p>Please click the link in the e-mail we sent to finalize your reservation within 30 minutes.</p>`));
        }
        if (scenario === 'book-another') {
          return res.end(page(`<p>Your request was received.</p><form method="post" action="/form"><button type="submit">Book another / 予約する</button></form>`));
        }
        return res.end(page(`<p>予約が完了しました。予約番号: A-1234</p><a class="c_btn" href="/calendar">Top</a>`));
      }

      res.statusCode = 404;
      res.end('not found');
    });
  });

  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, stats, url: `http://127.0.0.1:${server.address().port}/calendar` })));
}
