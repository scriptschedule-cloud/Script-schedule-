// netlify/functions/delete-account.js
//
// Permanently deletes the caller's Supabase auth account (their login
// credentials — email/password, unable to sign in again afterward).
//
// Household/medication data is deleted separately, CLIENT-SIDE, via the
// delete_my_account() RPC (safe to call directly — it's a SECURITY DEFINER
// function scoped to auth.uid(), same pattern as redeem_household_invite).
// This function exists only for the one piece that genuinely needs elevated
// privilege: removing the auth.users row itself requires the Supabase
// service role key, which must never be exposed to the browser.
//
// Expects POST JSON: { accessToken: "the-caller's-current-session-access-token" }
// The token is verified server-side (via Supabase's own /auth/v1/user
// endpoint) BEFORE any deletion — a client can only ever delete the account
// that token actually belongs to, never an arbitrary user id.
//
// IMPORTANT: requires SUPABASE_SERVICE_ROLE_KEY set as a Netlify environment
// variable (Site settings → Environment variables). Get it from the Supabase
// dashboard → Project Settings → API → "service_role" key (NOT the anon/
// publishable key already used elsewhere in this app). Treat it like a
// master password for the whole database — it must only ever live here,
// server-side, never in index.html or any client-visible file.
//
// Returns:
//   { ok: true }                  on success
//   { ok: false, error: "..." }   on failure

const SUPABASE_URL = "https://txaezqhbtjbtbxwlveoq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_DMnbXfeIUUEFf3OICUE-fA_N3gfZZcw";

exports.handler = async function (event) {
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

  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE_ROLE_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        ok: false,
        error: "missing_service_role_key",
        detail: "SUPABASE_SERVICE_ROLE_KEY env var must be set in Netlify (Project Settings → API → service_role key in Supabase)."
      })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: "invalid_json" }) };
  }

  // TEMPORARY diagnostic path — reports shape/length of the configured key
  // without ever exposing the secret itself, to debug a persistent "Invalid
  // API key" error from Supabase's admin endpoint. Remove once resolved.
  if (body.debug === true) {
    const raw = SERVICE_ROLE_KEY;
    const trimmed = raw.trim();
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        debug: {
          length: raw.length,
          trimmedLength: trimmed.length,
          hasWhitespace: raw.length !== trimmed.length,
          startsWithEyJ: raw.startsWith("eyJ"),
          startsWithSbSecret: raw.startsWith("sb_secret_"),
          prefix: raw.slice(0, 12),
          suffix: raw.slice(-6),
          dotCount: (raw.match(/\./g) || []).length // a JWT has exactly 2 dots
        }
      })
    };
  }

  const { accessToken } = body;
  if (!accessToken || typeof accessToken !== "string") {
    return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: "missing_access_token" }) };
  }

  try {
    // Verify the token belongs to a real, current session BEFORE deleting
    // anything — this is what stops a client from deleting an account that
    // isn't theirs. Uses the anon key + the caller's own token, exactly like
    // any authenticated client request would.
    const verifyResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: "GET",
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${accessToken}`
      }
    });

    if (!verifyResp.ok) {
      return { statusCode: 401, headers, body: JSON.stringify({ ok: false, error: "invalid_session" }) };
    }

    const user = await verifyResp.json();
    if (!user || !user.id) {
      return { statusCode: 401, headers, body: JSON.stringify({ ok: false, error: "invalid_session" }) };
    }

    // Now delete, using the service role key — the only credential allowed
    // to hit the admin API.
    const deleteResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
      method: "DELETE",
      headers: {
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`
      }
    });

    if (!deleteResp.ok) {
      const detail = await deleteResp.json().catch(() => ({}));
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ ok: false, error: "delete_failed", detail })
      };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: "unexpected_error", detail: String(e.message || e) })
    };
  }
};
