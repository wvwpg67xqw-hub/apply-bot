const https  = require("https");
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

function httpsPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const payload = JSON.stringify(body);

    const req = https.request(
      {
        hostname: parsed.hostname,
        path:     parsed.pathname + parsed.search,
        method:   "POST",
        headers:  {
          ...headers,
          "Content-Type":   "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: raw }));
      }
    );

    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Request timed out after ${TIMEOUT_MS / 1000}s`));
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function detectAI(text) {
  const token   = getHfToken();
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  // x-wait-for-model tells HF to block until the model is warm (up to ~60s)
  // instead of immediately returning a 503
  headers["x-wait-for-model"] = "true";

  const url  = `https://api-inference.huggingface.co/models/${MODEL}`;
  const body = { inputs: text, options: { wait_for_model: true } };

  let lastErr;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let res;
    try {
      res = await httpsPost(url, headers, body);
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        await sleep(2000 * attempt);
        continue;
      }
      throw new Error(`Network error after ${MAX_RETRIES} attempts: ${err.message}`);
    }

    // Model still loading (shouldn't happen with wait_for_model, but handle anyway)
    if (res.status === 503) {
      let waitMs = 10_000;
      try {
        const parsed503 = JSON.parse(res.body);
        if (parsed503?.estimated_time) waitMs = Math.min(parsed503.estimated_time * 1000, 60_000);
      } catch { /* ignore */ }

      if (attempt < MAX_RETRIES) {
        await sleep(waitMs);
        continue;
      }
      throw new Error(`Model still loading after ${MAX_RETRIES} attempts`);
    }

    if (res.status !== 200) {
      throw new Error(`Hugging Face API error ${res.status}: ${res.body}`);
    }

    let data;
    try {
      data = JSON.parse(res.body);
    } catch {
      throw new Error(`Invalid JSON from Hugging Face: ${res.body.slice(0, 200)}`);
    }

    const result = Array.isArray(data[0]) ? data[0] : data;
    const sorted = [...result].sort((a, b) => b.score - a.score);
    const top    = sorted[0];

    const isAI =
      top.label === "ChatGPT" ||
      top.label.toLowerCase().includes("ai") ||
      top.label.toLowerCase().includes("fake");

    return {
      isAI,
      confidence: Math.round(top.score * 100),
      label:      top.label,
      allScores:  result,
    };
  }

  throw lastErr || new Error("detectAI failed after max retries");
}

module.exports = { detectAI };
