/* ===================================================================
   GET /api/signals — scan Reddit via PullPush, classify + score,
   return signals as JSON. Runs on Vercel's Node runtime.

   Query params (optional):
     ?subreddits=cofounder,startups   override scanned communities
     ?size=40                          posts pulled per subreddit

   Response: { ok, signals[], scanned, sources{}, scannedAt }
   Cached at the edge for 15 min (stale-while-revalidate 5 min).
   =================================================================== */

const engine = require("../lib/engine.js");

module.exports = async function handler(req, res) {
  // CORS (safe: this is public, read-only data).
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  const q = req.query || {};
  const opts = {};
  if (q.subreddits) {
    opts.subreddits = String(q.subreddits)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 12);
  }
  if (q.size) {
    const n = parseInt(q.size, 10);
    if (!Number.isNaN(n)) opts.size = Math.max(5, Math.min(100, n));
  }

  try {
    const result = await engine.scanAll(opts);

    if (!result.ok) {
      // Upstream (PullPush) is down — tell the client so it can fall back.
      res.setHeader("Cache-Control", "no-store");
      res.status(502).json(result);
      return;
    }

    // Cache the successful scan at Vercel's edge for the refresh cadence.
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=900, stale-while-revalidate=300"
    );
    res.status(200).json(result);
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    res.status(500).json({ ok: false, error: "scan_failed", signals: [], scanned: 0, sources: {} });
  }
};
