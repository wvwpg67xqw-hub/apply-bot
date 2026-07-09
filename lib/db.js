const { Pool } = require("pg");
const log = require("../utils/logger");

const DEFAULT_JOIN_TIMEOUT = 48 * 60 * 60 * 1000;
const HARDCODED_STAFF_GUILD_ID = "1487744336908124190";

const connectionString = process.env.NEON_DATABASE_URL;
if (!connectionString) {
  log.error("DB", "NEON_DATABASE_URL is not set — add it as a secret");
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

let ready;

async function initTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS applybot_config (
      id SMALLINT PRIMARY KEY DEFAULT 1,
      data JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS applybot_guilds (
      guild_id TEXT PRIMARY KEY,
      data JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS applybot_blacklist (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role_id TEXT,
      expires_at BIGINT,
      PRIMARY KEY (guild_id, user_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS applybot_applications (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS applybot_pending_joins (
      user_id TEXT PRIMARY KEY,
      data JSONB NOT NULL
    )
  `);
}

async function init() {
  if (!ready) {
    ready = initTables().catch((err) => {
      log.error("DB", "Failed to initialize Postgres tables", err.message);
      throw err;
    });
  }
  await ready;
  log.info("DB", "Postgres storage ready");
}

async function withReady(fn) {
  await init();
  return fn();
}

async function getConfig() {
  return withReady(async () => {
    const { rows } = await pool.query(`SELECT data FROM applybot_config WHERE id = 1`);
    const cfg = rows[0]?.data ?? {};
    if (!cfg.staffGuildId) cfg.staffGuildId = HARDCODED_STAFF_GUILD_ID;
    return cfg;
  });
}

async function setConfig(updates) {
  return withReady(async () => {
    const current = await getConfig();
    const merged = { ...current, ...updates };
    await pool.query(
      `INSERT INTO applybot_config (id, data) VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
      [merged]
    );
  });
}

async function getGuilds() {
  return withReady(async () => {
    const { rows } = await pool.query(`SELECT guild_id, data FROM applybot_guilds`);
    return rows.map((r) => ({ id: r.guild_id, ...r.data }));
  });
}

async function getGuild(id) {
  return withReady(async () => {
    const { rows } = await pool.query(`SELECT data FROM applybot_guilds WHERE guild_id = $1`, [id]);
    if (!rows[0]) return null;
    return { id, ...rows[0].data };
  });
}

async function setGuildConfig(guildId, config) {
  return withReady(async () => {
    const existing = (await getGuild(guildId)) || {};
    const merged = { ...existing, ...config };
    delete merged.id;
    await pool.query(
      `INSERT INTO applybot_guilds (guild_id, data) VALUES ($1, $2)
       ON CONFLICT (guild_id) DO UPDATE SET data = EXCLUDED.data`,
      [guildId, merged]
    );
  });
}

async function isBlacklisted(guildId, userId) {
  return withReady(async () => {
    const { rows } = await pool.query(
      `SELECT role_id, expires_at FROM applybot_blacklist WHERE guild_id = $1 AND user_id = $2`,
      [guildId, userId]
    );
    const entry = rows[0];
    if (!entry) return false;
    if (entry.expires_at && Date.now() > Number(entry.expires_at)) {
      await removeFromBlacklist(guildId, userId);
      return false;
    }
    return true;
  });
}

async function addToBlacklist(guildId, userId, roleId, expiresAt = null) {
  return withReady(async () => {
    await pool.query(
      `INSERT INTO applybot_blacklist (guild_id, user_id, role_id, expires_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (guild_id, user_id) DO UPDATE SET role_id = EXCLUDED.role_id, expires_at = EXCLUDED.expires_at`,
      [guildId, userId, roleId, expiresAt]
    );
  });
}

async function getBlacklistRole(guildId, userId) {
  return withReady(async () => {
    const { rows } = await pool.query(
      `SELECT role_id, expires_at FROM applybot_blacklist WHERE guild_id = $1 AND user_id = $2`,
      [guildId, userId]
    );
    const entry = rows[0];
    if (!entry) return null;
    if (entry.expires_at && Date.now() > Number(entry.expires_at)) {
      await removeFromBlacklist(guildId, userId);
      return null;
    }
    return { role_id: entry.role_id, expires_at: entry.expires_at ? Number(entry.expires_at) : null };
  });
}

async function removeFromBlacklist(guildId, userId) {
  return withReady(async () => {
    const { rowCount } = await pool.query(
      `DELETE FROM applybot_blacklist WHERE guild_id = $1 AND user_id = $2`,
      [guildId, userId]
    );
    return rowCount > 0;
  });
}

async function removeFromBlacklistAllGuilds(userId) {
  return withReady(async () => {
    const { rowCount } = await pool.query(`DELETE FROM applybot_blacklist WHERE user_id = $1`, [userId]);
    return rowCount;
  });
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
    await init();
    const { rows } = await pool.query(`SELECT * FROM applybot_blacklist WHERE expires_at IS NOT NULL`);
    for (const item of rows) {
      if (Number(item.expires_at) <= Date.now()) {
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
  return withReady(async () => {
    const { rows } = await pool.query(`SELECT data FROM applybot_applications`);
    return rows.map((r) => r.data);
  });
}

async function saveApp(appData) {
  return withReady(async () => {
    await pool.query(
      `INSERT INTO applybot_applications (id, data) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
      [appData.id, appData]
    );
  });
}

async function getAppById(id) {
  return withReady(async () => {
    const { rows } = await pool.query(`SELECT data FROM applybot_applications WHERE id = $1`, [id.toUpperCase()]);
    return rows[0]?.data ?? null;
  });
}

function generateAppId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let suffix = "";
  for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  return "APP-" + suffix;
}

async function getPendingJoins() {
  return withReady(async () => {
    const { rows } = await pool.query(`SELECT data FROM applybot_pending_joins`);
    return rows.map((r) => r.data);
  });
}

async function addPendingJoin(entry) {
  return withReady(async () => {
    await pool.query(
      `INSERT INTO applybot_pending_joins (user_id, data) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data`,
      [entry.userId, entry]
    );
  });
}

async function removePendingJoin(userId) {
  return withReady(async () => {
    await pool.query(`DELETE FROM applybot_pending_joins WHERE user_id = $1`, [userId]);
  });
}

async function getJoinTimeoutMs() {
  const cfg = await getConfig();
  return cfg.joinTimeoutMs ?? DEFAULT_JOIN_TIMEOUT;
}

module.exports = {
  DEFAULT_JOIN_TIMEOUT,
  HARDCODED_STAFF_GUILD_ID,
  init,
  getPool: () => pool,
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
