# ScriptSchedule — Known Issues

Running log of open issues. Full detail (why it matters, recommended fix, test plan) lives in [PRODUCTION_READINESS_AUDIT.md](PRODUCTION_READINESS_AUDIT.md) — this file is the short list for quick reference, kept in sync with it.

## Open — Critical

- **C1** — Native app: decision made (Capacitor) and scaffolding committed (`4658c90`). Blocked on local tooling: iOS needs full Xcode.app installed (only CLT present), Android needs a JDK installed (none present). Not a code issue — install both, then `npx cap open ios` / `npx cap open android`.
- **C4** — Started, not fully closed: real tests + CI now exist (`tests/time.test.js`, `.github/workflows/test.yml`), covering the C3 timezone fix. Still open: dose-status/scheduling client-side logic, and RLS policy tests (needs a test Supabase project).

## Open — High

- **H7** — No in-app "Forgot Password" flow. Currently the only recovery path is an owner manually sending a magic link via the Supabase dashboard's Authentication → Users page — not something a real user could do for themselves. Should add a proper "Forgot password?" link on the sign-in form using Supabase's `resetPasswordForEmail()`, plus a landing screen in the app that detects a recovery token in the URL and lets the user set a new password.
- **H2** — No MFA, no admin-specific account protections.
- **H3** — No automatic session expiry; lost/stolen device stays signed in until manually revoked from another device.
- **H4** — No crash reporting, error monitoring, or backup-failure alerting.
- **H5** — Git history contains removed debug-endpoint output with partial (non-exploitable) service-role key metadata — recommend rotating the key as a precaution.
- **H6** — Abandoned React scaffold (`scriptschedule/`) and ~12MB of duplicated marketing images clutter the repo.

## Open — Medium / Low

See the audit's Medium/Low sections — representative, not yet an exhaustive sweep (accessibility, offline behavior, data export, pagination, performance at scale all still need a dedicated pass).

## Resolved this session (for the record)

- **Live production bug (unlabeled, found 2026-08-06)** — real user account (`ccragsdale@gmail.com`, the app owner's own daily-use account) had a valid login but no `household_members` row at all — meaning it had silently been running on local-only cached data the entire time, with invites failing and no way to tell why. Root cause traced live: `init()` falls back to a local flag and renders the app even when there's truly no session or household, with no visible indication anything was wrong. Fixed by: (1) adding the `cloudSyncMissing` banner + reachable sign-in path (see below), (2) creating the missing household for this account via the existing `create_household_with_owner` RPC, verified end-to-end (invite code generation confirmed working on the actual phone this account uses daily).
- **Supabase Auth "Site URL" was misconfigured to `localhost:3000`** instead of `https://scriptschedule.app` — discovered because a magic-link sign-in email redirected to an unreachable local address instead of the real site. This would have broken password reset, magic link, and email confirmation for every real user, not just this one case. Fixed by updating Authentication → URL Configuration → Site URL in the Supabase dashboard.
- **No path back to sign-in once a session goes missing** — `index.html` now sets `state.cloudSyncMissing` and shows a persistent banner with a working "Sign In" button (reopens the existing beta-gate sign-in form) whenever `loadHouseholdDataFromSupabase()` confirms there's truly no session, instead of silently rendering stale local data forever.
- **No visibility into which account is signed in** — App Settings now shows "Signed in as [email]" (or a "Not signed in" fallback), sourced from the same session check.
- **H1** — Dose corrections now generate an automatic, tamper-proof audit-trail entry (new `dose_event_corrections` table + trigger, migration 0014) — no client code changes needed since corrections were already real Postgres UPDATEs. **Needs the migration run in Supabase before it's live** (not yet executed against a database — no local Postgres available to test-run it directly).
- **C3** — Push reminders were scheduled using server (UTC) time with no timezone handling — fixed in `netlify/functions/schedule-push.js` using `Intl`-based timezone conversion; client now sends its IANA timezone. Verified via direct unit tests across multiple zones and both 2026 US DST transition dates. Rollout caveat: already-scheduled notifications from before this fix self-correct the next time each device opens the app (which now cancels-then-reschedules), not instantly for everyone.
- **C2** — Old, pre-XSS-fix duplicate app copies removed from the repo (`3fe27f2`) and confirmed gone from production (`scriptschedule.app/app-index.html` etc. now correctly serve the current patched app, 210,296 bytes, verified 2026-08-04 via direct fetch after a brief CDN propagation delay).
- Stored XSS across `index.html` — fixed, `escapeHtml()` added at 85 interpolation points.
- All four Netlify functions had zero identity checks — fixed, each now requires a verified Supabase session + per-user rate limiting.
- Misleading privacy copy ("not even us", "no one else, ever") — corrected to accurately describe household-level access control.
- Added self-service account/data deletion, verified end-to-end.
- Added "Sign Out of Other Devices," verified against the live Supabase backend.
- Medication history is archived instead of hard-deleted when a medication is removed.

## Backlog / feature ideas (not scoped or started)

- **Over-the-counter (OTC) medication reminders** — requested 2026-08-06. Not yet scoped: needs a decision on whether OTC meds are just a regular medication entry with a flag, or need their own simpler add-flow (no prescription/pharmacy/refill fields), and whether "as-needed" OTC use (e.g. ibuprofen when needed) should get different reminder/logging treatment than a scheduled prescription. Revisit and scope properly before building.

## How to use this file

When a new issue is found, add it here with a one-line summary and a link/reference to the fuller writeup (audit doc, or inline if small). When something is fixed, move it to "Resolved" with the date and a one-line note on how it was verified — not just "fixed."
