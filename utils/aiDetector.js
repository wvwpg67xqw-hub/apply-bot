const { read } = require("./jsondb");

const MODEL = "Hello-SimpleAI/chatgpt-detector-roberta";
const CONFIG_PATH = "./data/config.json";

function getHfToken() {
  if (process.env.HF_TOKEN) return process.env.HF_TOKEN;
  try {
    const cfg = read(CONFIG_PATH);
    return cfg?.hfToken || null;
  } catch {
    return null;
  }
}

async function detectAI(text) {
  const token = getHfToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(
    `https://api-inference.huggingface.co/models/${MODEL}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ inputs: text }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Hugging Face API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const result = Array.isArray(data[0]) ? data[0] : data;

  const sorted = [...result].sort((a, b) => b.score - a.score);
  const top = sorted[0];

  const isAI =
    top.label === "ChatGPT" ||
    top.label.toLowerCase().includes("ai") ||
    top.label.toLowerCase().includes("fake");

  const confidence = Math.round(top.score * 100);

  return {
    isAI,
    confidence,
    label: top.label,
    allScores: result,
  };
}

module.exports = { detectAI };
