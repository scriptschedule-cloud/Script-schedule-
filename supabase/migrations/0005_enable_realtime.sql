-- Fix: Realtime channel connects fine ("joined"), but no postgres_changes
-- events ever arrive on another device/tab.
--
-- Root cause: subscribing to a channel and having correct RLS is necessary
-- but not sufficient — Postgres's logical replication only streams changes
-- for tables explicitly added to the `supabase_realtime` publication.
-- None of the new tables were added to it, so the client-side subscription
-- was listening for events that were never being published in the first
-- place, regardless of RLS or the websocket connection being fine.
--
-- Run this once in the Supabase SQL editor, after 0001-0004.

alter publication supabase_realtime add table medications;
alter publication supabase_realtime add table dose_events;
alter publication supabase_realtime add table family_members;
alter publication supabase_realtime add table emergency_profiles;
alter publication supabase_realtime add table documents;
