-- Real server-side account deletion, replacing "Reset App" (which only ever
-- cleared local device storage, never touched the household's data in
-- Supabase — a real gap for anyone who actually wants their data gone).
--
-- Two behaviors depending on household size:
--   - Sole member: deletes the entire household and everything in it.
--   - Shared household: removes just the caller's membership ("leaving"),
--     without deleting data the other members still rely on — there's no
--     concept of "my" vs "their" medications within a shared household, it's
--     all common data, so a solo delete can't selectively remove just the
--     caller's contributions without breaking things for everyone else.
--
-- This RPC only handles the household/data side, which the authenticated
-- (non-admin) role can do safely under SECURITY DEFINER + auth.uid() scoping
-- — same pattern as redeem_household_invite and rename_family_member.
-- Deleting the actual auth.users row (removing login credentials entirely)
-- requires the Supabase service role key and happens separately, server-side,
-- via netlify/functions/delete-account.js.
--
-- Run this once in the Supabase SQL editor, after 0001-0010.

create or replace function delete_my_account()
returns text language plpgsql security definer set search_path = public as $$
declare
  v_household_id uuid;
  v_member_count int;
begin
  select household_id into v_household_id from household_members where user_id = auth.uid();
  if v_household_id is null then
    return 'no_household';
  end if;

  select count(*) into v_member_count from household_members where household_id = v_household_id;

  if v_member_count <= 1 then
    -- Sole member: remove the membership row explicitly first — the
    -- household_members table predates this migration (created outside
    -- version control per 0001's header comment) and its own FK cascade
    -- behavior toward households isn't something this file controls, so
    -- don't rely on it. Deleting the household row itself then cascades
    -- every other table (family_members, medications, dose_events,
    -- emergency_profiles, documents, household_invites) via the
    -- `household_id ... on delete cascade` FKs declared explicitly in 0001.
    delete from household_members where household_id = v_household_id;
    delete from households where id = v_household_id;
    return 'household_deleted';
  else
    delete from household_members where household_id = v_household_id and user_id = auth.uid();
    return 'left_household';
  end if;
end;
$$;
grant execute on function delete_my_account() to authenticated;
