// Local, dependency-free AI-text heuristic scanner.
//
// The previous version of this feature called out to Hugging Face's hosted
// inference API, which turned out to be unreliable (rate limits / cold model
// loads / network errors). This version runs entirely locally — no network
// call, so it can never fail to respond — and scores text using well-known
// stylistic tells of LLM-generated writing: stock transition phrases, overly
// uniform sentence length, absence of contractions, and above-average
// vocabulary formality. It is a heuristic, not a certainty — the result is
// presented as a confidence score, not a verdict of fact.

const AI_STOCK_PHRASES = [
  "as an ai", "i'm just a language model", "i am unable to",
  "in conclusion", "in summary", "to summarize", "overall,",
  "furthermore", "moreover", "additionally,", "it is important to note",
  "it's important to note", "i hope this helps", "let me know if you",
  "delve into", "leverage", "utilize", "robust solution", "seamless",
  "in today's fast-paced world", "on the other hand", "that being said",
  "first and foremost", "needless to say", "plays a crucial role",
  "plays a vital role", "cutting-edge", "streamline", "in order to",
];

const CONTRACTIONS_RE = /\b\w+'(?:t|re|ve|ll|d|s|m)\b/gi;

function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitWords(text) {
  return (text.toLowerCase().match(/[a-z0-9']+/g)) || [];
}

function stdDev(nums) {
  if (nums.length < 2) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
}

function analyzeText(text) {
  const sentences   = splitSentences(text);
  const words       = splitWords(text);
  const wordCount   = words.length;
  const lower       = text.toLowerCase();

  const reasons = [];
  let score = 0;

  // 1. Stock AI phrasing — strongest single signal
  const phraseHits = AI_STOCK_PHRASES.filter((p) => lower.includes(p));
  if (phraseHits.length > 0) {
    const pts = Math.min(40, phraseHits.length * 15);
    score += pts;
    reasons.push(`Found ${phraseHits.length} common AI stock phrase(s): "${phraseHits.slice(0, 3).join('", "')}" (+${pts})`);
  }

  // 2. Sentence length uniformity — AI text tends to have very even sentence lengths
  if (sentences.length >= 3) {
    const lengths = sentences.map((s) => splitWords(s).length);
    const dev = stdDev(lengths);
    if (dev < 2.5) {
      score += 20;
      reasons.push(`Sentence lengths are unusually uniform (σ=${dev.toFixed(1)} words) (+20)`);
    }
  }

  // 3. Contraction usage — humans typing casually use contractions; formal AI prose often avoids them
  if (wordCount >= 30) {
    const contractionCount = (text.match(CONTRACTIONS_RE) || []).length;
    const per100 = (contractionCount / wordCount) * 100;
    if (per100 < 1) {
      score += 20;
      reasons.push(`Almost no contractions used (${contractionCount} in ${wordCount} words) (+20)`);
    }
  }

  // 4. Average word length — more formal/complex vocabulary skews longer
  if (wordCount >= 15) {
    const avgWordLen = words.reduce((a, w) => a + w.length, 0) / wordCount;
    if (avgWordLen > 5.3) {
      score += 10;
      reasons.push(`Above-average word length (${avgWordLen.toFixed(1)} chars/word) (+10)`);
    }
  }

  // 5. Lack of typos/casual markers — no slang, no repeated letters (e.g. "sooo"), no lowercase "i"
  const casualMarkers = /\b(lol|lmao|omg|idk|ngl|tbh|gonna|wanna|kinda|yeah|nah)\b|([a-z])\2{2,}/i;
  if (wordCount >= 30 && !casualMarkers.test(lower)) {
    score += 10;
    reasons.push(`No casual/slang markers detected in a longer answer (+10)`);
  }

  score = Math.min(100, score);
  const isAI = score >= 50;

  if (reasons.length === 0) {
    reasons.push("No notable AI-writing patterns detected.");
  }

  return { isAI, confidence: score, reasons, wordCount, sentenceCount: sentences.length };
}

module.exports = { analyzeText };
