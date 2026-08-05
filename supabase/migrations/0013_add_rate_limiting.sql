-- Backing store + RPC for per-user rate limiting across the Netlify
-- functions (claude.js, schedule-push.js, cancel-push.js, delete-account.js).
-- None of them had any caller-identity check before this, let alone a
-- request cap — claude.js in particular was a fully open proxy to a paid
-- Anthropic API key for anyone who found the URL. That's fixed alongside
-- this migration by each function now requiring a verified Supabase access
-- token (see netlify/functions/_shared/security.js) and keying its limit by
-- that user's id rather than IP, which a real abuser can trivially rotate.
--
-- check_rate_limit atomically increments a fixed-window counter and reports
-- whether the caller is still under `p_max` for the current window; the
-- window resets on its own once `p_window_seconds` has elapsed since it
-- started, no cron/cleanup job needed.
--
-- Run this once in the Supabase SQL editor, after 0001-0012.

create table if not exists rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  count int not null default 0
);

alter table rate_limits enable row level security;
-- Deliberately no policies: the only access path is check_rate_limit()
-- below, which runs as SECURITY DEFINER and so bypasses RLS entirely. No
-- role is granted direct table access, so this stays true even if a policy
-- is added elsewhere later by mistake.

create or replace function check_rate_limit(p_key text, p_max int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into rate_limits (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update set
    window_start = case
      when rate_limits.window_start <= now() - make_interval(secs => p_window_seconds)
      then now()
      else rate_limits.window_start
    end,
    count = case
      when rate_limits.window_start <= now() - make_interval(secs => p_window_seconds)
      then 1
      else rate_limits.count + 1
    end
  returning count into v_count;

  return v_count <= p_max;
end;
$$;

grant execute on function check_rate_limit(text, int, int) to anon, authenticated;
