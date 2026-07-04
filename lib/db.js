const { read, write } = require("../utils/jsondb");

const GUILDS_PATH        = "./data/guilds.json";
const CONFIG_PATH        = "./data/config.json";
const APPS_PATH          = "./data/applications.json";
const PENDING_JOINS_PATH = "./data/pending_joins.json";
const DEFAULT_JOIN_TIMEOUT = 48 * 60 * 60 * 1000;

// ─── Global config ────────────────────────────────────────────────────────────

function getConfig()        { return read(CONFIG_PATH); }
function setConfig(updates) { write(CONFIG_PATH, { ...getConfig(), ...updates }); }

// ─── Per-guild config ─────────────────────────────────────────────────────────

function getGuilds()  { return read(GUILDS_PATH); }
function getGuild(id) { return getGuilds().find((g) => g.id === id) || null; }

function setGuildConfig(guildId, config) {
  const guilds = getGuilds();
  const idx    = guilds.findIndex((g) => g.id === guildId);
  if (idx === -1) guilds.push({ id: guildId, blacklist: [], ...config });
  else            guilds[idx] = { blacklist: [], ...guilds[idx], ...config };
  write(GUILDS_PATH, guilds);
}

// ─── Blacklist list (per guild) ───────────────────────────────────────────────

function isBlacklisted(guildId, userId) {
  const blacklist = getGuild(guildId)?.blacklist;
  if (!blacklist) return false;
  const entry = blacklist.find((e) => (typeof e === "string" ? e : e.userId) === userId);
  if (!entry) return false;
  const expiresAt = typeof entry === "object" ? entry.expiresAt : null;
  if (expiresAt && Date.now() > expiresAt) return false;
  return true;
}

function addToBlacklist(guildId, userId, expiresAt = null) {
  const guilds = getGuilds();
  let idx      = guilds.findIndex((g) => g.id === guildId);
  const entry  = { userId, expiresAt };
  if (idx === -1) {
    guilds.push({ id: guildId, blacklist: [entry] });
    write(GUILDS_PATH, guilds);
    return;
  }
  if (!Array.isArray(guilds[idx].blacklist)) guilds[idx].blacklist = [];
  const existing = guilds[idx].blacklist.findIndex(
    (e) => (typeof e === "string" ? e : e.userId) === userId
  );
  if (existing !== -1) guilds[idx].blacklist[existing] = entry;
  else                 guilds[idx].blacklist.push(entry);
  write(GUILDS_PATH, guilds);
}

function removeFromBlacklist(guildId, userId) {
  const guilds = getGuilds();
  const idx    = guilds.findIndex((g) => g.id === guildId);
  if (idx === -1) return false;
  const before = guilds[idx].blacklist?.length || 0;
  guilds[idx].blacklist = (guilds[idx].blacklist || []).filter(
    (e) => (typeof e === "string" ? e : e.userId) !== userId
  );
  write(GUILDS_PATH, guilds);
  return guilds[idx].blacklist.length < before;
}

// Removes a user from the blacklist in every guild (handles cross-server reviews)
function removeFromBlacklistAllGuilds(userId) {
  const guilds = getGuilds();
  let totalRemoved = 0;
  for (const g of guilds) {
    if (!Array.isArray(g.blacklist)) continue;
    const before = g.blacklist.length;
    g.blacklist = g.blacklist.filter(
      (e) => (typeof e === "string" ? e : e.userId) !== userId
    );
    totalRemoved += before - g.blacklist.length;
  }
  if (totalRemoved > 0) write(GUILDS_PATH, guilds);
  return totalRemoved;
}

// ─── Application records ──────────────────────────────────────────────────────

function getApps() {
  return read(APPS_PATH);
}

function saveApp(appData) {
  const apps = getApps();
  apps.push(appData);
  write(APPS_PATH, apps);
}

function getAppById(id) {
  return getApps().find((a) => a.id === id.toUpperCase()) || null;
}

function generateAppId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let suffix = "";
  for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  return "APP-" + suffix;
}

// ─── Pending join tracker ─────────────────────────────────────────────────────

function getPendingJoins() { return read(PENDING_JOINS_PATH); }

function addPendingJoin(entry) {
  const list = getPendingJoins();
  list.push(entry);
  write(PENDING_JOINS_PATH, list);
}

function removePendingJoin(userId) {
  const list = getPendingJoins().filter((e) => e.userId !== userId);
  write(PENDING_JOINS_PATH, list);
}

function getJoinTimeoutMs() {
  return getConfig().joinTimeoutMs ?? DEFAULT_JOIN_TIMEOUT;
}

module.exports = {
  GUILDS_PATH, CONFIG_PATH, APPS_PATH, PENDING_JOINS_PATH, DEFAULT_JOIN_TIMEOUT,
  getConfig, setConfig,
  getGuilds, getGuild, setGuildConfig,
  isBlacklisted, addToBlacklist, removeFromBlacklist, removeFromBlacklistAllGuilds,
  getApps, saveApp, getAppById, generateAppId,
  getPendingJoins, addPendingJoin, removePendingJoin, getJoinTimeoutMs,
};
