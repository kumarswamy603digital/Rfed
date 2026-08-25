# FOUNDER/RADAR

**Every startup opportunity buried in Reddit, on one page.**

Founder Radar scans the busiest founder communities on Reddit, filters out the
chatter, and surfaces only the signals worth your time — co-founder searches,
validated ideas, early roles, and hard-won insights — each scored with a
relevance **MATCH %**.

It's a **zero-dependency static site** (plain HTML + CSS + vanilla JS). There is
no build step and nothing to install. All Reddit data is fetched **live in your
browser** from the [PullPush.io](https://pullpush.io/) API.

---

## The pain it solves

Reddit is full of high-signal opportunities — a technical founder looking for a
business co-founder, a bootstrapped SaaS at $8k MRR that needs a CTO, a repeated
customer pain nobody has built for yet, a seed-stage startup hiring its first
engineer. But they're buried under thousands of low-signal posts across a dozen
subreddits. Founder Radar reads the noise so you don't have to.

## How it works

1. **Scan** — On load (and every 15 minutes), the app queries PullPush for recent
   submissions across five communities:
   `r/cofounder`, `r/startups`, `r/Entrepreneur`, `r/SaaS`, `r/SideProject`.
2. **Classify** — Each post is bucketed into **CO-FOUNDER / IDEA / HIRING /
   INSIGHT** using a keyword-and-context model, and obvious noise
   (`how do I…`, `roast my landing page`, …) is discarded.
3. **Score** — A deterministic **MATCH %** (0–99) blends category confidence,
   traction/stage evidence (MRR, revenue, waitlist, raised…), community
   engagement (log-scaled upvotes + comments), and freshness.
4. **Surface** — Signals render as a scannable feed you can filter, search, sort,
   and save.

When the live scan is unavailable (offline, rate-limited, or blocked), the app
falls back to a curated sample set so the page is never empty.

## Features

- Landing page with a live **LIVE SCAN** status card (posts scanned, signals
  surfaced, noise filtered, refresh cadence).
- Filter by category, full-text **search** across titles/descriptions/tags, and
  **sort** by Match / Newest / Top.
- **Save** signals to a watchlist (persisted in `localStorage`); the nav
  `SAVED • n` pill doubles as a saved-only filter.
- **Source coverage** sidebar and a **daily digest** email signup.
- Fully responsive, dark editorial design.

## Run it

Because the app fetches from an external API, serve it over HTTP rather than
opening the file directly (this avoids `file://` origin quirks):

```bash
# from the project root
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static host works too — GitHub Pages, Netlify, Vercel, Cloudflare Pages.
Just publish the repository root.

## Project structure

```
index.html        # markup: nav, hero, feed, sidebar, footer
styles.css        # design tokens + all component styling
js/
  data.js         # config (subreddits, cadence) + seed/fallback signals
  classify.js     # categorization, MATCH scoring, tag derivation, helpers
  pullpush.js     # PullPush.io client (fetch + scan-all across subreddits)
  app.js          # state, rendering, and all event wiring
```

## Configuration

Edit `js/data.js` → `FR.config` to change the scanned subreddits, how many posts
are pulled per scan, or the refresh cadence. Category keyword banks and the
scoring weights live in `js/classify.js`.

---

*Signal from the noise. Not affiliated with Reddit Inc. Data via PullPush.io.*
