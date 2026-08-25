/* ===================================================================
   POST /api/digest — join the digest AND (when configured) generate an
   AI opportunity report and email it via Resend.

   Body: { "email": "you@founder.co", "send": true }

   Behavior:
     • Always validates + records the signup (and forwards it to
       DIGEST_WEBHOOK_URL if set).
     • If send !== false and OPENAI_API_KEY is configured, it scans Reddit,
       reads comments for pain points, and generates startup opportunities.
     • If RESEND_API_KEY is configured, it emails that report to the user.
     • Returns the generated opportunities so the UI can show them inline.
   Missing keys degrade gracefully (the signup still succeeds).
   =================================================================== */

const report = require("../lib/report.js");
const mailer = require("../lib/email.js");
const ai = require("../lib/ai.js");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readBody(req) {
  // Vercel usually parses JSON into req.body; handle raw + string too.
  return new Promise((resolve) => {
    if (req.body && typeof req.body === "object") return resolve(req.body);
    if (typeof req.body === "string") {
      try { return resolve(JSON.parse(req.body)); } catch { return resolve({}); }
    }
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); }
    });
    req.on("error", () => resolve({}));
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  const body = await readBody(req);
  const email = String((body && body.email) || "").trim().toLowerCase();

  if (!EMAIL_RE.test(email) || email.length > 254) {
    res.status(400).json({ ok: false, error: "invalid_email" });
    return;
  }

  const record = {
    email,
    source: "founder-radar",
    at: new Date().toISOString(),
    ua: req.headers["user-agent"] || "",
  };

  const webhook = process.env.DIGEST_WEBHOOK_URL;
  if (webhook) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const r = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!r.ok) throw new Error("webhook " + r.status);
    } catch (err) {
      // Don't fail the user's signup on a downstream hiccup; log and accept.
      console.error("digest webhook failed:", err && err.message);
    }
  } else {
    console.log("digest signup:", JSON.stringify(record));
  }

  const aiConfigured = ai.isConfigured();
  const emailConfigured = mailer.isConfigured();
  const wantSend = body.send !== false; // default: generate + email now

  // Just subscribing (or AI disabled) — confirm and tell the user what's missing.
  if (!wantSend || !aiConfigured) {
    return res.status(200).json({
      ok: true,
      email,
      subscribed: true,
      aiConfigured,
      emailConfigured,
      emailed: false,
      note: aiConfigured
        ? "Subscribed. Your first AI report will arrive on the next digest run."
        : "Subscribed. Add OPENAI_API_KEY (and RESEND_API_KEY) in Vercel to enable AI reports.",
    });
  }

  // Generate the AI opportunity report now.
  let rep;
  try {
    rep = await report.buildReport({ limit: parseInt(body.limit, 10) || 6 });
  } catch (err) {
    return res.status(200).json({
      ok: true, email, subscribed: true, aiConfigured, emailConfigured,
      emailed: false, note: "Subscribed, but report generation failed: " + String(err && err.message),
    });
  }

  if (!rep.ok || !rep.opportunities.length) {
    return res.status(200).json({
      ok: true, email, subscribed: true, aiConfigured, emailConfigured,
      emailed: false, opportunities: [],
      note: "Subscribed, but no opportunities could be generated right now. Will retry on the next run.",
    });
  }

  // Email it via Resend (if configured).
  let emailed = false;
  let emailError;
  if (emailConfigured) {
    const sent = await mailer.sendDigest(email, rep.opportunities);
    emailed = !!sent.ok;
    if (!sent.ok) emailError = sent.error;
  }

  return res.status(200).json({
    ok: true,
    email,
    subscribed: true,
    aiConfigured,
    emailConfigured,
    emailed,
    emailError,
    count: rep.opportunities.length,
    opportunities: rep.opportunities,
    note: emailed
      ? "Report emailed. It's also shown below."
      : emailConfigured
        ? "Generated the report, but the email failed to send (" + emailError + "). Shown below."
        : "Generated the report. Add RESEND_API_KEY in Vercel to also email it. Shown below.",
  });
};
