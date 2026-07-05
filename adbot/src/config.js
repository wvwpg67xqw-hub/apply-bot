const db = require('./database');

const MAIN_GUILD_IDS = (process.env.MAIN_GUILD_IDS || process.env.MAIN_GUILD_ID || '')
  .split(',').map(s => s.trim()).filter(Boolean);

async function getStaffGuildId() {
  const dbStaffId = await db.getStaffGuildId();
  return dbStaffId || process.env.STAFF_GUILD_ID || null;
}

module.exports = {
  MAIN_GUILD_ID:   MAIN_GUILD_IDS[0] || null,
  MAIN_GUILD_IDS,
  getStaffGuildId,
  PROTECTED_ROLE_ID: process.env.PROTECTED_ROLE_ID,
};
