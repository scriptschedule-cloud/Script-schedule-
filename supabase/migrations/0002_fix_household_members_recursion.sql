-- Fix: "infinite recursion detected in policy for relation household_members"
-- (Postgres error 42P17), hit during real signup testing.
--
-- Root cause: the "members can view their household roster" policy on
-- household_members queried household_members from within its own USING
-- clause. Postgres re-applies that same policy to the inner query, which
-- recurses forever. The households SELECT policy had the same problem
-- indirectly, since it also queries household_members.
--
-- Fix: route both through a new SECURITY DEFINER helper function, which
-- bypasses RLS for its internal lookup (same pattern already used by
-- is_household_member() for every other table) and breaks the cycle.
--
-- Run this once in the Supabase SQL editor for project txaezqhbtjbtbxwlveoq,
-- after 0001_household_data_model.sql.

create or replace function user_household_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select household_id from household_members where user_id = auth.uid();
$$;

drop policy if exists "members can view their household roster" on household_members;
create policy "members can view their household roster" on household_members
  for select using (household_id in (select user_household_ids()));

drop policy if exists "members can view their household" on households;
create policy "members can view their household" on households
  for select using (id in (select user_household_ids()));
