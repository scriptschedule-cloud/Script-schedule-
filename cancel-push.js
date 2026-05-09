// netlify/functions/cancel-push.js
//
// Cancels scheduled push notifications for a medication.
// Called when a user deletes a med or edits its schedule.
//
// Expects POST JSON body:
//   { medId: 12345, daysAhead: 7 }   // cancels all scheduled pushes for this med
// OR
//   { externalId: "med-12345-2026-05-09T08:00" }   // cancels one specific push
//
// OneSignal lets you cancel by external_id, which we set when scheduling.

exports.handler = async function (event, context) {
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
      body: JSON.stringify({ ok: false, error: "missing_credentials" })
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

  const { medId, externalId, daysAhead = 7 } = body;

  // Build list of external_ids to cancel
  const externalIds = [];
  if (externalId) {
    externalIds.push(externalId);
  } else if (medId) {
    // Build all possible external_ids for this med across the window
    // Note: this is a brute-force approach — we generate all possible
    // (date, time) keys we *might* have created. OneSignal will silently
    // skip ones that don't exist.
    const now = new Date();
    for (let dayOffset = 0; dayOffset < daysAhead; dayOffset++) {
      const date = new Date(now);
      date.setDate(date.getDate() + dayOffset);
      const dateStr = date.toISOString().slice(0, 10);
      // Generate common dose times — covers our standard 4x daily schedule
      const possibleTimes = ["08:00", "12:00", "14:00", "16:00", "20:00", "21:00"];
      for (const t of possibleTimes) {
        externalIds.push(`med-${medId}-${dateStr}T${t}`);
      }
    }
  } else {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ ok: false, error: "missing_med_id_or_external_id" })
    };
  }

  let cancelled = 0;
  let failed = 0;

  for (const eid of externalIds) {
    try {
      // OneSignal cancel by external_id endpoint
      const resp = await fetch(
        `https://api.onesignal.com/notifications/${encodeURIComponent(eid)}?app_id=${APP_ID}`,
        {
          method: "DELETE",
          headers: {
            "Authorization": `Key ${REST_API_KEY}`,
            "Accept": "application/json"
          }
        }
      );
      // 200 = cancelled, 404 = didn't exist (fine), other = failure
      if (resp.ok || resp.status === 404) {
        cancelled++;
      } else {
        failed++;
      }
    } catch (e) {
      failed++;
    }
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ok: true, cancelled, failed })
  };
};
