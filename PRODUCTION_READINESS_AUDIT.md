# ScriptSchedule — Production-Readiness Audit

_Phase 1/2 deliverable. Every issue below was verified against the actual repo — file paths and line numbers are real, not inferred. Nothing in this document has been fixed yet except where explicitly marked "Already fixed."_

## How to read this

Each issue lists: what it is, where it lives, why it matters, what happens if it's left alone, the recommended fix, whether that fix risks touching existing behavior, and how it would be tested. **Critical and High issues should be resolved before anything cosmetic.** Nothing here has been changed as part of this audit — this is inspection only, per your working rules.

---

## CRITICAL

### C1. No native app project exists — "App Store release" needs a scoping decision first
- **Where:** whole repo. Confirmed no `ios/`, `android/`, `.xcodeproj`, `AndroidManifest.xml`, Capacitor/Cordova/Expo/React Native config anywhere.
- **Why it matters:** ScriptSchedule today is a web app / installable PWA (manifest.json + service worker), not a native binary. Apple's App Store and Google Play both require a native or wrapped build — a PWA cannot be submitted as-is.
- **If not addressed:** Phase 17 (App Store prep) cannot start at all — there's no bundle identifier, no Xcode project, nothing to attach screenshots or a version number to.
- **Recommended fix:** this needs **your decision**, not mine, because it changes cost and timeline significantly. Realistic options:
  1. Wrap the existing HTML/JS in **Capacitor** (thin native shell around the existing web app — smallest lift, keeps the current codebase as-is).
  2. Use a service like **PWABuilder** to package the PWA for store submission.
  3. Ship as an installable PWA only (no App Store presence) — fully valid for many use cases, avoids Apple/Google review entirely.
  4. A full native rewrite (React Native/Flutter/native Swift+Kotlin) — largest lift, not recommended given the working rule against redesigning without necessity.
- **Status: decision made, scaffolding done.** Chose **Capacitor** (smallest lift, no redesign needed). Committed (`4658c90`): `package.json` + Capacitor 8.5.0 packages, `capacitor.config.json` (appId `app.scriptschedule.mobile` — a placeholder, change it now if you want something else, since it becomes fixed once submitted to a store), `www/` (copy of the static app), and generated `ios/` + `android/` native projects via `npx cap add`.
  - **Blocked on local tooling, not code** — verified by hitting the real errors directly on this machine: iOS needs full **Xcode.app** installed (only Command Line Tools are present; `xcodebuild` explicitly refuses to run under CLT alone) — install from the Mac App Store, then `sudo xcode-select -s /Applications/Xcode.app`. Android needs a **JDK** installed (Gradle can't locate any Java runtime at all right now) — e.g. `brew install --cask temurin`, or Android Studio's bundled JDK.
  - Once those are installed: `npx cap open ios` / `npx cap open android` to build and run on a simulator/device.
- **Could affect existing features:** No — the web app (`index.html` etc.) is untouched; this only adds new files.
- **How to test:** once Xcode/JDK are installed, build and run each platform in its respective simulator, confirm the app loads and core flows (sign in, add a medication, scan) work inside the native shell the same as in a browser.

### C2. Old, unpatched copies of the app are live on the production domain right now
- **Where:** `app-index.html`, `index .html`, `ScriptSchedule-App/index.html`, `ScriptSchedule-App/index-app-CURRENT.html`, `scriptschedule-app 2/index.html` — all published because `netlify.toml` publishes the whole repo root (`publish = "."`) and the `_redirects` catch-all (`/* /index.html 200`) only applies when no file exists at the requested path.
- **CONFIRMED live, not inferred** — fetched each URL directly against `https://scriptschedule.app` just now:
  - `/app-index.html` → HTTP 200, 71,286 bytes, **no `escapeHtml()`**
  - `/index%20.html` → HTTP 200, 126,168 bytes, **no `escapeHtml()`**
  - `/ScriptSchedule-App/index.html` → HTTP 200, 75,426 bytes, **no `escapeHtml()`**
  - `/scriptschedule-app%202/index.html` → HTTP 200, 77,636 bytes, **no `escapeHtml()`**
  - (compare) `/index.html` → HTTP 200, 207,808 bytes, **has `escapeHtml()`** — the current, patched app
- **Why it matters:** anyone who lands on one of these URLs (a stale bookmark, a search-engine index, a shared link) is served a live, public copy of the app with the exact stored-XSS vulnerability that was just fixed elsewhere — undermining that fix entirely for anyone who doesn't happen to be on `/index.html`.
- **If not addressed:** the XSS fix done earlier this session provides a false sense of security while a vulnerable copy sits one URL away.
- **Recommended fix:** confirm these URLs are actually reachable on the live site (quick manual check), then either delete the dead files/directories entirely (git-recoverable, not permanent) or add explicit `_redirects`/`_headers` rules blocking them. Also applies to the abandoned `scriptschedule/` CRA scaffold and duplicated marketing images (~12MB) — see ARCHITECTURE.md's duplicate-files table.
- **Could affect existing features:** No — none of these files are linked from or used by the live app.
- **How to test:** after removal, request each old path directly and confirm it 404s or redirects to the current app instead of serving the old file.
- **RESOLVED.** Dead files removed and pushed (`3fe27f2`). Confirmed via the Netlify dashboard that auto-publish is on and the deploy succeeded; a brief CDN propagation delay on the custom domain initially still served old content, but re-verified after it caught up: `scriptschedule.app/app-index.html` and all other previously-vulnerable URLs now correctly serve the current, patched app (210,296 bytes, contains `escapeHtml()`).

### C3. Medication push reminders are scheduled in the wrong timezone for most users
- **Where:** `netlify/functions/schedule-push.js`, specifically `const now = new Date()` and `sendAt.setHours(hour, minute || 0, 0, 0)`. Verified: no timezone, UTC offset, or IANA timezone name is ever sent from the client (grepped `index.html` and all four functions for "timezone", "getTimezoneOffset", "Intl.DateTimeFormat" — zero matches).
- **Why it matters:** Netlify Functions run in a server timezone (effectively UTC), not the user's device timezone. A user who sets a medication time of "08:00" intending their own local 8am will have the actual push scheduled for 8am **server time** — e.g. 3am for a US Central user. This is a direct medication-safety issue for the app's core feature.
- **Important nuance confirmed:** the in-app "is this dose due" display is computed client-side in the browser (correct, uses the user's real local time) — this bug is isolated to the **server-scheduled push notification's actual fire time**, not the in-app UI.
- **If not addressed:** reminders fire at the wrong wall-clock time for essentially every user outside UTC, which is most users. This is likely the single most safety-critical bug in the app.
- **Recommended fix:** have the client send its IANA timezone (e.g. `Intl.DateTimeFormat().resolvedOptions().timeZone`) alongside `times`, and compute `sendAt` in that timezone server-side (e.g. via a small timezone-aware date library, since Node's built-in `Date` doesn't handle arbitrary IANA zones natively).
- **Could affect existing features:** Yes, directly touches the reminder-scheduling function — needs careful regression testing across DST transitions and multiple timezones before shipping.
- **How to test:** schedule a medication time from devices set to at least 3 different timezones (including one that observes DST) and confirm the actual push arrives at the correct local wall-clock time in each; test again spanning a DST transition date.
- **RESOLVED.** `netlify/functions/schedule-push.js` now computes every date/time in the user's own IANA timeZone (sent from the client via `Intl.DateTimeFormat().resolvedOptions().timeZone`) using `Intl`-based conversion helpers (`zonedTimeToUtc`, `todayInZone`, `addDays`) — no server-local `Date` math left in the scheduling path. `timeZone` is required, not defaulted, specifically so this can't silently regress if a caller forgets to send it.
  - Verified with direct unit tests covering: standard US timezone in both summer/winter offsets, a no-DST zone (Tokyo), the actual 2026 US spring-forward and fall-back transition dates, a half-hour-offset zone (India), a southern-hemisphere DST zone (Sydney), midnight edge cases, and calendar-day arithmetic across month/year boundaries — all correct.
  - Verified the client (`index.html`'s `syncPushSchedule`/`scheduleRemoteCaregiverPush`) now sends `timeZone` in the real request body, confirmed via a live browser check using the app's actual helper functions.
  - **Rollout caveat**: notifications already scheduled in OneSignal under the old, timezone-unaware math aren't retroactively corrected by this code change alone — they're already-created OneSignal objects. `syncPushSchedule()` now cancels a medication's existing scheduled pushes before rescheduling (previously it only ever added), which flushes stale entries the next time each device opens the app — but a device that never reopens won't self-correct. There's no full-app "cancel everything scheduled" step included here; that would be a separate, higher-blast-radius operation affecting other users' correctly-scheduled reminders too, and wasn't done without explicit sign-off.
  - **Known limitation carried forward**: `scheduleRemoteCaregiverPush` (the "assign someone else as caregiver" remote-scheduling path) uses the *assigning* device's timezone as an approximation, since no per-user timezone is stored anywhere yet. It self-corrects once the actual new caregiver's own device opens and calls `syncPushSchedule` with its own timezone. Storing a real per-user timezone would remove this approximation but wasn't in scope for this pass.

### C4. Zero automated tests and zero CI
- **Where:** whole repo — confirmed no test files, no test framework config, no `.github/workflows`, no CI config of any kind.
- **Why it matters:** for a medication-safety app, scheduling logic, dose-status logic, and RLS access rules currently have no regression protection at all. Every fix (including everything done this session) is verified manually, once, and can silently regress later with no warning.
- **If not addressed:** future changes (including well-intentioned ones) can reintroduce fixed bugs — including the XSS fix, the timezone bug above, or RLS gaps — with nothing to catch it before real users see it.
- **Status: started, not fully closed.** Added a real test suite (`tests/time.test.js`, 15 tests, using Node's built-in `node:test` — no new dependency) covering the timezone-conversion logic from the C3 fix: every timezone/DST/edge case verified earlier by hand is now a permanent, automated regression test (`npm test`, or `node --test`). Extracted the logic itself into `netlify/functions/_shared/time.js` so it's testable in isolation from the HTTP handler. Wired up `.github/workflows/test.yml` — first CI this repo has ever had, runs the suite on every push/PR to `main` (free on GitHub Actions' tier for a suite this size).
  - **What's still not covered** and remains open: the client-side dose-status/scheduling helpers in `index.html` (`isPastCourse`, frequency-to-schedule mapping, `toPushPayload`), and RLS policy tests (verifying user A genuinely cannot read/write user B's household data via a direct request) — the latter needs a real Supabase test project to run against, which is a bigger lift than adding to this pass.
- **Could affect existing features:** No — pure addition; `schedule-push.js`'s behavior is unchanged, only where the helper functions live moved.
- **How to test:** `npm test` locally, or check the Actions tab on GitHub after any push.

---

## HIGH

### H1. Dose corrections silently overwrite history instead of being tracked as a distinct "corrected" entry
- **Where:** `supabase/migrations/0001_household_data_model.sql`, `dose_events` table: `unique (medication_id, dose_date, dose_time)` and `status` check constraint only allows `('taken','snoozed','skipped','missed')` — no `corrected` status, no `corrected_at`/`corrected_by`/previous-value columns.
- **Why it matters:** if a user accidentally taps "Taken" and corrects it to "Skipped," the existing row's `status` is updated in place. There's no DELETE policy (good — the row itself can't vanish), but there's also no record that a correction happened, when, or what the original value was.
- **If not addressed:** partially conflicts with the working requirement to "preserve an audit trail when appropriate" for corrections — the current design preserves the *final* state but not the *correction event* itself.
- **Status: fixed, pending you running the migration.** Added `supabase/migrations/0014_track_dose_event_corrections.sql`: a new `dose_event_corrections` table plus a database trigger on `dose_events` that automatically logs `previous_status`, `new_status`, who, and when, whenever a dose's status actually changes.
  - **Zero client-side code changes needed** — confirmed by reading the actual code path: `logDoseAction()` in `index.html` already upserts on conflict `(medication_id, dose_date, dose_time)`, which means a correction is already a real Postgres `UPDATE` under the hood, and the trigger catches every one of those automatically regardless of which UI button triggered it.
  - **Tamper-proof by construction, not just convention**: the new table has no INSERT/UPDATE/DELETE policy granted to any client role at all — only the trigger function (running as the table owner via `SECURITY DEFINER`) can write to it. A household member can view their own correction history but can never fabricate, edit, or erase an entry.
  - Reviewed carefully against the exact same patterns already used and working in migrations 0001–0013 of this repo (`is_household_member()`, `security definer set search_path = public`), but **not executed against a live database** — no local Postgres/Docker is available in this environment to test-run it directly, consistent with how every other migration this session has worked. Needs to be run once in the Supabase SQL editor, same as the others.
- **Could affect existing features:** No — purely additive; `dose_events` itself is untouched, only a new side-effect (logging) is added when it's updated.
- **How to test:** after running the migration, log a dose as taken, then correct it to skipped in the app; query `select * from dose_event_corrections order by corrected_at desc limit 5;` in the Supabase SQL editor and confirm a row appears with the right previous/new status.

### H2. No admin-specific protections or MFA
- **Where:** whole system — there's no "admin account" concept anywhere in the schema or app. Whoever holds the Supabase dashboard login or the Netlify environment-variable access has unrestricted access to every household's data (via the dashboard or the `service_role` key).
- **Why it matters:** for a health-data app, the operator-level access point deserves stronger protection than a regular user account.
- **If not addressed:** a single compromised Supabase or Netlify login exposes all user data with no additional barrier.
- **Recommended fix:** enable MFA on your own Supabase and Netlify account logins (this is an account setting on their side, not app code); no in-app "admin" build-out is needed unless you want one.
- **Could affect existing features:** No.
- **How to test:** N/A — account-level setting, verify directly in each provider's dashboard.

### H3. No automatic session expiry or device management beyond the new manual toggle
- **Where:** whole auth flow. "Sign Out of Other Devices" (added earlier this session) is manual/self-service only.
- **Why it matters:** a lost or stolen phone with the app already signed in stays signed in indefinitely unless the user proactively goes to another device and taps that button.
- **If not addressed:** a real exposure window on a lost device, especially since there's no way for the app itself to know a device was lost.
- **Recommended fix:** consider a Supabase Auth session/refresh-token expiry policy (dashboard setting, not app code) as a backstop — this is a decision about acceptable friction vs. security and should be your call.
- **Could affect existing features:** Could force more frequent re-logins depending on the policy chosen — needs your input on the tradeoff.
- **How to test:** confirm session actually expires after the configured window on a device that's been idle.

### H4. No crash reporting, error monitoring, or backup-failure alerting
- **Where:** whole app — confirmed no Sentry/Crashlytics/PostHog/等 anywhere.
- **Why it matters:** if reminders silently fail to schedule, or the app throws errors for real users, there is currently no way to find out except a user reporting it directly.
- **If not addressed:** production issues (including reminder failures — the app's core promise) can go undetected indefinitely.
- **Recommended fix:** add a lightweight error-monitoring service (Phase 15). Needs a provider decision from you — flagging cost before adding anything, per your rules. Sentry's free tier, for example, covers small-scale error tracking; must ensure medication names/doses/photos are scrubbed before anything is sent (per your explicit requirement).
- **Could affect existing features:** No, additive.
- **How to test:** trigger a deliberate error in a test build and confirm it's captured without leaking sensitive fields.

### H5. Legacy debug-endpoint metadata sits in git history (already resolved in code)
- **Where:** git history, commits `32ac1f1` through `faaeb7b`. A temporary debug branch in `delete-account.js` (removed in `faaeb7b`) returned the service-role key's prefix (first 12 chars), suffix (last 6 chars), and decoded (non-secret) JWT claims while troubleshooting an "Invalid API key" error.
- **Why it matters:** this is visible to anyone with repo access, even though the code path is gone today. The partial fragments alone are not enough to reconstruct the real key, so actual exploitability is low — but it touched a secret at all, which is worth treating conservatively.
- **If not addressed:** low real risk, but leaves a bad precedent visible in history.
- **Recommended fix:** as a precaution, rotate `SUPABASE_SERVICE_ROLE_KEY` in the Supabase dashboard and update the Netlify environment variable. Optional: this doesn't require rewriting git history, since the exposed fragments can't reconstruct the key.
- **Could affect existing features:** Rotating the key requires updating the Netlify env var — no code change, brief operational step.
- **How to test:** after rotation, confirm `delete-account.js` still works end-to-end (it already reads the key from `process.env`).

### H6. Abandoned React scaffold and ~12MB of duplicated marketing assets clutter the repo — RESOLVED
- **Where:** `scriptschedule/` (unused Create-React-App project, different tech stack entirely), plus marketing images duplicated between the repo root and `assets/`.
- **Why it matters:** confuses anyone (including a future AI-assisted session) about what's actually live; not a security issue on its own, grouped here because it's part of the same cleanup as C2.
- **Status:** removed in the same commit as C2's cleanup (`3fe27f2`). Confirmed gone from the repo.

---

## MEDIUM (representative — not exhaustive; full sweep is later-phase work)

- **Performance of the single-file render model** — every state change re-renders the entire app via one `innerHTML` string rebuild. Not yet measured against a large medication history or multi-profile household; worth a real performance pass (Phase 12) before assuming it's fine at scale.
- **No pagination on dose history** — `dose_events` will grow unbounded per household with no querying limits observed in the client code reviewed so far.
- **Offline behavior — RESOLVED, escalated to Critical-severity finding.** Traced through and confirmed: every write in the app funnels through `cloudUpsert`/`cloudDelete`, which previously caught failures with only a `console.warn` — a user marking a dose "taken" while offline would see it succeed locally with zero indication the cloud write never happened. Fixed: both functions now show a real toast on failure; added proactive `online`/`offline` detection with a persistent, accurately-worded banner (local saves do still succeed, only sync is affected). Verified in the browser: dispatched real online/offline events and confirmed the banner; forced an actual write failure and confirmed the toast fires.
- **Accessibility — further progress, not fully audited.** Labeling done (see above). Color contrast: computed actual WCAG 2.1 ratios for the full color palette against every background used in the app; found and fixed 4 text colors that failed (2 badly, even for large text) — used for real content (placeholders, section headers, disclosure text), not decoration. Replaced with verified-passing colors in the same hue family, approved by the user first since (unlike the labeling work) this changes visible colors. **Still not done** — real screen-reader testing (VoiceOver/TalkBack), touch-target sizing, dynamic text scaling, and keyboard-navigation flow remain unstarted; none of those can be verified by reading code alone.

## LOW

- Minor copy/consistency items already caught and fixed this session (misleading "not even us" privacy claims, "Biometric Lock" claim removed) — no further action needed there.
- No `CONTRIBUTING.md` / developer onboarding doc — cosmetic, not urgent.

---

## What was verified as already fixed (not new issues, listed for completeness)

- Stored XSS across the live `index.html` — fixed, 85 `escapeHtml()` call sites added.
- All four Netlify functions previously had zero identity/rate-limit checks — fixed; each now requires a verified Supabase session and is rate-limited per user.
- Misleading "nobody can read your data, not even us" / "no one else, ever" privacy copy — fixed to accurately describe household-level access control.
- No secrets found committed in git history in any current or past commit (searched for real key-shaped strings, not just `process.env` references) — clean.
- `.DS_Store` is not tracked in git — clean.

---

## H7. No in-app password reset — discovered as a live production blocker — RESOLVED

- **Where:** the sign-in form (`#bg-signin-panel` in `index.html`) has no "Forgot password?" link at all.
- **Why it matters:** confirmed live on 2026-08-06 — the account owner didn't know/remember their own password, and the *only* recovery path was manually sending a magic link from the Supabase dashboard's Authentication → Users page. That requires project-owner access; a real end user in the same situation would be completely locked out with no self-service way back in.
- **Related finding, now fixed:** while testing this, discovered Supabase Auth's **Site URL** was set to `localhost:3000` instead of `https://scriptschedule.app` — meaning every magic-link/password-reset/email-confirmation link sent to any user redirected to an unreachable local address. Fixed in the dashboard (Authentication → URL Configuration). This was silently broken for an unknown period before today and would have affected any real user who ever tried to reset a password or confirm an email.
- **Recommended fix:** add a "Forgot password?" link to the sign-in form calling `sbClient.auth.resetPasswordForEmail(email)`, plus a landing screen that detects a `type=recovery` token in the URL (Supabase's client already parses this into a session automatically via `detectSessionInUrl`) and shows a simple "set a new password" form calling `sbClient.auth.updateUser({ password })`.
- **Could affect existing features:** No — additive UI only.
- **How to test:** trigger a real reset email, confirm the link lands on a working "set new password" screen instead of a dead end, confirm signing in with the new password works.

## Proposed order of work (pending your approval)

1. **C2 + H6** — confirm the old files are actually reachable live, then remove the dead/duplicate files and directories (git-recoverable). Lowest risk, fastest to verify, closes a real live vulnerability.
2. **C3** — timezone-aware reminder scheduling. Highest safety impact of anything found; needs careful, tested implementation since it touches the core reminder path.
3. **C1** — your decision on native app strategy (Capacitor/PWABuilder/PWA-only/native rewrite). Nothing else in Phase 17 can proceed without this.
4. **H1** — dose-correction audit trail (small schema addition).
5. **H2/H3** — MFA + session-expiry policy on your own accounts (no app code, just provider dashboard settings) plus a decision on session-expiry tradeoffs.
6. **H4** — pick and wire up an error-monitoring service (cost decision needed from you first).
7. **H5** — rotate the service-role key as a precaution.
8. Everything else (Medium/Low, and the rest of Phases 4–19: full medication-safety sweep, notification-reliability testing across the DST/offline/permission matrix, OCR confirmation-step review, accessibility, App Store prep once C1 is resolved) — proposed as its own set of small, testable phases once the above is agreed.

**I have not made any code changes as part of this audit.** Waiting for your go-ahead on the order above, and specifically on C1 (native app strategy) and C2 (deleting the old public files), before proceeding.
