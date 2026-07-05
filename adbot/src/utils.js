'use strict';

const { EmbedBuilder, Colors } = require('discord.js');

const SETUP_ALLOWED_ROLE = '1495222842365710388';
const OWNER_ROLES = ['1495222842365710388', '1495222841900007594']; // owner, co-owner

// ── Safe fetchers ──────────────────────────────────────────────────────────
async function safeFetchMember(guild, userId) {
  if (!guild || !userId) return null;
  try { return await guild.members.fetch(userId); } catch { return null; }
}

async function safeFetchUser(client, userId) {
  if (!client || !userId) return null;
  try { return await client.users.fetch(userId); } catch { return null; }
}

async function safeFetchChannel(guild, channelId) {
  if (!guild || !channelId) return null;
  try {
    return guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId);
  } catch { return null; }
}

async function safeFetchRole(guild, roleId) {
  if (!guild || !roleId) return null;
  try {
    return guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId);
  } catch { return null; }
}

// ── Permission helpers ─────────────────────────────────────────────────────
function isOwnerOrCoOwner(member) {
  if (!member) return false;
  return OWNER_ROLES.some(id => member.roles.cache.has(id)) || member.permissions.has('Administrator');
}

function hasPermission(member, allowedRoles) {
  if (!member) return false;
  // Owner and co-owner bypass all role restrictions
  if (isOwnerOrCoOwner(member)) return true;
  const roles = Array.isArray(allowedRoles) ? allowedRoles : (() => {
    try { return JSON.parse(allowedRoles || '[]'); } catch { return []; }
  })();
  if (!roles || roles.length === 0) return false;
  return roles.some(id => member.roles.cache.has(id));
}

function hasSetupPermission(member) {
  if (!member) return false;
  return isOwnerOrCoOwner(member);
}

// ── Logging helpers ────────────────────────────────────────────────────────
async function sendToChannel(guild, channelId, payload) {
  if (!guild || !channelId) return false;
  try {
    const ch = await safeFetchChannel(guild, channelId);
    if (!ch || !ch.isTextBased()) return false;
    await ch.send(payload);
    return true;
  } catch { return false; }
}

async function sendToLogs(guild, guildConfig, specificChannelId, payload) {
  const tasks = [];
  if (guildConfig?.general_log_channel) {
    tasks.push(sendToChannel(guild, guildConfig.general_log_channel, payload));
  }
  if (specificChannelId && specificChannelId !== guildConfig?.general_log_channel) {
    tasks.push(sendToChannel(guild, specificChannelId, payload));
  }
  await Promise.allSettled(tasks);
}

// ── Duration parser ────────────────────────────────────────────────────────
function parseDuration(str) {
  if (!str) return null;
  const match = String(str).match(/^(\d+)(s|m|h|d|w)$/i);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const map = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
  const ms = n * (map[unit] || 0);
  if (ms < 5000 || ms > 2419200000) return null;
  return ms;
}

function formatDuration(ms) {
  if (!ms) return 'unknown';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  return parts.join(' ') || '<1m';
}

function formatTimestamp(ts) {
  const unix = typeof ts === 'number' ? ts : Math.floor(Date.now() / 1000);
  return `<t:${unix}:F>`;
}

// ── User display ───────────────────────────────────────────────────────────
function displayUser(user) {
  if (!user) return 'Unknown User';
  const tag = user.tag || user.username || user.id || 'Unknown';
  const id = user.id || '?';
  return `${tag} (${id})`;
}

// ── Embed builders ─────────────────────────────────────────────────────────
function buildEmbed({ title, description, color, fields, footer, image, thumbnail }) {
  const embed = new EmbedBuilder()
    .setTitle(title || '\u200b')
    .setColor(color || Colors.Blurple)
    .setTimestamp();
  if (description) embed.setDescription(description);
  if (fields?.length) embed.addFields(fields.filter(f => f?.name && f?.value));
  if (footer) embed.setFooter({ text: String(footer) });
  if (image) embed.setImage(image);
  if (thumbnail) embed.setThumbnail(thumbnail);
  return embed;
}

function buildWarnEmbed({ target, moderator, reason, caseId, warnCount }) {
  return buildEmbed({
    title: '⚠️ Warning Issued',
    color: Colors.Yellow,
    fields: [
      { name: 'User', value: displayUser(target), inline: true },
      { name: 'Moderator', value: displayUser(moderator), inline: true },
      { name: 'Reason', value: reason || 'No reason provided', inline: false },
      { name: 'Case ID', value: String(caseId || 'N/A'), inline: true },
      { name: 'Total Warns', value: String(warnCount ?? 0), inline: true },
    ],
    footer: `Case ID: ${caseId || 'N/A'}`,
  });
}

function buildAdWarnEmbed({ target, moderator, reason, caseId, deletedMessageId, deletedContent }) {
  const fields = [
    { name: 'User', value: displayUser(target), inline: true },
    { name: 'Moderator', value: displayUser(moderator), inline: true },
    { name: 'Reason', value: reason || 'No reason provided', inline: false },
    { name: 'Case ID', value: String(caseId || 'N/A'), inline: true },
  ];
  if (deletedMessageId) fields.push({ name: 'Deleted Message ID', value: `\`${deletedMessageId}\``, inline: true });
  if (deletedContent) fields.push({ name: 'Deleted Message Content', value: deletedContent.length > 1024 ? deletedContent.slice(0, 1021) + '...' : deletedContent, inline: false });
  return buildEmbed({
    title: '📢 Advertisement Warning',
    color: Colors.Orange,
    fields,
    footer: `Case ID: ${caseId || 'N/A'}`,
  });
}

function buildStrikeEmbed({ target, moderator, reason, caseId, strikeCount, severity }) {
  const fields = [
    { name: 'User', value: displayUser(target), inline: true },
    { name: 'Moderator', value: displayUser(moderator), inline: true },
    { name: 'Reason', value: reason || 'No reason provided', inline: false },
    { name: 'Case ID', value: String(caseId || 'N/A'), inline: true },
    { name: 'Total Strikes', value: String(strikeCount ?? 0), inline: true },
  ];
  if (severity) fields.push({ name: 'Severity', value: severity, inline: true });
  return buildEmbed({
    title: '⚡ Strike Issued',
    color: Colors.Red,
    fields,
    footer: `Case ID: ${caseId || 'N/A'}`,
  });
}

function buildRequestEmbed({ type, target, moderator, reason, imageUrl, message, extra }) {
  const configs = {
    ban: { title: '🔨 Ban Request', color: Colors.Red },
    blacklist: { title: '🚫 Blacklist Request', color: Colors.DarkRed },
    'network-ban': { title: '🌐 Network Ban Request', color: Colors.DarkOrange },
    partnership: { title: '🤝 Partnership Request', color: Colors.Green },
  };
  const cfg = configs[type] || { title: 'Request', color: Colors.Grey };
  const fields = [];
  if (target) fields.push({ name: 'User', value: displayUser(target), inline: true });
  if (moderator) fields.push({ name: 'Requested By', value: displayUser(moderator), inline: true });
  if (reason) fields.push({ name: 'Reason', value: reason, inline: false });
  if (message) fields.push({ name: 'Message', value: message, inline: false });
  if (extra) fields.push({ name: 'Details', value: extra, inline: false });
  return buildEmbed({ title: cfg.title, color: cfg.color, fields, image: imageUrl || null });
}

// ── Safe reply ─────────────────────────────────────────────────────────────
async function safeReply(interaction, options) {
  try {
    if (interaction.replied || interaction.deferred) return await interaction.editReply(options);
    return await interaction.reply(options);
  } catch { /* silently ignore double-reply */ }
}

async function replyNoPermission(interaction, cmd) {
  return safeReply(interaction, {
    embeds: [buildEmbed({ title: '❌ Access Denied', description: `You don't have the required role to use **/${cmd}**.`, color: Colors.Red })],
    ephemeral: true,
  });
}

async function replyError(interaction, msg) {
  return safeReply(interaction, {
    embeds: [buildEmbed({ title: '❌ Error', description: String(msg || 'An unexpected error occurred.'), color: Colors.Red })],
    ephemeral: true,
  });
}

async function replySuccess(interaction, msg) {
  return safeReply(interaction, {
    embeds: [buildEmbed({ title: '✅ Success', description: String(msg), color: Colors.Green })],
    ephemeral: true,
  });
}

module.exports = {
  SETUP_ALLOWED_ROLE,
  safeFetchMember,
  safeFetchUser,
  safeFetchChannel,
  safeFetchRole,
  hasPermission,
  hasSetupPermission,
  sendToChannel,
  sendToLogs,
  parseDuration,
  formatDuration,
  formatTimestamp,
  displayUser,
  buildEmbed,
  buildWarnEmbed,
  buildAdWarnEmbed,
  buildStrikeEmbed,
  buildRequestEmbed,
  safeReply,
  replyNoPermission,
  replyError,
  replySuccess,
};
