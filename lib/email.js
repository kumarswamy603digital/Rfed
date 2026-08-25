/* ===================================================================
   lib/email.js — send the AI opportunity report via Resend (REST).

   Dependency-free: just fetch() against https://api.resend.com/emails.

   Env:
     RESEND_API_KEY  (required to send)
     DIGEST_FROM     (default "Founder Radar <onboarding@resend.dev>")
   =================================================================== */

const RESEND_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 15000;

function isConfigured() {
  return !!process.env.RESEND_API_KEY;
}

function fromAddress() {
  return process.env.DIGEST_FROM || "Founder Radar <onboarding@resend.dev>";
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/* Build the HTML body for the opportunity report. */
function buildDigestHtml(opportunities, meta = {}) {
  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const cards = opportunities.map((o, i) => {
    const opp = o.opportunity || {};
    const pains = (o.painPoints || [])
      .map((p) => `<li style="margin:0 0 6px;color:#4b4b4b;">${esc(p)}</li>`)
      .join("");
    const field = (label, val) =>
      val ? `<p style="margin:6px 0;color:#2b2b2b;font-size:14px;line-height:1.5;">
              <strong style="color:#111;">${esc(label)}:</strong> ${esc(val)}</p>` : "";

    return `
      <tr><td style="padding:22px 0;border-top:1px solid #ececec;">
        <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#f9552b;font-weight:700;">
          #${i + 1} · ${esc((o.category || "signal"))} · ${esc(o.confidence || "")} confidence
        </div>
        <h2 style="margin:8px 0 6px;font-size:20px;color:#111;line-height:1.25;">
          ${esc(opp.headline || o.sourceTitle)}
        </h2>
        <p style="margin:0 0 14px;color:#333;font-size:15px;line-height:1.6;">
          ${esc(o.plainEnglish || "")}
        </p>
        ${pains ? `<p style="margin:12px 0 6px;font-size:13px;font-weight:700;color:#111;">Pain points people mentioned</p>
          <ul style="margin:0 0 12px;padding-left:18px;font-size:14px;">${pains}</ul>` : ""}
        ${field("Problem", opp.problem)}
        ${field("Who has it", opp.who)}
        ${field("What to build", opp.solution)}
        ${field("Why now", opp.whyNow)}
        <p style="margin:14px 0 0;font-size:13px;color:#777;">
          Source: <a href="${esc(o.url)}" style="color:#f9552b;text-decoration:none;">r/${esc(o.subreddit)} thread ↗</a>
          ${o.match != null ? ` · match ${esc(o.match)}` : ""}
        </p>
      </td></tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html><body style="margin:0;background:#f6f5f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f5f3;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;padding:32px 34px;">
        <tr><td>
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:15px;letter-spacing:.14em;color:#111;">
            <span style="color:#f9552b;">●</span> FOUNDER / RADAR
          </div>
          <h1 style="margin:18px 0 4px;font-family:Georgia,serif;font-size:26px;color:#111;line-height:1.2;">
            Your startup opportunity report
          </h1>
          <p style="margin:0 0 6px;color:#888;font-size:13px;">${esc(dateStr)}</p>
          <p style="margin:0 0 4px;color:#444;font-size:15px;line-height:1.6;">
            We scanned founder communities on Reddit, read the comments for the real
            pain points, and turned them into ${opportunities.length} startup ${opportunities.length === 1 ? "opportunity" : "opportunities"} — in plain English.
          </p>
        </td></tr>
        <tr><td>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cards}</table>
        </td></tr>
        <tr><td style="padding-top:22px;border-top:1px solid #ececec;">
          <p style="margin:0;color:#999;font-size:12px;line-height:1.6;">
            Signal from the noise. Not affiliated with Reddit Inc.<br/>
            You're receiving this because you joined the Founder Radar daily digest.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/* Plain-text fallback body. */
function buildDigestText(opportunities) {
  const lines = ["FOUNDER / RADAR — your startup opportunity report", ""];
  opportunities.forEach((o, i) => {
    const opp = o.opportunity || {};
    lines.push(`#${i + 1} ${opp.headline || o.sourceTitle}`);
    if (o.plainEnglish) lines.push(o.plainEnglish);
    if (o.painPoints && o.painPoints.length) {
      lines.push("Pain points:");
      o.painPoints.forEach((p) => lines.push("  - " + p));
    }
    if (opp.problem) lines.push("Problem: " + opp.problem);
    if (opp.who) lines.push("Who has it: " + opp.who);
    if (opp.solution) lines.push("What to build: " + opp.solution);
    if (opp.whyNow) lines.push("Why now: " + opp.whyNow);
    lines.push("Source: " + o.url);
    lines.push("");
  });
  lines.push("Signal from the noise. Not affiliated with Reddit Inc.");
  return lines.join("\n");
}

/* Send the report to one recipient. Never throws — returns {ok,...}. */
async function sendDigest(to, opportunities, opts = {}) {
  if (!isConfigured()) return { ok: false, error: "resend_not_configured" };
  if (!to) return { ok: false, error: "no_recipient" };
  if (!opportunities || !opportunities.length) return { ok: false, error: "no_opportunities" };

  const payload = {
    from: fromAddress(),
    to: [to],
    subject:
      opts.subject ||
      `Founder Radar: ${opportunities.length} startup ${opportunities.length === 1 ? "opportunity" : "opportunities"} from Reddit`,
    html: buildDigestHtml(opportunities, opts.meta),
    text: buildDigestText(opportunities),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.RESEND_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: "resend_http_" + res.status, detail: data };
    return { ok: true, id: data.id };
  } catch (err) {
    return { ok: false, error: "resend_failed", detail: String(err && err.message) };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { isConfigured, fromAddress, buildDigestHtml, buildDigestText, sendDigest };
