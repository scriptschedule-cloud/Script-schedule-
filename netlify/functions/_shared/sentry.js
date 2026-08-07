// Minimal Sentry wrapper for the Netlify Functions in this app.
//
// Deliberately narrow: only ever sends a static label, the exception's
// name/stack (or a plain "error" message if it's not an Error instance),
// and an optional numeric status code — never request or response bodies.
// Those bodies are exactly where medication names, doses, and scanned
// label photos (base64) pass through this app (Supabase/OneSignal/Claude
// payloads), so they must never reach a third party like Sentry. See
// KNOWN_ISSUES.md H4.
//
// No-ops safely if SENTRY_DSN isn't set in Netlify's environment variables,
// so every function can call captureError() unconditionally.

let Sentry = null;
let initAttempted = false;

function getSentry() {
  if (initAttempted) return Sentry;
  initAttempted = true;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return null;
  try {
    Sentry = require("@sentry/node");
    Sentry.init({
      dsn,
      tracesSampleRate: 0,
      sendDefaultPii: false,
      // Default integrations include an http breadcrumb/request-data
      // integration that can attach request bodies to events — this app
      // never wants that, so events are sent bare (label + tags/extra set
      // explicitly below) rather than relying on Sentry's auto-context.
      defaultIntegrations: false
    });
  } catch (e) {
    Sentry = null;
  }
  return Sentry;
}

// label: short static string identifying where this happened, e.g.
// "schedule-push:onesignal_failed". err: the caught exception (or
// undefined). extra: optional plain object of SAFE, non-content fields
// only (e.g. { status: 500, failed: 3 }) — never pass API response bodies,
// request bodies, or anything containing medication/user data here.
function captureError(label, err, extra) {
  const S = getSentry();
  if (!S) return;
  try {
    S.withScope((scope) => {
      scope.setTag("function", label);
      if (extra && typeof extra === "object") {
        for (const k of Object.keys(extra)) {
          const v = extra[k];
          if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") {
            scope.setExtra(k, typeof v === "string" ? v.slice(0, 200) : v);
          }
        }
      }
      if (err instanceof Error) {
        S.captureException(err);
      } else {
        S.captureMessage(label, "error");
      }
    });
  } catch (e) {
    // Monitoring must never break the actual request.
  }
}

module.exports = { captureError };
