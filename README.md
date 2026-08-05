# ScriptSchedule

A family medication tracker: scan a prescription label, schedule reminders, log doses, and share one household's medication list across every family member's device in real time.

## What's in this repo

- [`index.html`](index.html) — the entire application (vanilla JS, no build step, no framework).
- [`privacy.html`](privacy.html) — the privacy policy page.
- [`netlify/functions/`](netlify/functions/) — four server-side functions (prescription scanning proxy, push-notification scheduling/cancellation, account deletion).
- [`supabase/migrations/`](supabase/migrations/) — the full database schema history, applied by hand in the Supabase SQL editor (see [DEPLOYMENT.md](DEPLOYMENT.md)).
- [`manifest.json`](manifest.json), [`sw.js`](sw.js) — PWA manifest and service worker.

See [ARCHITECTURE.md](ARCHITECTURE.md) for how everything fits together, [SECURITY.md](SECURITY.md) for the security model, [DEPLOYMENT.md](DEPLOYMENT.md) for how to ship a change, [TESTING.md](TESTING.md) for how to verify one, and [KNOWN_ISSUES.md](KNOWN_ISSUES.md) for what's not fixed yet.

**Not a substitute for medical advice.** ScriptSchedule is a medication organization and reminder tool. It is not a replacement for a physician, pharmacist, or emergency services.

## Repo cleanup note

This repo currently contains several old/duplicate copies of the app from earlier iterations (a pre-Supabase landing page, and multiple stale snapshots of the app itself) that are **still live on the production domain** — see [PRODUCTION_READINESS_AUDIT.md](PRODUCTION_READINESS_AUDIT.md), issue C2, before assuming everything in this repo is current or safe to link to.

## Local development

There is no build step for the main app — `index.html` can be opened via any static file server. The four server-side functions in `netlify/functions/` require Netlify Dev (or an equivalent local Netlify Functions runtime) plus the environment variables listed in [`.env.example`](.env.example) to run locally; without it, calls to `/.netlify/functions/*` will 404 against a plain static server.

## Third-party services this app depends on

- **Supabase** — database, auth, realtime sync.
- **Anthropic (Claude)** — prescription/pill/document scanning.
- **OneSignal** — push notification delivery.
- **Netlify** — hosting + serverless functions.

No npm dependencies are installed for the live app; the two client libraries (Supabase JS, OneSignal Web SDK) load from their own CDNs.
