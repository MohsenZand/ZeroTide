/**
 * Email notifications via Gmail SMTP (free — no third-party email service).
 *
 * Uses a Gmail account + an App Password (requires 2FA on that Google account),
 * stored as the GMAIL_USER / GMAIL_APP_PASSWORD secrets. Sends a digest of
 * "Buy now" items to the address in settings.notifyEmail.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const { loadSettings } = require("./settings");
const { assertOwner } = require("./auth");

if (!admin.apps.length) admin.initializeApp();

const gmailUser = defineSecret("GMAIL_USER");
const gmailPass = defineSecret("GMAIL_APP_PASSWORD");

function makeTransport() {
  const nodemailer = require("nodemailer");
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmailUser.value(), pass: gmailPass.value() },
  });
}

function money(n) {
  return typeof n === "number" ? "$" + n.toFixed(2) : "—";
}

function searchUrl(query, store) {
  const q = [query, store].filter(Boolean).join(" ");
  return "https://www.google.com/search?q=" + encodeURIComponent(q);
}

function itemRowHtml(it) {
  const b = it.currentBest || {};
  const bits = [];
  if (b.couponSavings > 0) bits.push(`${money(b.couponSavings)} coupon`);
  if (b.subscriptionSavings > 0) bits.push(`${money(b.subscriptionSavings)} subscribe & save`);
  if (b.cashbackRate > 0) bits.push(`${b.cashbackRate}% cash back`);
  const deals = bits.length ? ` &middot; incl. ${bits.join(" + ")}` : "";
  const target = typeof it.targetPrice === "number" ? ` (your price ${money(it.targetPrice)})` : "";
  const link = searchUrl(b.sourceTitle || it.title, b.store);
  return `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #e5e5e5;">
        <div style="font-size:15px;font-weight:600;color:#10201f;">${escapeHtml(it.title)}</div>
        <div style="font-size:14px;color:#0e7c86;font-weight:600;margin:2px 0;">
          ${money(b.truePrice)} at ${escapeHtml(b.store || "—")}${target}
        </div>
        <div style="font-size:12px;color:#7c8f91;">${escapeHtml(it.verdictReason || "")}${deals}</div>
        <a href="${link}" style="font-size:13px;color:#0e7c86;">See where to buy &rarr;</a>
      </td>
    </tr>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function digestHtml(items) {
  const rows = items.map(itemRowHtml).join("");
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;">
    <div style="font-size:20px;font-weight:700;color:#10201f;">ZeroTide &mdash; low tide reached</div>
    <div style="font-size:14px;color:#45585a;margin:6px 0 16px;">
      ${items.length} item${items.length === 1 ? "" : "s"} hit your price. Prices are AI estimates &mdash; confirm before buying.
    </div>
    <table style="width:100%;border-collapse:collapse;">${rows}</table>
    <div style="font-size:12px;color:#9aa;margin-top:20px;">
      You’re getting this because notifications are on in ZeroTide settings.
    </div>
  </div>`;
}

/**
 * Sends the Buy-now digest. Returns true if an email was sent.
 * Safe to call with no items (does nothing).
 */
async function sendBuyNowDigest(items) {
  if (!items || items.length === 0) return false;
  const settings = await loadSettings();
  if (!settings.notifyEnabled || !settings.notifyEmail) {
    logger.info("Notifications off or no email set — skipping digest.");
    return false;
  }
  const transport = makeTransport();
  await transport.sendMail({
    from: `ZeroTide <${gmailUser.value()}>`,
    to: settings.notifyEmail,
    subject: `ZeroTide: ${items.length} item${items.length === 1 ? "" : "s"} ready to buy`,
    html: digestHtml(items),
  });
  logger.info(`Digest sent to ${settings.notifyEmail} for ${items.length} item(s).`);
  return true;
}

// Manual test email so the user can verify their Gmail setup without waiting.
exports.sendTestEmail = onCall(
  { region: "us-central1", cors: true, invoker: "public", secrets: [gmailUser, gmailPass] },
  async (request) => {
    assertOwner(request);
    const settings = await loadSettings();
    if (!settings.notifyEmail) {
      throw new HttpsError("failed-precondition", "Add a notification email in Settings first.");
    }
    try {
      const transport = makeTransport();
      await transport.sendMail({
        from: `ZeroTide <${gmailUser.value()}>`,
        to: settings.notifyEmail,
        subject: "ZeroTide test email",
        html: `<div style="font-family:sans-serif;">✅ Your ZeroTide email notifications are working. You’ll get a digest when an item hits your price.</div>`,
      });
      return { success: true, sentTo: settings.notifyEmail };
    } catch (err) {
      logger.error("Test email failed", err);
      throw new HttpsError("internal", "Couldn't send: " + err.message);
    }
  }
);

module.exports.sendBuyNowDigest = sendBuyNowDigest;
module.exports.gmailSecrets = [gmailUser, gmailPass];
