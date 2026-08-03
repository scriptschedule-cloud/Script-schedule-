-- Fix: "new row violates row-level security policy for table households"
-- persisting even after 0003 removed the legacy policies.
--
-- Real root cause: creating a household from the client was two separate
-- steps — INSERT into households (then read the row back via .select()),
-- then INSERT into household_members. The read-back after the first insert
-- is governed by the households SELECT policy, which requires the row's id
-- to already appear in household_members for the current user. That's
-- impossible at that point — you can't be a member of a household before
-- the membership row exists. The INSERT itself likely succeeds, but
-- Postgres can't return it, and reports that failure with the exact same
-- message as a genuine WITH CHECK violation.
--
-- Fix: create the household and the owner's membership row atomically in
-- one SECURITY DEFINER RPC (same pattern as redeem_household_invite),
-- returning the new household's id directly instead of relying on a
-- client-side read-back that RLS can't yet permit.
--
-- Run this once in the Supabase SQL editor, after 0001-0003.

create or replace function create_household_with_owner(p_name text, p_role text default 'parent')
returns table(household_id uuid) language plpgsql security definer set search_path = public as $$
declare v_household_id uuid;
begin
  insert into households (name) values (p_name) returning id into v_household_id;
  insert into household_members (household_id, user_id, role) values (v_household_id, auth.uid(), p_role);
  return query select v_household_id;
end;
$$;
grant execute on function create_household_with_owner(text, text) to authenticated;
