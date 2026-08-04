-- Adds per-user display names to household_members so the client can show a
-- roster of real names, then extends the two membership-creating RPCs to set
-- it. This unblocks the "assign someone else as caregiver" picker (0008 only
-- supported self-assign, since there was no name to show for anyone else).
--
-- Run this once in the Supabase SQL editor, after 0001-0008.

alter table household_members add column if not exists display_name text;

-- create_household_with_owner (0004): add p_display_name as a new trailing
-- parameter with a default, so the existing two-arg call sites (if any are
-- ever added elsewhere) keep working unchanged.
create or replace function create_household_with_owner(p_name text, p_role text default 'parent', p_display_name text default null)
returns table(household_id uuid) language plpgsql security definer set search_path = public as $$
declare v_household_id uuid;
begin
  insert into households (name) values (p_name) returning id into v_household_id;
  insert into household_members (household_id, user_id, role, display_name) values (v_household_id, auth.uid(), p_role, p_display_name);
  return query select v_household_id;
end;
$$;
grant execute on function create_household_with_owner(text, text, text) to authenticated;

-- redeem_household_invite (0001/0006): same trailing-default-parameter approach.
create or replace function redeem_household_invite(p_code text, p_display_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_invite household_invites%rowtype;
begin
  select * into v_invite from household_invites
  where code = p_code and not revoked
    and (expires_at is null or expires_at > now())
    and (max_uses is null or use_count < max_uses)
  for update;

  if not found then raise exception 'invalid_or_expired_invite'; end if;

  insert into household_members(household_id, user_id, role, display_name)
  values (v_invite.household_id, auth.uid(), v_invite.role, p_display_name)
  on conflict (household_id, user_id) do update set display_name = excluded.display_name;

  update household_invites set use_count = use_count + 1 where id = v_invite.id;
  return v_invite.household_id;
end;
$$;
grant execute on function redeem_household_invite(text, text) to authenticated;
