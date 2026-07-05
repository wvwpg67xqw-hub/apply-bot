const mysql = require("mysql2/promise");
const log = require("../utils/logger");

const DEFAULT_JOIN_TIMEOUT = 48 * 60 * 60 * 1000;

// Staff (review) server — hardcoded so no manual /setstaffserver run is
// required. Can still be overridden by saving a different staffGuildId via
// setConfig, but this is the default fallback.
const HARDCODED_STAFF_GUILD_ID = "1487744336908124190";

let pool = null;
let initPromise = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host:     process.env.DB_HOST,
      port:     parseInt(process.env.DB_PORT || "3306", 10),
      user:     process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
  }
  return pool;
}

async function init() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const p = getPool();
    await p.query(`
      CREATE TABLE IF NOT EXISTS bot_config (
        id INT PRIMARY KEY DEFAULT 1,
        data JSON NOT NULL
      )
    `);
    await p.query(`
      CREATE TABLE IF NOT EXISTS guild_configs (
        guild_id VARCHAR(32) PRIMARY KEY,
        data JSON NOT NULL
      )
    `);
    await p.query(`
      CREATE TABLE IF NOT EXISTS blacklist (
        guild_id VARCHAR(32) NOT NULL,
        user_id VARCHAR(32) NOT NULL,
        expires_at BIGINT NULL,
        PRIMARY KEY (guild_id, user_id)
      )
    `);
    await p.query(`
      CREATE TABLE IF NOT EXISTS applications (
        app_id VARCHAR(16) PRIMARY KEY,
        data JSON NOT NULL,
        created_at BIGINT NOT NULL
      )
    `);
    await p.query(`
      CREATE TABLE IF NOT EXISTS pending_joins (
        user_id VARCHAR(32) PRIMARY KEY,
        data JSON NOT NULL
      )
    `);
    log.info("DB", "MySQL tables ready");
  })();
  return initPromise;
}

// ─── Global config ────────────────────────────────────────────────────────────

async function getConfig() {
  await init();
  const [rows] = await getPool().query("SELECT data FROM bot_config WHERE id = 1");
  const cfg = rows[0] ? rows[0].data : {};
  if (!cfg.staffGuildId) cfg.staffGuildId = HARDCODED_STAFF_GUILD_ID;
  return cfg;
}

async function setConfig(updates) {
  await init();
  const current = await getConfig();
  const merged  = { ...current, ...updates };
  await getPool().query(
    "INSERT INTO bot_config (id, data) VALUES (1, ?) ON DUPLICATE KEY UPDATE data = ?",
    [JSON.stringify(merged), JSON.stringify(merged)]
  );
}

// ─── Per-guild config ─────────────────────────────────────────────────────────

async function getGuilds() {
  await init();
  const [rows] = await getPool().query("SELECT guild_id, data FROM guild_configs");
  return rows.map((r) => ({ id: r.guild_id, ...r.data }));
}

async function getGuild(id) {
  await init();
  const [rows] = await getPool().query("SELECT data FROM guild_configs WHERE guild_id = ?", [id]);
  if (!rows[0]) return null;
  return { id, ...rows[0].data };
}

async function setGuildConfig(guildId, config) {
  await init();
  const existing   = (await getGuild(guildId)) || { id: guildId };
  const { id, ...rest } = existing;
  const merged     = { ...rest, ...config };
  await getPool().query(
    "INSERT INTO guild_configs (guild_id, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = ?",
    [guildId, JSON.stringify(merged), JSON.stringify(merged)]
  );
}

// ─── Blacklist (per guild) ─────────────────────────────────────────────────────

async function isBlacklisted(guildId, userId) {
  await init();
  const [rows] = await getPool().query(
    "SELECT expires_at FROM blacklist WHERE guild_id = ? AND user_id = ?",
    [guildId, userId]
  );
  if (!rows[0]) return false;
  const expiresAt = rows[0].expires_at;
  if (expiresAt && Date.now() > Number(expiresAt)) return false;
  return true;
}

async function addToBlacklist(guildId, userId, expiresAt = null) {
  await init();
  await getPool().query(
    "INSERT INTO blacklist (guild_id, user_id, expires_at) VALUES (?, ?, ?) " +
    "ON DUPLICATE KEY UPDATE expires_at = ?",
    [guildId, userId, expiresAt, expiresAt]
  );
}

async function removeFromBlacklist(guildId, userId) {
  await init();
  const [result] = await getPool().query(
    "DELETE FROM blacklist WHERE guild_id = ? AND user_id = ?",
    [guildId, userId]
  );
  return result.affectedRows > 0;
}

// Removes a user from the blacklist in every guild (handles cross-server reviews)
async function removeFromBlacklistAllGuilds(userId) {
  await init();
  const [result] = await getPool().query("DELETE FROM blacklist WHERE user_id = ?", [userId]);
  return result.affectedRows;
}

// ─── Application records ──────────────────────────────────────────────────────

async function getApps() {
  await init();
  const [rows] = await getPool().query("SELECT data FROM applications");
  return rows.map((r) => r.data);
}

async function saveApp(appData) {
  await init();
  await getPool().query(
    "INSERT INTO applications (app_id, data, created_at) VALUES (?, ?, ?)",
    [appData.id, JSON.stringify(appData), appData.submittedAt || Date.now()]
  );
}

async function getAppById(id) {
  await init();
  const [rows] = await getPool().query(
    "SELECT data FROM applications WHERE app_id = ?",
    [id.toUpperCase()]
  );
  return rows[0] ? rows[0].data : null;
}

function generateAppId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let suffix = "";
  for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  return "APP-" + suffix;
}

// ─── Pending join tracker ─────────────────────────────────────────────────────

async function getPendingJoins() {
  await init();
  const [rows] = await getPool().query("SELECT data FROM pending_joins");
  return rows.map((r) => r.data);
}

async function addPendingJoin(entry) {
  await init();
  await getPool().query(
    "INSERT INTO pending_joins (user_id, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = ?",
    [entry.userId, JSON.stringify(entry), JSON.stringify(entry)]
  );
}

async function removePendingJoin(userId) {
  await init();
  await getPool().query("DELETE FROM pending_joins WHERE user_id = ?", [userId]);
}

async function getJoinTimeoutMs() {
  const cfg = await getConfig();
  return cfg.joinTimeoutMs ?? DEFAULT_JOIN_TIMEOUT;
}

module.exports = {
  DEFAULT_JOIN_TIMEOUT, HARDCODED_STAFF_GUILD_ID,
  init,
  getConfig, setConfig,
  getGuilds, getGuild, setGuildConfig,
  isBlacklisted, addToBlacklist, removeFromBlacklist, removeFromBlacklistAllGuilds,
  getApps, saveApp, getAppById, generateAppId,
  getPendingJoins, addPendingJoin, removePendingJoin, getJoinTimeoutMs,
};
