// netlify/functions/schedule-push.js
//
// Schedules push notifications for ScriptSchedule medications via OneSignal.
//
// Expects POST JSON body:
//   {
//     subscriptionId: "the-user's-onesignal-subscription-id",
//     meds: [
//       { id, name, dose, person, times: ["08:00", "20:00"], frequency }
//     ],
//     timeZone: "America/Chicago",  // required — see note below
//     daysAhead: 7   // optional, default 7
//   }
//
// Returns:
//   { ok: true, scheduled: N }   on success
//   { ok: false, error: "..." }  on failure
//
// IMPORTANT: This function reads ONESIGNAL_APP_ID and ONESIGNAL_REST_API_KEY
// from Netlify environment variables. Both must be set or this returns an error.
//
// Requires accessToken in the body (a verified Supabase session) — this used
// to accept a subscriptionId + meds array from anyone with no identity check
// at all. Rate-limited per caller (not just per subscriptionId) since a
// signed-in household member legitimately schedules pushes for a caregiver
// on another device (see scheduleRemoteCaregiverPush in index.html).
//
// TIMEZONE: this function previously computed `sendAt` using the server's
// own local time (effectively UTC, since that's what Netlify Functions run
// in) with no awareness of the user's actual timezone at all — a "times":
// ["08:00"] entry was scheduled for 8am UTC, not 8am wherever the user
// actually is. That's now fixed: the client sends its IANA timeZone (e.g.
// "America/Chicago"), and every date/time computation below is done in that
// zone via zonedTimeToUtc()/todayInZone() rather than server-local Date
// methods. timeZone is required (not defaulted) specifically so this bug
// can't quietly reappear if a caller ever forgets to send it.
//
// MIGRATION NOTE for anyone reviewing this later: notifications already
// scheduled in OneSignal under the old, timezone-unaware math aren't
// retroactively corrected by this change — they're already-created OneSignal
// objects. Each device flushes and recreates its own correct schedule the
// next time it calls syncPushSchedule() (index.html), which now cancels
// before rescheduling specifically to replace any stale entries from before
// this fix — but a device that doesn't reopen the app won't self-correct.

const { verifyUser, checkRateLimit } = require("./_shared/security");

// Converts a wall-clock date+time in a specific IANA timezone into the
// correct UTC Date instant, using only Intl (no extra dependency). Two
// passes because the first correction can itself cross a DST boundary.
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

exports.handler = async function (event, context) {
  // CORS headers — Netlify Functions are same-origin to the site so this is mostly defensive
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ ok: false, error: "method_not_allowed" })
    };
  }

  const APP_ID = process.env.ONESIGNAL_APP_ID;
  const REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY;

  if (!APP_ID || !REST_API_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        ok: false,
        error: "missing_credentials",
        detail: "ONESIGNAL_APP_ID and ONESIGNAL_REST_API_KEY env vars must be set in Netlify."
      })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ ok: false, error: "invalid_json" })
    };
  }

  const { accessToken, subscriptionId, meds, daysAhead = 7, timeZone } = body;

  const user = await verifyUser(accessToken);
  if (!user) {
    return { statusCode: 401, headers, body: JSON.stringify({ ok: false, error: "unauthorized" }) };
  }

  const allowed = await checkRateLimit(`schedule-push:${user.id}`, 20, 300);
  if (!allowed) {
    return { statusCode: 429, headers, body: JSON.stringify({ ok: false, error: "rate_limited" }) };
  }

  if (!subscriptionId || typeof subscriptionId !== "string") {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ ok: false, error: "missing_subscription_id" })
    };
  }

  if (!Array.isArray(meds)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ ok: false, error: "missing_meds_array" })
    };
  }

  if (!isValidTimeZone(timeZone)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        ok: false,
        error: "missing_or_invalid_timezone",
        detail: "timeZone (an IANA name, e.g. 'America/Chicago') is required so reminders fire at the correct local time."
      })
    };
  }

  // Build the list of (date + time + med) tuples we need to schedule, all
  // computed in the user's own timeZone rather than server-local time.
  // We schedule daysAhead days into the future for each dose.
  const now = new Date();
  const anchor = todayInZone(timeZone);
  const schedules = [];

  for (const med of meds) {
    if (!med || !med.name) continue;
    const times = Array.isArray(med.times) ? med.times : [];
    if (times.length === 0) continue; // "as needed" meds — no schedule
    const freq = med.frequency || "Daily";
    // Short-course meds (e.g. a 7-day antibiotic) carry an endDate — never
    // schedule a push at or after it, regardless of daysAhead. Midnight of
    // that date in the user's own timezone, not the server's.
    let medEndAt = null;
    if (med.endDate) {
      const [ey, em, ed] = med.endDate.split("-").map(Number);
      medEndAt = zonedTimeToUtc(ey, em, ed, 0, 0, timeZone);
    }

    // For each day in the window
    for (let dayOffset = 0; dayOffset < daysAhead; dayOffset++) {
      // Skip days based on frequency
      if (freq === "Every other day" && dayOffset % 2 !== 0) continue;
      if (freq === "Weekly" && dayOffset !== 0) continue;

      const { year, month, day } = addDays(anchor, dayOffset);

      for (const timeStr of times) {
        const [hour, minute] = timeStr.split(":").map(Number);
        const sendAt = zonedTimeToUtc(year, month, day, hour, minute || 0, timeZone);

        // Skip times in the past (today's earlier doses already passed)
        if (sendAt.getTime() <= now.getTime() + 60000) continue;
        // Skip times at or past this medication's course end date
        if (medEndAt && sendAt.getTime() >= medEndAt.getTime()) continue;

        const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${timeStr}`;
        schedules.push({ med, sendAt: sendAt.toISOString(), dateKey });
      }
    }
  }

  if (schedules.length === 0) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, scheduled: 0, note: "no_future_doses" })
    };
  }

  // Send each schedule to OneSignal
  let scheduled = 0;
  let failed = 0;
  const errors = [];

  for (const s of schedules) {
    try {
      // Deliberately generic: the drug name/dose never leaves our servers as
      // push content — OneSignal, and the OS-level push relay behind it
      // (APNs/FCM), only ever see this generic text. The full detail (name,
      // dose) is still what's shown in the app itself once opened; it's
      // just not exposed in transit to third parties. Person's name is kept
      // (not the drug) since it's far less individually revealing on its
      // own than a specific medication name.
      const title = "⏰ Medication reminder";
      const message = s.med.person && s.med.person !== "Your Name"
        ? `Time for ${s.med.person}'s medication`
        : "Time for your medication";

      const payload = {
        app_id: APP_ID,
        include_subscription_ids: [subscriptionId],
        contents: { en: message },
        headings: { en: title },
        send_after: s.sendAt,
        // Custom data: lets the service worker / app know what this notification
        // was for. Only medId + doseTime are actually read client-side
        // (handleNotificationAction looks up the medication locally by id) —
        // medName/person aren't needed here and are deliberately omitted so
        // they don't travel through OneSignal at all, not even in this
        // non-visible field.
        data: {
          medId: s.med.id,
          doseTime: s.dateKey,
          type: "med_reminder"
        },
        // Action buttons shown in the notification
        web_buttons: [
          {
            id: "take",
            text: "✓ Take",
            icon: "https://scriptschedule.app/icon-192.png",
            url: `https://scriptschedule.app/?action=take&med=${encodeURIComponent(s.med.id)}&t=${encodeURIComponent(s.dateKey)}`
          },
          {
            id: "snooze",
            text: "⏰ Snooze 15min",
            icon: "https://scriptschedule.app/icon-192.png",
            url: `https://scriptschedule.app/?action=snooze&med=${encodeURIComponent(s.med.id)}&t=${encodeURIComponent(s.dateKey)}`
          }
        ],
        // External ID: lets us cancel/replace this specific scheduled push later
        // Format: med-{medId}-{ISO date+time}
        external_id: `med-${s.med.id}-${s.dateKey}`
      };

      const resp = await fetch("https://api.onesignal.com/notifications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Key ${REST_API_KEY}`,
          "Accept": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const data = await resp.json();

      if (!resp.ok || data.errors) {
        failed++;
        errors.push({
          dateKey: s.dateKey,
          status: resp.status,
          errors: data.errors || data
        });
      } else {
        scheduled++;
      }
    } catch (e) {
      failed++;
      errors.push({ dateKey: s.dateKey, error: String(e.message || e) });
    }
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      ok: failed === 0,
      scheduled,
      failed,
      errors: errors.slice(0, 5) // cap error detail to avoid huge responses
    })
  };
};
