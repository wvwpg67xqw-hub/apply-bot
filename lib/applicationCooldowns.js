const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "cooldowns.json");

function read() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) return {};
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return {}; }
}

function write(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), "utf8");
}

async function setApplicationCooldown(userId, { type, reapplyAt }) {
  const cooldowns = read();
  cooldowns[userId] = { reapply_at: reapplyAt, role_type: type };
  write(cooldowns);
}

async function getApplicationCooldown(userId, _roleType) {
  const cooldowns = read();
  const entry = cooldowns[userId];
  if (!entry) return null;

  const reapplyAt = Number(entry.reapply_at);
  if (Date.now() > reapplyAt) return null;

  return { reapplyAt, roleType: entry.role_type };
}

module.exports = { setApplicationCooldown, getApplicationCooldown };