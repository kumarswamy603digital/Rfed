/* ===================================================================
   lib/report.js — compose the pipeline:
     scan Reddit  ->  attach top comments  ->  AI pain-point analysis.
   Shared by /api/analyze and /api/digest.
   =================================================================== */

const engine = require("./engine.js");
const reddit = require("./reddit.js");
const ai = require("./ai.js");

/* Attach top comments to each signal (bounded parallelism). */
async function attachComments(signals, perPost) {
  const limit = perPost || 10;
  const results = await Promise.allSettled(
    signals.map((s) => reddit.fetchComments(s, { limit }))
  );
  results.forEach((r, i) => {
    signals[i].comments = r.status === "fulfilled" ? r.value : [];
  });
  return signals;
}

/* Full report: scan -> pick top N -> comments -> AI opportunities. */
async function buildReport(opts = {}) {
  const limit = Math.max(1, Math.min(12, opts.limit || 6));

  const scan = await engine.scanAll({ minMatch: opts.minMatch });
  if (!scan.ok) {
    return { ok: false, error: scan.error || "scan_failed", opportunities: [], signals: [] };
  }

  const top = scan.signals.slice(0, limit);
  await attachComments(top, opts.commentsPerPost || 10);

  const aiConfigured = ai.isConfigured();
  let opportunities = [];
  if (aiConfigured) {
    const res = await ai.generateOpportunities(top, { max: limit });
    opportunities = res.opportunities || [];
  }

  return {
    ok: true,
    source: scan.source,
    scanned: scan.scanned,
    aiConfigured,
    signals: top,
    opportunities,
  };
}

/* Analyze a single post (already-known fields from the UI). */
async function analyzeOne(postLike, opts = {}) {
  const sig = {
    id: postLike.id,
    title: postLike.title,
    desc: postLike.desc || postLike.selftext || "",
    subreddit: postLike.subreddit,
    permalink: postLike.permalink || postLike.url,
    category: postLike.category || "signal",
    match: postLike.match,
  };
  sig.comments = await reddit.fetchComments(
    { id: sig.id, subreddit: sig.subreddit, permalink: sig.permalink },
    { limit: opts.commentsPerPost || 15 }
  );

  if (!ai.isConfigured()) {
    return { ok: false, error: "ai_not_configured", aiConfigured: false, commentsAnalyzed: sig.comments.length };
  }
  const res = await ai.generateOpportunities([sig], { max: 1 });
  return {
    ok: true,
    aiConfigured: true,
    commentsAnalyzed: sig.comments.length,
    opportunity: (res.opportunities && res.opportunities[0]) || null,
  };
}

module.exports = { attachComments, buildReport, analyzeOne };
