/* ===================================================================
   pullpush.js — client for the PullPush.io Reddit API.
   Runs entirely in the browser (PullPush is CORS-enabled).
   Exposes: window.FR.pullpush.scanAll()
   =================================================================== */
(function () {
  window.FR = window.FR || {};

  const FIELDS = [
    "id", "title", "selftext", "subreddit", "author",
    "score", "num_comments", "created_utc", "permalink", "full_link", "url",
  ].join(",");

  /* Fetch recent submissions for a single subreddit. */
  async function fetchSubreddit(subreddit, opts = {}) {
    const size = opts.size || FR.config.pullSize;
    const params = new URLSearchParams({
      subreddit,
      size: String(size),
      sort: "desc",
      sort_type: "created_utc",
      fields: FIELDS,
    });
    const url = FR.config.pullpushBase + "?" + params.toString();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs || 12000);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const json = await res.json();
      return Array.isArray(json.data) ? json.data : [];
    } finally {
      clearTimeout(timer);
    }
  }

  /* Scan every configured subreddit, classify, dedupe, and return
     { signals, scanned, sources, error }. Never throws. */
  async function scanAll(opts = {}) {
    const subs = FR.config.subreddits;
    let scanned = 0;
    let anyOk = false;
    const rawBySub = {};

    const results = await Promise.allSettled(
      subs.map((s) => fetchSubreddit(s, opts))
    );

    results.forEach((r, i) => {
      const sub = subs[i];
      if (r.status === "fulfilled") {
        anyOk = true;
        rawBySub[sub] = r.value;
        scanned += r.value.length;
      } else {
        rawBySub[sub] = [];
      }
    });

    if (!anyOk) {
      return { ok: false, error: "network", signals: [], scanned: 0, sources: {} };
    }

    // Classify + collect.
    const seen = new Set();
    const signals = [];
    const sources = {};
    for (const sub of subs) sources[sub] = 0;

    for (const sub of subs) {
      for (const post of rawBySub[sub] || []) {
        const sig = FR.classify.toSignal(post);
        if (!sig) continue;
        if (seen.has(sig.id)) continue;
        seen.add(sig.id);
        signals.push(sig);
        if (sources[sig.subreddit] === undefined) sources[sig.subreddit] = 0;
        sources[sig.subreddit]++;
      }
    }

    signals.sort((a, b) => b.match - a.match);

    return { ok: true, signals, scanned, sources };
  }

  FR.pullpush = { fetchSubreddit, scanAll };
})();
