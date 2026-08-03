-- ScriptSchedule: household data model for real-time multi-device sync.
-- Run this once in the Supabase SQL editor for project txaezqhbtjbtbxwlveoq.
-- Extends the existing `households` / `household_members` tables (already in use
-- by setupSupabaseAccount() in index.html) with the tables needed to sync
-- medications, dose history, family members, emergency profiles, and documents,
-- plus a household-invite mechanism so a second device/person can join an
-- existing household instead of always creating a new one.

-- ── EXTENSIONS ────────────────────────────────────────────────────────────
create extension if not exists pgcrypto; -- for gen_random_uuid()

-- ── EXISTING TABLES: constrain role ──────────────────────────────────────
-- Today every signup hardcodes role:"parent" regardless of what's picked in
-- the onboarding UI. This constraint doesn't fix that (that's a client-code
-- fix), it just makes sure only valid roles can ever land in the column,
-- including from the new invite-redeem RPC below.
alter table household_members
  add constraint household_members_role_check
  check (role in ('parent','caregiver','self','pet_owner','viewer'));

-- ── FAMILY MEMBERS (replaces bare ss:people / ss:pets string arrays) ─────
create table family_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  kind text not null default 'person' check (kind in ('person','pet')),
  color text,
  created_at timestamptz not null default now(),
  unique (household_id, name)
);

-- ── MEDICATIONS ───────────────────────────────────────────────────────────
create table medications (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  family_member_id uuid references family_members(id) on delete set null,
  person text not null,               -- denormalized name, mirrors client state.meds[].person
  name text not null,
  dose text,
  frequency text,
  times jsonb not null default '[]',  -- ["08:00","20:00"]
  with_food boolean not null default false,
  notes text,
  pharmacy text,
  next_due text,                      -- legacy display string, kept for parity; not authoritative
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index medications_household_idx on medications(household_id);

-- ── DOSE EVENTS (replaces nested med.doseLog[]) ──────────────────────────
create table dose_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  medication_id uuid not null references medications(id) on delete cascade,
  dose_date date not null,
  dose_time text not null,            -- "HH:MM"
  status text not null check (status in ('taken','snoozed','skipped','missed')),
  snoozed_until timestamptz,
  occurred_at timestamptz not null default now(),
  logged_by uuid references auth.users(id),
  unique (medication_id, dose_date, dose_time)  -- mirrors today's doseKey = medId|date|time
);
create index dose_events_household_idx on dose_events(household_id);
create index dose_events_med_idx on dose_events(medication_id);

-- ── EMERGENCY PROFILES (replaces ss:emergency dict) ──────────────────────
create table emergency_profiles (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  family_member_id uuid references family_members(id) on delete cascade,
  person text not null,
  blood text, dob text, weight text,
  doctor text, doctor_phone text,
  emergency_contact text, emergency_phone text,
  allergies text,       -- kept as comma-separated string, matching client shape exactly
  conditions text,
  updated_at timestamptz not null default now(),
  unique (household_id, person)
);

-- ── DOCUMENTS (replaces ss:docs array) ────────────────────────────────────
create table documents (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  family_member_id uuid references family_members(id) on delete set null,
  person text not null,
  file_name text, file_size text, upload_date text,
  title text,
  type text check (type in ('Lab Results','Doctor Report','Prescription','Imaging','Discharge Summary','Other')),
  doc_date text,        -- was client's "date" field; renamed to avoid reserved-word confusion
  summary text,
  key_values jsonb default '[]',   -- [{label,value,flag}]
  diagnoses jsonb default '[]',    -- string[]
  medications jsonb default '[]', -- string[] (unrelated to the medications table, just a name collision)
  follow_up text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index documents_household_idx on documents(household_id);

-- ── HOUSEHOLD INVITES (join mechanism for a second device/person) ────────
create table household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  code text not null unique,          -- short human-typeable code, e.g. 7-char base32
  created_by uuid references auth.users(id),
  role text not null default 'caregiver'
    check (role in ('parent','caregiver','self','pet_owner','viewer')),
  expires_at timestamptz,             -- null = no expiry
  max_uses int default 1,             -- null = unlimited
  use_count int not null default 0,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);

-- ── ROW LEVEL SECURITY ────────────────────────────────────────────────────
-- The anon/publishable key is embedded client-side, so RLS is the only
-- access control. Every household-scoped table gets the same shape via a
-- shared helper function.

create or replace function is_household_member(hid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from household_members
    where household_id = hid and user_id = auth.uid()
  );
$$;

-- Second SECURITY DEFINER helper, specifically for household_members' own
-- SELECT policy. A policy on household_members cannot query household_members
-- directly in its USING clause (even via is_household_member's EXISTS) without
-- Postgres re-applying that same policy to the inner query, which recurses
-- infinitely ("infinite recursion detected in policy for relation
-- household_members", error 42P17). Routing through this SECURITY DEFINER
-- function bypasses RLS for the inner lookup, breaking the cycle.
create or replace function user_household_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select household_id from household_members where user_id = auth.uid();
$$;

-- households (existing table)
alter table households enable row level security;
create policy "members can view their household" on households
  for select using (id in (select user_household_ids()));
create policy "authenticated users can create a household" on households
  for insert with check (auth.uid() is not null);

-- household_members (existing table)
alter table household_members enable row level security;
create policy "members can view their household roster" on household_members
  for select using (household_id in (select user_household_ids()));
create policy "users can insert their own membership row" on household_members
  for insert with check (user_id = auth.uid());
-- no update/delete policy exposed to the client — role changes/removal are an admin/future concern

-- family_members
alter table family_members enable row level security;
create policy "members select family_members" on family_members for select using (is_household_member(household_id));
create policy "members insert family_members" on family_members for insert with check (is_household_member(household_id));
create policy "members update family_members" on family_members for update using (is_household_member(household_id)) with check (is_household_member(household_id));
create policy "members delete family_members" on family_members for delete using (is_household_member(household_id));

-- medications
alter table medications enable row level security;
create policy "members select medications" on medications for select using (is_household_member(household_id));
create policy "members insert medications" on medications for insert with check (is_household_member(household_id));
create policy "members update medications" on medications for update using (is_household_member(household_id)) with check (is_household_member(household_id));
create policy "members delete medications" on medications for delete using (is_household_member(household_id));

-- dose_events — deliberately no DELETE policy: preserves an audit trail of
-- dose history. "Undo" should be a new status row, not a delete.
alter table dose_events enable row level security;
create policy "members select dose_events" on dose_events for select using (is_household_member(household_id));
create policy "members insert dose_events" on dose_events for insert with check (is_household_member(household_id));
create policy "members update dose_events" on dose_events for update using (is_household_member(household_id)) with check (is_household_member(household_id));

-- emergency_profiles
alter table emergency_profiles enable row level security;
create policy "members select emergency_profiles" on emergency_profiles for select using (is_household_member(household_id));
create policy "members insert emergency_profiles" on emergency_profiles for insert with check (is_household_member(household_id));
create policy "members update emergency_profiles" on emergency_profiles for update using (is_household_member(household_id)) with check (is_household_member(household_id));
create policy "members delete emergency_profiles" on emergency_profiles for delete using (is_household_member(household_id));

-- documents
alter table documents enable row level security;
create policy "members select documents" on documents for select using (is_household_member(household_id));
create policy "members insert documents" on documents for insert with check (is_household_member(household_id));
create policy "members delete documents" on documents for delete using (is_household_member(household_id));

-- household_invites: members can view/create/revoke their own; redemption by
-- a non-member goes through the redeem_household_invite() RPC only, which
-- runs as SECURITY DEFINER so it can bypass RLS for that one legitimate case.
alter table household_invites enable row level security;
create policy "members view invites" on household_invites for select using (is_household_member(household_id));
create policy "members create invites" on household_invites for insert with check (is_household_member(household_id) and created_by = auth.uid());
create policy "members revoke invites" on household_invites for update using (is_household_member(household_id)) with check (is_household_member(household_id));

-- ── RPCs ──────────────────────────────────────────────────────────────────

-- Redeem an invite code — the one place a non-member can act on household_invites.
-- Returns a plain uuid rather than RETURNS TABLE(household_id uuid): that
-- form implicitly declares household_id as a PL/pgSQL variable for the whole
-- function body, which collides with the bare `household_id` identifier in
-- the ON CONFLICT target list below and raises "column reference
-- household_id is ambiguous" (error 42702).
create or replace function redeem_household_invite(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_invite household_invites%rowtype;
begin
  select * into v_invite from household_invites
  where code = p_code and not revoked
    and (expires_at is null or expires_at > now())
    and (max_uses is null or use_count < max_uses)
  for update;

  if not found then raise exception 'invalid_or_expired_invite'; end if;

  insert into household_members(household_id, user_id, role)
  values (v_invite.household_id, auth.uid(), v_invite.role)
  on conflict (household_id, user_id) do nothing;

  update household_invites set use_count = use_count + 1 where id = v_invite.id;
  return v_invite.household_id;
end;
$$;
grant execute on function redeem_household_invite(text) to authenticated;

-- Rename a family member and cascade the denormalized "person" text columns
-- (fixes today's "no rename function, name IS the foreign key" gap).
create or replace function rename_family_member(p_family_member_id uuid, p_new_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v_hid uuid;
begin
  select household_id into v_hid from family_members where id = p_family_member_id;
  if v_hid is null or not is_household_member(v_hid) then
    raise exception 'not_authorized';
  end if;
  update family_members set name = p_new_name where id = p_family_member_id;
  update medications set person = p_new_name where family_member_id = p_family_member_id;
  update emergency_profiles set person = p_new_name where family_member_id = p_family_member_id;
  update documents set person = p_new_name where family_member_id = p_family_member_id;
end;
$$;
grant execute on function rename_family_member(uuid, text) to authenticated;

-- ── REALTIME ──────────────────────────────────────────────────────────────
-- RLS and a subscribed channel are not enough on their own — Postgres's
-- logical replication only streams changes for tables explicitly added to
-- the supabase_realtime publication.
alter publication supabase_realtime add table medications;
alter publication supabase_realtime add table dose_events;
alter publication supabase_realtime add table family_members;
alter publication supabase_realtime add table emergency_profiles;
alter publication supabase_realtime add table documents;
