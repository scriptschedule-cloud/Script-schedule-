// Regression tests for netlify/functions/_shared/time.js — the timezone
// conversion logic behind medication reminder scheduling. This exists
// specifically so the "reminders fire at the wrong wall-clock time for
// non-UTC users" bug (fixed once already) can never silently reappear.
//
// Run with: npm test  (or: node --test tests/)
// Uses Node's built-in test runner — no external test framework dependency.

const test = require("node:test");
const assert = require("node:assert/strict");
const { zonedTimeToUtc, todayInZone, addDays, isValidTimeZone } = require("../netlify/functions/_shared/time");

// Reads back what local HH:MM a UTC instant displays as in a given zone —
// the same round-trip check used to hand-verify this fix originally.
function hmIn(date, timeZone) {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

test("zonedTimeToUtc: US Central, summer (CDT, UTC-5)", () => {
  const d = zonedTimeToUtc(2026, 8, 10, 8, 0, "America/Chicago");
  assert.equal(hmIn(d, "America/Chicago"), "08:00");
  assert.equal(d.toISOString(), "2026-08-10T13:00:00.000Z");
});

test("zonedTimeToUtc: US Central, winter (CST, UTC-6)", () => {
  const d = zonedTimeToUtc(2026, 1, 10, 8, 0, "America/Chicago");
  assert.equal(hmIn(d, "America/Chicago"), "08:00");
  assert.equal(d.toISOString(), "2026-01-10T14:00:00.000Z");
});

test("zonedTimeToUtc: zone with no DST (Tokyo, UTC+9)", () => {
  const d = zonedTimeToUtc(2026, 8, 10, 8, 0, "Asia/Tokyo");
  assert.equal(hmIn(d, "Asia/Tokyo"), "08:00");
});

test("zonedTimeToUtc: US spring-forward transition day (2026-03-08)", () => {
  // 8am is after the 2am->3am gap that day; must still resolve to exactly 8am local.
  const d = zonedTimeToUtc(2026, 3, 8, 8, 0, "America/Chicago");
  assert.equal(hmIn(d, "America/Chicago"), "08:00");
});

test("zonedTimeToUtc: US fall-back transition day (2026-11-01)", () => {
  // 8am is after the repeated 1am-2am hour that day; must still resolve to exactly 8am local.
  const d = zonedTimeToUtc(2026, 11, 1, 8, 0, "America/Chicago");
  assert.equal(hmIn(d, "America/Chicago"), "08:00");
});

test("zonedTimeToUtc: half-hour offset zone (India, UTC+5:30)", () => {
  const d = zonedTimeToUtc(2026, 8, 10, 8, 0, "Asia/Kolkata");
  assert.equal(hmIn(d, "Asia/Kolkata"), "08:00");
});

test("zonedTimeToUtc: southern-hemisphere DST (Sydney)", () => {
  const d = zonedTimeToUtc(2026, 1, 15, 8, 0, "Australia/Sydney");
  assert.equal(hmIn(d, "Australia/Sydney"), "08:00");
});

test("zonedTimeToUtc: midnight edge case", () => {
  const d = zonedTimeToUtc(2026, 8, 10, 0, 0, "America/Chicago");
  assert.equal(hmIn(d, "America/Chicago"), "00:00");
});

test("zonedTimeToUtc: UTC identity case", () => {
  const d = zonedTimeToUtc(2026, 8, 10, 8, 0, "UTC");
  assert.equal(d.toISOString(), "2026-08-10T08:00:00.000Z");
});

test("addDays: crosses a year boundary", () => {
  assert.deepEqual(addDays({ year: 2026, month: 12, day: 30 }, 5), { year: 2027, month: 1, day: 4 });
});

test("addDays: crosses a month boundary in a non-leap February", () => {
  assert.deepEqual(addDays({ year: 2026, month: 2, day: 27 }, 2), { year: 2026, month: 3, day: 1 });
});

test("addDays: zero days is a no-op", () => {
  assert.deepEqual(addDays({ year: 2026, month: 6, day: 15 }, 0), { year: 2026, month: 6, day: 15 });
});

test("todayInZone: returns a well-formed {year,month,day} for a real zone", () => {
  const t = todayInZone("America/Chicago");
  assert.equal(typeof t.year, "number");
  assert.ok(t.month >= 1 && t.month <= 12);
  assert.ok(t.day >= 1 && t.day <= 31);
});

test("isValidTimeZone: accepts real IANA names", () => {
  assert.equal(isValidTimeZone("America/Chicago"), true);
  assert.equal(isValidTimeZone("UTC"), true);
  assert.equal(isValidTimeZone("Asia/Kolkata"), true);
});

test("isValidTimeZone: rejects garbage input", () => {
  assert.equal(isValidTimeZone("Not/A/Real/Zone"), false);
  assert.equal(isValidTimeZone(""), false);
  assert.equal(isValidTimeZone(null), false);
  assert.equal(isValidTimeZone(undefined), false);
  assert.equal(isValidTimeZone(12345), false);
});
