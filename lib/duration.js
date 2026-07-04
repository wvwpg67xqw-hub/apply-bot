// ─── Duration parser ──────────────────────────────────────────────────────────

function parseDuration(str) {
  if (!str || str.toLowerCase() === "permanent") return null;
  const match = str.match(/^(\d+)\s*(m|h|d|w)$/i);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const ms = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
  return Date.now() + n * ms[unit];
}

function parseDurationMs(str) {
  if (!str) return null;
  const match = str.match(/^(\d+)\s*(m|h|d|w)$/i);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const ms = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
  return n * ms[unit];
}

module.exports = { parseDuration, parseDurationMs };
