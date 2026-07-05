'use strict';

const mysql = require('mysql2/promise');

// ─────────────────────────────────────────────
// SHARED MYSQL POOL (same database as the main app)
// ─────────────────────────────────────────────

if (global.__ADBOT_DATABASE__) {
  module.exports = global.__ADBOT_DATABASE__;
  return;
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

function generateCaseId() {
  return `#${Date.now().toString(36).toUpperCase()}`;
}

function parseJSON(v) {
  if (v == null) return [];
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch {
    return [];
  }
}

async function safeRun(sql, params = []) {
  try {
    const [result] = await pool.query(sql, params);
    return result;
  } catch (err) {
    console.error('[MySQL RUN]', err.message);
    return null;
  }
}

async function safeGet(sql, params = []) {
  try {
    const [rows] = await pool.query(sql, params);
    return rows[0] || null;
  } catch (err) {
    console.error('[MySQL GET]', err.message);
    return null;
  }
}

async function safeAll(sql, params = []) {
  try {
    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (err) {
    console.error('[MySQL ALL]', err.message);
    return [];
  }
}

// ─────────────────────────────────────────────
// TABLES (own set, prefixed to avoid clashing with the apply-bot's tables)
// ─────────────────────────────────────────────

async function initTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS adbot_guild_config (
      guild_id VARCHAR(32) PRIMARY KEY,
      type VARCHAR(16) DEFAULT 'network',
      general_log_channel VARCHAR(32),
      warn_log_channel VARCHAR(32),
      ad_warn_log_channel VARCHAR(32),
      ban_request_channel VARCHAR(32),
      blacklist_request_channel VARCHAR(32),
      network_ban_request_channel VARCHAR(32),
      partnership_request_channel VARCHAR(32),
      partnership_accepted_channel VARCHAR(32),
      jail_role VARCHAR(32),
      updated_at BIGINT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS adbot_guild_roles (
      guild_id VARCHAR(32) NOT NULL,
      field VARCHAR(64) NOT NULL,
      role_ids TEXT,
      PRIMARY KEY (guild_id, field)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS adbot_guilds (
      guild_id VARCHAR(32) PRIMARY KEY,
      ad_channels TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS adbot_warns (
      id INT AUTO_INCREMENT PRIMARY KEY,
      case_id VARCHAR(32) UNIQUE,
      guild_id VARCHAR(32),
      user_id VARCHAR(32),
      moderator_id VARCHAR(32),
      reason TEXT,
      timestamp BIGINT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS adbot_strikes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      case_id VARCHAR(32) UNIQUE,
      guild_id VARCHAR(32),
      user_id VARCHAR(32),
      moderator_id VARCHAR(32),
      reason TEXT,
      timestamp BIGINT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS adbot_ad_warns (
      id INT AUTO_INCREMENT PRIMARY KEY,
      case_id VARCHAR(32) UNIQUE,
      guild_id VARCHAR(32),
      user_id VARCHAR(32),
      moderator_id VARCHAR(32),
      reason TEXT,
      deleted_message_id VARCHAR(32),
      deleted_content TEXT,
      timestamp BIGINT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS adbot_message_counts (
      guild_id VARCHAR(32) NOT NULL,
      user_id VARCHAR(32) NOT NULL,
      count INT DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS adbot_snipe_cache (
      guild_id VARCHAR(32) NOT NULL,
      channel_id VARCHAR(32) NOT NULL,
      user_id VARCHAR(32),
      content TEXT,
      timestamp BIGINT,
      PRIMARY KEY (guild_id, channel_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS adbot_breaks (
      id INT AUTO_INCREMENT PRIMARY KEY,
      guild_id VARCHAR(32),
      user_id VARCHAR(32),
      reason TEXT,
      started_at BIGINT,
      ended_at BIGINT,
      completed TINYINT DEFAULT 0
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS adbot_break_roles (
      user_id VARCHAR(32) PRIMARY KEY,
      role_ids TEXT,
      created_at BIGINT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS adbot_jail (
      id INT AUTO_INCREMENT PRIMARY KEY,
      guild_id VARCHAR(32),
      user_id VARCHAR(32),
      moderator_id VARCHAR(32),
      reason TEXT,
      roles TEXT,
      jailed_at BIGINT,
      unjailed_at BIGINT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS adbot_balance (
      guild_id VARCHAR(32) NOT NULL,
      user_id VARCHAR(32) NOT NULL,
      amount INT DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    )
  `);
}

const ready = initTables().catch(err => {
  console.error('[AdBot DB] Failed to initialize tables:', err.message);
});

// ─────────────────────────────────────────────
// GUILD CONFIG
// ─────────────────────────────────────────────

async function getGuild(guildId) {
  await ready;
  return safeGet(`SELECT * FROM adbot_guild_config WHERE guild_id = ?`, [guildId]);
}

async function upsertGuild(guildId, data) {
  await ready;
  const fields = Object.keys(data);
  if (fields.length === 0) return;
  if (data.type === 'staff') {
    await safeRun(`UPDATE adbot_guild_config SET type = 'network' WHERE type = 'staff' AND guild_id != ?`, [guildId]);
  }
  const sets = fields.map(f => `${f} = VALUES(${f})`).join(', ');
  const cols = ['guild_id', ...fields, 'updated_at'];
  const values = [guildId, ...fields.map(f => data[f]), Date.now()];
  await safeRun(
    `INSERT INTO adbot_guild_config (${cols.join(', ')})
     VALUES (${cols.map(() => '?').join(', ')})
     ON DUPLICATE KEY UPDATE ${sets}, updated_at = VALUES(updated_at)`,
    values
  );
}

async function getMainGuildIds() {
  await ready;
  const rows = await safeAll(`SELECT guild_id FROM adbot_guild_config WHERE type = 'main'`);
  return rows.map(r => r.guild_id);
}

async function getStaffGuildId() {
  await ready;
  const row = await safeGet(`SELECT guild_id FROM adbot_guild_config WHERE type = 'staff' LIMIT 1`);
  return row ? row.guild_id : null;
}

// ─────────────────────────────────────────────
// GUILD ROLES
// ─────────────────────────────────────────────

async function getGuildRoles(guildId, field) {
  await ready;
  const row = await safeGet(`SELECT role_ids FROM adbot_guild_roles WHERE guild_id = ? AND field = ?`, [guildId, field]);
  return row ? parseJSON(row.role_ids) : [];
}

async function setGuildRoles(guildId, field, roleIds) {
  await ready;
  await safeRun(
    `INSERT INTO adbot_guild_roles (guild_id, field, role_ids) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE role_ids = VALUES(role_ids)`,
    [guildId, field, JSON.stringify(roleIds)]
  );
}

async function getGuildCommandPermissions(guildId) {
  await ready;
  const rows = await safeAll(`SELECT field, role_ids FROM adbot_guild_roles WHERE guild_id = ?`, [guildId]);
  const result = {};
  for (const row of rows) {
    const cmd = row.field.replace(/_roles$/, '').replace(/_/g, '-');
    result[cmd] = parseJSON(row.role_ids);
  }
  return result;
}

// ─────────────────────────────────────────────
// AD CHANNELS
// ─────────────────────────────────────────────

async function getAdChannels(guildId) {
  await ready;
  const row = await safeGet(`SELECT ad_channels FROM adbot_guilds WHERE guild_id = ?`, [guildId]);
  return row ? parseJSON(row.ad_channels) : [];
}

async function addAdChannel(guildId, channelId) {
  await ready;
  const existing = await getAdChannels(guildId);
  if (existing.includes(channelId)) return false;
  const updated = [...existing, channelId];
  await safeRun(
    `INSERT INTO adbot_guilds (guild_id, ad_channels) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE ad_channels = VALUES(ad_channels)`,
    [guildId, JSON.stringify(updated)]
  );
  return true;
}

async function removeAdChannel(guildId, channelId) {
  await ready;
  const existing = await getAdChannels(guildId);
  const updated = existing.filter(id => id !== channelId);
  await safeRun(
    `INSERT INTO adbot_guilds (guild_id, ad_channels) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE ad_channels = VALUES(ad_channels)`,
    [guildId, JSON.stringify(updated)]
  );
}

// ─────────────────────────────────────────────
// WARNS
// ─────────────────────────────────────────────

async function addWarn(guildId, userId, moderatorId, reason) {
  await ready;
  const caseId = generateCaseId();
  await safeRun(
    `INSERT INTO adbot_warns (case_id, guild_id, user_id, moderator_id, reason, timestamp) VALUES (?, ?, ?, ?, ?, ?)`,
    [caseId, guildId, userId, moderatorId, reason, Date.now()]
  );
  return caseId;
}

async function getWarns(guildId, userId) {
  await ready;
  return safeAll(`SELECT * FROM adbot_warns WHERE guild_id = ? AND user_id = ? ORDER BY timestamp DESC`, [guildId, userId]);
}

async function getWarnLeaderboard(guildId) {
  await ready;
  return safeAll(
    `SELECT user_id, COUNT(*) as count FROM adbot_warns WHERE guild_id = ? GROUP BY user_id ORDER BY count DESC LIMIT 10`,
    [guildId]
  );
}

// ─────────────────────────────────────────────
// AD WARNS
// ─────────────────────────────────────────────

async function addAdWarn(guildId, userId, moderatorId, reason, deletedMessageId, deletedContent) {
  await ready;
  const caseId = generateCaseId();
  await safeRun(
    `INSERT INTO adbot_ad_warns (case_id, guild_id, user_id, moderator_id, reason, deleted_message_id, deleted_content, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [caseId, guildId, userId, moderatorId, reason, deletedMessageId || null, deletedContent || null, Date.now()]
  );
  return caseId;
}

async function removeLatestAdWarn(guildId, userId) {
  await ready;
  const row = await safeGet(
    `SELECT id, case_id FROM adbot_ad_warns WHERE guild_id = ? AND user_id = ? ORDER BY timestamp DESC LIMIT 1`,
    [guildId, userId]
  );
  if (!row) return null;
  await safeRun(`DELETE FROM adbot_ad_warns WHERE id = ?`, [row.id]);
  return row.case_id;
}

// ─────────────────────────────────────────────
// STRIKES
// ─────────────────────────────────────────────

async function addStrike(guildId, userId, moderatorId, reason) {
  await ready;
  const caseId = generateCaseId();
  await safeRun(
    `INSERT INTO adbot_strikes (case_id, guild_id, user_id, moderator_id, reason, timestamp) VALUES (?, ?, ?, ?, ?, ?)`,
    [caseId, guildId, userId, moderatorId, reason, Date.now()]
  );
  return caseId;
}

async function getStrikes(guildId, userId) {
  await ready;
  return safeAll(`SELECT * FROM adbot_strikes WHERE guild_id = ? AND user_id = ? ORDER BY timestamp DESC`, [guildId, userId]);
}

async function removeStrike(caseId, guildId) {
  await ready;
  const row = await safeGet(`SELECT id FROM adbot_strikes WHERE case_id = ? AND guild_id = ?`, [caseId, guildId]);
  if (!row) return false;
  await safeRun(`DELETE FROM adbot_strikes WHERE id = ?`, [row.id]);
  return true;
}

async function removeLatestStrike(guildId, userId) {
  await ready;
  const row = await safeGet(
    `SELECT id, case_id FROM adbot_strikes WHERE guild_id = ? AND user_id = ? ORDER BY timestamp DESC LIMIT 1`,
    [guildId, userId]
  );
  if (!row) return null;
  await safeRun(`DELETE FROM adbot_strikes WHERE id = ?`, [row.id]);
  return row.case_id;
}

// ─────────────────────────────────────────────
// JAIL
// ─────────────────────────────────────────────

async function jailUser(guildId, userId, moderatorId, reason, roles) {
  await ready;
  await safeRun(
    `INSERT INTO adbot_jail (guild_id, user_id, moderator_id, reason, roles, jailed_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [guildId, userId, moderatorId, reason, JSON.stringify(roles || []), Date.now()]
  );
}

async function unjailUser(guildId, userId) {
  await ready;
  const row = await safeGet(
    `SELECT * FROM adbot_jail WHERE guild_id = ? AND user_id = ? AND unjailed_at IS NULL ORDER BY jailed_at DESC LIMIT 1`,
    [guildId, userId]
  );
  if (!row) return null;
  await safeRun(`UPDATE adbot_jail SET unjailed_at = ? WHERE id = ?`, [Date.now(), row.id]);
  return { ...row, roles: parseJSON(row.roles) };
}

// ─────────────────────────────────────────────
// MESSAGE COUNTS
// ─────────────────────────────────────────────

async function incrementMessageCount(guildId, userId) {
  await ready;
  await safeRun(
    `INSERT INTO adbot_message_counts (guild_id, user_id, count) VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE count = count + 1`,
    [guildId, userId]
  );
}

async function getMessageCount(guildId, userId) {
  await ready;
  const row = await safeGet(`SELECT count FROM adbot_message_counts WHERE guild_id = ? AND user_id = ?`, [guildId, userId]);
  return row ? row.count : 0;
}

async function getMessageLeaderboard(guildId) {
  await ready;
  return safeAll(
    `SELECT user_id, count FROM adbot_message_counts WHERE guild_id = ? ORDER BY count DESC LIMIT 10`,
    [guildId]
  );
}

async function resetMessageCount(guildId, userId) {
  await ready;
  await safeRun(`DELETE FROM adbot_message_counts WHERE guild_id = ? AND user_id = ?`, [guildId, userId]);
}

async function resetAllMessageCounts(guildId) {
  await ready;
  await safeRun(`DELETE FROM adbot_message_counts WHERE guild_id = ?`, [guildId]);
}

// ─────────────────────────────────────────────
// SNIPE CACHE
// ─────────────────────────────────────────────

async function setSnipe(guildId, channelId, userId, content) {
  await ready;
  await safeRun(
    `INSERT INTO adbot_snipe_cache (guild_id, channel_id, user_id, content, timestamp) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), content = VALUES(content), timestamp = VALUES(timestamp)`,
    [guildId, channelId, userId, content, Date.now()]
  );
}

async function getSnipe(guildId, channelId) {
  await ready;
  return safeGet(`SELECT * FROM adbot_snipe_cache WHERE guild_id = ? AND channel_id = ?`, [guildId, channelId]);
}

// ─────────────────────────────────────────────
// BALANCE
// ─────────────────────────────────────────────

async function getBalance(guildId, userId) {
  await ready;
  const row = await safeGet(`SELECT amount FROM adbot_balance WHERE guild_id = ? AND user_id = ?`, [guildId, userId]);
  return row ? row.amount : 0;
}

// ─────────────────────────────────────────────
// CASE INFO
// ─────────────────────────────────────────────

async function getCaseInfo(caseId, guildId) {
  await ready;
  const warn = await safeGet(`SELECT *, 'warn' as type FROM adbot_warns WHERE case_id = ? AND guild_id = ?`, [caseId, guildId]);
  if (warn) return warn;
  const strike = await safeGet(`SELECT *, 'strike' as type FROM adbot_strikes WHERE case_id = ? AND guild_id = ?`, [caseId, guildId]);
  if (strike) return strike;
  const adWarn = await safeGet(`SELECT *, 'ad_warn' as type FROM adbot_ad_warns WHERE case_id = ? AND guild_id = ?`, [caseId, guildId]);
  return adWarn || null;
}

// ─────────────────────────────────────────────
// BREAK ROLES
// ─────────────────────────────────────────────

async function saveBreakRoles(userId, roleIds) {
  await ready;
  await safeRun(
    `INSERT INTO adbot_break_roles (user_id, role_ids, created_at) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE role_ids = VALUES(role_ids), created_at = VALUES(created_at)`,
    [userId, JSON.stringify(roleIds), Date.now()]
  );
}

async function getBreakRoles(userId) {
  await ready;
  const row = await safeGet(`SELECT role_ids FROM adbot_break_roles WHERE user_id = ?`, [userId]);
  return row ? parseJSON(row.role_ids) : [];
}

async function deleteBreakRoles(userId) {
  await ready;
  await safeRun(`DELETE FROM adbot_break_roles WHERE user_id = ?`, [userId]);
}

// ─────────────────────────────────────────────
// BREAK SYSTEM
// ─────────────────────────────────────────────

async function startBreak(guildId, userId, reason) {
  await ready;
  await safeRun(
    `INSERT INTO adbot_breaks (guild_id, user_id, reason, started_at) VALUES (?, ?, ?, ?)`,
    [guildId, userId, reason || '', Date.now()]
  );
}

async function insertTimedBreak(guildId, userId, reason, startedAt, endedAt) {
  await ready;
  await safeRun(
    `INSERT INTO adbot_breaks (guild_id, user_id, reason, started_at, ended_at) VALUES (?, ?, ?, ?, ?)`,
    [guildId, userId, reason, startedAt, endedAt]
  );
}

async function endBreak(guildId, userId) {
  await ready;
  await safeRun(
    `UPDATE adbot_breaks
     SET ended_at = ?
     WHERE guild_id = ?
     AND user_id = ?
     AND ended_at IS NULL
     AND completed = 0`,
    [Date.now(), guildId, userId]
  );
}

async function getCurrentBreaks(guildId) {
  await ready;
  return safeAll(
    `SELECT * FROM adbot_breaks WHERE guild_id = ? AND completed = 0 AND ended_at IS NULL`,
    [guildId]
  );
}

async function getExpiredBreaks() {
  await ready;
  return safeAll(
    `SELECT * FROM adbot_breaks WHERE completed = 0 AND ended_at IS NOT NULL AND ended_at <= ?`,
    [Date.now()]
  );
}

async function markBreakCompleted(id) {
  await ready;
  await safeRun(
    `UPDATE adbot_breaks SET completed = 1 WHERE id = ?`,
    [id]
  );
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────

const exported = {
  pool,
  ready,

  safeRun,
  safeGet,
  safeAll,

  parseJSON,
  generateCaseId,

  getGuild,
  upsertGuild,
  getMainGuildIds,
  getStaffGuildId,

  getGuildRoles,
  setGuildRoles,
  getGuildCommandPermissions,

  getAdChannels,
  addAdChannel,
  removeAdChannel,

  addWarn,
  getWarns,
  getWarnLeaderboard,

  addAdWarn,
  removeLatestAdWarn,

  addStrike,
  getStrikes,
  removeStrike,
  removeLatestStrike,

  jailUser,
  unjailUser,

  incrementMessageCount,
  getMessageCount,
  getMessageLeaderboard,
  resetMessageCount,
  resetAllMessageCounts,

  setSnipe,
  getSnipe,

  getBalance,

  getCaseInfo,

  saveBreakRoles,
  getBreakRoles,
  deleteBreakRoles,

  startBreak,
  insertTimedBreak,
  endBreak,
  getCurrentBreaks,
  getExpiredBreaks,
  markBreakCompleted,
};

global.__ADBOT_DATABASE__ = exported;
module.exports = exported;
