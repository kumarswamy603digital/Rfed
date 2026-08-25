# FOUNDER/RADAR

**Every startup opportunity buried in Reddit, on one page.**

Founder Radar scans the busiest founder communities on Reddit, filters out the
chatter, and surfaces only the signals worth your time — co-founder searches,
validated ideas, early roles, and hard-won insights — each scored with a
relevance **MATCH %**.

It's a **full-stack app built for Vercel**: a static frontend (plain HTML + CSS +
vanilla JS, no build step) plus **serverless API functions** that scan and classify
posts on the backend. Signals come from **live Reddit listings** (so every result
is a real, openable post), with [PullPush.io](https://pullpush.io/) as a fallback.

---

## Architecture

```
Browser --GET /api/signals--> Vercel Function --> LIVE Reddit listings
   ^                              |             (fallback: PullPush archive,
   |                        classify + score       liveness-verified)
   +------- JSON signals <--------+   (edge-cached 15 min)

Browser --POST /api/digest--> Vercel Function  (email signup -> optional webhook)
```

**Why live Reddit (not the PullPush archive) is primary.** PullPush stores a post
as it looked *when created*. Many founder subs — r/cofounder especially —
auto-remove posts after the fact, so an archived post can look fine but be
**removed by moderators** on live Reddit (clicking it shows a removal notice).
Reading Reddit's *live listings* means every surfaced signal is a real, openable
post. PullPush is kept only as a fallback, and those results are
**liveness-verified** against Reddit before being shown.

**Why the backend?** Scanning server-side avoids browser CORS/rate-limit issues,
lets Vercel's edge cache the scan (one upstream hit serves many visitors for 15
minutes), and keeps the classification logic in one place.

**Graceful degradation** — the frontend tries, in order:
1. **`GET /api/signals`** — your Vercel backend (preferred; live Reddit).
2. **Direct PullPush.io fetch** from the browser — so it still works as a *pure
   static* deploy (e.g. GitHub Pages) with no backend.
3. **Curated seed data** — so the page is never empty (offline / everything down).

## How the engine works

1. **Scan** — read the newest posts (live) from
   `r/cofounder`, `r/startups`, `r/Entrepreneur`, `r/SaaS`, `r/SideProject`.
2. **Filter** — drop removed/deleted, stickied, and NSFW posts up front.
3. **Classify** — bucket each post into **CO-FOUNDER / IDEA / HIRING / INSIGHT**
   with a keyword-and-context model. Posts with **no keyword evidence** are
   treated as noise and dropped (no more generic threads leaking through).
4. **Score** — a deterministic **MATCH %** (0–99) blends category confidence,
   traction/stage evidence (MRR, revenue, waitlist, raised…), log-scaled
   engagement (upvotes + comments), and freshness. Only signals above a
   relevance floor are surfaced.
5. **De-dupe** — by post id *and* by normalized title, keeping the strongest copy
   (no more repeated opportunities).
6. **Surface** — signals render as a scannable feed you can filter, search, sort,
   and save.

## Features

- Landing page with a live **LIVE SCAN** status card.
- Filter by category, full-text **search**, and **sort** by Match / Newest / Top.
- **Save** signals to a watchlist (`localStorage`); the nav `SAVED • n` pill
  doubles as a saved-only filter.
- **Source coverage** sidebar and a working **daily digest** signup
  (`POST /api/digest`).
- Fully responsive dark editorial design.

## Project structure

```
index.html          # markup: nav, hero, feed, sidebar, footer
styles.css          # design tokens + all component styling
vercel.json         # clean URLs + static cache headers
package.json        # Node engine + `vercel dev` scripts (no dependencies)

api/
  signals.js        # GET  — scan + classify + score, edge-cached 15 min
  digest.js         # POST — email signup (optional DIGEST_WEBHOOK_URL forward)

lib/
  reddit.js         # LIVE Reddit source (OAuth app-only or public JSON)
  engine.js         # shared scan/classify/score engine + PullPush fallback

js/
  data.js           # config + seed/fallback signals
  classify.js       # browser-side classify (used by the direct-fetch fallback)
  pullpush.js       # browser-side PullPush client (direct-fetch fallback)
  app.js            # state, rendering, event wiring, API calls
```

---

## Deploy to Vercel

### Option A — Vercel dashboard (no CLI)
1. Push this repo to GitHub (already done).
2. Go to **vercel.com → Add New… → Project**, import the repo.
3. Framework preset: **Other**. Leave build/output settings empty.
4. Click **Deploy**. That's it — Vercel serves the static files from the repo
   root and turns everything in `/api` into serverless functions automatically.

### Option B — Vercel CLI
```bash
npm i -g vercel      # once
vercel               # preview deploy (follow the prompts)
vercel --prod        # production deploy
```

### Environment variables (all optional)
| Variable | Purpose |
|---|---|
| `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` | Use Reddit's **official app-only OAuth API** instead of the public JSON endpoints. Recommended for production: cloud IPs (like Vercel's) are sometimes rate-limited or blocked on the public endpoints, and OAuth is far more reliable. Create a "script"/"web app" at <https://www.reddit.com/prefs/apps>. |
| `REDDIT_USER_AGENT` | Custom User-Agent string sent to Reddit (defaults to a descriptive one). Reddit asks for a unique UA. |
| `DIGEST_WEBHOOK_URL` | If set, digest signups are POSTed here as JSON (`{ email, source, at, ua }`). Point it at Zapier, Make, your ESP, or a DB webhook. If unset, signups are validated and logged. |

Set these under **Project → Settings → Environment Variables**, then redeploy.
Without any of them the app still works — it uses Reddit's public JSON endpoints
and falls back to PullPush.

## Run locally

Full-stack (functions + static), mirrors production:
```bash
npm i -g vercel
vercel dev            # serves http://localhost:3000 with /api working
```

Static-only preview (frontend falls back to direct PullPush / seed data):
```bash
python3 -m http.server 8000     # open http://localhost:8000
```

## Configuration

Edit `lib/engine.js` → `config` (backend) and `js/data.js` → `FR.config`
(frontend fallback) to change the scanned subreddits, posts pulled per scan, the
refresh cadence, or the `minMatch` relevance floor. Category keyword banks and
scoring weights live in `lib/engine.js` (mirrored in `js/classify.js` for the
direct-fetch path).

---

*Signal from the noise. Not affiliated with Reddit Inc. Live data from Reddit; PullPush.io as fallback.*
