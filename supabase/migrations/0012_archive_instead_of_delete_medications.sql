-- Removing a medication used to hard-delete its row, which cascaded (via
-- dose_events.medication_id references medications(id) on delete cascade,
-- see 0001) and permanently wiped that medication's entire taken/skipped/
-- snoozed history — silently undermining the audit trail dose_events was
-- deliberately built to preserve (dose_events itself has no client DELETE
-- policy specifically to prevent this, but that protection doesn't cover
-- the parent row's cascade).
--
-- Fix: "removing" a medication now archives it instead. archived_at is null
-- for every medication that's actually in use; set once a medication is
-- removed. The medications table's existing UPDATE policy already lets any
-- household member set this column — no RLS changes needed.
--
-- Run this once in the Supabase SQL editor, after 0001-0011.

alter table medications add column if not exists archived_at timestamptz;
