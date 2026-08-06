// Regression tests for the client-side medication-scheduling helpers in
// index.html (courseEndDate, isPastCourse, isArchived, doseKey, todayStr).
// These are extracted directly from the real index.html source at test
// time (see tests/helpers/extractFromIndexHtml.js) rather than duplicated
// here, so a future edit to the real function can't silently drift out of
// sync with what these tests actually check.
//
// Dates are computed relative to "now" at test-run time rather than
// hardcoded, since these functions are inherently relative to "today" —
// unlike the timezone-conversion tests (tests/time.test.js), which
// deliberately test specific fixed calendar dates/DST transitions.

const test = require("node:test");
const assert = require("node:assert/strict");
const { extractFunctions } = require("./helpers/extractFromIndexHtml");

const { todayStr, courseEndDate, isPastCourse, isArchived, doseKey } =
  extractFunctions(["todayStr", "courseEndDate", "isPastCourse", "isArchived", "doseKey"]);

function ymd(date) {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}
function daysFromToday(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
}

test("todayStr: matches a freshly computed local YYYY-MM-DD", () => {
  assert.equal(todayStr(), ymd(new Date()));
});

test("courseEndDate: no durationDays -> null (ongoing/chronic medication)", () => {
  assert.equal(courseEndDate({ name: "Lisinopril" }), null);
});

test("courseEndDate: durationDays of 0 -> null (falsy check treats 0 as unset)", () => {
  assert.equal(courseEndDate({ durationDays: 0 }), null);
});

test("courseEndDate: adds durationDays to an explicit startDate", () => {
  const end = courseEndDate({ startDate: "2026-01-01", durationDays: 7 });
  assert.equal(ymd(end), "2026-01-08");
});

test("courseEndDate: falls back to today when startDate is missing", () => {
  const end = courseEndDate({ durationDays: 5 });
  const expectedStart = new Date();
  expectedStart.setDate(expectedStart.getDate() + 5);
  assert.equal(ymd(end), ymd(expectedStart));
});

test("isPastCourse: false for an ongoing medication (no durationDays)", () => {
  assert.equal(isPastCourse({ name: "Lisinopril" }), false);
});

test("isPastCourse: false when the course ends in the future", () => {
  assert.equal(isPastCourse({ startDate: daysFromToday(0), durationDays: 10 }), false);
});

test("isPastCourse: true when the course ended in the past", () => {
  assert.equal(isPastCourse({ startDate: daysFromToday(-20), durationDays: 5 }), true);
});

test("isPastCourse: true on the exact end date (inclusive boundary)", () => {
  // A course starting 5 days ago with a 5-day duration ends exactly today.
  assert.equal(isPastCourse({ startDate: daysFromToday(-5), durationDays: 5 }), true);
});

test("isArchived: false when archivedAt is unset", () => {
  assert.equal(isArchived({ name: "Vitamin D3" }), false);
});

test("isArchived: false when archivedAt is explicitly null", () => {
  assert.equal(isArchived({ archivedAt: null }), false);
});

test("isArchived: true when archivedAt is set", () => {
  assert.equal(isArchived({ archivedAt: "2026-08-01T00:00:00.000Z" }), true);
});

test("doseKey: joins medId/date/time with the expected separator", () => {
  assert.equal(doseKey("med-123", "2026-08-06", "08:00"), "med-123|2026-08-06|08:00");
});
