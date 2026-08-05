// Timezone-aware date/time helpers shared by schedule-push.js and its tests
// (tests/time.test.js). Extracted into their own module so this logic —
// the fix for reminders firing at the wrong wall-clock time for non-UTC
// users — has real, permanent regression coverage instead of living only
// inline in the function that uses it.
//
// No external dependency: everything here is built on Intl, which every
// supported Node runtime (and Netlify's Functions runtime) ships with.

// Converts a wall-clock date+time in a specific IANA timezone into the
// correct UTC Date instant. Two passes because the first correction can
// itself cross a DST boundary.
function zonedTimeToUtc(year, month, day, hour, minute, timeZone) {
  const target = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guess = new Date(target);
  for (let i = 0; i < 2; i++) {
    const seenAsUTC = zonedPartsAsUTC(guess, timeZone);
    guess = new Date(guess.getTime() + (target - seenAsUTC));
  }
  return guess;
}

// What wall-clock date/time does `date` display as in `timeZone`? Returned
// as if that reading were itself a UTC timestamp (a deliberate intermediate
// representation used only for the correction math above).
function zonedPartsAsUTC(date, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
  const p = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== "literal") p[part.type] = parseInt(part.value, 10);
  }
  if (p.hour === 24) p.hour = 0; // some ICU builds format midnight as "24"
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second || 0);
}

// "Today" as observed in `timeZone` — the anchor date reminders count
// forward from, so "day 0" means the user's own calendar day, not the
// server's (which can differ near midnight depending on the offset).
function todayInZone(timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit"
  });
  const p = {};
  for (const part of dtf.formatToParts(new Date())) {
    if (part.type !== "literal") p[part.type] = parseInt(part.value, 10);
  }
  return { year: p.year, month: p.month, day: p.day };
}

// Adds `days` calendar days to a {year,month,day} triple. Plain calendar
// arithmetic, not a real instant, so a UTC-anchored Date is safe here — only
// the date parts are used, never treated as an actual moment in time.
function addDays({ year, month, day }, days) {
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function isValidTimeZone(tz) {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = { zonedTimeToUtc, todayInZone, addDays, isValidTimeZone };
