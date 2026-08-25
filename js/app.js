/* ===================================================================
   app.js — state, rendering, and event wiring for Founder Radar.
   =================================================================== */
(function () {
  window.FR = window.FR || {};
  const { categories } = FR;
  const { timeAgo } = FR.classify;

  const LS_SAVED = "fr:saved";
  const LS_EMAIL = "fr:digest-email";

  const state = {
    signals: FR.SEED.slice(),
    filter: "all",
    query: "",
    sort: "match",
    saved: loadSaved(),
    savedOnly: false,
    live: false,
    analyses: {}, // id -> { loading | ok | message | opportunity | commentsAnalyzed }
  };

  /* ---------- DOM refs ---------- */
  const el = {
    cards: document.getElementById("cards"),
    empty: document.getElementById("emptyState"),
    filters: document.getElementById("filters"),
    search: document.getElementById("search"),
    sort: document.getElementById("sort"),
    sourceList: document.getElementById("sourceList"),
    savedPill: document.getElementById("savedPill"),
    savedCount: document.getElementById("savedCount"),
    feedStatus: document.getElementById("feedStatus"),
    aiReport: document.getElementById("aiReport"),
    digestForm: document.getElementById("digestForm"),
    digestEmail: document.getElementById("digestEmail"),
    digestOk: document.getElementById("digestOk"),
    // hero stats
    statScanned: document.getElementById("statScanned"),
    statSignals: document.getElementById("statSignals"),
    statNoise: document.getElementById("statNoise"),
    sourcesConnected: document.getElementById("sourcesConnected"),
  };

  /* ---------- helpers ---------- */
  function loadSaved() {
    try { return new Set(JSON.parse(localStorage.getItem(LS_SAVED) || "[]")); }
    catch { return new Set(); }
  }
  function persistSaved() {
    try { localStorage.setItem(LS_SAVED, JSON.stringify([...state.saved])); } catch {}
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }
  function fmt(n) { return (n || 0).toLocaleString("en-US"); }

  /* ---------- rendering ---------- */
  function visibleSignals() {
    let list = state.signals.slice();

    if (state.savedOnly) list = list.filter((s) => state.saved.has(s.id));
    if (state.filter !== "all") list = list.filter((s) => s.category === state.filter);

    if (state.query) {
      const q = state.query.toLowerCase();
      list = list.filter((s) =>
        s.title.toLowerCase().includes(q) ||
        s.desc.toLowerCase().includes(q) ||
        s.subreddit.toLowerCase().includes(q) ||
        s.tags.some((t) => t.toLowerCase().includes(q))
      );
    }

    if (state.sort === "match") list.sort((a, b) => b.match - a.match);
    else if (state.sort === "new") list.sort((a, b) => b.createdUtc - a.createdUtc);
    else if (state.sort === "top") list.sort((a, b) => (b.score + b.comments) - (a.score + a.comments));

    return list;
  }

  function cardHTML(s) {
    const cat = categories[s.category] || categories.insight;
    const isSaved = state.saved.has(s.id);
    const tags = s.tags.map((t) => `<span class="tag">#${esc(t)}</span>`).join("");
    return `
      <article class="card" style="--cat-color:${cat.color}" data-id="${esc(s.id)}">
        <div class="card-top">
          <span class="cat-tag">${esc(cat.label)}</span>
          <span class="card-sub">r/${esc(s.subreddit)}</span>
          <span class="card-age">${esc(timeAgo(s.createdUtc))}</span>
          <span class="match">
            <span class="match-dot"></span>
            <span class="match-score">${s.match}</span> MATCH
          </span>
        </div>
        <h2 class="card-title">${esc(s.title)}</h2>
        <p class="card-desc">${esc(s.desc)}</p>
        <div class="tags">${tags}</div>
        <div class="card-foot">
          <span class="metric">&#9650; ${fmt(s.score)}</span>
          <span class="metric">&#9671; ${fmt(s.comments)}</span>
          <span class="card-author">u/${esc(s.author)}</span>
          <span class="foot-actions">
            <button class="btn-analyze" data-action="analyze" data-id="${esc(s.id)}">
              <span class="ai-spark">&#10022;</span> ANALYZE
            </button>
            <button class="btn-save ${isSaved ? "saved" : ""}" data-action="save" data-id="${esc(s.id)}">
              ${isSaved ? "SAVED" : "SAVE"}
            </button>
            <a class="btn-open" href="${esc(s.permalink)}" target="_blank" rel="noopener noreferrer">
              OPEN <span>&#8599;</span>
            </a>
          </span>
        </div>
        ${analysisPanelHTML(s.id)}
      </article>`;
  }

  /* Inline AI pain-point / opportunity panel for a card. */
  function analysisPanelHTML(id) {
    const a = state.analyses[id];
    if (!a) return "";
    if (a.loading) {
      return `<div class="ai-panel"><div class="ai-loading"><span class="ai-spark spin">&#10022;</span> Reading the comments for pain points&hellip;</div></div>`;
    }
    if (!a.ok) {
      return `<div class="ai-panel"><div class="ai-note">${esc(a.message || "AI analysis unavailable.")}</div></div>`;
    }
    const o = a.opportunity;
    if (!o) return `<div class="ai-panel"><div class="ai-note">No clear opportunity found in this thread.</div></div>`;
    return `<div class="ai-panel">${opportunityHTML(o, a.commentsAnalyzed)}</div>`;
  }

  /* Shared renderer for an AI opportunity object. */
  function opportunityHTML(o, commentsAnalyzed) {
    const opp = o.opportunity || {};
    const pains = (o.painPoints || [])
      .map((p) => `<li>${esc(p)}</li>`) .join("");
    const field = (label, val) =>
      val ? `<p class="ai-field"><span class="ai-field-label">${esc(label)}</span> ${esc(val)}</p>` : "";
    const conf = o.confidence ? `<span class="ai-conf ai-conf-${esc(o.confidence)}">${esc(o.confidence)} confidence</span>` : "";
    return `
      <div class="ai-head">
        <span class="ai-badge"><span class="ai-spark">&#10022;</span> AI OPPORTUNITY</span>
        ${conf}
        ${commentsAnalyzed != null ? `<span class="ai-meta">${commentsAnalyzed} comments read</span>` : ""}
      </div>
      ${opp.headline ? `<h3 class="ai-headline">${esc(opp.headline)}</h3>` : ""}
      ${o.plainEnglish ? `<p class="ai-plain">${esc(o.plainEnglish)}</p>` : ""}
      ${pains ? `<p class="ai-sub">Pain points people mentioned</p><ul class="ai-pains">${pains}</ul>` : ""}
      ${field("Problem", opp.problem)}
      ${field("Who has it", opp.who)}
      ${field("What to build", opp.solution)}
      ${field("Why now", opp.whyNow)}`;
  }

  function render() {
    const list = visibleSignals();
    el.cards.innerHTML = list.map(cardHTML).join("");
    el.empty.hidden = list.length !== 0;
    if (state.savedOnly && list.length === 0) {
      el.empty.textContent = "No saved signals yet — hit SAVE on the ones worth tracking.";
    } else {
      el.empty.textContent = "No signals match your filters.";
    }
  }

  function renderCounts() {
    const counts = { all: state.signals.length, cofounder: 0, idea: 0, hiring: 0, insight: 0 };
    for (const s of state.signals) counts[s.category] = (counts[s.category] || 0) + 1;
    el.filters.querySelectorAll(".chip-count").forEach((node) => {
      const key = node.getAttribute("data-count");
      node.textContent = counts[key] != null ? counts[key] : 0;
    });
  }

  function renderSources() {
    // Count signals per subreddit, preserving configured order first.
    const counts = {};
    for (const s of state.signals) counts[s.subreddit] = (counts[s.subreddit] || 0) + 1;

    const ordered = [];
    for (const sub of FR.config.subreddits) ordered.push([sub, counts[sub] || 0]);
    for (const sub of Object.keys(counts)) {
      if (!FR.config.subreddits.includes(sub)) ordered.push([sub, counts[sub]]);
    }

    el.sourceList.innerHTML = ordered
      .map(([sub, n]) => `
        <li>
          <span class="src-name">r/${esc(sub)}</span>
          <span class="src-count">${n}</span>
        </li>`)
      .join("");

    if (el.sourcesConnected) el.sourcesConnected.textContent = FR.config.subreddits.length;
  }

  function renderStats(scanned) {
    const signals = state.signals.length;
    if (scanned != null && scanned > 0) {
      el.statScanned.textContent = fmt(scanned);
      const noisePct = Math.round(((scanned - signals) / scanned) * 100);
      el.statNoise.textContent = Math.max(0, Math.min(99, noisePct)) + "%";
    }
    el.statSignals.textContent = signals;
  }

  function renderSavedPill() {
    const n = state.saved.size;
    el.savedCount.textContent = n;
    el.savedPill.classList.toggle("has-saved", n > 0);
    el.savedPill.classList.toggle("active-filter", state.savedOnly);
  }

  function renderAll(scanned) {
    render();
    renderCounts();
    renderSources();
    renderStats(scanned);
    renderSavedPill();
  }

  /* ---------- events ---------- */
  function onFilterClick(e) {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    state.filter = chip.getAttribute("data-filter");
    state.savedOnly = false;
    el.filters.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    renderSavedPill();
    render();
  }

  function onCardClick(e) {
    const saveBtn = e.target.closest("[data-action='save']");
    if (saveBtn) {
      const id = saveBtn.getAttribute("data-id");
      if (state.saved.has(id)) state.saved.delete(id);
      else state.saved.add(id);
      persistSaved();
      renderSavedPill();
      render();
      return;
    }
    const analyzeBtn = e.target.closest("[data-action='analyze']");
    if (analyzeBtn) {
      analyzeSignal(analyzeBtn.getAttribute("data-id"));
    }
  }

  /* Ask the backend AI to analyze a single post's comments -> opportunity. */
  async function analyzeSignal(id) {
    const sig = state.signals.find((s) => s.id === id);
    if (!sig) return;

    // Toggle closed if already analyzed.
    if (state.analyses[id] && !state.analyses[id].loading) {
      delete state.analyses[id];
      render();
      return;
    }

    state.analyses[id] = { loading: true };
    render();

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: sig.id,
          title: sig.title,
          subreddit: sig.subreddit,
          permalink: sig.permalink,
          desc: sig.desc,
          category: sig.category,
          match: sig.match,
        }),
      });
      const data = await res.json();
      if (data && data.ok && data.opportunity) {
        state.analyses[id] = { ok: true, opportunity: data.opportunity, commentsAnalyzed: data.commentsAnalyzed };
      } else if (data && data.aiConfigured === false) {
        state.analyses[id] = { ok: false, message: data.hint || "AI is not configured on this deployment. Add OPENAI_API_KEY in Vercel." };
      } else {
        state.analyses[id] = { ok: false, message: "Couldn't analyze this thread right now. Try again shortly." };
      }
    } catch {
      state.analyses[id] = { ok: false, message: "Analysis needs the backend (deploy on Vercel with OPENAI_API_KEY set)." };
    }
    render();
  }

  function onSavedPillClick() {
    state.savedOnly = !state.savedOnly;
    if (state.savedOnly) {
      state.filter = "all";
      el.filters.querySelectorAll(".chip").forEach((c) =>
        c.classList.toggle("active", c.getAttribute("data-filter") === "all"));
    }
    renderSavedPill();
    render();
  }

  async function onDigestSubmit(e) {
    e.preventDefault();
    const email = (el.digestEmail.value || "").trim();
    if (!email) return;

    const joinBtn = el.digestForm.querySelector(".digest-join");
    if (joinBtn) { joinBtn.disabled = true; joinBtn.textContent = "WORKING\u2026"; }

    try { localStorage.setItem(LS_EMAIL, email); } catch {}

    let data = null;
    try {
      const res = await fetch("/api/digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, send: true }),
      });
      data = await res.json();
    } catch { /* offline / static deploy */ }

    el.digestForm.hidden = true;
    el.digestOk.hidden = false;

    if (data && data.ok) {
      el.digestOk.textContent = data.note || "You're on the list.";
      if (data.opportunities && data.opportunities.length) {
        renderAiReport(data.opportunities, data.emailed ? email : null);
      }
    } else {
      el.digestOk.textContent =
        "Saved your email. AI reports need the backend deployed on Vercel with OPENAI_API_KEY + RESEND_API_KEY.";
    }
  }

  /* Render the AI opportunity report at the top of the feed. */
  function renderAiReport(opportunities, emailedTo) {
    const items = opportunities.map((o, i) => `
      <article class="ai-card">
        <div class="ai-card-idx">#${i + 1}</div>
        <div class="ai-card-body">${opportunityHTML(o, null)}
          <p class="ai-source"><a href="${esc(o.url)}" target="_blank" rel="noopener noreferrer">r/${esc(o.subreddit)} source &#8599;</a></p>
        </div>
      </article>`).join("");

    el.aiReport.innerHTML = `
      <div class="ai-report-head">
        <h2 class="ai-report-title"><span class="ai-spark">&#10022;</span> Your AI opportunity report</h2>
        ${emailedTo ? `<span class="ai-report-sent">Emailed to ${esc(emailedTo)}</span>` : ""}
      </div>
      <div class="ai-report-grid">${items}</div>`;
    el.aiReport.hidden = false;
    el.aiReport.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function setStatus(html) {
    if (!html) { el.feedStatus.hidden = true; return; }
    el.feedStatus.hidden = false;
    el.feedStatus.innerHTML = html;
  }

  /* ---------- live scan ----------
     Strategy, most-preferred first:
       1. Our own backend  GET /api/signals  (full-stack / Vercel deploy)
       2. Direct browser  ->  PullPush.io      (pure-static deploy)
       3. Curated seed data                    (offline / everything down)  */
  async function fetchBackend() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch("/api/signals", {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (data && data.ok && Array.isArray(data.signals) && data.signals.length) {
        return { ...data, via: "backend" };
      }
      return { ok: false };
    } catch {
      return { ok: false };
    } finally {
      clearTimeout(timer);
    }
  }

  async function runScan() {
    setStatus(`<span class="live-dot">&#9679;</span> Scanning ${FR.config.subreddits.length} communities&hellip;`);

    let result = await fetchBackend();
    let via = "backend";

    if (!(result && result.ok)) {
      // Fall back to fetching PullPush directly from the browser.
      via = "client";
      try { result = await FR.pullpush.scanAll(); }
      catch { result = { ok: false }; }
    }

    if (result && result.ok && result.signals.length > 0) {
      state.signals = result.signals;
      state.live = true;
      renderAll(result.scanned);
      const label = via === "backend" ? "LIVE via API" : "LIVE (direct)";
      setStatus(`<span class="live-dot">&#9679;</span> ${label} &mdash; ${result.signals.length} signals from ${fmt(result.scanned)} posts scanned. Auto-refresh every 15 min.`);
    } else {
      // Keep seed data; make clear it's the demo set.
      state.live = false;
      renderAll();
      setStatus(`Showing curated sample signals &mdash; live scan unavailable right now (offline or rate-limited). Will retry automatically.`);
    }
  }

  /* ---------- init ---------- */
  function init() {
    // Prefill digest email if returning visitor.
    try {
      const saved = localStorage.getItem(LS_EMAIL);
      if (saved) el.digestEmail.value = saved;
    } catch {}

    el.filters.addEventListener("click", onFilterClick);
    el.cards.addEventListener("click", onCardClick);
    el.savedPill.addEventListener("click", onSavedPillClick);
    el.digestForm.addEventListener("submit", onDigestSubmit);
    el.search.addEventListener("input", (e) => { state.query = e.target.value; render(); });
    el.sort.addEventListener("change", (e) => { state.sort = e.target.value; render(); });

    renderAll();

    // Kick off the first live scan, then poll on the configured cadence.
    runScan();
    setInterval(runScan, FR.config.refreshMs);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
