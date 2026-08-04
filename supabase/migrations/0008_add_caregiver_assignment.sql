-- Lets a household assign which specific member gets push notifications for
-- a given person/pet's medications, instead of every push-enabled device in
-- the household being reminded about everything. Assignment is a one-tap
-- self-serve toggle client-side ("Notify me for X's meds") — no new RLS is
-- needed since the existing family_members UPDATE policy already lets any
-- household member set this column on any family member.
--
-- Run this once in the Supabase SQL editor, after 0001-0007.

alter table family_members
  add column caregiver_user_id uuid references auth.users(id);

-- Backfill existing rows so notifications don't silently stop working for
-- households that already had push enabled before this migration — default
-- to any existing member of that household (arbitrary but functional; the
-- self-serve toggle lets anyone correct it in one tap).
update family_members fm
set caregiver_user_id = (
  select hm.user_id from household_members hm
  where hm.household_id = fm.household_id
  limit 1
)
where fm.caregiver_user_id is null;
