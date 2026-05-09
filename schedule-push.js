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
//     daysAhead: 7   // optional, default 7
//   }
//
// Returns:
//   { ok: true, scheduled: N }   on success
//   { ok: false, error: "..." }  on failure
//
// IMPORTANT: This function reads ONESIGNAL_APP_ID and ONESIGNAL_REST_API_KEY
// from Netlify environment variables. Both must be set or this returns an error.

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

  const { subscriptionId, meds, daysAhead = 7 } = body;

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

  // Build the list of (date + time + med) tuples we need to schedule
  // We schedule daysAhead days into the future for each dose.
  const now = new Date();
  const schedules = [];

  for (const med of meds) {
    if (!med || !med.name) continue;
    const times = Array.isArray(med.times) ? med.times : [];
    if (times.length === 0) continue; // "as needed" meds — no schedule
    const freq = med.frequency || "Daily";

    // For each day in the window
    for (let dayOffset = 0; dayOffset < daysAhead; dayOffset++) {
      // Skip days based on frequency
      if (freq === "Every other day" && dayOffset % 2 !== 0) continue;
      if (freq === "Weekly" && dayOffset !== 0) continue;

      for (const timeStr of times) {
        const [hour, minute] = timeStr.split(":").map(Number);
        const sendAt = new Date(now);
        sendAt.setDate(sendAt.getDate() + dayOffset);
        sendAt.setHours(hour, minute || 0, 0, 0);

        // Skip times in the past (today's earlier doses already passed)
        if (sendAt.getTime() <= now.getTime() + 60000) continue;

        schedules.push({
          med,
          sendAt: sendAt.toISOString(),
          dateKey: sendAt.toISOString().slice(0, 10) + "T" + timeStr
        });
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
      const personLabel = s.med.person && s.med.person !== "Your Name"
        ? `${s.med.person}: `
        : "";
      const doseLabel = s.med.dose ? ` (${s.med.dose})` : "";
      const title = `⏰ Time for ${s.med.name}`;
      const message = `${personLabel}${s.med.name}${doseLabel}`;

      const payload = {
        app_id: APP_ID,
        include_subscription_ids: [subscriptionId],
        contents: { en: message },
        headings: { en: title },
        send_after: s.sendAt,
        // Custom data: lets the service worker / app know what this notification was for
        data: {
          medId: s.med.id,
          medName: s.med.name,
          person: s.med.person,
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
