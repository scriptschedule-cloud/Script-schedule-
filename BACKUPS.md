# ScriptSchedule — Database Backups

Supabase's Free plan (what this project runs on) doesn't include any automated
backups — that's a Pro-plan feature ($25/mo, 7-day daily retention). Until/unless
this project upgrades, `.github/workflows/backup.yml` is the free substitute: a
daily GitHub Action that dumps the whole database, encrypts it, and stores it as
a build artifact.

## One-time setup (required — the workflow will fail without this)

This repo is **public**, so anyone can see the workflow file itself and its logs
— but not the two secrets below, which GitHub keeps encrypted and never prints
even in a public repo's logs.

1. **`SUPABASE_DB_URL`** — the database connection string.
   - Supabase dashboard → this project → **Connect** button (top of the page) → **Direct connection** tab.
   - Use the **Session pooler** option, not "Direct connection" itself — despite the tab's name, "Direct connection" only resolves over IPv6 unless you pay for Supabase's IPv4 add-on, and GitHub Actions runners have no IPv6 route (this failed with `Network is unreachable` before switching). Session pooler works over IPv4 for free and is what this workflow actually needs. It looks like:
     `postgresql://postgres.txaezqhbtjbtbxwlveoq:[YOUR-PASSWORD]@aws-1-us-east-2.pooler.supabase.com:5432/postgres`
     (note the `postgres.txaezqhbtjbtbxwlveoq` username format — different from Direct connection's plain `postgres`)
   - Copy it with the real password filled in, and paste it as **one single line with no trailing blank line** — a stray newline after `/postgres` causes `pg_dump: error: ... database "postgres\n" does not exist`, which is exactly what happened the first time.

2. **`BACKUP_PASSPHRASE`** — a long random passphrase *you* generate, not Claude. This encrypts every backup; anyone with this passphrase (or the Supabase DB password above) can read your household's full medical data, so treat it exactly like that.
   - Generate one locally: `openssl rand -base64 32`
   - Save it in your password manager — if you lose it, every backup becomes permanently unreadable, encrypted data with no key.

3. Add both as **repository secrets**: GitHub → this repo → **Settings → Secrets and variables → Actions → New repository secret**. Name them exactly `SUPABASE_DB_URL` and `BACKUP_PASSPHRASE`.

4. Test it: **Actions tab → Database Backup → Run workflow** (the `workflow_dispatch` trigger lets you run it on demand instead of waiting for the 08:00 UTC daily schedule). Confirm it finishes green and produces an artifact.

## Restoring from a backup

1. GitHub → **Actions → Database Backup** → pick a run → download the `scriptschedule-backup-<run-id>` artifact (a zip containing `backup.sql.gpg`).
2. Decrypt it:
   ```bash
   gpg --batch --passphrase "YOUR_BACKUP_PASSPHRASE" --decrypt backup.sql.gpg > backup.sql
   ```
3. Restore into a database (ideally a **new/scratch** Supabase project first, to verify it before ever touching production):
   ```bash
   psql "postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres" -f backup.sql
   ```
   This Direct connection string usually works fine here since you're running it from your own machine (with normal internet routing), not a GitHub Actions runner — but if you hit `Network is unreachable`, swap in the Session pooler connection string instead (same format as `SUPABASE_DB_URL` above).
4. **Never run step 3 directly against the live production database** unless you've already confirmed data loss and deliberately intend to overwrite it — restoring is itself a destructive operation on whatever it targets.

## Limitations of this approach (vs. Supabase Pro's built-in backups)

- **Retention is 14 days**, not 7 — but only via GitHub Actions artifacts, which are less purpose-built for this than Supabase's own backup storage.
- **No point-in-time recovery** — this is one full dump per day, not continuous. Data changed since the last run (up to ~24h) is not recoverable.
- **No automatic failure alerting beyond GitHub's own defaults** — GitHub emails the repo owner when a scheduled workflow run fails, *if* your GitHub notification settings for Actions are enabled. Worth checking: GitHub → your profile → **Settings → Notifications** → confirm "Actions" email notifications are on.
- **Manual restore, not one-click** — restoring requires running the commands above yourself; there's no in-app "restore" button.

If this project ever handles more than a handful of households, or the manual-restore/no-PITR tradeoffs stop feeling acceptable, upgrading to Supabase Pro is the more robust long-term answer — this workflow is a stopgap, not a replacement for that.
