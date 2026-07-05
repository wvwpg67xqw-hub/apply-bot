'use strict';

const { SlashCommandBuilder, EmbedBuilder, Colors, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// ── Helper: check command permission ──────────────────────────────────────
function checkPerm(interaction, db, utils, cmdKey) {
  const roles = await db.getGuildRoles(interaction.guildId, cmdKey + '_roles');
  if (!utils.hasPermission(interaction.member, roles)) {
    utils.replyNoPermission(interaction, cmdKey.replace(/_/g, '-'));
    return false;
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// MODERATION COMMANDS
// ═══════════════════════════════════════════════════════════════════════════

// ── /warn ──────────────────────────────────────────────────────────────────
const warnCmd = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Issue a warning to a user')
    .addUserOption(o => o.setName('user').setDescription('The user to warn').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for the warning').setMaxLength(500).setRequired(true)),

  async execute(interaction, db, utils, client) {
    if (!checkPerm(interaction, db, utils, 'warn')) return;

    const target = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');

    if (!target) return utils.replyError(interaction, 'Could not find that user.');

    const caseId = await db.addWarn(interaction.guildId, target.id, interaction.user.id, reason);
    const warns = await db.getWarns(interaction.guildId, target.id);
    const cfg = await db.getGuild(interaction.guildId);
    const embed = utils.buildWarnEmbed({ target, moderator: interaction.user, reason, caseId, warnCount: warns.length });

    await utils.sendToLogs(interaction.guild, cfg, cfg?.warn_log_channel, { embeds: [embed] });
    return utils.replySuccess(interaction, `${target} has been warned. Case: **${caseId}**. They now have **${warns.length}** warning(s).`);
  },
};

// ── /warns ─────────────────────────────────────────────────────────────────
const warnsCmd = {
  data: new SlashCommandBuilder()
    .setName('warns')
    .setDescription('View warning history for a user')
    .addUserOption(o => o.setName('user').setDescription('The user to check').setRequired(true)),

  async execute(interaction, db, utils) {
    if (!checkPerm(interaction, db, utils, 'warns')) return;

    const target = interaction.options.getUser('user');
    if (!target) return utils.replyError(interaction, 'Could not find that user.');

    const warns = await db.getWarns(interaction.guildId, target.id);
    if (warns.length === 0) {
      return utils.safeReply(interaction, {
        embeds: [utils.buildEmbed({ title: `⚠️ Warns for ${target.username}`, description: 'This user has no warnings.', color: Colors.Green })],
        ephemeral: true,
      });
    }

    const lines = warns.slice(0, 20).map((w, i) =>
      `**${i + 1}.** \`${w.case_id}\` — ${w.reason} *(${utils.formatTimestamp(w.timestamp)})*`
    );

    return utils.safeReply(interaction, {
      embeds: [utils.buildEmbed({
        title: `⚠️ Warns for ${target.username} (${warns.length} total)`,
        description: lines.join('\n'),
        color: Colors.Yellow,
        thumbnail: target.displayAvatarURL?.() || null,
      })],
      ephemeral: true,
    });
  },
};

// ── /warn-leaderboard ──────────────────────────────────────────────────────
const warnLeaderboardCmd = {
  data: new SlashCommandBuilder()
    .setName('warn-leaderboard')
    .setDescription('Show the top warned users in this server'),

  async execute(interaction, db, utils) {
    if (!checkPerm(interaction, db, utils, 'warn_leaderboard')) return;

    const board = await db.getWarnLeaderboard(interaction.guildId);
    if (board.length === 0) {
      return utils.safeReply(interaction, {
        embeds: [utils.buildEmbed({ title: '⚠️ Warn Leaderboard', description: 'No warnings recorded yet.', color: Colors.Grey })],
      });
    }

    const lines = board.map((r, i) => `**${i + 1}.** <@${r.user_id}> — **${r.count}** warn(s)`);
    return utils.safeReply(interaction, {
      embeds: [utils.buildEmbed({ title: '⚠️ Warn Leaderboard', description: lines.join('\n'), color: Colors.Yellow })],
    });
  },
};

// ── /ad-warn ───────────────────────────────────────────────────────────────
const adWarnCmd = {
  data: new SlashCommandBuilder()
    .setName('ad-warn')
    .setDescription('Issue an advertisement warning, optionally deleting the offending message or thread')
    .addUserOption(o => o.setName('user').setDescription('The user to ad-warn').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for the ad warning').setRequired(true))
    .addStringOption(o => o.setName('message_id').setDescription('ID of the ad message to delete and save as evidence').setRequired(false))
    .addStringOption(o => o.setName('thread_id').setDescription('ID of the ad thread to delete and save as evidence').setRequired(false))
    .addChannelOption(o => o.setName('channel').setDescription('Channel the message is in (defaults to current channel)').setRequired(false)),

  async execute(interaction, db, utils) {
    if (!checkPerm(interaction, db, utils, 'ad_warn')) return;

    const target = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');
    const messageId = interaction.options.getString('message_id');
    const threadId = interaction.options.getString('thread_id');
    const channelOpt = interaction.options.getChannel('channel');

    if (!target) return utils.replyError(interaction, 'Could not find that user.');
    if (messageId && threadId) return utils.replyError(interaction, 'Provide either a `message_id` or a `thread_id`, not both.');

    let deletedMessageId = null;
    let deletedContent = null;

    if (messageId) {
      const sourceChannel = channelOpt || interaction.channel;
      if (!sourceChannel?.messages) return utils.replyError(interaction, 'Cannot access messages in that channel.');
      try {
        const msg = await sourceChannel.messages.fetch(messageId);
        deletedMessageId = msg.id;
        const parts = [];
        if (msg.content) parts.push(msg.content);
        if (msg.attachments.size > 0) parts.push(`[${msg.attachments.size} attachment(s): ${msg.attachments.map(a => a.url).join(', ')}]`);
        if (msg.embeds.length > 0) parts.push(`[${msg.embeds.length} embed(s)]`);
        deletedContent = parts.join('\n') || '[No text content]';
        await msg.delete();
      } catch (err) {
        return utils.replyError(interaction, `Could not fetch or delete message \`${messageId}\`: ${err?.message || 'Unknown error'}. Make sure the message exists in the specified channel.`);
      }
    }

    if (threadId) {
      try {
        const thread = await interaction.guild.channels.fetch(threadId);
        if (!thread) return utils.replyError(interaction, `No thread found with ID \`${threadId}\`.`);
        deletedMessageId = thread.id;
        const starterMsg = thread.isThread?.() ? await thread.fetchStarterMessage().catch(() => null) : null;
        deletedContent = `Thread: **${thread.name}**` + (starterMsg?.content ? `\nOpening message: ${starterMsg.content}` : '');
        await thread.delete('Ad warning — deleted by moderator');
      } catch (err) {
        return utils.replyError(interaction, `Could not fetch or delete thread \`${threadId}\`: ${err?.message || 'Unknown error'}.`);
      }
    }

    const caseId = await db.addAdWarn(interaction.guildId, target.id, interaction.user.id, reason, deletedMessageId, deletedContent);
    const cfg = await db.getGuild(interaction.guildId);
    const embed = utils.buildAdWarnEmbed({ target, moderator: interaction.user, reason, caseId, deletedMessageId, deletedContent });

    await utils.sendToLogs(interaction.guild, cfg, cfg?.ad_warn_log_channel, { embeds: [embed] });
    const deletedNote = deletedMessageId ? ' The message/thread has been deleted and saved as evidence.' : '';
    return utils.replySuccess(interaction, `${target} has been issued an ad warning. Case: **${caseId}**.${deletedNote}`);
  },
};

// ── /remove-ad-warn ────────────────────────────────────────────────────────
const removeAdWarnCmd = {
  data: new SlashCommandBuilder()
    .setName('remove-ad-warn')
    .setDescription('Remove the most recent advertisement warning from a user')
    .addUserOption(o => o.setName('user').setDescription('The user to remove the ad warning from').setRequired(true)),

  async execute(interaction, db, utils) {
    if (!checkPerm(interaction, db, utils, 'remove_ad_warn')) return;

    const target = interaction.options.getUser('user');
    if (!target) return utils.replyError(interaction, 'Could not find that user.');

    const caseId = await db.removeLatestAdWarn(interaction.guildId, target.id);
    if (!caseId) return utils.replyError(interaction, `${target} has no advertisement warnings to remove.`);

    const cfg = await db.getGuild(interaction.guildId);
    const embed = utils.buildEmbed({
      title: '📢 Ad Warning Removed',
      color: Colors.Grey,
      fields: [
        { name: 'User', value: utils.displayUser(target), inline: true },
        { name: 'Case ID', value: caseId, inline: true },
        { name: 'Removed By', value: utils.displayUser(interaction.user), inline: true },
      ],
    });
    await utils.sendToLogs(interaction.guild, cfg, cfg?.ad_warn_log_channel, { embeds: [embed] });
    return utils.replySuccess(interaction, `Most recent ad warning (**${caseId}**) removed from ${target}.`);
  },
};

// ── /mute ──────────────────────────────────────────────────────────────────
const muteCmd = {
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Timeout (mute) a member')
    .addUserOption(o => o.setName('user').setDescription('Member to mute').setRequired(true))
    .addStringOption(o => o.setName('duration').setDescription('Duration e.g. 10m, 1h, 1d, 7d (max 28d)').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for mute').setRequired(false)),

  async execute(interaction, db, utils) {
    if (!checkPerm(interaction, db, utils, 'mute')) return;

    const target = interaction.options.getUser('user');
    const durationStr = interaction.options.getString('duration');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    if (!target) return utils.replyError(interaction, 'Could not find that user.');

    const ms = utils.parseDuration(durationStr);
    if (!ms) return utils.replyError(interaction, 'Invalid duration. Use format: `10m`, `1h`, `1d`, `7d`. Min: 5s, Max: 28d.');

    const member = await utils.safeFetchMember(interaction.guild, target.id);
    if (!member) return utils.replyError(interaction, 'Could not find that member in this server.');
    if (!member.moderatable) return utils.replyError(interaction, 'I cannot mute this member (they may have higher permissions).');

    try {
      await member.timeout(ms, reason);
    } catch (err) {
      return utils.replyError(interaction, `Failed to mute: ${err?.message || 'Unknown error'}`);
    }

    const cfg = await db.getGuild(interaction.guildId);
    const embed = utils.buildEmbed({
      title: '🔇 Member Muted',
      color: Colors.Orange,
      fields: [
        { name: 'User', value: utils.displayUser(target), inline: true },
        { name: 'Moderator', value: utils.displayUser(interaction.user), inline: true },
        { name: 'Duration', value: utils.formatDuration(ms), inline: true },
        { name: 'Reason', value: reason, inline: false },
      ],
    });
    await utils.sendToLogs(interaction.guild, cfg, cfg?.general_log_channel, { embeds: [embed] });
    return utils.replySuccess(interaction, `${target} has been muted for **${utils.formatDuration(ms)}**.`);
  },
};

// ── /unmute ────────────────────────────────────────────────────────────────
const unmuteCmd = {
  data: new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Remove a timeout from a member')
    .addUserOption(o => o.setName('user').setDescription('Member to unmute').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for unmute').setRequired(false)),

  async execute(interaction, db, utils) {
    if (!checkPerm(interaction, db, utils, 'unmute')) return;

    const target = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    if (!target) return utils.replyError(interaction, 'Could not find that user.');

    const member = await utils.safeFetchMember(interaction.guild, target.id);
    if (!member) return utils.replyError(interaction, 'Could not find that member in this server.');
    if (!member.isCommunicationDisabled()) return utils.replyError(interaction, 'That member is not currently muted.');

    try {
      await member.timeout(null, reason);
    } catch (err) {
      return utils.replyError(interaction, `Failed to unmute: ${err?.message || 'Unknown error'}`);
    }

    const cfg = await db.getGuild(interaction.guildId);
    const embed = utils.buildEmbed({
      title: '🔊 Member Unmuted',
      color: Colors.Green,
      fields: [
        { name: 'User', value: utils.displayUser(target), inline: true },
        { name: 'Moderator', value: utils.displayUser(interaction.user), inline: true },
        { name: 'Reason', value: reason, inline: false },
      ],
    });
    await utils.sendToLogs(interaction.guild, cfg, cfg?.general_log_channel, { embeds: [embed] });
    return utils.replySuccess(interaction, `${target} has been unmuted.`);
  },
};

// ── /ban ───────────────────────────────────────────────────────────────────
const banCmd = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member from the server')
    .addUserOption(o => o.setName('user').setDescription('Member to ban').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for ban').setRequired(true))
    .addBooleanOption(o => o.setName('delete_messages').setDescription('Delete recent messages from this user').setRequired(false)),

  async execute(interaction, db, utils) {
    if (!checkPerm(interaction, db, utils, 'ban')) return;

    const target = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');
    const deleteMessages = interaction.options.getBoolean('delete_messages') ?? false;
    if (!target) return utils.replyError(interaction, 'Could not find that user.');

    const member = await utils.safeFetchMember(interaction.guild, target.id);
    if (member && !member.bannable) return utils.replyError(interaction, 'I cannot ban this member (they may have higher permissions).');

    try {
      await interaction.guild.bans.create(target.id, { reason, deleteMessageSeconds: deleteMessages ? 604800 : 0 });
    } catch (err) {
      return utils.replyError(interaction, `Failed to ban: ${err?.message || 'Unknown error'}`);
    }

    const cfg = await db.getGuild(interaction.guildId);
    const embed = utils.buildEmbed({
      title: '🔨 Member Banned',
      color: Colors.Red,
      fields: [
        { name: 'User', value: utils.displayUser(target), inline: true },
        { name: 'Moderator', value: utils.displayUser(interaction.user), inline: true },
        { name: 'Reason', value: reason, inline: false },
      ],
    });
    await utils.sendToLogs(interaction.guild, cfg, cfg?.general_log_channel, { embeds: [embed] });
    return utils.replySuccess(interaction, `${target} has been banned.`);
  },
};

// ── /fire ──────────────────────────────────────────────────────────────────
const fireCmd = {
  data: new SlashCommandBuilder()
    .setName('fire')
    .setDescription('Remove all staff roles from a member (fire them)')
    .addUserOption(o => o.setName('user').setDescription('Member to fire').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for firing').setRequired(true)),

  async execute(interaction, db, utils) {
    if (!checkPerm(interaction, db, utils, 'fire')) return;

    const target = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');
    if (!target) return utils.replyError(interaction, 'Could not find that user.');

    const member = await utils.safeFetchMember(interaction.guild, target.id);
    if (!member) return utils.replyError(interaction, 'Could not find that member in this server.');

    const removableRoles = member.roles.cache.filter(r => r.id !== interaction.guild.id && r.managed === false && r.position < interaction.guild.members.me.roles.highest.position);
    try {
      await member.roles.remove(removableRoles, reason);
    } catch (err) {
      return utils.replyError(interaction, `Failed to remove roles: ${err?.message || 'Unknown error'}`);
    }

    const cfg = await db.getGuild(interaction.guildId);
    const embed = utils.buildEmbed({
      title: '🔥 Member Fired',
      color: Colors.DarkRed,
      fields: [
        { name: 'User', value: utils.displayUser(target), inline: true },
        { name: 'Moderator', value: utils.displayUser(interaction.user), inline: true },
        { name: 'Roles Removed', value: removableRoles.size > 0 ? removableRoles.map(r => r.name).join(', ') : 'None', inline: false },
        { name: 'Reason', value: reason, inline: false },
      ],
    });
    await utils.sendToLogs(interaction.guild, cfg, cfg?.general_log_channel, { embeds: [embed] });
    return utils.replySuccess(interaction, `${target} has been fired and all removable roles have been stripped.`);
  },
};

// ── /promote ───────────────────────────────────────────────────────────────
const promoteCmd = {
  data: new SlashCommandBuilder()
    .setName('promote')
    .setDescription('Promote a member by assigning them a role')
    .addUserOption(o => o.setName('user').setDescription('Member to promote').setRequired(true))
    .addRoleOption(o => o.setName('role').setDescription('Role to assign').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for promotion').setRequired(false)),

  async execute(interaction, db, utils) {
    if (!checkPerm(interaction, db, utils, 'promote')) return;

    const target = interaction.options.getUser('user');
    const role = interaction.options.getRole('role');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    if (!target || !role) return utils.replyError(interaction, 'Could not find user or role.');

    const member = await utils.safeFetchMember(interaction.guild, target.id);
    if (!member) return utils.replyError(interaction, 'Could not find that member in this server.');
    if (role.position >= interaction.guild.members.me.roles.highest.position) {
      return utils.replyError(interaction, 'I cannot assign a role that is higher than or equal to my highest role.');
    }

    try {
      await member.roles.add(role, reason);
    } catch (err) {
      return utils.replyError(interaction, `Failed to assign role: ${err?.message || 'Unknown error'}`);
    }

    const cfg = await db.getGuild(interaction.guildId);
    const embed = utils.buildEmbed({
      title: '⬆️ Member Promoted',
      color: Colors.Green,
      fields: [
        { name: 'User', value: utils.displayUser(target), inline: true },
        { name: 'Moderator', value: utils.displayUser(interaction.user), inline: true },
        { name: 'Role Assigned', value: `${role}`, inline: true },
        { name: 'Reason', value: reason, inline: false },
      ],
    });
    await utils.sendToLogs(interaction.guild, cfg, cfg?.general_log_channel, { embeds: [embed] });
    return utils.replySuccess(interaction, `${target} has been promoted with the ${role} role.`);
  },
};

// ── /demote-user ───────────────────────────────────────────────────────────
const demoteUserCmd = {
  data: new SlashCommandBuilder()
    .setName('demote-user')
    .setDescription('Demote a member by removing a role from them')
    .addUserOption(o => o.setName('user').setDescription('Member to demote').setRequired(true))
    .addRoleOption(o => o.setName('role').setDescription('Role to remove').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for demotion').setRequired(false)),

  async execute(interaction, db, utils) {
    if (!checkPerm(interaction, db, utils, 'demote_user')) return;

    const target = interaction.options.getUser('user');
    const role = interaction.options.getRole('role');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    if (!target || !role) return utils.replyError(interaction, 'Could not find user or role.');

    const member = await utils.safeFetchMember(interaction.guild, target.id);
    if (!member) return utils.replyError(interaction, 'Could not find that member in this server.');
    if (!member.roles.cache.has(role.id)) return utils.replyError(interaction, 'That member does not have that role.');

    try {
      await member.roles.remove(role, reason);
    } catch (err) {
      return utils.replyError(interaction, `Failed to remove role: ${err?.message || 'Unknown error'}`);
    }

    const cfg = await db.getGuild(interaction.guildId);
    const embed = utils.buildEmbed({
      title: '⬇️ Member Demoted',
      color: Colors.Orange,
      fields: [
        { name: 'User', value: utils.displayUser(target), inline: true },
        { name: 'Moderator', value: utils.displayUser(interaction.user), inline: true },
        { name: 'Role Removed', value: `${role}`, inline: true },
        { name: 'Reason', value: reason, inline: false },
      ],
    });
    await utils.sendToLogs(interaction.guild, cfg, cfg?.general_log_channel, { embeds: [embed] });
    return utils.replySuccess(interaction, `${target} has been demoted. The ${role} role has been removed.`);
  },
};

// ── /strike ────────────────────────────────────────────────────────────────
const strikeCmd = {
  data: new SlashCommandBuilder()
    .setName('strike')
    .setDescription('Issue a strike to a member')
    .addUserOption(o => o.setName('user').setDescription('Member to strike').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for strike').setRequired(true))
    .addIntegerOption(o => o.setName('severity').setDescription('Severity level (1=minor, 2=moderate, 3=major)').setMinValue(1).setMaxValue(3).setRequired(false)),

  async execute(interaction, db, utils) {
    if (!checkPerm(interaction, db, utils, 'strike')) return;

    const target = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');
    const severity = interaction.options.getInteger('severity') || 1;
    if (!target) return utils.replyError(interaction, 'Could not find that user.');

    const severityLabel = { 1: '🟡 Minor (1)', 2: '🟠 Moderate (2)', 3: '🔴 Major (3)' }[severity];
    const caseId = await db.addStrike(interaction.guildId, target.id, interaction.user.id, reason);
    const strikes = await db.getStrikes(interaction.guildId, target.id);
    const cfg = await db.getGuild(interaction.guildId);
    const embed = utils.buildStrikeEmbed({ target, moderator: interaction.user, reason, caseId, strikeCount: strikes.length, severity: severityLabel });

    await utils.sendToLogs(interaction.guild, cfg, cfg?.general_log_channel, { embeds: [embed] });
    return utils.replySuccess(interaction, `${target} has been given a **${severityLabel}** strike. Case: **${caseId}**. They now have **${strikes.length}** strike(s).`);
  },
};

// ── /strike-remove ─────────────────────────────────────────────────────────
const strikeRemoveCmd = {
  data: new SlashCommandBuilder()
    .setName('strike-remove')
    .setDescription('Remove a strike from a user (by case ID or removes the latest)')
    .addUserOption(o => o.setName('user').setDescription('The user to remove a strike from').setRequired(true))
    .addStringOption(o => o.setName('case_id').setDescription('Specific case ID to remove (leave blank to remove latest)').setRequired(false)),

  async execute(interaction, db, utils) {
    if (!checkPerm(interaction, db, utils, 'strike_remove')) return;

    const target = interaction.options.getUser('user');
    const caseId = interaction.options.getString('case_id');
    if (!target) return utils.replyError(interaction, 'Could not find that user.');

    let removedCaseId;
    if (caseId) {
      const removed = await db.removeStrike(caseId, interaction.guildId);
      if (!removed) return utils.replyError(interaction, `No strike found with case ID **${caseId}** for this server.`);
      removedCaseId = caseId;
    } else {
      removedCaseId = await db.removeLatestStrike(interaction.guildId, target.id);
      if (!removedCaseId) return utils.replyError(interaction, `${target} has no strikes to remove.`);
    }

    const cfg = await db.getGuild(interaction.guildId);
    const embed = utils.buildEmbed({
      title: '⚡ Strike Removed',
      color: Colors.Grey,
      fields: [
        { name: 'User', value: utils.displayUser(target), inline: true },
        { name: 'Case ID', value: removedCaseId, inline: true },
        { name: 'Removed By', value: utils.displayUser(interaction.user), inline: true },
      ],
    });
    await utils.sendToLogs(interaction.guild, cfg, cfg?.general_log_channel, { embeds: [embed] });
    return utils.replySuccess(interaction, `Strike **${removedCaseId}** removed from ${target}.`);
  },
};

// ── /jail ──────────────────────────────────────────────────────────────────
const jailCmd = {
  data: new SlashCommandBuilder()
    .setName('jail')
    .setDescription('Jail a member (remove all roles, assign jail role)')
    .addUserOption(o => o.setName('user').setDescription('Member to jail').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for jail').setRequired(true))
    .addStringOption(o => o.setName('duration').setDescription('How long to jail (e.g. 10m, 1h, 1d) — leave blank for indefinite').setRequired(false)),

  async execute(interaction, db, utils) {
    if (!checkPerm(interaction, db, utils, 'jail')) return;

    const target = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');
    if (!target) return utils.replyError(interaction, 'Could not find that user.');

    const cfg = await db.getGuild(interaction.guildId);
    if (!cfg?.jail_role) return utils.replyError(interaction, 'No jail role configured. Use **/setup** to set one.');

    const jailRole = await utils.safeFetchRole(interaction.guild, cfg.jail_role);
    if (!jailRole) return utils.replyError(interaction, 'Jail role not found. Please update it with **/setup**.');

    const member = await utils.safeFetchMember(interaction.guild, target.id);
    if (!member) return utils.replyError(interaction, 'Could not find that member in this server.');
    if (!member.manageable) return utils.replyError(interaction, 'I cannot manage this member.');

    const existingRoles = member.roles.cache
      .filter(r => r.id !== interaction.guild.id && !r.managed)
      .map(r => r.id);

    try {
      await member.roles.set([jailRole.id], reason);
    } catch (err) {
      return utils.replyError(interaction, `Failed to jail member: ${err?.message || 'Unknown error'}`);
    }

    const durationStr = interaction.options.getString('duration');
    const ms = durationStr ? utils.parseDuration(durationStr) : null;
    if (durationStr && !ms) return utils.replyError(interaction, 'Invalid duration. Use format: `10m`, `1h`, `1d`. Min: 5s, Max: 28d.');

    if (ms && member.moderatable) {
      try { await member.timeout(ms, reason); } catch { /* non-critical if timeout fails */ }
    }

    await db.jailUser(interaction.guildId, target.id, interaction.user.id, reason, existingRoles);

    const fields = [
      { name: 'User', value: utils.displayUser(target), inline: true },
      { name: 'Moderator', value: utils.displayUser(interaction.user), inline: true },
      { name: 'Reason', value: reason, inline: false },
      { name: 'Roles Saved', value: `${existingRoles.length} role(s) stored for restoration`, inline: false },
    ];
    if (ms) fields.push({ name: 'Duration', value: utils.formatDuration(ms), inline: true });

    const embed = utils.buildEmbed({ title: '🔒 Member Jailed', color: Colors.DarkOrange, fields });
    await utils.sendToLogs(interaction.guild, cfg, cfg?.general_log_channel, { embeds: [embed] });
    return utils.replySuccess(interaction, `${target} has been jailed${ms ? ` for **${utils.formatDuration(ms)}**` : ''}.`);
  },
};

// ── /unjail ────────────────────────────────────────────────────────────────
const unjailCmd = {
  data: new SlashCommandBuilder()
    .setName('unjail')
    .setDescription('Release a jailed member and restore their roles')
    .addUserOption(o => o.setName('user').setDescription('Member to unjail').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for unjail').setRequired(false)),

  async execute(interaction, db, utils) {
    if (!checkPerm(interaction, db, utils, 'unjail')) return;

    const target = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'Released from jail';
    if (!target) return utils.replyError(interaction, 'Could not find that user.');

    const jailData = await db.unjailUser(interaction.guildId, target.id);
    if (!jailData) return utils.replyError(interaction, 'That member is not currently jailed (no jail record found).');

    const member = await utils.safeFetchMember(interaction.guild, target.id);
    if (!member) return utils.replyError(interaction, 'Could not find that member in this server.');

    let restoredRoles = 0;
    try {
      const roleIds = JSON.parse(jailData.roles || '[]');
      const validRoles = roleIds.filter(id => interaction.guild.roles.cache.has(id));
      if (validRoles.length > 0) await member.roles.set(validRoles, reason);
      restoredRoles = validRoles.length;
    } catch (err) {
      return utils.replyError(interaction, `Unjailed but failed to restore roles: ${err?.message || 'Unknown error'}`);
    }

    const cfg = await db.getGuild(interaction.guildId);
    const embed = utils.buildEmbed({
      title: '🔓 Member Released from Jail',
      color: Colors.Green,
      fields: [
        { name: 'User', value: utils.displayUser(target), inline: true },
        { name: 'Moderator', value: utils.displayUser(interaction.user), inline: true },
        { name: 'Roles Restored', value: String(restoredRoles), inline: true },
        { name: 'Reason', value: reason, inline: false },
      ],
    });
    await utils.sendToLogs(interaction.guild, cfg, cfg?.general_log_channel, { embeds: [embed] });
    return utils.replySuccess(interaction, `${target} has been released and **${restoredRoles}** role(s) restored.`);
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// REQUEST COMMANDS (image required)
// ═══════════════════════════════════════════════════════════════════════════

// ── /ban-request ───────────────────────────────────────────────────────────
const banRequestCmd = {
  data: new SlashCommandBuilder()
    .setName('ban-request')
    .setDescription('Submit a ban request with image proof')
    .addUserOption(o => o.setName('user').setDescription('User to request ban for').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for the ban request').setRequired(true))
    .addAttachmentOption(o => o.setName('image').setDescription('Image proof (required)').setRequired(true))
    .addStringOption(o => o.setName('severity').setDescription('Severity of the offense').setRequired(false).addChoices(
      { name: 'Low', value: 'low' },
      { name: 'Medium', value: 'medium' },
      { name: 'High', value: 'high' },
    )),

  async execute(interaction, db, utils) {
    if (!checkPerm(interaction, db, utils, 'ban_request')) return;

    const target = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');
    const image = interaction.options.getAttachment('image');
    const severity = interaction.options.getString('severity');

    if (!target) return utils.replyError(interaction, 'Could not find that user.');
    if (!image) return utils.replyError(interaction, 'An image proof is required for ban requests.');
    if (!image.contentType?.startsWith('image/')) return utils.replyError(interaction, 'The attachment must be an image file.');

    const cfg = await db.getGuild(interaction.guildId);
    if (!cfg?.ban_request_channel) return utils.replyError(interaction, 'No ban request channel configured. Use **/setup** to set one.');

    const extra = severity ? `Severity: **${severity.charAt(0).toUpperCase() + severity.slice(1)}**` : null;
    const embed = utils.buildRequestEmbed({ type: 'ban', target, moderator: interaction.user, reason, imageUrl: image.url, extra });
    await utils.sendToLogs(interaction.guild, cfg, cfg.ban_request_channel, { embeds: [embed] });
    return utils.replySuccess(interaction, `Ban request for ${target} has been submitted.`);
  },
};

// ── /blacklist-request ─────────────────────────────────────────────────────
const blacklistRequestCmd = {
  data: new SlashCommandBuilder()
    .setName('blacklist-request')
    .setDescription('Submit a blacklist request with image proof')
    .addUserOption(o => o.setName('user').setDescription('User to request blacklist for').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for blacklist').setRequired(true))
    .addAttachmentOption(o => o.setName('image').setDescription('Image proof (required)').setRequired(true))
    .addBooleanOption(o => o.setName('permanent').setDescription('Request a permanent blacklist').setRequired(false)),

  async execute(interaction, db, utils) {
    if (!checkPerm(interaction, db, utils, 'blacklist_request')) return;

    const target = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');
    const image = interaction.options.getAttachment('image');
    const permanent = interaction.options.getBoolean('permanent') ?? false;

    if (!target) return utils.replyError(interaction, 'Could not find that user.');
    if (!image) return utils.replyError(interaction, 'An image proof is required for blacklist requests.');
    if (!image.contentType?.startsWith('image/')) return utils.replyError(interaction, 'The attachment must be an image file.');

    const cfg = await db.getGuild(interaction.guildId);
    if (!cfg?.blacklist_request_channel) return utils.replyError(interaction, 'No blacklist request channel configured. Use **/setup** to set one.');

    const extra = permanent ? '⚠️ **Permanent blacklist requested**' : null;
    const embed = utils.buildRequestEmbed({ type: 'blacklist', target, moderator: interaction.user, reason, imageUrl: image.url, extra });
    await utils.sendToLogs(interaction.guild, cfg, cfg.blacklist_request_channel, { embeds: [embed] });
    return utils.replySuccess(interaction, `Blacklist request for ${target} has been submitted${permanent ? ' (permanent)' : ''}.`);
  },
};

// ── /network-ban-request ───────────────────────────────────────────────────
const networkBanRequestCmd = {
  data: new SlashCommandBuilder()
    .setName('network-ban-request')
    .setDescription('Submit a network ban request with image proof')
    .addUserOption(o => o.setName('user').setDescription('User to request network ban for').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for network ban').setRequired(true))
    .addAttachmentOption(o => o.setName('image').setDescription('Image proof (required)').setRequired(true))
    .addStringOption(o => o.setName('scope').setDescription('Scope of the ban').setRequired(false).addChoices(
      { name: 'Server only', value: 'server' },
      { name: 'Full network', value: 'network' },
    )),

  async execute(interaction, db, utils) {
    if (!checkPerm(interaction, db, utils, 'network_ban_request')) return;

    const target = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');
    const image = interaction.options.getAttachment('image');
    const scope = interaction.options.getString('scope') || 'network';

    if (!target) return utils.replyError(interaction, 'Could not find that user.');
    if (!image) return utils.replyError(interaction, 'An image proof is required for network ban requests.');
    if (!image.contentType?.startsWith('image/')) return utils.replyError(interaction, 'The attachment must be an image file.');

    const cfg = await db.getGuild(interaction.guildId);
    if (!cfg?.network_ban_request_channel) return utils.replyError(interaction, 'No network ban request channel configured. Use **/setup** to set one.');

    const extra = `Scope: **${scope === 'network' ? 'Full Network' : 'Server Only'}**`;
    const embed = utils.buildRequestEmbed({ type: 'network-ban', target, moderator: interaction.user, reason, imageUrl: image.url, extra });
    await utils.sendToLogs(interaction.guild, cfg, cfg.network_ban_request_channel, { embeds: [embed] });
    return utils.replySuccess(interaction, `Network ban request for ${target} has been submitted (scope: ${scope}).`);
  },
};

// ── /partnership-request ───────────────────────────────────────────────────
const partnershipRequestCmd = {
  data: new SlashCommandBuilder()
    .setName('partnership-request')
    .setDescription('Submit a partnership request')
    .addStringOption(o => o.setName('message').setDescription('Partnership message / pitch').setRequired(true))
    .addAttachmentOption(o => o.setName('image').setDescription('Server banner or proof image (required)').setRequired(true))
    .addStringOption(o => o.setName('server_invite').setDescription('Server invite link').setRequired(false)),

  async execute(interaction, db, utils) {
    if (!checkPerm(interaction, db, utils, 'partnership_request')) return;

    const message = interaction.options.getString('message');
    const image = interaction.options.getAttachment('image');
    const serverInvite = interaction.options.getString('server_invite');

    if (!image) return utils.replyError(interaction, 'An image is required for partnership requests.');
    if (!image.contentType?.startsWith('image/')) return utils.replyError(interaction, 'The attachment must be an image file.');

    const cfg = await db.getGuild(interaction.guildId);
    if (!cfg?.partnership_request_channel) return utils.replyError(interaction, 'No partnership request channel configured. Use **/setup** to set one.');

    const extra = serverInvite ? `Invite: ${serverInvite}` : null;
    const embed = utils.buildRequestEmbed({ type: 'partnership', moderator: interaction.user, message, imageUrl: image.url, extra });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`pr_accept:${interaction.user.id}`)
        .setLabel('✅ Accept')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`pr_deny:${interaction.user.id}`)
        .setLabel('❌ Deny')
        .setStyle(ButtonStyle.Danger),
    );

    await utils.sendToLogs(interaction.guild, cfg, cfg.partnership_request_channel, { embeds: [embed], components: [row] });
    return utils.replySuccess(interaction, 'Your partnership request has been submitted.');
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY COMMANDS
// ═══════════════════════════════════════════════════════════════════════════

// ── /messages ──────────────────────────────────────────────────────────────
const messagesCmd = {
  data: new SlashCommandBuilder()
    .setName('messages')
    .setDescription('View message count for a user')
    .addUserOption(o => o.setName('user').setDescription('User to check (defaults to yourself)').setRequired(false))
    .addStringOption(o => o.setName('type').setDescription('Type of messages to show').setRequired(false).addChoices(
      { name: 'All', value: 'all' },
      { name: 'Staff', value: 'staff' },
      { name: 'Mod', value: 'mod' },
    )),

  async execute(interaction, db, utils) {
    if (!checkPerm(interaction, db, utils, 'messages')) return;

    const target = interaction.options.getUser('user') || interaction.user;
    const type = interaction.options.getString('type') || 'all';
    const count = await db.getMessageCount(interaction.guildId, target.id);
    const typeLabel = { all: 'All', staff: 'Staff', mod: 'Mod' }[type] || 'All';

    return utils.safeReply(interaction, {
      embeds: [utils.buildEmbed({
        title: `💬 Message Count (${typeLabel})`,
        description: `${target} has sent **${count.toLocaleString()}** message(s) in this server.`,
        color: Colors.Blurple,
        thumbnail: target.displayAvatarURL?.() || null,
      })],
    });
  },
};

// ── /message-leaderboard ───────────────────────────────────────────────────
const messageLeaderboardCmd = {
  data: new SlashCommandBuilder()
    .setName('message-leaderboard')
    .setDescription('Show the top message senders in this server')
    .addStringOption(o => o.setName('type').setDescription('Leaderboard time range').setRequired(false).addChoices(
      { name: 'Daily', value: 'daily' },
      { name: 'Weekly', value: 'weekly' },
      { name: 'All Time', value: 'all-time' },
    )),

  async execute(interaction, db, utils) {
    if (!checkPerm(interaction, db, utils, 'message_leaderboard')) return;

    const type = interaction.options.getString('type') || 'all-time';
    const typeLabel = { 'daily': 'Daily', 'weekly': 'Weekly', 'all-time': 'All Time' }[type] || 'All Time';
    const board = await db.getMessageLeaderboard(interaction.guildId);
    if (board.length === 0) {
      return utils.safeReply(interaction, {
        embeds: [utils.buildEmbed({ title: `💬 Message Leaderboard (${typeLabel})`, description: 'No messages tracked yet.', color: Colors.Grey })],
      });
    }
    const lines = board.map((r, i) => `**${i + 1}.** <@${r.user_id}> — **${r.count.toLocaleString()}** messages`);
    return utils.safeReply(interaction, {
      embeds: [utils.buildEmbed({ title: `💬 Message Leaderboard (${typeLabel})`, description: lines.join('\n'), color: Colors.Blurple })],
    });
  },
};

// ── /case-info ─────────────────────────────────────────────────────────────
const caseInfoCmd = {
  data: new SlashCommandBuilder()
    .setName('case-info')
    .setDescription('Look up a case by its ID')
    .addStringOption(o => o.setName('case_id').setDescription('The case ID to look up').setRequired(true)),

  async execute(interaction, db, utils) {
    if (!checkPerm(interaction, db, utils, 'case_info')) return;

    const caseId = interaction.options.getString('case_id');
    const caseData = await db.getCaseInfo(caseId, interaction.guildId);
    if (!caseData) return utils.replyError(interaction, `No case found with ID **${caseId}**.`);

    const typeEmoji = { warn: '⚠️', strike: '⚡', 'ad-warn': '📢' };
    return utils.safeReply(interaction, {
      embeds: [utils.buildEmbed({
        title: `${typeEmoji[caseData.type] || '📋'} Case ${caseId}`,
        color: Colors.Blurple,
        fields: [
          { name: 'Type', value: caseData.type || 'unknown', inline: true },
          { name: 'User', value: `<@${caseData.user_id}>`, inline: true },
          { name: 'Moderator', value: `<@${caseData.moderator_id}>`, inline: true },
          { name: 'Reason', value: caseData.reason || 'N/A', inline: false },
          { name: 'Date', value: utils.formatTimestamp(caseData.timestamp), inline: false },
        ],
      })],
      ephemeral: true,
    });
  },
};

// ── /balance ───────────────────────────────────────────────────────────────
const balanceCmd = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('View balance for a user')
    .addUserOption(o => o.setName('user').setDescription('User to check (defaults to yourself)').setRequired(false)),

  async execute(interaction, db, utils) {
    if (!checkPerm(interaction, db, utils, 'balance')) return;

    const target = interaction.options.getUser('user') || interaction.user;
    const bal = await db.getBalance(interaction.guildId, target.id);

    return utils.safeReply(interaction, {
      embeds: [utils.buildEmbed({
        title: '💰 Balance',
        description: `${target} has a balance of **${bal.toLocaleString()}** coins.`,
        color: Colors.Yellow,
        thumbnail: target.displayAvatarURL?.() || null,
      })],
    });
  },
};

// ── /snipe ─────────────────────────────────────────────────────────────────
const snipeCmd = {
  data: new SlashCommandBuilder()
    .setName('snipe')
    .setDescription('Show the last deleted message in a channel')
    .addChannelOption(o => o.setName('channel').setDescription('Channel to snipe (defaults to current channel)').setRequired(false)),

  async execute(interaction, db, utils) {
    if (!checkPerm(interaction, db, utils, 'snipe')) return;

    const targetChannel = interaction.options.getChannel('channel');
    const channelId = targetChannel?.id || interaction.channelId;
    const snipe = await db.getSnipe(interaction.guildId, channelId);
    if (!snipe || !snipe.content) {
      return utils.safeReply(interaction, {
        embeds: [utils.buildEmbed({ title: '👻 Snipe', description: 'No recently deleted messages found in this channel.', color: Colors.Grey })],
        ephemeral: true,
      });
    }

    const snipeUser = snipe.user_id ? `<@${snipe.user_id}>` : 'Unknown User';
    return utils.safeReply(interaction, {
      embeds: [utils.buildEmbed({
        title: '👻 Sniped Message',
        description: snipe.content,
        color: Colors.DarkGrey,
        fields: [
          { name: 'Author', value: snipeUser, inline: true },
          { name: 'Deleted', value: utils.formatTimestamp(snipe.timestamp), inline: true },
        ],
      })],
    });
  },
};

// ── /current-breaks ────────────────────────────────────────────────────────
const currentBreaksCmd = {
  data: new SlashCommandBuilder()
    .setName('current-breaks')
    .setDescription('Show all staff members currently on break'),

  async execute(interaction, db, utils) {
    if (!checkPerm(interaction, db, utils, 'current_breaks')) return;

    const breaks = await db.getCurrentBreaks(interaction.guildId);
    if (breaks.length === 0) {
      return utils.safeReply(interaction, {
        embeds: [utils.buildEmbed({ title: '☕ Current Breaks', description: 'No staff members are currently on break.', color: Colors.Green })],
      });
    }

    const lines = breaks.map(b => {
      const since = utils.formatTimestamp(b.started_at);
      const reason = b.reason ? ` — ${b.reason}` : '';
      return `<@${b.user_id}>${reason} (since ${since})`;
    });

    return utils.safeReply(interaction, {
      embeds: [utils.buildEmbed({
        title: `☕ Current Breaks (${breaks.length})`,
        description: lines.join('\n'),
        color: Colors.Yellow,
      })],
    });
  },
};

// ── /break (start a break) ─────────────────────────────────────────────────
const breakCmd = {
  data: new SlashCommandBuilder()
    .setName('break')
    .setDescription('Start a break')
    .addStringOption(o => o.setName('reason').setDescription('Reason for break (optional)').setRequired(false)),

  async execute(interaction, db, utils) {
    const reason = interaction.options.getString('reason') || '';
    await db.startBreak(interaction.guildId, interaction.user.id, reason);
    return utils.replySuccess(interaction, `Your break has been started${reason ? `: *${reason}*` : '.'}. Use **/break-end** when you return.`);
  },
};

// ── /break-end ─────────────────────────────────────────────────────────────
const breakEndCmd = {
  data: new SlashCommandBuilder()
    .setName('break-end')
    .setDescription('End your current break'),

  async execute(interaction, db, utils) {
    await db.endBreak(interaction.guildId, interaction.user.id);
    return utils.replySuccess(interaction, 'Welcome back! Your break has ended.');
  },
};

// ── /reset-messages ────────────────────────────────────────────────────────
const resetMessagesCmd = {
  data: new SlashCommandBuilder()
    .setName('reset-messages')
    .setDescription('Reset message count for a specific user')
    .addUserOption(o => o.setName('user').setDescription('User to reset').setRequired(true)),

  async execute(interaction, db, utils) {
    if (!checkPerm(interaction, db, utils, 'reset_messages')) return;

    const target = interaction.options.getUser('user');
    if (!target) return utils.replyError(interaction, 'Could not find that user.');

    await db.resetMessageCount(interaction.guildId, target.id);
    return utils.replySuccess(interaction, `Message count for ${target} has been reset to 0.`);
  },
};

// ── /reset-messages-all ────────────────────────────────────────────────────
const resetMessagesAllCmd = {
  data: new SlashCommandBuilder()
    .setName('reset-messages-all')
    .setDescription('Reset message counts for ALL users in this server')
    .addBooleanOption(o => o.setName('confirm').setDescription('Set to true to confirm resetting ALL message counts').setRequired(true)),

  async execute(interaction, db, utils) {
    if (!checkPerm(interaction, db, utils, 'reset_messages_all')) return;

    const confirm = interaction.options.getBoolean('confirm');
    if (!confirm) return utils.replyError(interaction, 'Reset cancelled. Set `confirm` to **True** to proceed with resetting all message counts.');

    await db.resetAllMessageCounts(interaction.guildId);
    return utils.replySuccess(interaction, 'All message counts in this server have been reset.');
  },
};

// ── /delete ────────────────────────────────────────────────────────────────
const deleteCmd = {
  data: new SlashCommandBuilder()
    .setName('delete')
    .setDescription('Delete all bot messages in a channel')
    .addChannelOption(o => o.setName('channel').setDescription('Channel to clear (defaults to current channel)').setRequired(false))
    .addIntegerOption(o => o.setName('limit').setDescription('Max messages to scan (default 100, max 500)').setMinValue(1).setMaxValue(500).setRequired(false)),

  async execute(interaction, db, utils) {
    if (!checkPerm(interaction, db, utils, 'delete')) return;

    const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
    const limit = interaction.options.getInteger('limit') || 100;

    if (!targetChannel.messages) return utils.replyError(interaction, 'Cannot access messages in that channel.');

    await interaction.deferReply({ ephemeral: true });

    let deleted = 0;
    let lastId = null;
    let remaining = limit;
    const twoWeeksAgo = Date.now() - 13 * 24 * 60 * 60 * 1000;

    try {
      do {
        const opts = { limit: Math.min(remaining, 100) };
        if (lastId) opts.before = lastId;

        const fetched = await targetChannel.messages.fetch(opts);
        if (fetched.size === 0) break;
        lastId = fetched.last().id;
        remaining -= fetched.size;

        const botMsgs = fetched.filter(m => m.author.id === interaction.client.user.id);
        if (botMsgs.size === 0) continue;

        const recent = botMsgs.filter(m => m.createdTimestamp > twoWeeksAgo);
        const old = botMsgs.filter(m => m.createdTimestamp <= twoWeeksAgo);

        if (recent.size > 1) {
          await targetChannel.bulkDelete(recent).catch(() => {});
          deleted += recent.size;
        } else if (recent.size === 1) {
          await recent.first().delete().catch(() => {});
          deleted++;
        }

        for (const msg of old.values()) {
          await msg.delete().catch(() => {});
          deleted++;
          await new Promise(r => setTimeout(r, 350));
        }
      } while (remaining > 0);
    } catch (err) {
      return interaction.editReply({
        embeds: [utils.buildEmbed({ title: '❌ Error', description: `Stopped after deleting ${deleted} message(s): ${err?.message || 'Unknown error'}`, color: Colors.Red })],
      });
    }

    return interaction.editReply({
      embeds: [utils.buildEmbed({
        title: '🗑️ Bot Messages Cleared',
        description: `Deleted **${deleted}** bot message(s) from ${targetChannel}.`,
        color: Colors.Green,
      })],
    });
  },
};

module.exports = [
  warnCmd, warnsCmd, warnLeaderboardCmd,
  adWarnCmd, removeAdWarnCmd,
  muteCmd, unmuteCmd, banCmd,
  fireCmd, promoteCmd, demoteUserCmd,
  strikeCmd, strikeRemoveCmd,
  jailCmd, unjailCmd,
  banRequestCmd, blacklistRequestCmd, networkBanRequestCmd, partnershipRequestCmd,
  messagesCmd, messageLeaderboardCmd,
  caseInfoCmd, balanceCmd, snipeCmd,
  currentBreaksCmd, breakEndCmd,
  resetMessagesCmd, resetMessagesAllCmd,
  deleteCmd,
];
