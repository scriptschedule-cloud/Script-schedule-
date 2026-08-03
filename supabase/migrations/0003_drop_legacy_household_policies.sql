-- Fix: "new row violates row-level security policy for table households"
-- (Postgres error 42501), hit while retrying signup after 0002.
--
-- Root cause: two pre-existing catch-all policies from before this
-- migration series — "households_access" and "household_members_access"
-- (both cmd = ALL) — specify no WITH CHECK clause. Postgres defaults an
-- ALL policy's WITH CHECK to match its USING clause when none is given.
-- households_access's USING clause requires the row's id to already be in
-- household_members for the current user — impossible for a brand-new
-- household, since you can't already be a member of a household you
-- haven't created yet. That silently blocked every household creation.
--
-- Fix: drop both legacy blanket policies. The 0001/0002 migrations already
-- added more precise, correct replacements:
--   - households:        "members can view their household" (select),
--                         "authenticated users can create a household" (insert)
--   - household_members: "members can view their household roster" (select),
--                         "users can insert their own membership row" (insert)
--
-- Run this once in the Supabase SQL editor for project txaezqhbtjbtbxwlveoq,
-- after 0001 and 0002.

drop policy if exists "households_access" on households;
drop policy if exists "household_members_access" on household_members;
