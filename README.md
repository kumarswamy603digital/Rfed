# FOUNDER/RADAR

**Every startup opportunity buried in Reddit, on one page.**

Founder Radar scans the busiest founder communities on Reddit, filters out the
chatter, and surfaces only the signals worth your time — co-founder searches,
validated ideas, early roles, and hard-won insights — each scored with a
relevance **MATCH %**.

It's a **full-stack app built for Vercel**: a static frontend (plain HTML + CSS +
vanilla JS, no build step) plus **serverless API functions** that do the Reddit
scanning and classification on the backend using [PullPush.io](https://pullpush.io/).

---

## Architecture

```
Browser ──GET /api/signals──▶  Vercel Function ──▶  PullPush.io (Reddit archive)
   ▲                                │
   │                          classify + score
   └──────── JSON signals ◀─────────┘   (edge-cached 15 min)

Browser ──POST /api/digest──▶  Vercel Function  (email signup → optional webhook)
```

**Why the backend?** Scanning server-side avoids browser CORS/rate-limit issues,
lets Vercel's edge cache the scan (one PullPush hit serves many visitors for 15
minutes), and keeps the classification logic in one place.

**Graceful degradation** — the frontend tries, in order:
1. **`GET /api/signals`** — your Vercel backend (preferred).
2. **Direct PullPush.io fetch** from the browser — so it still works as a *pure
   static* deploy (e.g. GitHub Pages) with no backend.
3. **Curated seed data** — so the page is never empty (offline / everything down).

## How the engine works

1. **Scan** — query PullPush for recent submissions across
   `r/cofounder`, `r/startups`, `r/Entrepreneur`, `r/SaaS`, `r/SideProject`.
2. **Classify** — bucket each post into **CO-FOUNDER / IDEA / HIRING / INSIGHT**
   with a keyword-and-context model; discard obvious noise
   (`how do I…`, `roast my landing page`, …).
3. **Score** — a deterministic **MATCH %** (0–99) blends category confidence,
   traction/stage evidence (MRR, revenue, waitlist, raised…), log-scaled
   engagement (upvotes + comments), and freshness.
4. **Surface** — signals render as a scannable feed you can filter, search, sort,
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
  engine.js         # shared server-side scan/classify/score engine (Node)

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

### Environment variables (optional)
| Variable | Purpose |
|---|---|
| `DIGEST_WEBHOOK_URL` | If set, digest signups are POSTed here as JSON (`{ email, source, at, ua }`). Point it at Zapier, Make, your ESP, or a DB webhook. If unset, signups are validated and logged. |

Set it under **Project → Settings → Environment Variables**, then redeploy.

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
(frontend fallback) to change the scanned subreddits, posts pulled per scan, or
the refresh cadence. Category keyword banks and scoring weights live in
`lib/engine.js` (and mirrored in `js/classify.js` for the direct-fetch path).

---

*Signal from the noise. Not affiliated with Reddit Inc. Data via PullPush.io.*
