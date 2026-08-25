/* ===================================================================
   POST /api/digest — daily-digest email signup.
   Body: { "email": "you@founder.co" }

   Storage is intentionally pluggable and dependency-free:
     • If the DIGEST_WEBHOOK_URL env var is set, the signup is forwarded
       there (Zapier / Make / your ESP / a serverless DB webhook).
     • Otherwise the signup is validated and accepted (logged) so the
       flow works out of the box; wire up persistence when you're ready.
   =================================================================== */

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

  res.status(200).json({ ok: true, email });
};
