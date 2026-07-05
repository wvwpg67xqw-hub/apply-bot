const config = require('../config');
const db     = require('../database');

async function getMainGuildIds() {
  const envIds = (process.env.MAIN_GUILD_IDS || config.MAIN_GUILD_ID || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const dbIds = await db.getMainGuildIds();
  return [...new Set([...envIds, ...dbIds])];
}

async function fireUser(client, user, actorTag) {
  const mainGuildIds = await getMainGuildIds();

  // Remove roles in every main server
  for (const guildId of mainGuildIds) {
    try {
      const guild = client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId).catch(() => null);
      if (!guild) continue;

      const member = await guild.members.fetch(user.id).catch(() => null);
      if (!member) continue;

      const rolesToKeep = member.roles.cache.filter(
        r => r.id === config.PROTECTED_ROLE_ID || r.managed
      );

      await member.roles.set(rolesToKeep);
      console.log(`[FIRE] Removed roles from ${user.tag} in ${guild.name}`);
    } catch (err) {
      console.error(`[FIRE] Error in guild ${guildId}:`, err.message);
    }
  }

  // Kick from staff server
  try {
    const staffGuildId = await config.getStaffGuildId();
    const staffGuild = client.guilds.cache.get(staffGuildId)
      ?? await client.guilds.fetch(staffGuildId).catch(() => null);

    if (staffGuild) {
      const staffMember = await staffGuild.members.fetch(user.id).catch(() => null);
      if (staffMember) {
        await staffMember.kick(`Fired by ${actorTag}`);
        console.log(`[FIRE] Kicked ${user.tag} from staff server`);
      }
    }
  } catch (err) {
    console.error('[FIRE] Staff guild error:', err.message);
  }
}

module.exports = { fireUser };
