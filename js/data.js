/* ===================================================================
   data.js — configuration + seed/fallback signals
   Exposes: window.FR.config, window.FR.SEED
   =================================================================== */
(function () {
  window.FR = window.FR || {};

  /* The founder communities we scan, in coverage order. */
  FR.config = {
    subreddits: ["cofounder", "startups", "Entrepreneur", "SaaS", "SideProject"],
    // How many raw posts to pull per subreddit per scan.
    pullSize: 40,
    // How often the client re-scans (ms). 15 min.
    refreshMs: 15 * 60 * 1000,
    pullpushBase: "https://api.pullpush.io/reddit/search/submission/",
  };

  /* Human labels + colors per category (kept in sync with CSS accents). */
  FR.categories = {
    cofounder: { label: "CO-FOUNDER", plural: "CO-FOUNDERS", color: "#f9552b" },
    idea:      { label: "IDEA",       plural: "IDEAS",       color: "#86bf5b" },
    hiring:    { label: "HIRING",     plural: "HIRING",      color: "#f9552b" },
    insight:   { label: "INSIGHT",    plural: "INSIGHTS",    color: "#7ba6d0" },
  };

  /* Seed signals — shown instantly on load and as a fallback when the
     live PullPush scan is unavailable (offline / rate-limited / CORS).
     These mirror the reference design one-to-one. */
  FR.SEED = [
    {
      id: "seed-1",
      category: "cofounder",
      subreddit: "cofounder",
      createdUtc: nowMinus({ h: 2 }),
      match: 96,
      title: "Technical founder (ex-Stripe) looking for a non-technical co-founder in fintech",
      desc: "I've been building payment infra for 6 years and have a working prototype for SMB invoicing. Need someone who lives and breathes sales and ops. Equal equity, based anywhere.",
      tags: ["fintech", "b2b", "technical-business"],
      score: 412,
      comments: 87,
      author: "ledger_dev",
      permalink: "https://reddit.com/r/cofounder",
    },
    {
      id: "seed-2",
      category: "cofounder",
      subreddit: "cofounder",
      createdUtc: nowMinus({ h: 8 }),
      match: 94,
      title: "Non-technical founder w/ $8k MRR seeking CTO co-founder for AI legal tool",
      desc: "Bootstrapped to 30 paying law firms doing contract review. Drowning in manual work. I handle sales + domain. Need a builder to own the product. Revenue share from day one.",
      tags: ["legaltech", "ai", "has-revenue"],
      score: 289,
      comments: 61,
      author: "counsel_ops",
      permalink: "https://reddit.com/r/cofounder",
    },
    {
      id: "seed-3",
      category: "idea",
      subreddit: "startups",
      createdUtc: nowMinus({ h: 5 }),
      match: 91,
      title: "Everyone in r/smallbusiness keeps asking for the same scheduling tool — nobody built it",
      desc: "Scanned 40+ threads this month. Home-service owners want SMS-first booking that syncs with Google Calendar and takes deposits. Existing tools are too heavy. Clear wedge.",
      tags: ["saas", "scheduling", "underserved"],
      score: 738,
      comments: 143,
      author: "signal_hunter",
      permalink: "https://reddit.com/r/startups",
    },
    {
      id: "seed-4",
      category: "cofounder",
      subreddit: "cofounder",
      createdUtc: nowMinus({ d: 1 }),
      match: 90,
      title: "Designer + PM looking for engineer to build consumer health app (prototype ready)",
      desc: "We have Figma flows, a landing page with 900 waitlist signups, and interviews with 50 users. Need one strong mobile engineer to make it real. Split equity 3 ways.",
      tags: ["consumer", "mobile", "waitlist"],
      score: 203,
      comments: 52,
      author: "health_by_design",
      permalink: "https://reddit.com/r/cofounder",
    },
    {
      id: "seed-5",
      category: "idea",
      subreddit: "Entrepreneur",
      createdUtc: nowMinus({ d: 1 }),
      match: 88,
      title: "Freelancers keep begging for a 'proposal → contract → invoice' tool that isn't 5 apps",
      desc: "Saw this pain repeated across r/freelance and r/Entrepreneur. People stitch together Notion, DocuSign, and Stripe manually. One integrated flow could win the solo market.",
      tags: ["freelance", "workflow", "consolidation"],
      score: 634,
      comments: 121,
      author: "solo_stacker",
      permalink: "https://reddit.com/r/Entrepreneur",
    },
    {
      id: "seed-6",
      category: "insight",
      subreddit: "SideProject",
      createdUtc: nowMinus({ h: 11 }),
      match: 82,
      title: "Indie hackers are quietly making $2-5k/mo on niche Chrome extensions",
      desc: "A recurring pattern in r/SideProject: single-purpose extensions solving one annoying workflow. Low competition, high willingness to pay. Distribution is the real moat.",
      tags: ["distribution", "microsaas", "trend"],
      score: 521,
      comments: 98,
      author: "buildinpublic",
      permalink: "https://reddit.com/r/SideProject",
    },
    {
      id: "seed-7",
      category: "insight",
      subreddit: "SaaS",
      createdUtc: nowMinus({ h: 14 }),
      match: 80,
      title: "Thin AI wrappers churn — tools embedded in a real workflow retain",
      desc: "Founders in r/SaaS report churn on thin wrappers but retention on tools embedded in a real workflow. Depth > novelty. Pick a boring industry and go deep.",
      tags: ["ai", "vertical", "retention"],
      score: 447,
      comments: 76,
      author: "retention_nerd",
      permalink: "https://reddit.com/r/SaaS",
    },
    {
      id: "seed-8",
      category: "hiring",
      subreddit: "startups",
      createdUtc: nowMinus({ d: 1 }),
      match: 78,
      title: "Seed-stage climate startup hiring founding engineer (equity-heavy)",
      desc: "We're 3 people, $1.2M raised, building carbon accounting for manufacturers. Looking for a founding full-stack eng who wants real ownership. Remote-first, EU/US timezones.",
      tags: ["climate", "founding-eng", "seed"],
      score: 176,
      comments: 44,
      author: "carbon_founder",
      permalink: "https://reddit.com/r/startups",
    },
  ];

  function nowMinus({ h = 0, d = 0 }) {
    return Math.floor(Date.now() / 1000) - h * 3600 - d * 86400;
  }
})();
