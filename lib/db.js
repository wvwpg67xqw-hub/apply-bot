const { Pool } = require("pg");
const log = require("../utils/logger");

const DEFAULT_JOIN_TIMEOUT = 48 * 60 * 60 * 1000;
const HARDCODED_STAFF_GUILD_ID = "1487744336908124190";

let pool = null;
let initPromise = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.SUPABASE_DB_URL,
      ssl: { rejectUnauthorized: false },
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
        data JSONB NOT NULL
      )
    `);

    await p.query(`
      CREATE TABLE IF NOT EXISTS guild_configs (
        guild_id TEXT PRIMARY KEY,
        data JSONB NOT NULL
      )
    `);

    await p.query(`
      CREATE TABLE IF NOT EXISTS blacklist (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role_id TEXT,
        expires_at BIGINT,
        PRIMARY KEY (guild_id, user_id)
      )
    `);

    // Safe no-op if column already exists
    await p.query(`
      ALTER TABLE blacklist ADD COLUMN IF NOT EXISTS role_id TEXT
    `).catch(() => {});

    await p.query(`
      CREATE TABLE IF NOT EXISTS applications (
        app_id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        created_at BIGINT NOT NULL
      )
    `);

    await p.query(`
      CREATE TABLE IF NOT EXISTS pending_joins (
        user_id TEXT PRIMARY KEY,
        data JSONB NOT NULL
      )
    `);

    await p.query(`
      CREATE TABLE IF NOT EXISTS application_cooldowns (
        user_id TEXT PRIMARY KEY,
        reapply_at BIGINT NOT NULL,
        role_type TEXT NOT NULL
      )
    `);

    log.info("DB", "PostgreSQL tables ready");
  })();

  return initPromise;
}


// ─── Config ─────────────────────────────────────────────────────

async function getConfig() {
  await init();
  const { rows } = await getPool().query("SELECT data FROM bot_config WHERE id = 1");
  const cfg = rows[0] ? rows[0].data : {};
  if (!cfg.staffGuildId) cfg.staffGuildId = HARDCODED_STAFF_GUILD_ID;
  return cfg;
}

async function setConfig(updates) {
  await init();
  const current = await getConfig();
  const merged = { ...current, ...updates };
  await getPool().query(
    `INSERT INTO bot_config (id, data) VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET data = $1`,
    [JSON.stringify(merged)]
  );
}


// ─── Guild Config ────────────────────────────────────────────────

async function getGuilds() {
  await init();
  const { rows } = await getPool().query("SELECT guild_id, data FROM guild_configs");
  return rows.map(r => ({ id: r.guild_id, ...r.data }));
}

async function getGuild(id) {
  await init();
  const { rows } = await getPool().query(
    "SELECT data FROM guild_configs WHERE guild_id = $1",
    [id]
  );
  if (!rows[0]) return null;
  return { id, ...rows[0].data };
}

async function setGuildConfig(guildId, config) {
  await init();
  const existing = await getGuild(guildId) || { id: guildId };
  const merged = { ...existing, ...config };
  delete merged.id;
  await getPool().query(
    `INSERT INTO guild_configs (guild_id, data) VALUES ($1, $2)
     ON CONFLICT (guild_id) DO UPDATE SET data = $2`,
    [guildId, JSON.stringify(merged)]
  );
}


// ─── Blacklist ───────────────────────────────────────────────────

async function isBlacklisted(guildId, userId) {
  await init();
  const { rows } = await getPool().query(
    "SELECT expires_at FROM blacklist WHERE guild_id = $1 AND user_id = $2",
    [guildId, userId]
  );
  if (!rows[0]) return false;
  const expires = rows[0].expires_at;
  if (expires && Date.now() > Number(expires)) {
    await removeFromBlacklist(guildId, userId);
    return false;
  }
  return true;
}

async function addToBlacklist(guildId, userId, roleId, expiresAt = null) {
  await init();
  await getPool().query(
    `INSERT INTO blacklist (guild_id, user_id, role_id, expires_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (guild_id, user_id) DO UPDATE SET role_id = $3, expires_at = $4`,
    [guildId, userId, roleId, expiresAt]
  );
}

async function getBlacklistRole(guildId, userId) {
  await init();
  const { rows } = await getPool().query(
    "SELECT role_id, expires_at FROM blacklist WHERE guild_id = $1 AND user_id = $2",
    [guildId, userId]
  );
  if (!rows[0]) return null;
  if (rows[0].expires_at && Date.now() > Number(rows[0].expires_at)) {
    await removeFromBlacklist(guildId, userId);
    return null;
  }
  return rows[0];
}

async function removeFromBlacklist(guildId, userId) {
  await init();
  const result = await getPool().query(
    "DELETE FROM blacklist WHERE guild_id = $1 AND user_id = $2",
    [guildId, userId]
  );
  return result.rowCount > 0;
}

async function removeFromBlacklistAllGuilds(userId) {
  await init();
  const result = await getPool().query(
    "DELETE FROM blacklist WHERE user_id = $1",
    [userId]
  );
  return result.rowCount;
}


// ─── Restore role after rejoin ───────────────────────────────────

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


// ─── Remove expired blacklist roles ──────────────────────────────

function startBlacklistExpiration(client) {
  setInterval(async () => {
    const { rows } = await getPool().query(
      "SELECT * FROM blacklist WHERE expires_at IS NOT NULL AND expires_at <= $1",
      [Date.now()]
    );
    for (const item of rows) {
      const guild = client.guilds.cache.get(item.guild_id);
      if (guild) {
        try {
          const member = await guild.members.fetch(item.user_id);
          if (item.role_id) await member.roles.remove(item.role_id);
        } catch {}
      }
      await removeFromBlacklist(item.guild_id, item.user_id);
    }
  }, 60000);
}


// ─── Applications ────────────────────────────────────────────────

async function getApps() {
  await init();
  const { rows } = await getPool().query("SELECT data FROM applications");
  return rows.map(r => r.data);
}

async function saveApp(appData) {
  await init();
  await getPool().query(
    "INSERT INTO applications (app_id, data, created_at) VALUES ($1, $2, $3)",
    [appData.id, JSON.stringify(appData), appData.submittedAt || Date.now()]
  );
}

async function getAppById(id) {
  await init();
  const { rows } = await getPool().query(
    "SELECT data FROM applications WHERE app_id = $1",
    [id.toUpperCase()]
  );
  return rows[0]?.data || null;
}

function generateAppId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let suffix = "";
  for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  return "APP-" + suffix;
}


// ─── Pending joins ───────────────────────────────────────────────

async function getPendingJoins() {
  await init();
  const { rows } = await getPool().query("SELECT data FROM pending_joins");
  return rows.map(r => r.data);
}

async function addPendingJoin(entry) {
  await init();
  await getPool().query(
    `INSERT INTO pending_joins (user_id, data) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET data = $2`,
    [entry.userId, JSON.stringify(entry)]
  );
}

async function removePendingJoin(userId) {
  await init();
  await getPool().query(
    "DELETE FROM pending_joins WHERE user_id = $1",
    [userId]
  );
}

async function getJoinTimeoutMs() {
  const cfg = await getConfig();
  return cfg.joinTimeoutMs ?? DEFAULT_JOIN_TIMEOUT;
}


module.exports = {
  DEFAULT_JOIN_TIMEOUT,
  HARDCODED_STAFF_GUILD_ID,

  init,
  getPool,

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
