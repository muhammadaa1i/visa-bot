# visa-bot

Automated monitoring/booking assistant for the Japan Embassy in Uzbekistan visa
appointment calendar (`https://uzembassyryouji.rsvsys.jp/reservations/calendar`),
built to handle multiple clients (applicants) in parallel.

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
3. **CQRS**: separate the write side (commands: `RegisterClientCommand`,
   `BookSlotCommand`) from the read side (queries: `GetAvailableSlotsQuery`,
   `GetClientStatusQuery`). Commands mutate state and return
   nothing/an id/an ack — never a full read model. Queries never mutate state.
   Each command/query has its own handler class in its own file
   (`commands/book-slot.command.ts` + `commands/book-slot.handler.ts`, etc.).
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
  fragment to re-parse for slot availability (`icon_circle` = available,
  `icon_disabled` = not available).
- Deeper flow (date → time slot → applicant details → email confirmation)
  goes through further AJAX endpoints under `/ajax/reservations/*`
  (`interval-stock`, `staff-stock`, `calendar-select-plan`,
  `calendar-plan-status`) — not yet fully captured live because no slots were
  open in the observed 12-month window as of 2026-09-18. Re-run
  `recon/walkthrough.js` when slots open to capture the remaining steps before
  building the booking command handler.
- Because there are no client-rendered SPA calls beyond these AJAX POSTs,
  slot-availability polling can run as plain HTTP requests (cookie jar +
  token bookkeeping) without a full browser — reserve Playwright for the
  final booking step if form-tampering protection turns out to require exact
  browser-rendered field state.

## Deployment target

Must run on a free-tier server. Prefer a lightweight polling worker (plain
HTTP, no headless browser) for the read side; only spin up Playwright
on-demand for the write side (actual booking), since headless Chromium is too
heavy to keep resident on free tiers.
