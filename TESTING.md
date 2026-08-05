# ScriptSchedule — Testing

## Current state: a real (but partial) automated suite now exists

`tests/time.test.js` — 15 tests covering the timezone-conversion logic behind medication reminder scheduling (`netlify/functions/_shared/time.js`): multiple IANA zones, both 2026 US DST transition dates, half-hour-offset and southern-hemisphere zones, midnight edge cases, and calendar arithmetic across month/year boundaries. Run with `npm test` (uses Node's built-in `node:test` — no external framework dependency). `.github/workflows/test.yml` runs this on every push/PR to `main` — the first CI this repo has had.

**Still not covered** — real gaps, not yet addressed:
- Client-side dose-status/scheduling logic in `index.html` (`isPastCourse`, frequency-to-schedule mapping, `toPushPayload`).
- RLS policy tests (confirming user A genuinely cannot read/write user B's household data) — needs a dedicated test Supabase project to run against safely, which is more setup than a pure unit test.
- Everything else in this file's "manual launch-testing checklist" below.

Every other fix made to this app (XSS, auth/rate-limiting, session control, dead-file cleanup) has been verified manually and once, with no permanent regression protection. See [PRODUCTION_READINESS_AUDIT.md](PRODUCTION_READINESS_AUDIT.md) C4 for the full picture.

## How things have been manually verified so far

- **RLS/access control** — verified by creating real throwaway test accounts and confirming cross-household access is blocked.
- **XSS fix** — verified by testing the actual injection live before and after the fix.
- **Rate limiting / auth on Netlify functions** — verified via direct console calls against the live Supabase backend (`node -e require(...)` for syntax, live session checks in-browser for the auth/session behavior).
- **Account deletion** — verified end-to-end with a real throwaway account: created it, deleted it, confirmed it could no longer sign in.
- **Sign out other devices** — verified the actual `supabase-js` `signOut({scope:'others'})` call against the live backend, confirmed the current device's session survives.

None of this is repeatable automatically — every one of these checks would need to be redone by hand if the relevant code changes again.

## Manual launch-testing checklist (until automated tests exist)

Anything marked automated-later is a candidate for Phase 16 test-writing; for now, verify by hand before any release:

- [ ] Sign up, sign in, sign out, password reset
- [ ] Add/edit/archive a medication, across every frequency type (daily, multiple-times-daily, every-other-day, weekly, as-needed)
- [ ] Log a dose as taken/skipped/snoozed; correct a mistaken entry
- [ ] Scan a prescription label; confirm OCR results require explicit user confirmation before saving
- [ ] Push notification actually arrives at the scheduled local time — **currently known to be wrong for non-UTC users, see audit C3**
- [ ] Multi-device sync: two devices in the same household see the same data live
- [ ] Household invite: generate a code, redeem it on a second account, confirm both see shared data
- [ ] Delete account: confirm data removal and login removal both complete
- [ ] Sign out other devices: confirm the other session is actually revoked
- [ ] Notification permission denied → app shows a visible warning (needs verification — not yet confirmed either way)
- [ ] Time zone change / DST transition — reminder behavior (needs dedicated testing once C3 is fixed)

## What "done" should look like eventually

- Unit tests for scheduling/status logic (`isPastCourse`, frequency → dose-time mapping, timezone conversion once C3 is fixed).
- RLS policy tests (a request using another household's record id must fail).
- A CI pipeline running these on every push, before Netlify deploys.
