-- Lets a caregiver handoff schedule push reminders for the NEW caregiver even
-- if their device/app is closed at the moment of handoff, by persisting each
-- member's OneSignal subscription id so the device performing the handoff
-- (which is open right now) can call schedule-push on their behalf, instead
-- of only relying on the new caregiver's own device being open (Realtime) or
-- them next opening the app (maybeResyncPushes' load-time resync).
--
-- Run this once in the Supabase SQL editor, after 0001-0009.

alter table household_members add column if not exists onesignal_subscription_id text;

-- household_members has no client-facing UPDATE policy today (0001 deliberately
-- left role changes as admin-only). Add a narrow self-service policy plus
-- column-level grants so a user can update ONLY their own display_name and
-- onesignal_subscription_id — never their own or anyone else's role.
-- (drop-if-exists first so this file is safe to re-run after a partial failure.)
drop policy if exists "members update their own contact info" on household_members;
create policy "members update their own contact info" on household_members
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke update on household_members from authenticated;
grant update (display_name, onesignal_subscription_id) on household_members to authenticated;
