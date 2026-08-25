/* ===================================================================
   classify.js — turn a raw Reddit submission into a scored "signal".
   Exposes: window.FR.classify (toSignal, categorize, scoreMatch, ...)
   =================================================================== */
(function () {
  window.FR = window.FR || {};

  /* Keyword banks used for categorization + relevance. */
  const KW = {
    cofounder: [
      "co-founder", "cofounder", "co founder", "looking for a technical",
      "looking for a non-technical", "seeking cto", "seeking a technical",
      "need a co", "join me", "equal equity", "split equity", "founding partner",
      "seeking co", "want to build together", "cto co", "technical co",
    ],
    hiring: [
      "hiring", "we're hiring", "we are hiring", "join our team", "founding engineer",
      "first engineer", "first hire", "now hiring", "open role", "we're looking to hire",
      "employee #", "early employee", "job opening", "full-time", "salary", "equity + salary",
    ],
    idea: [
      "idea", "nobody built", "no one has built", "underserved", "gap in the market",
      "someone should build", "wedge", "pain point", "keeps asking", "begging for",
      "opportunity", "market for", "validated", "willing to pay", "would pay",
    ],
    insight: [
      "pattern", "trend", "i noticed", "recurring", "learned", "lesson", "data shows",
      "analysis", "report", "retention", "churn", "takeaway", "here's what", "growth",
      "case study", "breakdown", "quietly making",
    ],
  };

  /* Signals that a post is *noise* (not a real opportunity). */
  const NOISE = [
    "how do i", "is it worth", "should i quit", "rate my", "roast my",
    "just launched", "check out my", "feedback on my", "upvote", "vent",
    "am i the only", "rant", "advice needed", "help me decide",
  ];

  const STAGE_POSITIVE = [
    "mrr", "arr", "revenue", "paying", "customers", "waitlist", "prototype",
    "raised", "traction", "users", "beta", "launched", "profitable", "$",
  ];

  const TAG_MAP = {
    fintech: ["fintech", "payment", "invoic", "banking", "stripe"],
    ai: ["ai", "gpt", "llm", "machine learning", "ml "],
    b2b: ["b2b", "saas", "enterprise", "smb"],
    saas: ["saas", "subscription", "recurring"],
    mobile: ["mobile", "ios", "android", "app store"],
    consumer: ["consumer", "b2c", "social"],
    marketplace: ["marketplace", "two-sided", "supply and demand"],
    "has-revenue": ["mrr", "arr", "revenue", "paying", "profitable"],
    remote: ["remote", "distributed", "anywhere"],
    equity: ["equity", "equal split", "co-founder"],
    climate: ["climate", "carbon", "sustainab", "green"],
    healthtech: ["health", "medical", "clinic", "patient"],
    legaltech: ["legal", "law firm", "contract review", "compliance"],
    ecommerce: ["ecommerce", "e-commerce", "shopify", "dtc"],
    developer: ["developer tool", "devtool", "api", "sdk"],
  };

  function text(post) {
    return ((post.title || "") + " " + (post.desc || post.selftext || "")).toLowerCase();
  }

  function countHits(haystack, words) {
    let n = 0;
    for (const w of words) if (haystack.includes(w)) n++;
    return n;
  }

  /* Decide the category of a post. Returns a key of FR.categories, or null
     if the post reads like noise rather than an opportunity. */
  function categorize(post) {
    const t = text(post);

    const scores = {
      cofounder: countHits(t, KW.cofounder) * 3,
      hiring: countHits(t, KW.hiring) * 2,
      idea: countHits(t, KW.idea) * 2,
      insight: countHits(t, KW.insight),
    };

    // Subreddit nudges.
    const sub = (post.subreddit || "").toLowerCase();
    if (sub === "cofounder") scores.cofounder += 2;
    if (sub === "sideproject") scores.insight += 1;
    if (sub === "saas") scores.insight += 1;

    const best = Object.keys(scores).reduce((a, b) => (scores[b] > scores[a] ? b : a), "insight");

    // Reject as noise if nothing meaningful matched and it trips a noise phrase.
    const noiseHits = countHits(t, NOISE);
    if (scores[best] === 0 && noiseHits > 0) return null;
    if (scores[best] === 0) return null;

    return best;
  }

  /* MATCH score 0-100: relevance signal blended from keyword strength,
     stage/traction words, and community engagement. Deterministic. */
  function scoreMatch(post, category) {
    const t = text(post);
    let s = 40;

    // Category confidence.
    const catHits = countHits(t, KW[category] || []);
    s += Math.min(catHits * 6, 24);

    // Traction / stage evidence.
    s += Math.min(countHits(t, STAGE_POSITIVE) * 4, 16);

    // Engagement (log-scaled so a few viral posts don't dominate).
    const eng = (post.score || 0) + (post.comments || post.num_comments || 0) * 2;
    s += Math.min(Math.round(Math.log10(eng + 1) * 7), 18);

    // Freshness bonus (last 24h).
    const ageH = (Date.now() / 1000 - (post.createdUtc || post.created_utc || 0)) / 3600;
    if (ageH < 24) s += 4;
    if (ageH < 6) s += 2;

    // Clarity: longer, structured self-text tends to be a real ask.
    const body = (post.desc || post.selftext || "");
    if (body.length > 140) s += 3;

    return Math.max(1, Math.min(99, Math.round(s)));
  }

  /* Auto-derive up to 3 hashtags from content. */
  function deriveTags(post, category) {
    const t = text(post);
    const found = [];
    for (const [tag, words] of Object.entries(TAG_MAP)) {
      if (found.length >= 3) break;
      if (words.some((w) => t.includes(w))) found.push(tag);
    }
    if (found.length === 0) {
      // Fall back to a category-appropriate tag.
      found.push(category === "hiring" ? "role" : category === "idea" ? "opportunity" : "startup");
    }
    return found.slice(0, 3);
  }

  /* Strip markdown / collapse whitespace and trim to a teaser length. */
  function cleanText(raw, max) {
    if (!raw) return "";
    let s = raw
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // markdown links -> text
      .replace(/[#>*_`~]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (max && s.length > max) s = s.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
    return s;
  }

  /* Convert a raw PullPush submission into a signal, or null if it's noise. */
  function toSignal(post) {
    if (!post || !post.title) return null;
    // Skip removed/deleted content.
    if (post.selftext === "[removed]" || post.selftext === "[deleted]") { /* still allow title-only */ }

    const norm = {
      title: cleanText(post.title, 140),
      desc: cleanText(post.selftext, 220),
      subreddit: post.subreddit,
      score: post.score || 0,
      num_comments: post.num_comments || 0,
      created_utc: post.created_utc || 0,
    };

    const category = categorize(norm);
    if (!category) return null;

    const permalink = post.permalink
      ? (post.permalink.startsWith("http") ? post.permalink : "https://reddit.com" + post.permalink)
      : (post.full_link || post.url || "https://reddit.com/r/" + post.subreddit);

    return {
      id: post.id || permalink,
      category,
      subreddit: post.subreddit,
      createdUtc: post.created_utc || 0,
      match: scoreMatch(norm, category),
      title: norm.title,
      desc: norm.desc || "(No description — open on Reddit for the full post.)",
      tags: deriveTags(norm, category),
      score: post.score || 0,
      comments: post.num_comments || 0,
      author: post.author || "unknown",
      permalink,
      live: true,
    };
  }

  /* "2h ago" / "3d ago" formatting. */
  function timeAgo(utcSeconds) {
    const diff = Math.max(0, Date.now() / 1000 - utcSeconds);
    if (diff < 3600) return Math.max(1, Math.floor(diff / 60)) + "m ago";
    if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
    return Math.floor(diff / 86400) + "d ago";
  }

  FR.classify = { toSignal, categorize, scoreMatch, deriveTags, cleanText, timeAgo };
})();
