const { HfInference } = require("@huggingface/inference");
const { read } = require("./jsondb");

const MODEL = "Hello-SimpleAI/chatgpt-detector-roberta";
const CONFIG_PATH = "./data/config.json";

function getHfToken() {
  if (process.env.HF_TOKEN) return process.env.HF_TOKEN;
  try {
    const cfg = read(CONFIG_PATH);
    return cfg?.hfToken || undefined;
  } catch {
    return undefined;
  }
}

async function detectAI(text) {
  const hf = new HfInference(getHfToken());

  const result = await hf.textClassification({
    model: MODEL,
    inputs: text,
  });

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
