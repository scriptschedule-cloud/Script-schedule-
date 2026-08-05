# ScriptSchedule — Security Model

_Describes what's actually implemented today, verified against the code. See [PRODUCTION_READINESS_AUDIT.md](PRODUCTION_READINESS_AUDIT.md) for open gaps._

## Secrets

Real secrets (`ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ONESIGNAL_REST_API_KEY`) live only in Netlify's environment variables, read via `process.env` in the four server-side functions. They are never in client-side code and never committed to git (verified by searching all git history for key-shaped strings — none found).

Values that **are** hardcoded client-side (Supabase project URL + anon/publishable key, OneSignal App ID) are meant to be public — they identify the project/app but grant no privileged access on their own.

## Authentication

Entirely delegated to **Supabase Auth** (email + password). This app's code never sees or stores a password or password hash. A separate beta-access code gates onboarding but is not a security boundary — it's a shared "is this a beta tester" gate.

## Authorization

Every table has **Row Level Security** enabled. Access is scoped through an `is_household_member(household_id)` check — a user can only read/write data belonging to a household they're a member of. A handful of `SECURITY DEFINER` RPCs exist for the specific operations that must bypass RLS on purpose (joining a household via invite code, deleting your own account, etc.) — each scopes itself to `auth.uid()` internally rather than trusting client input.

## API-level protection

All four Netlify functions require a verified Supabase access token (checked server-side against Supabase's own `/auth/v1/user` endpoint) and enforce a per-user rate limit backed by a Postgres table + RPC. Before this session, three of the four had no identity check at all — this was found and fixed.

## Known gaps (see audit for full detail)

- No MFA, no session auto-expiry beyond a manual "sign out other devices."
- No dependency/vulnerability scanning pipeline (no CI at all yet).
- Several old, pre-XSS-fix copies of the app are still live on the production domain (see audit C2) — pending your approval to remove.
- No professional security audit or penetration test has been performed. Manual review only.

## Do not claim

- **Do not describe this app as HIPAA-compliant** without a professional assessment — no such assessment has been done.
- **Do not describe data as unreadable "even by us"** — whoever holds the Supabase/Netlify account credentials has full access via the dashboard or service-role key. The app's privacy copy was corrected this session to reflect this accurately.

## Reporting

Route any security concern found in the future through a written, dated entry in [KNOWN_ISSUES.md](KNOWN_ISSUES.md) until there's a dedicated process.
