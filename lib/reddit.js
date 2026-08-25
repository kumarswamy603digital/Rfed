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

function parseChildren(json) {
  const children = (json && json.data && json.data.children) || [];
  const posts = [];
  for (const c of children) {
    const p = normalize(c);
    if (p) posts.push(p);
  }
  return posts;
}

/* Fetch one listing (new | hot | top | rising) from a subreddit. */
async function fetchListing(subreddit, opts = {}) {
  if (typeof opts === "number") opts = { limit: opts }; // back-compat
  const limit = Math.max(5, Math.min(100, opts.limit || 100));
  const sort = opts.sort || "new";
  let q = "/r/" + encodeURIComponent(subreddit) + "/" + sort + "?limit=" + limit + "&raw_json=1";
  if (sort === "top") q += "&t=" + (opts.t || "week");
  const res = await redditGet(q);
  if (!res.ok) throw new Error("listing " + subreddit + "/" + sort + " HTTP " + res.status);
  return parseChildren(await res.json());
}

/* Keyword search inside a subreddit (or across Reddit if subreddit is falsy). */
async function search(subreddit, query, opts = {}) {
  const limit = Math.max(5, Math.min(100, opts.limit || 50));
  const sort = opts.sort || "new";
  const params =
    "q=" + encodeURIComponent(query) + "&sort=" + sort + "&limit=" + limit +
    "&raw_json=1&type=link" + (subreddit ? "&restrict_sr=1" : "");
  const base = subreddit ? "/r/" + encodeURIComponent(subreddit) + "/search" : "/search";
  const res = await redditGet(base + "?" + params);
  if (!res.ok) throw new Error("search HTTP " + res.status);
  return parseChildren(await res.json());
}

/* Fetch every subreddit, pulling multiple listings for a wide net.
   Merges + de-dupes per subreddit by post id. Never throws.
   Returns { ok, bySub, scanned, source }. ok=false only if ALL fail. */
async function fetchAll(subreddits, opts = {}) {
  if (typeof opts === "number") opts = { limit: opts }; // back-compat
  const limit = opts.limit || 100;
  const listings = opts.listings || [{ sort: "new" }, { sort: "top", t: "week" }];

  const tasks = [];
  const taskSub = [];
  for (const sub of subreddits) {
    for (const l of listings) {
      tasks.push(fetchListing(sub, { limit, sort: l.sort, t: l.t }));
      taskSub.push(sub);
    }
  }

  const results = await Promise.allSettled(tasks);
  const bySubMap = {};
  for (const s of subreddits) bySubMap[s] = new Map();
  let anyOk = false;

  results.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    anyOk = true;
    const sub = taskSub[i];
    for (const p of r.value) if (!bySubMap[sub].has(p.id)) bySubMap[sub].set(p.id, p);
  });

  const bySub = {};
  let scanned = 0;
  for (const s of subreddits) {
    bySub[s] = Array.from(bySubMap[s].values());
    scanned += bySub[s].length;
  }
  return {
    ok: anyOk,
    bySub,
    scanned,
    source: hasOAuth() ? "reddit-oauth" : "reddit-public",
  };
}

/* Fetch top-level comments for a post. Accepts a post object, a permalink,
   or "/r/sub/comments/id". Returns [{ author, body, score }] (top-scored,
   live only). Never throws — returns [] on any error. */
async function fetchComments(post, opts = {}) {
  const limit = Math.max(1, Math.min(50, opts.limit || 12));
  let path;
  try {
    if (typeof post === "string") {
      path = post.startsWith("http") ? new URL(post).pathname : post;
    } else if (post && post.permalink) {
      path = post.permalink.startsWith("http") ? new URL(post.permalink).pathname : post.permalink;
    } else if (post && post.id && post.subreddit) {
      path = "/r/" + post.subreddit + "/comments/" + post.id;
    } else {
      return [];
    }
  } catch {
    return [];
  }
  path = path.replace(/\/+$/, "");

  try {
    const res = await redditGet(path + "?limit=" + limit + "&depth=1&sort=top&raw_json=1");
    if (!res.ok) return [];
    const json = await res.json();
    // The comments endpoint returns [postListing, commentListing].
    const commentListing = Array.isArray(json) ? json[1] : null;
    const children = (commentListing && commentListing.data && commentListing.data.children) || [];
    const out = [];
    for (const c of children) {
      if (!c || c.kind !== "t1") continue;
      const d = c.data || {};
      const body = (d.body || "").trim();
      if (!body || body === "[removed]" || body === "[deleted]") continue;
      if (d.author === "AutoModerator" || d.author === "[deleted]") continue;
      out.push({ author: d.author, body, score: d.score || 0 });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, limit);
  } catch {
    return [];
  }
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

module.exports = { fetchListing, search, fetchAll, fetchComments, filterLive, hasOAuth, isRemoved };
