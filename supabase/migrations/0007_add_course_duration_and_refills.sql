-- Adds support for short-course medications (e.g. a 7-day antibiotic) and a
-- manual refills-remaining counter.
--
-- start_date + duration_days together define a course window. duration_days
-- stays null for ongoing/chronic medications (the default for everything
-- today) — only set for a short course. "Is this course over" is computed
-- client-side from these two columns (start_date + duration_days < today),
-- not stored: a generated column can't reference current_date (not
-- immutable), and a stored/cached flag would need a background job or an
-- extra write to flip, both unnecessary for a comparison this trivial.
--
-- refills_remaining is null = "not tracked / unknown," distinct from 0 =
-- "none left." Never defaults to 0.
--
-- Run this once in the Supabase SQL editor, after 0001-0006.

alter table medications
  add column start_date date not null default current_date,
  add column duration_days integer check (duration_days is null or duration_days > 0),
  add column refills_remaining integer;
