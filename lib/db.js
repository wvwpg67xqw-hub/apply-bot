const fs = require("fs");
const path = require("path");
const log = require("../utils/logger");

const DEFAULT_JOIN_TIMEOUT = 48 * 60 * 60 * 1000;
const HARDCODED_STAFF_GUILD_ID = "1487744336908124190";

const DATA_DIR = path.join(__dirname, "..", "data");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function filePath(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

function readJson(name, defaultValue) {
  ensureDataDir();
  const fp = filePath(name);
  if (!fs.existsSync(fp)) return defaultValue;
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return defaultValue;
  }
}

function writeJson(name, data) {
  ensureDataDir();
  fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2), "utf8");
}

async function init() {
  ensureDataDir();
  log.info("DB", "JSON file storage ready");
}

async function getConfig() {
  const cfg = readJson("config", {});
  if (!cfg.staffGuildId) cfg.staffGuildId = HARDCODED_STAFF_GUILD_ID;
  return cfg;
}

async function setConfig(updates) {
  const current = await getConfig();
  const merged = { ...current, ...updates };
  writeJson("config", merged);
}

async function getGuilds() {
  const guilds = readJson("guilds", {});
  return Object.entries(guilds).map(([id, data]) => ({ id, ...data }));
}

async function getGuild(id) {
  const guilds = readJson("guilds", {});
  if (!guilds[id]) return null;
  return { id, ...guilds[id] };
}

async function setGuildConfig(guildId, config) {
  const guilds = readJson("guilds", {});
  const existing = guilds[guildId] || {};
  const merged = { ...existing, ...config };
  delete merged.id;
  guilds[guildId] = merged;
  writeJson("guilds", guilds);
}

async function isBlacklisted(guildId, userId) {
  const bl = readJson("blacklist", {});
  const key = `${guildId}:${userId}`;
  const entry = bl[key];
  if (!entry) return false;
  if (entry.expires_at && Date.now() > entry.expires_at) {
    await removeFromBlacklist(guildId, userId);
    return false;
  }
  return true;
}

async function addToBlacklist(guildId, userId, roleId, expiresAt = null) {
  const bl = readJson("blacklist", {});
  const key = `${guildId}:${userId}`;
  bl[key] = { guild_id: guildId, user_id: userId, role_id: roleId, expires_at: expiresAt };
  writeJson("blacklist", bl);
}

async function getBlacklistRole(guildId, userId) {
  const bl = readJson("blacklist", {});
  const key = `${guildId}:${userId}`;
  const entry = bl[key];
  if (!entry) return null;
  if (entry.expires_at && Date.now() > entry.expires_at) {
    await removeFromBlacklist(guildId, userId);
    return null;
  }
  return { role_id: entry.role_id, expires_at: entry.expires_at };
}

async function removeFromBlacklist(guildId, userId) {
  const bl = readJson("blacklist", {});
  const key = `${guildId}:${userId}`;
  if (!bl[key]) return false;
  delete bl[key];
  writeJson("blacklist", bl);
  return true;
}

async function removeFromBlacklistAllGuilds(userId) {
  const bl = readJson("blacklist", {});
  let count = 0;
  for (const key of Object.keys(bl)) {
    if (bl[key].user_id === userId) {
      delete bl[key];
      count++;
    }
  }
  writeJson("blacklist", bl);
  return count;
}

async function restoreBlacklistRole(member) {
  const data = await getBlacklistRole(member.guild.id, member.id);
  if (!data?.role_id) return;
  try {
    await member.roles.add(data.role_id);
    log.info("BLACKLIST", `Restored blacklist role to ${member.id}`);
  } catch (err) {
    log.warn("BLACKLIST", `Could not restore blacklist role`, err.message);
  }
}

function startBlacklistExpiration(client) {
  setInterval(async () => {
    const bl = readJson("blacklist", {});
    for (const key of Object.keys(bl)) {
      const item = bl[key];
      if (item.expires_at && Date.now() >= item.expires_at) {
        const guild = client.guilds.cache.get(item.guild_id);
        if (guild) {
          try {
            const member = await guild.members.fetch(item.user_id);
            if (item.role_id) await member.roles.remove(item.role_id);
          } catch {}
        }
        await removeFromBlacklist(item.guild_id, item.user_id);
      }
    }
  }, 60000);
}

async function getApps() {
  const apps = readJson("applications", {});
  return Object.values(apps);
}

async function saveApp(appData) {
  const apps = readJson("applications", {});
  apps[appData.id] = appData;
  writeJson("applications", apps);
}

async function getAppById(id) {
  const apps = readJson("applications", {});
  return apps[id.toUpperCase()] || null;
}

function generateAppId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let suffix = "";
  for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  return "APP-" + suffix;
}

async function getPendingJoins() {
  const pj = readJson("pending_joins", {});
  return Object.values(pj);
}

async function addPendingJoin(entry) {
  const pj = readJson("pending_joins", {});
  pj[entry.userId] = entry;
  writeJson("pending_joins", pj);
}

async function removePendingJoin(userId) {
  const pj = readJson("pending_joins", {});
  delete pj[userId];
  writeJson("pending_joins", pj);
}

async function getJoinTimeoutMs() {
  const cfg = await getConfig();
  return cfg.joinTimeoutMs ?? DEFAULT_JOIN_TIMEOUT;
}

module.exports = {
  DEFAULT_JOIN_TIMEOUT,
  HARDCODED_STAFF_GUILD_ID,
  init,
  getPool: () => null,
  getConfig,
  setConfig,
  getGuilds,
  getGuild,
  setGuildConfig,
  isBlacklisted,
  addToBlacklist,
  getBlacklistRole,
  removeFromBlacklist,
  removeFromBlacklistAllGuilds,
  restoreBlacklistRole,
  startBlacklistExpiration,
  getApps,
  saveApp,
  getAppById,
  generateAppId,
  getPendingJoins,
  addPendingJoin,
  removePendingJoin,
  getJoinTimeoutMs,
};