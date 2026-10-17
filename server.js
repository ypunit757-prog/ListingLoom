import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");

// Any OpenAI-compatible endpoint works: Ollama (http://host:11434/v1),
// vLLM, llama.cpp server, or a hosted provider serving open-weight models.
const LLM_BASE_URL = (process.env.LLM_BASE_URL || "").replace(/\/+$/, "");
const LLM_MODEL = process.env.LLM_MODEL || "gemma3";
const LLM_API_KEY = process.env.LLM_API_KEY || "";
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 90000);

// Estimated marketplace fees. Update these when the marketplaces change theirs.
const FEES = {
  Etsy: { pct: 0.095, fixed: 0.45 },
  eBay: { pct: 0.1325, fixed: 0.3 },
};

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

// ---- tiny in-memory rate limiter -------------------------------------------
const hits = new Map();
function limit(max, windowMs) {
  return (req, res, next) => {
    const now = Date.now();
    const rec = hits.get(req.ip + req.path);
    if (!rec || rec.reset < now) {
      hits.set(req.ip + req.path, { count: 1, reset: now + windowMs });
      return next();
    }
    if (++rec.count > max) {
      return res.status(429).json({ error: "Too many requests. Try again in a few minutes." });
    }
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
}, 60000).unref();

// ---- helpers ---------------------------------------------------------------
const clean = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const cap = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const VOICES = ["Warm", "Polished", "Playful", "Straightforward"];

function readInput(body) {
  const marketplace = body.marketplace === "eBay" ? "eBay" : "Etsy";
  const voice = VOICES.includes(body.voice) ? body.voice : "Warm";
  const cost = Math.max(0, Math.min(100000, Number(body.cost) || 0));
  return {
    product: clean(body.product, 80),
    materials: clean(body.materials, 160),
    style: clean(body.style, 80),
    details: clean(body.details, 400),
    marketplace,
    voice,
    cost,
  };
}

function priceRange(cost, marketplace) {
  if (!cost) return null;
  const f = FEES[marketplace];
  const at = (margin) => Math.ceil((cost + f.fixed) / (1 - f.pct - margin)) - 0.01;
  return { low: at(0.3), high: at(0.45), feePct: f.pct * 100, feeFixed: f.fixed };
}

// ---- model call ------------------------------------------------------------
function buildMessages(i) {
  const isEtsy = i.marketplace === "Etsy";
  const system = [
    "You write marketplace listings for small sellers.",
    'Reply with a single JSON object and nothing else: {"title": string, "description": string, "tags": string[]}.',
    isEtsy
      ? "Title: at most 140 characters, front-load the words a buyer would search. Tags: exactly 13, each at most 20 characters."
      : "Title: at most 80 characters, no filler or promotional symbols. Tags: up to 8 short item-specific keywords.",
    "Description: 110 to 170 words, plain text, short paragraphs, then a short list where each line starts with '- '.",
    "Only use facts the seller gave you. Do not invent sizes, certifications, shipping times or health claims.",
  ].join("\n");
  const user = [
    `Marketplace: ${i.marketplace}`,
    `Product: ${i.product}`,
    i.materials && `Materials: ${i.materials}`,
    i.style && `Style or scent: ${i.style}`,
    i.details && `Other details: ${i.details}`,
    `Voice: ${i.voice}`,
  ].filter(Boolean).join("\n");
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

function parseModelJson(text, i) {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("no JSON in model reply");
  const obj = JSON.parse(text.slice(a, b + 1));
  const title = clean(obj.title, i.marketplace === "Etsy" ? 140 : 80);
  const description = String(obj.description || "").replace(/\r/g, "").trim().slice(0, 2500);
  const tags = (Array.isArray(obj.tags) ? obj.tags : [])
    .map((t) => clean(t, 20).replace(/^#/, "")).filter(Boolean)
    .slice(0, i.marketplace === "Etsy" ? 13 : 8);
  if (!title || !description) throw new Error("incomplete listing");
  return { title, description, tags };
}

async function callModel(i) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS);
  try {
    const r = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        ...(LLM_API_KEY && { Authorization: `Bearer ${LLM_API_KEY}` }),
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: buildMessages(i),
        temperature: 0.7,
        max_tokens: 800,
        stream: false,
      }),
    });
    if (!r.ok) throw new Error(`model server returned ${r.status}`);
    const data = await r.json();
    return parseModelJson(data.choices?.[0]?.message?.content || "", i);
  } finally {
    clearTimeout(timer);
  }
}

// ---- template fallback (used when no model is configured or it fails) -------
function templateListing(i) {
  const first = (i.materials.split(",")[0] || "").trim();
  const head = i.style ? `${cap(i.style)} ${cap(i.product)}` : cap(i.product);
  const title = i.marketplace === "Etsy"
    ? `${head} | ${cap(first || "Handmade")} | Handmade Gift`.slice(0, 140)
    : `${head} - ${cap(first || "Quality")} - Fast Shipping`.slice(0, 80);
  const openers = {
    Warm: `Meet your new favourite ${i.product.toLowerCase()}, made slowly and with care.`,
    Polished: `A refined ${i.product.toLowerCase()}, made with attention to every detail.`,
    Playful: `Say hello to the ${i.product.toLowerCase()} people keep asking about.`,
    Straightforward: `${cap(i.product)}. Good materials, clear details, careful packing.`,
  };
  const closers = {
    Warm: "Each one is made in a small batch and packed by hand, so it is ready to give or to keep.",
    Polished: "Made in limited quantities and packed to be gifted.",
    Playful: "Small batch, big personality. You may want to order a second one for a friend.",
    Straightforward: "Message me with any questions before you buy.",
  };
  const bullets = [
    i.materials && `Materials: ${i.materials}`,
    i.style && `Style: ${i.style}`,
    ...i.details.split(/[,\n]/).map((s) => s.trim()).filter(Boolean).map((s) => s[0].toUpperCase() + s.slice(1)),
  ].filter(Boolean);
  const description = `${openers[i.voice]}\n\n${bullets.map((b) => "- " + b).join("\n")}\n\n${closers[i.voice]}`;
  const words = [...new Set(`${i.product},${i.materials},${i.style},${i.details}`.toLowerCase().split(/[,\s]+/).filter((w) => w.length > 3))];
  const tags = [...words, "handmade gift", "small batch", "unique gift", "gift idea"].slice(0, i.marketplace === "Etsy" ? 13 : 8);
  return { title, description, tags };
}

// ---- routes ----------------------------------------------------------------
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, engine: LLM_BASE_URL ? LLM_MODEL : "template" });
});

app.post("/api/generate", limit(20, 10 * 60 * 1000), async (req, res) => {
  const input = readInput(req.body || {});
  if (!input.product) return res.status(400).json({ error: "Add a product name first." });

  let listing, engine;
  if (LLM_BASE_URL) {
    try {
      listing = await callModel(input);
      engine = { kind: "model", name: LLM_MODEL };
    } catch (err) {
      console.error("model call failed:", err.message);
    }
  }
  if (!listing) {
    listing = templateListing(input);
    engine = { kind: "template", name: LLM_BASE_URL ? "model unavailable" : "no model connected" };
  }
  res.json({ ...listing, price: priceRange(input.cost, input.marketplace), engine, marketplace: input.marketplace });
});

app.post("/api/waitlist", limit(5, 60 * 60 * 1000), (req, res) => {
  const email = clean(req.body?.email, 120).toLowerCase();
  const plan = ["Free", "Seller", "Studio"].includes(req.body?.plan) ? req.body.plan : "Seller";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: "That email address doesn't look right." });
  }
  const row = JSON.stringify({ email, plan, at: new Date().toISOString() });
  console.log("waitlist:", row);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(path.join(DATA_DIR, "waitlist.jsonl"), row + "\n");
  } catch (err) {
    console.error("could not write waitlist file:", err.message);
  }
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`ListingLoom on :${PORT} (${LLM_BASE_URL ? `model ${LLM_MODEL} at ${LLM_BASE_URL}` : "template mode"})`);
});
