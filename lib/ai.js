/* ===================================================================
   lib/ai.js — AI analysis layer (CommonJS, dependency-free).

   Talks to any OpenAI-compatible Chat Completions API via plain fetch
   (OpenAI, Azure OpenAI, OpenRouter, Together, local gateways, …).

   Given a Reddit post + its comments, it:
     • extracts the concrete PAIN POINTS people are discussing, and
     • generates a startup OPPORTUNITY written in simple English.

   Env:
     OPENAI_API_KEY   (required to enable AI)
     OPENAI_BASE_URL  (default https://api.openai.com/v1)
     OPENAI_MODEL     (default gpt-4o-mini)
   =================================================================== */

const TIMEOUT_MS = 45000;

function cfg() {
  return {
    key: process.env.OPENAI_API_KEY || process.env.AI_API_KEY || "",
    base: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
    model: process.env.OPENAI_MODEL || process.env.AI_MODEL || "gpt-4o-mini",
  };
}

function isConfigured() {
  return !!cfg().key;
}

function clip(s, n) {
  s = String(s || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/* Low-level chat call. Returns the assistant message string. */
async function chat(messages, opts = {}) {
  const c = cfg();
  if (!c.key) throw new Error("ai_not_configured");

  const body = {
    model: c.model,
    messages,
    temperature: opts.temperature != null ? opts.temperature : 0.5,
    max_tokens: opts.maxTokens || 2000,
  };
  if (opts.json) body.response_format = { type: "json_object" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || TIMEOUT_MS);
  try {
    const res = await fetch(c.base + "/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + c.key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error("ai HTTP " + res.status + " " + clip(t, 160));
    }
    const json = await res.json();
    const msg = json && json.choices && json.choices[0] && json.choices[0].message;
    return (msg && msg.content) || "";
  } finally {
    clearTimeout(timer);
  }
}

/* Compact one signal + its comments into the model's input shape. */
function toModelItem(sig, comments, index) {
  return {
    index,
    subreddit: sig.subreddit,
    title: clip(sig.title, 200),
    body: clip(sig.desc || sig.selftext, 800),
    top_comments: (comments || [])
      .slice(0, 8)
      .map((c) => clip(c.body, 300))
      .filter(Boolean),
  };
}

const SYSTEM_PROMPT =
  "You are a sharp startup analyst who reads Reddit threads and finds real, " +
  "buildable startup opportunities. You pay special attention to the COMMENTS, " +
  "because that is where people describe their real pain, frustrations, and what " +
  "they wish existed. Write for a beginner: use simple, plain English, short " +
  "sentences, and no jargon. Never invent facts that are not supported by the " +
  "post or comments. Respond with STRICT JSON only.";

function buildUserPrompt(items) {
  return (
    "Analyze the following Reddit threads. For EACH thread, do two things:\n" +
    "1) Extract the concrete PAIN POINTS people mention (especially in the comments).\n" +
    "2) Turn them into ONE clear startup OPPORTUNITY.\n\n" +
    "Return JSON exactly in this shape:\n" +
    "{\n" +
    '  "opportunities": [\n' +
    "    {\n" +
    '      "index": <the index number from the input>,\n' +
    '      "painPoints": ["short pain point", "..."],\n' +
    '      "opportunity": {\n' +
    '        "headline": "short name of the idea",\n' +
    '        "problem": "the problem in one plain sentence",\n' +
    '        "who": "who has this problem",\n' +
    '        "solution": "what to build, in simple words",\n' +
    '        "whyNow": "why this is a good moment / the evidence"\n' +
    "      },\n" +
    '      "plainEnglish": "2 to 4 simple sentences a beginner can understand",\n' +
    '      "confidence": "high | medium | low"\n' +
    "    }\n" +
    "  ]\n" +
    "}\n\n" +
    "Rules: keep every string short and in plain English. If a thread has no real " +
    "opportunity, still include it with confidence \"low\" and say so briefly.\n\n" +
    "INPUT THREADS:\n" +
    JSON.stringify(items)
  );
}

/* Tolerant JSON extraction (handles ```json fences / stray prose). */
function parseResponse(text) {
  if (!text) return { opportunities: [] };
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try {
    const obj = JSON.parse(s);
    if (Array.isArray(obj)) return { opportunities: obj };
    return { opportunities: Array.isArray(obj.opportunities) ? obj.opportunities : [] };
  } catch {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const obj = JSON.parse(s.slice(start, end + 1));
        return { opportunities: Array.isArray(obj.opportunities) ? obj.opportunities : [] };
      } catch { /* fall through */ }
    }
    return { opportunities: [] };
  }
}

/* Merge model output back onto the source signals by index. */
function mergeByIndex(signals, modelItems, aiOpps) {
  const byIndex = new Map();
  for (const o of aiOpps) if (o && o.index != null) byIndex.set(Number(o.index), o);

  return modelItems.map((mi) => {
    const sig = signals[mi.index];
    const ai = byIndex.get(mi.index) || {};
    return {
      sourceTitle: sig.title,
      subreddit: sig.subreddit,
      url: sig.permalink,
      category: sig.category,
      match: sig.match,
      painPoints: Array.isArray(ai.painPoints) ? ai.painPoints : [],
      opportunity: ai.opportunity || null,
      plainEnglish: ai.plainEnglish || "",
      confidence: ai.confidence || "low",
    };
  });
}

/* High-level: given signals (each optionally carrying `comments`),
   produce AI opportunities. Returns [] gracefully if not configured. */
async function generateOpportunities(signalsWithComments, opts = {}) {
  if (!isConfigured()) return { ok: false, error: "ai_not_configured", opportunities: [] };

  const signals = signalsWithComments.slice(0, opts.max || 8);
  const modelItems = signals.map((s, i) => toModelItem(s, s.comments, i));

  const content = await chat(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(modelItems) },
    ],
    { json: true, temperature: 0.5, maxTokens: opts.maxTokens || 2600 }
  );

  const parsed = parseResponse(content);
  const opportunities = mergeByIndex(signals, modelItems, parsed.opportunities);
  return { ok: true, opportunities };
}

module.exports = {
  isConfigured,
  chat,
  toModelItem,
  buildUserPrompt,
  parseResponse,
  mergeByIndex,
  generateOpportunities,
  SYSTEM_PROMPT,
};
