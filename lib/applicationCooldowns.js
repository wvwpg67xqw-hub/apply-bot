const { init, getPool } = require("./db");

// Table is created in lib/db.js init() alongside the other tables.

/**
 * Set (or overwrite) a 3-week cooldown for a user.
 *
 * @param {string} userId
 * @param {{ type: string, reapplyAt: number }} opts
 */
async function setApplicationCooldown(userId, { type, reapplyAt }) {
  await init();
  await getPool().query(
    `INSERT INTO application_cooldowns (user_id, reapply_at, role_type)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE reapply_at = ?, role_type = ?`,
    [userId, reapplyAt, type, reapplyAt, type]
  );
}

/**
 * Get the active cooldown for a user, or null if none / already expired.
 *
 * @param {string} userId
 * @returns {{ reapplyAt: number, roleType: string } | null}
 */
// _roleType accepted for call-site compatibility but cooldown is global per user
async function getApplicationCooldown(userId, _roleType) {
  await init();
  const [rows] = await getPool().query(
    "SELECT reapply_at, role_type FROM application_cooldowns WHERE user_id = ?",
    [userId]
  );
  if (!rows[0]) return null;

  const reapplyAt = Number(rows[0].reapply_at);

  // Cooldown has already passed — treat as none
  if (Date.now() > reapplyAt) return null;

  return { reapplyAt, roleType: rows[0].role_type };
}

module.exports = { setApplicationCooldown, getApplicationCooldown };
