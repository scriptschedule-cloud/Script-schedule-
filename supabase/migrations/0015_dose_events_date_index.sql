-- Supports the new bounded dose_events query in loadHouseholdDataFromSupabase()
-- (index.html), which now fetches only the last 120 days instead of a
-- household's entire dose history on every app load. The existing
-- household_idx (0001) alone means Postgres can narrow to the household but
-- still has to scan every row within it to apply the date filter; a
-- composite index lets it seek directly to the right range instead,
-- which is what actually matters once a household's history grows large
-- over months/years of daily use.
--
-- Run this once in the Supabase SQL editor, after 0001-0014.

create index if not exists dose_events_household_date_idx
  on dose_events(household_id, dose_date);
