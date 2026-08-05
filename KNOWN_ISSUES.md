# ScriptSchedule — Known Issues

Running log of open issues. Full detail (why it matters, recommended fix, test plan) lives in [PRODUCTION_READINESS_AUDIT.md](PRODUCTION_READINESS_AUDIT.md) — this file is the short list for quick reference, kept in sync with it.

## Open — Critical

- **C1** — Native app: decision made (Capacitor) and scaffolding committed (`4658c90`). Blocked on local tooling: iOS needs full Xcode.app installed (only CLT present), Android needs a JDK installed (none present). Not a code issue — install both, then `npx cap open ios` / `npx cap open android`.
- **C4** — Zero automated tests, zero CI.

## Open — High

- **H1** — Dose corrections overwrite history in place; no distinct "corrected" status or audit trail of the correction itself.
- **H2** — No MFA, no admin-specific account protections.
- **H3** — No automatic session expiry; lost/stolen device stays signed in until manually revoked from another device.
- **H4** — No crash reporting, error monitoring, or backup-failure alerting.
- **H5** — Git history contains removed debug-endpoint output with partial (non-exploitable) service-role key metadata — recommend rotating the key as a precaution.
- **H6** — Abandoned React scaffold (`scriptschedule/`) and ~12MB of duplicated marketing images clutter the repo.

## Open — Medium / Low

See the audit's Medium/Low sections — representative, not yet an exhaustive sweep (accessibility, offline behavior, data export, pagination, performance at scale all still need a dedicated pass).

## Resolved this session (for the record)

- **C3** — Push reminders were scheduled using server (UTC) time with no timezone handling — fixed in `netlify/functions/schedule-push.js` using `Intl`-based timezone conversion; client now sends its IANA timezone. Verified via direct unit tests across multiple zones and both 2026 US DST transition dates. Rollout caveat: already-scheduled notifications from before this fix self-correct the next time each device opens the app (which now cancels-then-reschedules), not instantly for everyone.
- **C2** — Old, pre-XSS-fix duplicate app copies removed from the repo (`3fe27f2`) and confirmed gone from production (`scriptschedule.app/app-index.html` etc. now correctly serve the current patched app, 210,296 bytes, verified 2026-08-04 via direct fetch after a brief CDN propagation delay).
- Stored XSS across `index.html` — fixed, `escapeHtml()` added at 85 interpolation points.
- All four Netlify functions had zero identity checks — fixed, each now requires a verified Supabase session + per-user rate limiting.
- Misleading privacy copy ("not even us", "no one else, ever") — corrected to accurately describe household-level access control.
- Added self-service account/data deletion, verified end-to-end.
- Added "Sign Out of Other Devices," verified against the live Supabase backend.
- Medication history is archived instead of hard-deleted when a medication is removed.

## How to use this file

When a new issue is found, add it here with a one-line summary and a link/reference to the fuller writeup (audit doc, or inline if small). When something is fixed, move it to "Resolved" with the date and a one-line note on how it was verified — not just "fixed."
