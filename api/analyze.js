/* ===================================================================
   POST /api/analyze — AI pain-point analysis + opportunity generation.

   Two modes:
     • Single post (from a feed card):
         body: { id, title, subreddit, permalink, selftext|desc, category, match }
         -> { ok, aiConfigured, commentsAnalyzed, opportunity }
     • Top-N report (fresh scan):
         body: { report: true, limit }  (or GET ?report=1&limit=6)
         -> { ok, aiConfigured, source, scanned, opportunities[] }

   Returns aiConfigured:false (not an error) when OPENAI_API_KEY is unset,
   so the UI can prompt the user to add a key.
   =================================================================== */

const report = require("../lib/report.js");
const ai = require("../lib/ai.js");

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === "object") return resolve(req.body);
    if (typeof req.body === "string") {
      try { return resolve(JSON.parse(req.body)); } catch { return resolve({}); }
    }
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const q = req.query || {};
  const wantReport = q.report === "1" || q.report === "true";
  const body = req.method === "POST" ? await readBody(req) : {};

  try {
    // Report mode
    if (wantReport || body.report) {
      const limit = parseInt(body.limit || q.limit, 10) || 6;
      const r = await report.buildReport({ limit });
      if (!r.ok) { res.setHeader("Cache-Control", "no-store"); return res.status(502).json(r); }
      return res.status(200).json({
        ok: true,
        aiConfigured: r.aiConfigured,
        source: r.source,
        scanned: r.scanned,
        opportunities: r.opportunities,
      });
    }

    // Single-post mode
    if (req.method !== "POST" || !body.title) {
      return res.status(400).json({ ok: false, error: "missing_post" });
    }
    if (!ai.isConfigured()) {
      return res.status(200).json({
        ok: false,
        aiConfigured: false,
        error: "ai_not_configured",
        hint: "Set OPENAI_API_KEY in your Vercel project to enable AI analysis.",
      });
    }
    const r = await report.analyzeOne(body, { commentsPerPost: 15 });
    return res.status(200).json(r);
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).json({ ok: false, error: "analyze_failed", detail: String(err && err.message) });
  }
};
