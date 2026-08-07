// Previously this forwarded any POST body straight to Anthropic with no
// caller-identity check at all — anyone who found this URL could spend the
// app owner's Anthropic quota. Now requires a verified Supabase session
// (accessToken in the body, same convention as delete-account.js) and caps
// each user to 30 calls per 10 minutes — generous for normal scan/pill-ID/
// document-upload use, but not for a scripted abuse loop.
const { verifyUser, checkRateLimit } = require("./_shared/security");
const { captureError } = require("./_shared/sentry");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: { message: "invalid_json" } }) };
  }

  const { accessToken, ...anthropicPayload } = body;
  const user = await verifyUser(accessToken);
  if (!user) {
    return { statusCode: 401, body: JSON.stringify({ error: { message: "unauthorized" } }) };
  }

  const allowed = await checkRateLimit(`claude:${user.id}`, 30, 600);
  if (!allowed) {
    return { statusCode: 429, body: JSON.stringify({ error: { message: "rate_limited" } }) };
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(anthropicPayload)
    });

    const data = await response.json();
    return {
      statusCode: response.status,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    };
  } catch (err) {
    // err here is a network-level failure from our own fetch() call (e.g.
    // connection reset) — never the Anthropic response body itself, which
    // is returned to the client directly above and never passed through
    // error handling, so this is safe to forward as-is.
    captureError("claude:fetch_failed", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
