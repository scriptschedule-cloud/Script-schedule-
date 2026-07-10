// netlify/functions/cancel-push.js
//
// Cancels previously scheduled push notifications for a specific medication
// via OneSignal, e.g. when a med is deleted or edited in ScriptSchedule.
//
// Expects POST JSON body:
//   { medId: "the-med-id", daysAhead: 7 }   // daysAhead optional, default 7
//
// How it works:
//   schedule-push.js tags every notification it creates with an external_id
//   of the form  med-{medId}-{dateKey}  (see schedule-push.js).
//   OneSignal's cancel-by-id endpoint needs OneSignal's own notification id,
//   not our external_id, so this function first looks up recently scheduled
//   notifications for the app, finds the ones whose external_id starts with
//   "med-{medId}-", and cancels each one by its OneSignal id.
//
// Returns:
//   { ok: true, cancelled: N }   on success
//   { ok: false, error: "..." }  on failure

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

  const { medId } = body;

  if (!medId) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ ok: false, error: "missing_med_id" })
    };
  }

  const prefix = `med-${medId}-`;
  let cancelled = 0;
  let failed = 0;
  const errors = [];

  try {
    // OneSignal doesn't support "cancel by external_id prefix" directly, so we
    // page through the app's recent notifications, find the ones tagged for
    // this med, and cancel each one by its OneSignal id.
    let offset = 0;
    const limit = 50;
    let matches = [];

    // Cap the number of pages we scan so a single request can't run away.
    for (let page = 0; page < 10; page++) {
      const listResp = await fetch(
        `https://api.onesignal.com/notifications?app_id=${APP_ID}&limit=${limit}&offset=${offset}`,
        {
          method: "GET",
          headers: {
            "Authorization": `Key ${REST_API_KEY}`,
            "Accept": "application/json"
          }
        }
      );

      const listData = await listResp.json();

      if (!listResp.ok) {
        errors.push({ step: "list", status: listResp.status, detail: listData });
        break;
      }

      const notifications = listData.notifications || [];
      if (notifications.length === 0) break;

      matches = matches.concat(
        notifications.filter(
          (n) => typeof n.external_id === "string" && n.external_id.startsWith(prefix)
        )
      );

      if (notifications.length < limit) break; // last page
      offset += limit;
    }

    for (const n of matches) {
      try {
        const delResp = await fetch(
          `https://api.onesignal.com/notifications/${n.id}?app_id=${APP_ID}`,
          {
            method: "DELETE",
            headers: {
              "Authorization": `Key ${REST_API_KEY}`,
              "Accept": "application/json"
            }
          }
        );
        const delData = await delResp.json();
        if (!delResp.ok || delData.errors) {
          failed++;
          errors.push({ id: n.id, status: delResp.status, errors: delData.errors || delData });
        } else {
          cancelled++;
        }
      } catch (e) {
        failed++;
        errors.push({ id: n.id, error: String(e.message || e) });
      }
    }
  } catch (e) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: "unexpected_error", detail: String(e.message || e) })
    };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      ok: failed === 0,
      cancelled,
      failed,
      errors: errors.slice(0, 5)
    })
  };
};
