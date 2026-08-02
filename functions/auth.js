/**
 * Owner-only access guard.
 *
 * ZeroTide is a private, single-user app. Every callable requires a signed-in
 * Google user whose (verified) email is on the owner allowlist. Everyone else is
 * rejected — this is what makes the public URL safe to leave up.
 *
 * Set your allowed account(s) via the ZEROTIDE_OWNER_EMAILS environment variable
 * (comma-separated) in `functions/.env` — see functions/.env.example. Example:
 *   ZEROTIDE_OWNER_EMAILS=you@gmail.com,you@work.com
 */

const { HttpsError } = require("firebase-functions/v2/https");

const OWNER_EMAILS = String(process.env.ZEROTIDE_OWNER_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

function assertOwner(request) {
  const auth = request.auth;
  if (!auth) {
    throw new HttpsError("unauthenticated", "Please sign in to use ZeroTide.");
  }
  if (OWNER_EMAILS.length === 0) {
    // Misconfiguration: no owners set. Fail closed rather than allow everyone.
    throw new HttpsError("failed-precondition", "No owner emails configured. Set ZEROTIDE_OWNER_EMAILS in functions/.env.");
  }
  const email = String(auth.token?.email || "").toLowerCase();
  const emailVerified = auth.token?.email_verified;
  if (!email || !emailVerified || !OWNER_EMAILS.includes(email)) {
    throw new HttpsError("permission-denied", "This ZeroTide is private to its owner.");
  }
  return email;
}

module.exports = { assertOwner, OWNER_EMAILS };
