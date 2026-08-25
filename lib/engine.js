/* ===================================================================
   lib/engine.js — server-side scan + classification engine (CommonJS).
   Shared by the Vercel serverless functions in /api.
   Uses the global fetch available in the Vercel Node runtime (Node 18+).

   Data sources, in priority order:
     1. lib/reddit.js — LIVE Reddit listings (never contain removed posts)
     2. PullPush archive (fallback) — verified for liveness before surfacing
   =================================================================== */

const reddit = require("./reddit.js");

const config = {
  // Scan founder/startup/indie communities from many directions.
  subreddits: [
    "cofounder", "startups", "Entrepreneur", "SaaS", "SideProject",
    "indiehackers", "EntrepreneurRideAlong", "growmybusiness",
    "smallbusiness", "microsaas",
  ],
  pullSize: 100, // Reddit /new supports up to 100 per subreddit
  // Pull several listings per subreddit for wide coverage.
  listings: [{ sort: "new" }, { sort: "top", t: "week" }],
  pullpushBase: "https://api.pullpush.io/reddit/search/submission/",
  timeoutMs: 9000, // stay comfortably under serverless function limits
  minMatch: 52, // only surface reasonably-relevant opportunities
};

/* ---------- keyword banks ---------- */
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

/* ---------- helpers ---------- */
function text(post) {
  return ((post.title || "") + " " + (post.desc || post.selftext || "")).toLowerCase();
}
function countHits(haystack, words) {
  let n = 0;
  for (const w of words) if (haystack.includes(w)) n++;
  return n;
}

function categorize(post) {
  const t = text(post);

  // Raw keyword evidence per category (before any subreddit nudging).
  const kw = {
    cofounder: countHits(t, KW.cofounder),
    hiring: countHits(t, KW.hiring),
    idea: countHits(t, KW.idea),
    insight: countHits(t, KW.insight),
  };
  const kwTotal = kw.cofounder + kw.hiring + kw.idea + kw.insight;

  // No real evidence at all -> it's noise, not an opportunity.
  if (kwTotal === 0) return null;
  // Reads like a low-signal question/vent and barely matched -> drop.
  if (countHits(t, NOISE) >= 2 && kwTotal <= 1) return null;

  const scores = {
    cofounder: kw.cofounder * 3,
    hiring: kw.hiring * 2,
    idea: kw.idea * 2,
    insight: kw.insight,
  };
  const sub = (post.subreddit || "").toLowerCase();
  if (sub === "cofounder") scores.cofounder += 2;
  if (sub === "sideproject") scores.insight += 1;
  if (sub === "saas") scores.insight += 1;

  const best = Object.keys(scores).reduce((a, b) => (scores[b] > scores[a] ? b : a), "insight");
  if (scores[best] === 0) return null;
  return best;
}

/* Normalized title key for de-duplication. */
function normTitle(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function scoreMatch(post, category) {
  const t = text(post);
  let s = 40;
  s += Math.min(countHits(t, KW[category] || []) * 6, 24);
  s += Math.min(countHits(t, STAGE_POSITIVE) * 4, 16);
  const eng = (post.score || 0) + (post.comments || post.num_comments || 0) * 2;
  s += Math.min(Math.round(Math.log10(eng + 1) * 7), 18);
  const ageH = (Date.now() / 1000 - (post.createdUtc || post.created_utc || 0)) / 3600;
  if (ageH < 24) s += 4;
  if (ageH < 6) s += 2;
  const body = post.desc || post.selftext || "";
  if (body.length > 140) s += 3;
  return Math.max(1, Math.min(99, Math.round(s)));
}

function deriveTags(post, category) {
  const t = text(post);
  const found = [];
  for (const [tag, words] of Object.entries(TAG_MAP)) {
    if (found.length >= 3) break;
    if (words.some((w) => t.includes(w))) found.push(tag);
  }
  if (found.length === 0) {
    found.push(category === "hiring" ? "role" : category === "idea" ? "opportunity" : "startup");
  }
  return found.slice(0, 3);
}

function cleanText(raw, max) {
  if (!raw) return "";
  let s = String(raw)
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (max && s.length > max) s = s.slice(0, max - 1).replace(/\s+\S*$/, "") + "\u2026";
  return s;
}

function toSignal(post) {
  if (!post || !post.title) return null;
  // Never surface removed/deleted content (would 404 or show a mod-removal notice).
  if (post.selftext === "[removed]" || post.selftext === "[deleted]") return null;
  if (post.author === "[deleted]" || post.author === "[removed]") return null;
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
    desc: norm.desc || "(No description \u2014 open on Reddit for the full post.)",
    tags: deriveTags(norm, category),
    score: post.score || 0,
    comments: post.num_comments || 0,
    author: post.author || "unknown",
    permalink,
    live: true,
  };
}

/* ---------- PullPush fetch ---------- */
const FIELDS = [
  "id", "title", "selftext", "subreddit", "author",
  "score", "num_comments", "created_utc", "permalink", "full_link", "url",
].join(",");

async function fetchSubreddit(subreddit, size) {
  const params = new URLSearchParams({
    subreddit,
    size: String(size || config.pullSize),
    sort: "desc",
    sort_type: "created_utc",
    fields: FIELDS,
  });
  const url = config.pullpushBase + "?" + params.toString();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "founder-radar/1.0" },
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const json = await res.json();
    return Array.isArray(json.data) ? json.data : [];
  } finally {
    clearTimeout(timer);
  }
}

/* PullPush fallback: fetch all subs, drop archive-time removed posts, then
   verify liveness against Reddit so we don't surface mod-removed posts. */
async function pullpushFallback(subs, size) {
  const results = await Promise.allSettled(subs.map((s) => fetchSubreddit(s, size)));
  const bySub = {};
  let scanned = 0;
  let anyOk = false;

  results.forEach((r, i) => {
    if (r.status === "fulfilled") { anyOk = true; bySub[subs[i]] = r.value; }
    else bySub[subs[i]] = [];
  });
  if (!anyOk) return { ok: false, bySub: {}, scanned: 0 };

  for (const sub of subs) {
    const raw = bySub[sub] || [];
    scanned += raw.length;
    const notRemoved = raw.filter(
      (p) => p && p.title &&
        p.selftext !== "[removed]" && p.selftext !== "[deleted]" &&
        p.author !== "[deleted]" && p.author !== "[removed]"
    );
    // Best-effort liveness verification (returns input unchanged if Reddit unreachable).
    bySub[sub] = await reddit.filterLive(notRemoved);
  }
  return { ok: true, bySub, scanned };
}

/* Scan every configured subreddit, classify, score, and de-dupe.
   LIVE Reddit is preferred; PullPush is the fallback. Never throws. */
async function scanAll(opts = {}) {
  const subs = opts.subreddits || config.subreddits;
  const size = opts.size || config.pullSize;
  const minMatch = opts.minMatch != null ? opts.minMatch : config.minMatch;

  let bySub = {};
  let scanned = 0;
  let anyOk = false;
  let source = "reddit";

  // 1) LIVE Reddit listings (never include removed posts).
  try {
    const rr = await reddit.fetchAll(subs, { limit: size, listings: opts.listings || config.listings });
    if (rr.ok && rr.scanned > 0) {
      bySub = rr.bySub;
      scanned = rr.scanned;
      source = rr.source;
      anyOk = true;
    }
  } catch { /* fall through to PullPush */ }

  // 2) Fallback: PullPush archive, liveness-verified.
  if (!anyOk) {
    const pp = await pullpushFallback(subs, size);
    if (pp.ok) {
      bySub = pp.bySub;
      scanned = pp.scanned;
      source = "pullpush";
      anyOk = true;
    }
  }

  if (!anyOk) return { ok: false, error: "upstream_unavailable", signals: [], scanned: 0, sources: {} };

  // Classify + de-dupe by post id.
  const seenId = new Set();
  const collected = [];
  for (const sub of subs) {
    for (const post of bySub[sub] || []) {
      const sig = toSignal(post);
      if (!sig) continue;
      if (minMatch && sig.match < minMatch) continue;
      if (seenId.has(sig.id)) continue;
      seenId.add(sig.id);
      collected.push(sig);
    }
  }

  // Rank by match, then de-dupe by normalized title (keeps the strongest copy).
  collected.sort((a, b) => b.match - a.match);
  const seenTitle = new Set();
  const signals = [];
  const sources = {};
  for (const sub of subs) sources[sub] = 0;
  for (const sig of collected) {
    const key = normTitle(sig.title);
    if (seenTitle.has(key)) continue;
    seenTitle.add(key);
    signals.push(sig);
    sources[sig.subreddit] = (sources[sig.subreddit] || 0) + 1;
  }

  return { ok: true, signals, scanned, sources, source, scannedAt: Date.now() };
}

module.exports = {
  config,
  categorize,
  scoreMatch,
  deriveTags,
  cleanText,
  toSignal,
  normTitle,
  fetchSubreddit,
  pullpushFallback,
  scanAll,
};
