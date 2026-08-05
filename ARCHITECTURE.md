# ScriptSchedule — Architecture

_Last verified against the actual repo contents on 2026-08-04. Everything below was confirmed by reading the real files, not inferred._

## What this is

ScriptSchedule is a **family medication tracker**: scan a prescription label, schedule reminders, log doses, and share the household's medication list across devices in real time.

## Framework & language

- **No frontend framework.** The entire app UI is one file, [`index.html`](index.html) (~214KB), written in vanilla JavaScript. It uses a hand-rolled `state` object + `render()` function that rebuilds the whole UI as an HTML string and paints it via a single `app.innerHTML = buildApp()` call ([index.html:2606](index.html:2606)-ish). There is no React/Vue/Svelte, no JSX, no virtual DOM.
- **No build step, no bundler, no npm dependencies for the app itself.** There is no `package.json` at the repo root. Two external libraries are loaded directly from CDNs via `<script>` tags:
  - `@supabase/supabase-js@2` (jsDelivr)
  - OneSignal Web SDK v16 (`cdn.onesignal.com`)
- **Backend logic** lives in four small Node.js **Netlify Functions** (AWS Lambda under the hood), each a standalone `exports.handler`.
- **Database** is Postgres via **Supabase**, accessed directly from the browser using Supabase's JS client (no custom backend API layer for CRUD — Row Level Security is the only access control on data).

## Frontend structure

- [`index.html`](index.html) — the entire application: onboarding/beta-gate, auth (sign up/in), household setup, medication CRUD, scanning UI, dose logging, reminders, Report tab, Family & Household settings, Privacy & Security card.
- [`privacy.html`](privacy.html) — standalone privacy policy page.
- [`manifest.json`](manifest.json) + [`sw.js`](sw.js) — PWA manifest and service worker (offline caching + OneSignal push handling + notification-action routing). This is what makes the app "installable" on a phone home screen.
- Icons: `icon-152.png` through `icon-512.png`, `favicon.ico` — used by the manifest and Apple touch-icon meta tags.

## Backend structure

`netlify/functions/`:

| File | Purpose |
|---|---|
| `claude.js` | Proxies vision/text requests to Anthropic's Messages API for prescription-label scanning, pill ID, and document extraction. Requires a verified Supabase session; rate-limited 30 req/10min per user. |
| `schedule-push.js` | Schedules OneSignal push notifications for a user's medication times. Requires a verified session; rate-limited 20 req/5min per user. |
| `cancel-push.js` | Cancels previously scheduled pushes for a medication (e.g. on delete). Same auth/rate-limit pattern. |
| `delete-account.js` | Deletes the caller's Supabase Auth login (the one operation that needs the service-role key). Verifies the caller's token first; rate-limited 5/hour. |
| `_shared/security.js` | Shared helpers: `verifyUser(accessToken)` (confirms a real Supabase session) and `checkRateLimit(key, max, windowSeconds)` (calls a Postgres RPC-backed rate limiter). |

None of these functions run any of their own persistent state — the "rate limit" counters live in Supabase (`rate_limits` table), not in Lambda memory, so they survive cold starts.

## Database (Supabase Postgres)

Schema is defined across 13 migration files in `supabase/migrations/` (0001–0013), applied by hand in the Supabase SQL editor — **there is no migration runner/CLI wired up**, so "run this once in the Supabase SQL editor" is the actual deployment mechanism today.

Tables:

| Table | Purpose |
|---|---|
| `households` | One row per family/household. |
| `household_members` | Join table: user ↔ household, with `role`, `display_name`, `onesignal_subscription_id`. |
| `family_members` | People/pets in a household; `caregiver_user_id` controls who gets push reminders for them. |
| `medications` | Name, dose, frequency, `times` (jsonb array of "HH:MM" strings), `start_date`, `duration_days`, `refills_remaining`, `archived_at`. |
| `dose_events` | One row per (medication, date, time) slot; `status` ∈ taken/snoozed/skipped/missed; `unique(medication_id, dose_date, dose_time)` means **correcting a dose overwrites the same row** rather than adding a new "corrected" entry (see audit, High-2). |
| `emergency_profiles` | Blood type, allergies, doctor/emergency contacts per person. |
| `documents` | Uploaded/scanned document metadata + AI-extracted structured fields. |
| `household_invites` | Short codes for joining an existing household. |
| `rate_limits` | Backing store for the Netlify functions' per-user rate limiter (added 0013). |

**Row Level Security is on for every table.** Access is scoped via an `is_household_member(household_id)` helper — a user can only read/write rows belonging to a household they're a member of. Several RPCs (`create_household_with_owner`, `redeem_household_invite`, `rename_family_member`, `delete_my_account`, `check_rate_limit`) run as `SECURITY DEFINER` for the specific operations that legitimately need to bypass RLS (e.g. joining a household you're not a member of yet).

**Realtime** is enabled (`supabase_realtime` publication) on `medications`, `dose_events`, `family_members`, `emergency_profiles`, `documents` — this is how multiple devices in the same household see changes live.

## Authentication

**Supabase Auth** (email + password). No custom auth code — sign-up/sign-in/sign-out/password hashing are all Supabase's own managed service; the app never sees a password hash. A separate, unrelated **beta access code** (`appleaday26`, hardcoded client-side at [index.html:839](index.html:839)) gates the onboarding flow — this is a shared "you're one of our beta testers" gate, not a security boundary, and isn't meant to be one.

## Hosting

**Netlify.** [`netlify.toml`](netlify.toml) is minimal: `publish = "."` — the entire repo root is published as static files, with no build command. [`_redirects`](_redirects) has one rule, `/* /index.html 200`, for SPA-style routing — but this only applies when no file physically exists at the requested path, which matters (see audit, Critical-2).

## Notifications

**OneSignal Web Push**, via the SDK loaded client-side (App ID hardcoded at [index.html:25](index.html:25) — this is a public identifier, not a secret) and `sw.js` (imports OneSignal's own service-worker script). Scheduling and cancellation go through the two Netlify functions above, which call OneSignal's REST API server-side.

## Prescription scanning / "OCR"

There is no traditional OCR library. Scanning works by sending a photo to **Anthropic's Claude API** (via `claude.js`) with a prompt asking it to read the label/pill/document and return structured JSON. The photo itself is not stored server-side — only the extracted text fields are saved to the household's data.

## Analytics & crash reporting

**None found.** No Sentry, no Firebase Analytics/Crashlytics, no PostHog, no Mixpanel, no error-tracking service of any kind. Errors are handled locally (toasts, `console.warn`) with no remote visibility into what's failing for real users.

## Third-party APIs

- **Supabase** — database, auth, realtime.
- **Anthropic (Claude)** — prescription/pill/document scanning.
- **OneSignal** — push notification delivery.

## Third-party packages

None for the live app (loaded via CDN, not npm). There is one unrelated, unused `package.json` inside `scriptschedule/` (react, react-dom, react-scripts) — see "Duplicate/abandoned files" below; it is disconnected from the deployed app.

## Environment variables

Set in Netlify (Site settings → Environment variables). **Names only — no values recorded here or anywhere in this repo:**

- `ANTHROPIC_API_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ONESIGNAL_APP_ID`
- `ONESIGNAL_REST_API_KEY`

The Supabase project URL and anon/publishable key, and the OneSignal App ID, are hardcoded in client-side files. This is intentional and safe for those specific values — they are meant to be public; Supabase's RLS and OneSignal's server-side REST key are the actual access controls.

## Testing

**None exists.** No unit tests, integration tests, or end-to-end tests. No test framework is installed (no Jest/Vitest/Playwright/Cypress config anywhere). No CI pipeline (no `.github/workflows`, no other CI config).

## Build & deployment process

Push to the connected git branch → Netlify auto-deploys (static publish, no build command, functions auto-bundled by Netlify's default bundler). There is no staging environment, no CI gate, no automated smoke test before a deploy goes live.

## Apple & Android configuration

**None exists.** This is a web app / PWA only:
- No Xcode project, no `ios/` directory, no bundle identifier.
- No Android Studio project, no `android/` directory, no package name, no `AndroidManifest.xml`.
- No Capacitor, Cordova, React Native, or Expo wrapper of any kind.

**This is the single biggest gap relative to an "App Store release" goal** and needs an explicit decision from you before any Phase 17 work can proceed — see the audit's Critical-1.

## Known unfinished features / gaps (from this session's work and code inspection)

- No MFA, no admin-specific account protections, no separate "admin" concept at all (whoever has the Supabase/Netlify login has full access).
- No automatic session expiry; "Sign Out of Other Devices" (added this session) is manual/self-service only.
- Dose corrections overwrite history in place rather than layering a distinct "corrected" entry (see audit High-2).
- No timezone handling in reminder scheduling (see audit Critical-3) — a serious, verified bug for reminder accuracy.
- No crash reporting, error monitoring, or backup-failure alerting.
- No data export feature.

## Duplicate, unused, or abandoned files

Found in the repo root, verified by reading each:

| Path | What it is | Status |
|---|---|---|
| `app-index.html`, `app.js`, `style.css`, `app-index.zip`, `files.zip` | An earlier, front-end-only marketing/landing page ("ScriptSchedule Netlify Redesign" per `README.txt`) — a fake beta-signup form that "does not send data anywhere." Fully superseded by the real app. | **Dead, but publicly deployed** (see audit Critical-2) |
| `index .html` (note the space in the filename) | A stray duplicate of an older `index.html`, apparently created via a GitHub web-UI edit (git history shows `Update index .html` commits parallel to `index.html`). 129KB, predates the XSS fix. | **Dead, but publicly deployed** |
| `ScriptSchedule-App/` (with its own `index.html`, `index-app-CURRENT.html`, `manifest.json`, `sw.js`, icons) | An older, self-contained snapshot of the app. | **Dead, but publicly deployed** |
| `scriptschedule-app 2/` (its own `index.html`, `netlify/`, `netlify.toml`) | Another older snapshot. | **Dead, but publicly deployed** |
| `scriptschedule/` (React + `react-scripts` + `src/`/`public/`) | A completely different, abandoned Create-React-App scaffold — different tech stack, never wired to the live site's `netlify.toml`. | Dead, not deployed (has its own `netlify.toml` but Netlify only builds the site connected in its dashboard) |
| `paper-before.png`, `app-showcase.png`, `brand-mark.png` at repo root **and** duplicated inside `assets/` | Marketing images used only by the dead landing page. | Dead, duplicated (~12MB total) |
| `assets/test.txt` | A 1-byte placeholder file. | Dead |

**None of this was deleted in this pass** — removing files/directories is exactly the kind of change the working rules require flagging first. See the audit's Critical-2 for why several of these are more than just clutter.

## Areas worth a closer look (not necessarily bugs, but notable)

- The entire live app renders through one `innerHTML` assignment built from a template string touching every piece of state — this is why `escapeHtml()` had to be applied at 85 separate interpolation points to fix the stored-XSS issue found earlier this session; any *new* interpolation point added in the future needs the same discipline, since there's no framework-level auto-escaping to fall back on.
- Git history contains several "temporary diagnostic" commits (since removed) that had a debug-only branch in `delete-account.js` returning partial `SUPABASE_SERVICE_ROLE_KEY` metadata (12-char prefix, 6-char suffix, decoded JWT claims — not the full key) while troubleshooting an "Invalid API key" error. The debug branch is confirmed gone from the current file, and this metadata alone isn't enough to reconstruct the real key, but it's visible to anyone with repo access in history. Noted for completeness.
