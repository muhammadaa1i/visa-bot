# visa-bot

Automated monitoring/booking assistant for the Japan Embassy in Uzbekistan visa
appointment calendar (`https://uzembassyryouji.rsvsys.jp/reservations/calendar`),
built to handle multiple clients (applicants) in parallel.

## Commands

- `npm start` — runs the Telegram bot (`src/index.js` via `node --env-file=.env`).
  Requires `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env`; the process
  throws immediately on startup if either is missing.
- `npm test` — runs `test/booking.test.js`: the real booker and
  `BookSlotsHandler` against a local fake of the embassy site
  (`test/fake-embassy-site.js`, 127.0.0.1 only — never the real site), one
  scenario per form shape/outcome. Plain Node script, no test framework;
  needs Playwright's Chromium installed. No linter/formatter is configured.
- `npm run monitor` — the standalone Playwright slot-availability monitor
  (`recon/monitor.js`, loads `.env` for the Telegram alert). Runs forever,
  checking the current month + the next 2 each pass with a 30–45s pause
  between passes (don't shorten it — that's the rate limit). Runs on the VM
  only, not on the dev PC. Telegram alerts fire only when
  availability changes; the 🚨 slot alert also goes to the extra chat ids in
  `SLOT_ALERT_CHAT_IDS` (comma-separated, optional — each recipient must have
  pressed Start in the bot), while ⚠️/✅/daily messages stay owner-only; on each new opening it also clicks through date →
  time → applicant form and saves every page, the XHR log and the form's
  field names to `recon/out/FLOW-<timestamp>/` (never fills or submits).
  That capture is what the booking command gets built from. It watches
  itself via Telegram (no PC-side checks): ⚠️ after 5 failed passes in a
  row, ✅ on recovery, and a daily "alive" message at 09:00 Tashkent time —
  a missing daily message means the VM itself is down. On the VM it runs as the systemd service in
  `deploy/visa-monitor.service`; the old GitHub Actions workflow is gone.
- Other recon scripts (run directly with `node`):
  - `node recon/inspect.js` — Playwright script that records all network
    requests/responses on the calendar page to `recon/out/` for manual
    inspection.
  - `node recon/walkthrough.js` — Playwright script that logs XHR
    request/response pairs while driving the booking flow; re-run this when
    slots are open to capture the steps past calendar browsing.

## Current implementation state (src/)

Automatic booking (`BookSlotsHandler`, `src/commands/book-slots.handler.js`)
runs inside the bot process, since the bot is the only writer of
`data/clients.json`. `src/index.js` wires it: `SlotSignalFileWatcher` fires
when the monitor creates `recon/out/ALERT.txt`, and the handler books pending
clients oldest-first, one slot each, via the `SlotBooker` port
(`PlaywrightSlotBooker`). The real booking form has never been seen, so the
booker is built to handle unknown forms safely:
- `form-field-classifier.js` recognizes fields by label (EN/JA/RU/UZ); the
  booker submits only if every required field is recognized, otherwise
  `HELD_BACK` with the unknown labels sent to the owner.
- Phases `NOTHING_SENT → DETAILS_SENT → FINAL_SENT`; after the confirmation
  page is submitted it never clicks again. Results/errors are judged only on
  text that's new vs. the previous page (step indicators repeat everywhere).
- The client is set to `booking` in `beforeSubmit` before any applicant data
  is sent; `booking` is never retried automatically (no double-booking).

Composition root is `src/index.js` →
`createTelegramBot()` in `src/bot/telegram-bot.js`, which is the only file
that touches Telegraf directly and wires:
- `RegisterClientHandler` (`src/commands/register-client.handler.js`) — the
  one write operation so far; validates input and calls
  `ClientRepository.save()`.
- `GetPendingClientsHandler` / `GetClientsByChatIdHandler`
  (`src/queries/*.handler.js`) — read paths backing the `/list` (owner-only)
  and `/mystatus` bot commands, surfaced via `src/bot/status-commands.js`.
- `RegisterConversation` + `ConversationState`
  (`src/bot/register-conversation.js`, `src/bot/conversation-state.js`) — the
  `/register` wizard's state machine (`awaiting_name` →
  `awaiting_email`, then saves; every client is short stay (Applicant),
  the only calendar the monitor watches, so there's no category step), keyed per Telegram chat id in an
  in-memory `Map`. State is not persisted, so an in-flight `/register` is
  lost on bot restart — acceptable today since it's re-askable, but relevant
  if a longer wizard is ever added.
- `JsonClientRepository` (`src/infra/json-client-repository.js`) — the only
  `ClientRepository` implementation; append-only JSON array at
  `data/clients.json` (gitignored), writes serialized through an in-process
  promise queue (`#enqueue`) plus temp-file-then-rename so concurrent
  `save()`/`update()` calls can't corrupt the file. This is a single-writer
  design — it assumes one process owns the file, which matches the
  single-VM deployment target below but would need to change if the bot and
  booking engine ever ran as separate processes.
- Client shape and enums (`VISA_CATEGORIES`, `CLIENT_STATUS`) live in
  `src/domain/client.js`; `createClient()` is the only place a `Client`
  object gets constructed.

## Strict engineering rules (non-negotiable)

These rules apply to every file in this repository, no exceptions, unless the
user explicitly overrides them for a specific case.

1. **Module system**: ESM only. `package.json` has `"type": "module"`. Never
   write `require`/`module.exports` — always `import`/`export`.
2. **SOLID, per file**:
   - **S**ingle Responsibility — one file, one reason to change. A file that
     fetches data does not also transform it or persist it.
   - **O**pen/Closed — new visa categories, notification channels, or storage
     backends are added by adding a new class/module behind an existing
     interface, not by editing existing branches with more `if`s.
   - **L**iskov Substitution — any implementation of an interface (e.g. a
     `NotificationChannel`, a `SlotRepository`) must be swappable without the
     caller knowing which concrete type it got.
   - **I**nterface Segregation — small, focused interfaces (e.g. don't force a
     read-only repository to implement `save()`).
   - **D**ependency Inversion — modules depend on abstractions (ports), not on
     concrete infra (Playwright, a specific DB, a specific HTTP client). Wire
     concrete implementations at the composition root only.
3. **Architecture pattern**: Command pattern + Ports & Adapters (Hexagonal) +
   State Machine for conversations — chosen over full CQRS as the better fit
   for this project's actual size (a handful of operations on one small
   entity, not a domain complex enough to need separate read/write models).
   - **Commands** (`src/commands/*.handler.js`): one class per write
     operation (`RegisterClientHandler`, later `BookSlotHandler`), each with
     a single `handle(input)` method. `input` is a plain object — add a
     dedicated command-factory file only if constructing it requires real
     logic (defaults, derived fields), never as a pass-through wrapper
     around an object literal.
   - **Queries** (`src/queries/*.handler.js`): one class per read operation,
     `handle(...)` taking whatever primitives/plain object it needs directly.
     Never mutate state. No separate query-object file for a query that
     takes zero or one trivial parameter — that's ceremony, not structure.
   - **Ports & Adapters** (`src/ports/*.port.js` + `src/infra/*.js`):
     business logic depends only on port interfaces (`ClientRepository`,
     `Notifier`), never on concrete infra (Telegraf, a specific file format,
     Playwright). Concrete adapters are wired at the composition root
     (`src/bot/telegram-bot.js`, `src/index.js`) only.
   - **State machine** (`src/bot/conversation-state.js` +
     `*-conversation.js`): multi-step Telegram conversations (like
     `/register`) are modeled as an explicit per-chat step + data state,
     not scattered boolean flags.
4. **Scalability**: the booking engine must support N clients queued
   independently. No global mutable state, no shared singletons holding
   per-client data. Client work items go through a queue/worker model so
   adding clients doesn't require code changes, and so one client's failure
   doesn't block another's.
5. **Reliability**:
   - Every external call (HTTP to rsvsys.jp, browser automation) is wrapped
     with timeouts and typed error handling — never a bare `try/catch` that
     swallows the error.
   - Idempotency: retrying a command (e.g. after a crash) must not double-book
     a client. Persist state transitions before acting, or use a dedupe key.
   - Structured logging (not `console.log` scattered around) so failures are
     diagnosable in production.
6. **Security**:
   - Client PII (name, email, passport/document info) is never logged in
     plaintext and never committed to the repo.
   - Secrets (session cookies, API keys, notification tokens) come from
     environment variables / a secrets manager — never hardcoded, never
     committed. `.env` is gitignored.
   - Respect the target site: preserve its CSRF (`_csrfToken`, `_Token[fields]`,
     `_Token[unlocked]`) handshake exactly as issued per-session — never
     attempt to bypass, brute-force, or spoof it. Rate-limit our own requests
     to a level indistinguishable from a careful human user; no hammering.
7. **No dead weight**: no speculative abstractions for hypothetical future
   requirements, no unused config flags, no half-finished handlers. If a
   feature isn't needed yet, don't scaffold it "for later."

## Scope of the strict rules

The rules above govern the production bot codebase (to live under `src/`).
Scripts under `recon/` are throwaway reconnaissance/ops tooling used to learn
the target site and to run the standalone availability monitor — they are
intentionally simple single-file scripts and are exempt from the CQRS/SOLID
file-separation rules. Don't "clean them up" into the strict structure; when
the actual booking command handler is built, it belongs in `src/`, informed
by what recon learned.

## Target site mechanics (reference, learned via recon in `recon/`)

- Platform: generic Japanese reservation SaaS ("rsvsys.jp"), backend is
  CakePHP (classic `_csrfToken` + `_Token[fields]`/`_Token[unlocked]` Security
  Component tokens tied to the exact set of submitted field names).
- Calendar rendering is server-side; month navigation and slot listing are
  fetched via `POST https://uzembassyryouji.rsvsys.jp/ajax/reservations/calendar`
  with form-encoded body (`category`, `event`, `plan`, `date`, `disp_type`,
  plus the CSRF/token fields), returning `{"html": "..."}` — the calendar HTML
  fragment to re-parse for slot availability (`icon_disabled` = not
  available; `icon_circle` = available, first seen live 2026-09-25; the
  monitor still treats any date cell not marked `icon_disabled` as possibly
  open).
- Deeper flow, seen live 2026-09-25: clicking an open date re-renders the
  same page as a day view (`disp_type=day`, same AJAX endpoint) with one
  icon-only link per time. The open one is
  `a.js_move_reserve.js_window_open_for_time` with
  `href="/reservations/option?event_id=20&event_plan_id=19&date=YYYY/MM/DD&time_from=HH:MM"`
  and `data-stock` (free places); the site's script opens it in a **popup
  window** (`data-url` adds `isPopUpWindow=1`), and the applicant form
  continues there, not in the calendar tab. The form itself hasn't been
  captured yet (the monitor's capture didn't follow the popup until then).
  Slots opened and closed within minutes that day.
- Because there are no client-rendered SPA calls beyond these AJAX POSTs,
  slot-availability polling can run as plain HTTP requests (cookie jar +
  token bookkeeping) without a full browser — reserve Playwright for the
  final booking step if form-tampering protection turns out to require exact
  browser-rendered field state.

## Deployment target

Everything (the Telegram registration bot, the calendar monitor, and the
eventual booking command) runs together on a single always-on free-tier VM
(Oracle Cloud Always Free), not split across the local machine and a separate
CI/cloud-routine service. The split tried earlier failed for two independent
reasons worth remembering:
- Anthropic's Claude Code cloud routine sandbox blocks outbound access to
  arbitrary external hosts by policy — it could never reach the embassy site.
- Splitting the Telegram bot (local) from the monitor (GitHub Actions) meant
  the two never shared the same `data/clients.json` — the monitor had no way
  to know who to book for.

One VM, one process (or a couple of cooperating processes) sharing local
disk, avoids both problems.
