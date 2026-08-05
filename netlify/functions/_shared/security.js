// Shared helpers for the Netlify functions: verifying the caller is a real,
// currently-signed-in Supabase user, and enforcing a per-user rate limit on
// top of that. Talks to Supabase only via its public anon-key REST/Auth API
// — the service role key (used only by delete-account.js, for the one
// operation that genuinely needs it) never passes through here.

const SUPABASE_URL = "https://txaezqhbtjbtbxwlveoq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_DMnbXfeIUUEFf3OICUE-fA_N3gfZZcw";

// Confirms accessToken belongs to a real, current Supabase session and
// returns that user's record ({id, email, ...}), or null if it doesn't
// verify. A client can never impersonate another user this way — the token
// itself is what's checked, not anything the client claims about its owner.
async function verifyUser(accessToken) {
  if (!accessToken || typeof accessToken !== "string") return null;
  try {
    const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` }
    });
    if (!resp.ok) return null;
    const user = await resp.json();
    return user && user.id ? user : null;
  } catch (e) {
    return null;
  }
}

// Atomically checks and increments a fixed-window counter stored in
// Supabase (see migration 0013_add_rate_limiting.sql), scoped by `key`
// (typically `${functionName}:${userId}`). Fails OPEN — i.e. allows the
// request — if the RPC call itself errors, so an outage of this mechanism
// never blocks real use of the app; it's a backstop against abuse, not a
// gate real traffic depends on.
async function checkRateLimit(key, max, windowSeconds) {
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_rate_limit`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ p_key: key, p_max: max, p_window_seconds: windowSeconds })
    });
    if (!resp.ok) return true;
    const allowed = await resp.json();
    return allowed !== false;
  } catch (e) {
    return true;
  }
}

module.exports = { verifyUser, checkRateLimit };
