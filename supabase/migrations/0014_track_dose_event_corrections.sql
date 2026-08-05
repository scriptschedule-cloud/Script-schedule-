-- Fix: correcting a dose (e.g. tapping "Taken" by accident, then "Skipped")
-- overwrites dose_events.status in place — there's no DELETE policy on that
-- table (deliberately, to protect history), but an UPDATE silently loses
-- what the row said a moment ago. logDoseAction()/cloudUpsert() in
-- index.html already upsert on conflict (medication_id, dose_date,
-- dose_time), so every correction is a real Postgres UPDATE — which means a
-- trigger can catch every single one automatically, with no client-side
-- code changes at all.
--
-- dose_event_corrections is intentionally NOT writable by the authenticated
-- role directly — only the trigger function (SECURITY DEFINER, so it runs
-- with the table owner's privileges) inserts into it. A client can view its
-- own household's correction history but can never fabricate, edit, or
-- delete an entry, the same tamper-proof shape as dose_events' own missing
-- DELETE policy, just one level stronger (no UPDATE/INSERT policy at all,
-- not even for the current value).
--
-- Run this once in the Supabase SQL editor, after 0001-0013.

create table dose_event_corrections (
  id uuid primary key default gen_random_uuid(),
  dose_event_id uuid not null references dose_events(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  previous_status text not null,
  new_status text not null,
  corrected_by uuid references auth.users(id),
  corrected_at timestamptz not null default now()
);
create index dose_event_corrections_dose_event_idx on dose_event_corrections(dose_event_id);
create index dose_event_corrections_household_idx on dose_event_corrections(household_id);

alter table dose_event_corrections enable row level security;
create policy "members select dose_event_corrections" on dose_event_corrections
  for select using (is_household_member(household_id));
-- Deliberately no insert/update/delete policy for authenticated/anon — see
-- header comment. The trigger below is the only writer.

create or replace function log_dose_event_correction()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.status is distinct from OLD.status then
    insert into dose_event_corrections (dose_event_id, household_id, previous_status, new_status, corrected_by)
    values (OLD.id, OLD.household_id, OLD.status, NEW.status, auth.uid());
  end if;
  return NEW;
end;
$$;

drop trigger if exists dose_events_log_correction on dose_events;
create trigger dose_events_log_correction
  before update on dose_events
  for each row execute function log_dose_event_correction();
