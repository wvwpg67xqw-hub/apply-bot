const { ChannelType } = require("discord.js");
const log = require("../utils/logger");
const { getConfig } = require("./db");

// ─── Staff invite — cached, auto-rotating every 24 hr ────────────────────────

let _cachedInviteUrl    = null;
let _inviteRefreshTimer = null;

async function _buildInvite(client) {
  const cfg = getConfig();
  if (!cfg.staffGuildId) return null;
  const staffGuild = client.guilds.cache.get(cfg.staffGuildId);
  if (!staffGuild) return null;

  let channel = null;
  if (cfg.inviteChannelId) {
    channel = staffGuild.channels.cache.get(cfg.inviteChannelId) ?? null;
  }
  if (!channel) {
    channel = staffGuild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText &&
             c.permissionsFor(staffGuild.members.me)?.has("CreateInstantInvite")
    ) ?? null;
  }
  if (!channel) return null;

  try {
    const invite = await channel.createInvite({
      maxAge:  86400,
      maxUses: 1,
      unique:  true,
      reason:  "Staff application acceptance — single-use 24 hour rotating invite",
    });
    log.info("INVITE", `Generated invite ${invite.code} → #${invite.channel.name} (1 use, 24 hr)`);
    return invite.url;
  } catch (err) {
    log.error("INVITE", "Failed to generate invite", err.message);
    return null;
  }
}

async function startInviteRotation(client) {
  if (_inviteRefreshTimer) clearInterval(_inviteRefreshTimer);
  _cachedInviteUrl = await _buildInvite(client);

  _inviteRefreshTimer = setInterval(async () => {
    log.info("INVITE", "24-hr rotation — generating new invite...");
    _cachedInviteUrl = await _buildInvite(client);
  }, 24 * 60 * 60 * 1000);
}

async function generateStaffInvite(client) {
  // If the cached invite was already consumed (1-use), build a fresh one immediately
  if (!_cachedInviteUrl) _cachedInviteUrl = await _buildInvite(client);
  const url = _cachedInviteUrl;
  _cachedInviteUrl = null;               // mark consumed — next call rebuilds
  _buildInvite(client).then(u => { _cachedInviteUrl = u; }); // pre-warm next
  return url;
}

module.exports = { startInviteRotation, generateStaffInvite };
