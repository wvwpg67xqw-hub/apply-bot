const { HfInference } = require("@huggingface/inference");

const MODEL = "Hello-SimpleAI/chatgpt-detector-roberta";

async function detectAI(text) {
  const token = process.env.HF_TOKEN;
  const hf = new HfInference(token || undefined);

  const result = await hf.textClassification({
    model: MODEL,
    inputs: text,
  });

  const aiLabel = result.find(
    (r) => r.label === "ChatGPT" || r.label.toLowerCase().includes("ai") || r.label.toLowerCase().includes("fake")
  );
  const humanLabel = result.find(
    (r) => r.label === "Human" || r.label.toLowerCase().includes("human") || r.label.toLowerCase().includes("real")
  );

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
