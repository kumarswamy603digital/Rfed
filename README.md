# FOUNDER/RADAR

**Every startup opportunity buried in Reddit, on one page.**

Founder Radar scans the busiest founder communities on Reddit, filters out the
chatter, and surfaces only the signals worth your time — co-founder searches,
validated ideas, early roles, and hard-won insights — each scored with a
relevance **MATCH %**. An optional **AI layer reads the comments** for real pain
points, turns them into startup opportunities in plain English, and can **email
you the report via Resend**.

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

1. **Scan (wide net)** — read live posts from **10 founder/indie communities**
   (`r/cofounder`, `r/startups`, `r/Entrepreneur`, `r/SaaS`, `r/SideProject`,
   `r/indiehackers`, `r/EntrepreneurRideAlong`, `r/growmybusiness`,
   `r/smallbusiness`, `r/microsaas`), pulling **both `new` and `top`/week**
   listings per subreddit for maximum coverage.
2. **Filter** — drop removed/deleted, stickied, and NSFW posts up front, so every
   surfaced opportunity is legitimate and openable.
3. **Classify** — bucket each post into **CO-FOUNDER / IDEA / HIRING / INSIGHT**.
   Posts with **no keyword evidence** are treated as noise and dropped.
4. **Score** — a deterministic **MATCH %** (0–99) blends category confidence,
   traction/stage evidence (MRR, revenue, waitlist, raised…), engagement, and
   freshness. Only signals above a relevance floor are surfaced.
5. **De-dupe** — by post id *and* normalized title, keeping the strongest copy.
6. **Surface** — signals render as a scannable feed you can filter, search, sort,
   and save.

## AI pain-point analysis + emailed report

Founder Radar can go a step further and **read the comments** — where people
describe their real frustrations — to generate concrete startup ideas.

- **Per-signal `ANALYZE`** — each feed card has an AI button. It fetches the
  post's top comments, extracts the **pain points**, and generates a startup
  **opportunity in plain English** (problem, who has it, what to build, why now),
  shown inline. (`POST /api/analyze`)
- **Emailed report** — the digest signup runs the same pipeline across the top
  signals and **emails you the opportunities via [Resend](https://resend.com/)**,
  written in simple English. (`POST /api/digest`)

The AI layer is model-agnostic (any **OpenAI-compatible** Chat Completions API)
and everything degrades gracefully: without keys, the app still scans, classifies,
and shows the feed — it just skips the AI/email steps and tells you which key to add.

## Features

- Landing page with a live **LIVE SCAN** status card.
- Filter by category, full-text **search**, and **sort** by Match / Newest / Top.
- **AI `ANALYZE`** on every card — pain points + a generated opportunity.
- **AI opportunity report emailed via Resend** from the digest signup.
- **Save** signals to a watchlist (`localStorage`); the nav `SAVED • n` pill
  doubles as a saved-only filter.
- **Source coverage** sidebar; fully responsive dark editorial design.

## Project structure

```
index.html          # markup: nav, hero, feed, sidebar, footer
styles.css          # design tokens + all component styling
vercel.json         # clean URLs + static cache headers
package.json        # Node engine + `vercel dev` scripts (no dependencies)

api/
  signals.js        # GET  — scan + classify + score, edge-cached 15 min
  analyze.js        # POST — AI pain-point analysis (single post or top-N report)
  digest.js         # POST — subscribe + generate AI report + email via Resend

lib/
  reddit.js         # LIVE Reddit source (listings, search, comments)
  engine.js         # scan/classify/score engine + PullPush fallback
  ai.js             # OpenAI-compatible client: pain points -> opportunities
  email.js          # Resend client: formats + sends the report (HTML + text)
  report.js         # pipeline: scan -> comments -> AI opportunities

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

### Environment variables
| Variable | Enables | Notes |
|---|---|---|
| `OPENAI_API_KEY` | **AI analysis + reports** | Any OpenAI-compatible key. Required for `ANALYZE` and emailed reports. |
| `OPENAI_MODEL` | — | Model to use (default `gpt-4o-mini`). |
| `OPENAI_BASE_URL` | — | Override the API base for OpenAI-compatible providers (OpenRouter, Together, Azure, local gateways). Default `https://api.openai.com/v1`. |
| `RESEND_API_KEY` | **Emailing the report** | Get one at <https://resend.com>. Without it, reports are still generated and shown in the UI, just not emailed. |
| `DIGEST_FROM` | — | Sender address, e.g. `Founder Radar <radar@yourdomain.com>` (must be a Resend-verified domain). Defaults to Resend's `onboarding@resend.dev`. |
| `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` | **Reliable live Reddit** | Official app-only OAuth. Recommended for production — cloud IPs are sometimes blocked on the public endpoints. Create an app at <https://www.reddit.com/prefs/apps>. |
| `REDDIT_USER_AGENT` | — | Custom User-Agent for Reddit (Reddit asks for a unique UA). |
| `DIGEST_WEBHOOK_URL` | — | If set, digest signups are also POSTed here as JSON (Zapier / Make / your DB). |

Set these under **Project → Settings → Environment Variables**, then redeploy.
Everything is **optional** and degrades gracefully — with no keys the app still
scans Reddit, classifies, and shows the feed; it just skips the AI/email steps.
For the full experience set `OPENAI_API_KEY` + `RESEND_API_KEY` (and ideally the
two `REDDIT_*` OAuth vars).

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
