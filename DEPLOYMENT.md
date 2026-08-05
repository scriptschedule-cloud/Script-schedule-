# ScriptSchedule — Deployment

## Hosting

Netlify, connected to this git repository. `netlify.toml` sets `publish = "."` (whole repo root, no build command) — pushing to the connected branch deploys automatically. There is no staging environment and no CI gate before a deploy goes live.

**Known issue:** because the whole repo root is published, old/duplicate HTML files are also live at their own URLs — see [PRODUCTION_READINESS_AUDIT.md](PRODUCTION_READINESS_AUDIT.md) C2. Cleaning up the repo root (removing dead files) directly reduces what's publicly reachable.

## Environment variables (set in Netlify → Site settings → Environment variables)

| Variable | Used by | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | `netlify/functions/claude.js` | Prescription/pill/document scanning |
| `SUPABASE_SERVICE_ROLE_KEY` | `netlify/functions/delete-account.js` | The one operation that needs to bypass RLS (deleting the auth user itself) |
| `ONESIGNAL_APP_ID` | `netlify/functions/schedule-push.js`, `cancel-push.js` | Push notification scheduling |
| `ONESIGNAL_REST_API_KEY` | same | Push notification scheduling |

See [`.env.example`](.env.example) for the reference list (no real values are ever stored in this repo).

## Database migrations

**There is no migration runner.** Each file in `supabase/migrations/` (0001 through the latest) is applied by hand, in order, by pasting it into the Supabase SQL editor for the project. Each migration file documents in its own header comment what it fixes and what it depends on. Before running a new migration against production:

1. Read the migration file's header comment in full.
2. Confirm it's being applied in the correct numeric order (some migrations `drop function`/`alter table` in ways that assume prior migrations already ran).
3. There is currently no automated backup step before running a migration — take a manual Supabase backup/snapshot first if the migration touches existing data (not just adding new columns/tables).
4. There is no tested rollback procedure for any migration in this repo today — this is a real gap (see audit, Phase 11 scope) worth addressing before further schema changes ship to production data.

## Rolling back a deploy

Netlify keeps prior deploy snapshots — use Netlify's own "restore this deploy" feature from the dashboard for a code-only rollback. This does **not** roll back database migrations, which are one-way unless a corresponding down-migration is written by hand (none exist today).

## Local development

No build step for `index.html` itself. To exercise the Netlify functions locally, use Netlify Dev with the environment variables above set in a local `.env` (never commit this file — see `.gitignore`).
