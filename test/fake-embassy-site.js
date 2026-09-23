import http from 'http';

// Minimal stand-in for the embassy site. Every page carries the same header, step indicator
// (which literally contains "予約完了") and a persistent warning with an "error" class, to prove
// the booker only reacts to what's new on each page.
const COMMON = `
  <div class="header">Embassy of Japan in Uzbekistan</div>
  <ol class="steps"><li>入力 / Input</li><li>確認 / Confirm</li><li>予約完了 / Reservation complete</li></ol>
  <p class="c_txt_error">If your selection does not match your input information, your appointment will be canceled.</p>`;

const page = (body) => `<!doctype html><html><head><meta charset="utf-8"></head><body>${COMMON}${body}</body></html>`;

function calendar(open) {
  const cell = (day, isOpen) => `<td><div class="sc_cal_month_itemlist"><div class="sc_cal_date">${day}</div>
    <p class="c_cal_time_cell">${isOpen ? `<a href="/form"><img src="/assets/images/user/icon_circle.svg" width="24" height="24"></a>` : '<img src="/assets/images/user/icon_disabled.svg" width="24" height="24">'}</p></div></td>`;
  return page(`<form><input type="hidden" name="event" class="js-event" value="20"></form>
    <div class="c_cal_navex_date"><a href="#" class="next01 js_change_date">次月</a><div class="date">2026年 10月</div></div>
    <table><tr>${cell(13, false)}${cell(14, open)}${cell(15, false)}</tr></table>`);
}

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
  const stats = { finalSubmissions: 0, detailSubmissions: 0 };
  const form = FORMS[scenario] ?? FORMS.simple;

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const data = Object.fromEntries(new URLSearchParams(body));
      res.setHeader('content-type', 'text/html; charset=utf-8');
      const url = req.url.split('?')[0];

      if (url === '/calendar') return res.end(calendar(scenario !== 'no-open'));

      if (url === '/form') {
        if (scenario === 'taken') return res.end(page(`<div class="c_form_error">This slot is no longer available.</div><a class="c_btn" href="/calendar">戻る / Back</a>`));
        return res.end(page(`<form method="post" action="/confirm">${form}
          <button type="submit">確認画面へ / Confirm</button></form>`));
      }

      if (url === '/confirm') {
        stats.detailSubmissions++;
        if (scenario === 'rejected') {
          return res.end(page(`<p class="error-message">This e-mail address already has a reservation.</p>
            <form method="post" action="/confirm">${form}<button type="submit">確認画面へ / Confirm</button></form>`));
        }
        const hidden = Object.entries(data).map(([k, v]) => `<input type="hidden" name="${k}" value="${v}">`).join('');
        return res.end(page(`<h2>Please check your reservation before it is confirmed</h2>
          <table><tr><th>Name</th><td>${data.name ?? ''}</td></tr><tr><th>E-mail</th><td>${data.email ?? ''}</td></tr></table>
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
