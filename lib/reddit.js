/* ===================================================================
   lib/reddit.js — LIVE Reddit source (CommonJS, Node runtime).

   Why this exists: PullPush is a historical *archive*. It stores a post
   as it looked when created, so a post can look fine in the archive but
   have been removed by mods on live Reddit (r/cofounder auto-removes
   short posts). Clicking such a signal shows "removed by moderator".

   This module reads Reddit's *live* listings instead, which by definition
   never contain removed/deleted posts — so every surfaced signal is a
   real, openable post.

   Auth:
     • If REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET are set, we use the
       official app-only OAuth API (oauth.reddit.com) — most reliable,
       especially from cloud IPs.
     • Otherwise we fall back to the public www.reddit.com JSON endpoints.
   =================================================================== */

const UA =
  process.env.REDDIT_USER_AGENT ||
  "web:founder-radar:v1.1 (startup-opportunity radar)";

const TIMEOUT_MS = 9000;

let tokenCache = { token: null, exp: 0 };

function hasOAuth() {
  return !!(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET);
}

async function withTimeout(promiseFactory) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await promiseFactory(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function getAccessToken() {
  const now = Date.now();
  if (tokenCache.token && now < tokenCache.exp - 30000) return tokenCache.token;

  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  const basic = Buffer.from(id + ":" + secret).toString("base64");

  const res = await withTimeout((signal) =>
    fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: "Basic " + basic,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": UA,
      },
      body: "grant_type=client_credentials",
      signal,
    })
  );
  if (!res.ok) throw new Error("oauth token HTTP " + res.status);
  const json = await res.json();
  tokenCache = {
    token: json.access_token,
    exp: now + (json.expires_in || 3600) * 1000,
  };
  return tokenCache.token;
}

/* Low-level GET against Reddit, using OAuth when available. */
async function redditGet(pathAndQuery) {
  if (hasOAuth()) {
    const token = await getAccessToken();
    const url = "https://oauth.reddit.com" + pathAndQuery;
    return withTimeout((signal) =>
      fetch(url, {
        headers: { Authorization: "Bearer " + token, "User-Agent": UA },
        signal,
      })
    );
  }
  // Public JSON. Ensure `.json` is present before any query string.
  const [path, query] = pathAndQuery.split("?");
  const jsonPath = path.endsWith(".json") ? path : path + ".json";
  const url = "https://www.reddit.com" + jsonPath + (query ? "?" + query : "");
  return withTimeout((signal) =>
    fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal })
  );
}

function isRemoved(d) {
  return (
    !!d.removed_by_category ||
    d.selftext === "[removed]" ||
    d.selftext === "[deleted]" ||
    d.author === "[deleted]" ||
    d.author === "[removed]" ||
    d.removed === true ||
    d.banned_by != null
  );
}

/* Reddit listing child -> our normalized post shape. Returns null to drop. */
function normalize(child) {
  const d = child && child.data ? child.data : null;
  if (!d) return null;
  if (d.stickied || d.pinned) return null;
  if (d.over_18) return null;
  if (isRemoved(d)) return null;
  if (!d.title) return null;

  return {
    id: d.id,
    title: d.title,
    selftext: d.selftext || "",
    subreddit: d.subreddit,
    author: d.author,
    score: d.score || 0,
    num_comments: d.num_comments || 0,
    created_utc: d.created_utc || 0,
    permalink: d.permalink
      ? "https://www.reddit.com" + d.permalink
      : "https://www.reddit.com/r/" + d.subreddit + "/comments/" + d.id,
    url: d.url,
    is_self: d.is_self,
    flair: d.link_flair_text || "",
  };
}

/* Fetch a single subreddit's newest posts (live, filtered). */
async function fetchListing(subreddit, size) {
  const limit = Math.max(5, Math.min(100, size || 100));
  const res = await redditGet(
    "/r/" + encodeURIComponent(subreddit) + "/new?limit=" + limit + "&raw_json=1"
  );
  if (!res.ok) throw new Error("listing " + subreddit + " HTTP " + res.status);
  const json = await res.json();
  const children = (json && json.data && json.data.children) || [];
  const posts = [];
  for (const c of children) {
    const p = normalize(c);
    if (p) posts.push(p);
  }
  return posts;
}

/* Fetch every subreddit. Never throws.
   Returns { ok, bySub, scanned, source }. ok=false only if ALL fail. */
async function fetchAll(subreddits, size) {
  const results = await Promise.allSettled(
    subreddits.map((s) => fetchListing(s, size))
  );
  const bySub = {};
  let scanned = 0;
  let anyOk = false;
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      anyOk = true;
      bySub[subreddits[i]] = r.value;
      scanned += r.value.length;
    } else {
      bySub[subreddits[i]] = [];
    }
  });
  return {
    ok: anyOk,
    bySub,
    scanned,
    source: hasOAuth() ? "reddit-oauth" : "reddit-public",
  };
}

/* Liveness check for a set of posts (used to verify PullPush results).
   Batches up to 100 ids into one /api/info call. On any failure, returns
   the input unchanged (best-effort — never removes everything on error). */
async function filterLive(posts) {
  if (!posts.length) return posts;
  try {
    const ids = posts.slice(0, 100).map((p) => "t3_" + p.id).join(",");
    const res = await redditGet("/api/info?id=" + ids + "&raw_json=1");
    if (!res.ok) return posts;
    const json = await res.json();
    const children = (json && json.data && json.data.children) || [];
    const liveIds = new Set();
    for (const c of children) {
      const d = c && c.data;
      if (d && !isRemoved(d) && !d.stickied) liveIds.add(d.id);
    }
    if (liveIds.size === 0) return posts; // check returned nothing usable
    return posts.filter((p) => liveIds.has(p.id));
  } catch {
    return posts;
  }
}

module.exports = { fetchListing, fetchAll, filterLive, hasOAuth, isRemoved };
