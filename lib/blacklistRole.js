const { EmbedBuilder } = require("discord.js");
const log = require("../utils/logger");
const { getServerConfig } = require("./serverConfig");

const BLACKLIST_LOG_CHANNEL = "1492165517279232090";

// ─── Blacklist log helper ─────────────────────────────────────────────────────

async function sendBlacklistLog(clientRef, { applicantId, applicantTag, roleLabel, roleEmoji, sourceGuildName, moderator, reason, appId, expiresAt }) {
  try {
    const ch = await clientRef.channels.fetch(BLACKLIST_LOG_CHANNEL);
    if (!ch?.isTextBased()) return;
    const userValue = applicantTag
      ? `<@${applicantId}> (${applicantTag})\nID: \`${applicantId}\``
      : `<@${applicantId}>\nID: \`${applicantId}\``;
    const embed = new EmbedBuilder()
      .setTitle("🚫 User Blacklisted")
      .setColor(0x000000)
      .addFields(
        { name: "User",    value: userValue,                       inline: false },
        { name: "Server",  value: sourceGuildName,                 inline: true },
        { name: "Role",    value: `${roleEmoji} ${roleLabel}`,     inline: true },
        { name: "By",      value: moderator,                       inline: true },
      )
      .setTimestamp();
    if (appId)     embed.addFields({ name: "App ID",   value: `\`${appId}\``,                                          inline: true });
    if (expiresAt) embed.addFields({ name: "Expires",  value: `<t:${Math.floor(expiresAt / 1000)}:R>`,                 inline: true });
    else           embed.addFields({ name: "Duration", value: "Permanent",                                             inline: true });
    if (reason)    embed.addFields({ name: "Reason",   value: reason,                                                   inline: false });
    await ch.send({ embeds: [embed] });
    log.info("BLACKLIST", `Log posted to channel ${BLACKLIST_LOG_CHANNEL}`);
  } catch (err) {
    log.error("BLACKLIST", "Failed to post to blacklist log channel", err.message);
  }
}

// ─── Staff blacklist role (per-server) ────────────────────────────────────────
// Each advertising server has its own "blacklist" role. If a member holds that
// role in a given server, they are treated as blacklisted there — regardless of
// whether they're in the guilds.json blacklist list. When a user is manually
// blacklisted (via /blacklist or the review panel's Blacklist button), the bot
// automatically grants them that server's blacklist role.

async function memberHasStaffBlacklistRole(guild, userId) {
  if (!guild) return false;
  const entry = getServerConfig(guild.name, guild.id);
  if (!entry?.blacklistRoleId) return false;
  let member = null;
  try { member = await guild.members.fetch(userId); } catch { return false; }
  return member.roles.cache.has(entry.blacklistRoleId);
}

async function applyStaffBlacklistRole(guild, userId) {
  if (!guild) return;
  const entry = getServerConfig(guild.name, guild.id);
  if (!entry?.blacklistRoleId) return;
  try {
    const member = await guild.members.fetch(userId);
    await member.roles.add(entry.blacklistRoleId);
    log.info("BLACKLIST", `Granted blacklist role ${entry.blacklistRoleId} to ${userId} in [${guild.name}]`);
  } catch (err) {
    log.warn("BLACKLIST", `Could not grant blacklist role to ${userId} in [${guild.name}]`, err.message);
  }
}

module.exports = { BLACKLIST_LOG_CHANNEL, sendBlacklistLog, memberHasStaffBlacklistRole, applyStaffBlacklistRole };
