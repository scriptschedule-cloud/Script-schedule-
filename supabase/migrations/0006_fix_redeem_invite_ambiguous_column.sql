-- Fix: "column reference \"household_id\" is ambiguous" (Postgres error 42702)
-- when redeeming a household invite.
--
-- Root cause: `RETURNS TABLE(household_id uuid)` implicitly declares
-- `household_id` as a PL/pgSQL variable for the whole function body. The
-- `on conflict (household_id, user_id)` target list inside the function is a
-- bare identifier list, and PL/pgSQL's parser matches it against that
-- variable instead of unambiguously resolving it to household_members'
-- column, producing the error. (create_household_with_owner has a similarly
-- named OUT column but no ON CONFLICT clause, so it never hit this.)
--
-- Fix: return a plain uuid instead of a one-column table, which removes the
-- colliding variable entirely.
--
-- Run this once in the Supabase SQL editor, after 0001-0005.
--
-- Note: the DROP is required — Postgres won't let CREATE OR REPLACE change
-- a function's return type (table -> uuid here), only its body.

drop function if exists redeem_household_invite(text);

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
