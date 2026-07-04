const { read } = require("./jsondb");

const MODEL       = "Hello-SimpleAI/chatgpt-detector-roberta";
const CONFIG_PATH = "./data/config.json";
const TIMEOUT_MS  = 30_000;
const MAX_RETRIES = 3;

function getHfToken() {
  if (process.env.HF_TOKEN) return process.env.HF_TOKEN;
  try {
    const cfg = read(CONFIG_PATH);
    return cfg?.hfToken || null;
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") throw new Error(`Request timed out after ${timeoutMs / 1000}s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function detectAI(text) {
  const token   = getHfToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const url  = `https://api-inference.huggingface.co/models/${MODEL}`;
  const body = JSON.stringify({ inputs: text });

  let lastErr;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let res;
    try {
      res = await fetchWithTimeout(url, { method: "POST", headers, body }, TIMEOUT_MS);
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        await sleep(2000 * attempt);
        continue;
      }
      throw new Error(`Network error after ${MAX_RETRIES} attempts: ${err.message}`);
    }

    // Model is loading — HF tells us how long to wait
    if (res.status === 503) {
      let waitMs = 10_000;
      try {
        const body503 = await res.json();
        if (body503?.estimated_time) waitMs = Math.min(body503.estimated_time * 1000, 60_000);
      } catch { /* ignore parse failure */ }

      if (attempt < MAX_RETRIES) {
        await sleep(waitMs);
        continue;
      }
      throw new Error(`Model still loading after ${MAX_RETRIES} attempts (waited ${waitMs / 1000}s each)`);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "(unreadable)");
      throw new Error(`Hugging Face API error ${res.status}: ${errText}`);
    }

    const data   = await res.json();
    const result = Array.isArray(data[0]) ? data[0] : data;
    const sorted = [...result].sort((a, b) => b.score - a.score);
    const top    = sorted[0];

    const isAI =
      top.label === "ChatGPT" ||
      top.label.toLowerCase().includes("ai") ||
      top.label.toLowerCase().includes("fake");

    const confidence = Math.round(top.score * 100);

    return { isAI, confidence, label: top.label, allScores: result };
  }

  throw lastErr || new Error("detectAI failed after max retries");
}

module.exports = { detectAI };
