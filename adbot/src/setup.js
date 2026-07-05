'use strict';

const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');

const ALL_COMMANDS = [
  'warn', 'warns', 'warn-leaderboard', 'ad-warn', 'remove-ad-warn',
  'mute', 'unmute', 'ban', 'fire', 'promote', 'demote-user',
  'strike', 'strike-remove', 'jail', 'unjail',
  'ban-request', 'blacklist-request', 'network-ban-request', 'partnership-request',
  'setup-status', 'setup-edit', 'messages', 'message-leaderboard',
  'case-info', 'balance', 'snipe', 'current-breaks', 'reset-messages', 'reset-messages-all',
  'delete', 'request-break', 'break-end',
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function promptEmbed(title, description, step, total) {
  return new EmbedBuilder()
    .setColor(Colors.Blurple)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: `${step ? `Step ${step}/${total} • ` : ''}Type your answer, or type skip to skip • 60s to respond` });
}

function timeoutEmbed() {
  return new EmbedBuilder()
    .setColor(Colors.Red)
    .setTitle('⏱️ Setup Timed Out')
    .setDescription('No response received within 60 seconds.\nRun the command again to restart.');
}

async function ask(channel, userId, title, description, step, total) {
  const sent = await channel.send({ embeds: [promptEmbed(title, description, step, total)] });
  try {
    const collected = await channel.awaitMessages({
      filter: m => m.author.id === userId,
      max: 1,
      time: 60_000,
      errors: ['time'],
    });
    const reply = collected.first();
    await reply.delete().catch(() => {});
    return reply.content.trim();
  } catch {
    await sent.edit({ embeds: [timeoutEmbed()] }).catch(() => {});
    return null;
  }
}

function isSkip(content) {
  return content.toLowerCase() === 'skip';
}

function parseChannelId(content) {
  const fromMention = /<#(\d+)>/.exec(content);
  if (fromMention) return fromMention[1];
  const bareId = /^\d{17,20}$/.exec(content.trim());
  return bareId ? bareId[0] : null;
}

function parseRoleIds(content) {
  const ids = [];
  const re = /<@&(\d+)>/g;
  let m;
  while ((m = re.exec(content)) !== null) ids.push(m[1]);
  if (ids.length === 0 && /^\d{17,20}$/.test(content.trim())) ids.push(content.trim());
  return ids;
}

// ── /setup ──────────────────────────────────────────────────────────────────
const setupCommand = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configure all log channels and the jail role in one command — fill only what you need')
    .addChannelOption(o => o.setName('general_log').setDescription('All bot action logs — warns, bans, mutes, jails, etc.').setRequired(false))
    .addChannelOption(o => o.setName('warn_log').setDescription('Warning logs only').setRequired(false))
    .addChannelOption(o => o.setName('ad_warn_log').setDescription('Ad-warning logs (includes deleted message content)').setRequired(false))
    .addChannelOption(o => o.setName('ban_request').setDescription('Receives /ban-request submissions').setRequired(false))
    .addChannelOption(o => o.setName('blacklist_request').setDescription('Receives /blacklist-request submissions').setRequired(false))
    .addChannelOption(o => o.setName('network_ban_request').setDescription('Receives /network-ban-request submissions').setRequired(false))
    .addChannelOption(o => o.setName('partnership_request').setDescription('Receives /partnership-request applications').setRequired(false))
    .addChannelOption(o => o.setName('partnership_accepted').setDescription('Where accepted partnerships are announced').setRequired(false))
    .addRoleOption(o => o.setName('jail_role').setDescription('Role given to jailed members — other roles are saved and restored on /unjail').setRequired(false)),

  async execute(interaction, db, utils) {
    if (!utils.hasSetupPermission(interaction.member)) {
      return utils.replyNoPermission(interaction, 'setup');
    }

    const general_log_channel    = interaction.options.getChannel('general_log')?.id;
    const warn_log_channel        = interaction.options.getChannel('warn_log')?.id;
    const ad_warn_log_channel     = interaction.options.getChannel('ad_warn_log')?.id;
    const ban_request_channel     = interaction.options.getChannel('ban_request')?.id;
    const blacklist_request_channel = interaction.options.getChannel('blacklist_request')?.id;
    const network_ban_request_channel = interaction.options.getChannel('network_ban_request')?.id;
    const partnership_request_channel = interaction.options.getChannel('partnership_request')?.id;
    const partnership_accepted_channel = interaction.options.getChannel('partnership_accepted')?.id;
    const jail_role               = interaction.options.getRole('jail_role')?.id;

    const data = {};
    const lines = [];

    if (general_log_channel)           { data.general_log_channel = general_log_channel;                       lines.push(`📋 **General Log:** <#${general_log_channel}>`); }
    if (warn_log_channel)              { data.warn_log_channel = warn_log_channel;                             lines.push(`⚠️ **Warn Log:** <#${warn_log_channel}>`); }
    if (ad_warn_log_channel)           { data.ad_warn_log_channel = ad_warn_log_channel;                       lines.push(`📢 **Ad-Warn Log:** <#${ad_warn_log_channel}>`); }
    if (ban_request_channel)           { data.ban_request_channel = ban_request_channel;                       lines.push(`🔨 **Ban Request:** <#${ban_request_channel}>`); }
    if (blacklist_request_channel)     { data.blacklist_request_channel = blacklist_request_channel;           lines.push(`🚫 **Blacklist Request:** <#${blacklist_request_channel}>`); }
    if (network_ban_request_channel)   { data.network_ban_request_channel = network_ban_request_channel;       lines.push(`🌐 **Network Ban Request:** <#${network_ban_request_channel}>`); }
    if (partnership_request_channel)   { data.partnership_request_channel = partnership_request_channel;       lines.push(`🤝 **Partnership Request:** <#${partnership_request_channel}>`); }
    if (partnership_accepted_channel)  { data.partnership_accepted_channel = partnership_accepted_channel;     lines.push(`✅ **Partnership Accepted:** <#${partnership_accepted_channel}>`); }
    if (jail_role)                     { data.jail_role = jail_role;                                           lines.push(`🔒 **Jail Role:** <@&${jail_role}>`); }

    if (Object.keys(data).length === 0) {
      return utils.replyError(interaction, 'No values provided — fill in at least one option to save.');
    }

    await db.upsertGuild(interaction.guildId, data);

    return utils.safeReply(interaction, {
      embeds: [utils.buildEmbed({
        title: '✅ Setup Saved',
        description: lines.join('\n'),
        color: Colors.Green,
        footer: 'Use /setup-ad-channel to configure ad channels • /setup-status to review all settings',
      })],
      ephemeral: true,
    });
  },
};

// ── /setup-roles-wizard ─────────────────────────────────────────────────────
const setupRolesWizardCommand = {
  data: new SlashCommandBuilder()
    .setName('setup-roles-wizard')
    .setDescription('Interactive wizard — walks through every command and sets which roles can use it'),

  async execute(interaction, db, utils) {
    if (!utils.hasSetupPermission(interaction.member)) {
      return utils.replyNoPermission(interaction, 'setup-roles-wizard');
    }

    const channel = interaction.channel;
    const userId = interaction.user.id;
    const total = ALL_COMMANDS.length;

    await utils.safeReply(interaction, {
      embeds: [utils.buildEmbed({
        title: '🛡️ Role Setup Wizard Starting...',
        description: `I'll walk through all **${total} commands** one at a time.\n\nFor each one, mention the role(s) that should be able to use it — you can mention **multiple roles** in one message.\n\nType \`skip\` to leave a command open to everyone.\n\n**You have 60 seconds per step.**`,
        color: Colors.Blurple,
      })],
      ephemeral: true,
    });

    const summary = [];

    for (let i = 0; i < ALL_COMMANDS.length; i++) {
      const cmd = ALL_COMMANDS[i];
      const response = await ask(
        channel,
        userId,
        `🛡️ /${cmd}`,
        `Mention the role(s) that can use **/${cmd}**.\nYou can mention multiple: \`@Moderator @Admin\`\n\nType \`skip\` to leave it open to everyone.`,
        i + 1,
        total,
      );

      if (response === null) return;

      if (isSkip(response)) {
        summary.push(`\`/${cmd}\` — open to everyone`);
        continue;
      }

      const roleIds = parseRoleIds(response);
      if (roleIds.length === 0) {
        summary.push(`\`/${cmd}\` — ⚠️ no valid roles found, skipped`);
        continue;
      }

      const field = cmd.replace(/-/g, '_') + '_roles';
      await db.setGuildRoles(interaction.guildId, field, roleIds);
      summary.push(`\`/${cmd}\` — ${roleIds.map(id => `<@&${id}>`).join(', ')}`);
    }

    const CHUNK = 15;
    for (let c = 0; c < summary.length; c += CHUNK) {
      const chunk = summary.slice(c, c + CHUNK);
      const isLast = c + CHUNK >= summary.length;
      await channel.send({
        embeds: [new EmbedBuilder()
          .setColor(isLast ? Colors.Green : Colors.Blurple)
          .setTitle(c === 0 ? '✅ Role Setup Complete' : '✅ Role Setup (continued)')
          .setDescription(chunk.join('\n'))
          .setFooter(isLast ? { text: 'All permissions saved. Run /setup-status to review your channels.' } : null)
        ],
      });
    }
  },
};

// ── /setup-roles (quick single-command edit) ────────────────────────────────
const setupRolesCommand = {
  data: new SlashCommandBuilder()
    .setName('setup-roles')
    .setDescription('Quickly add or remove a single role from a command\'s permission list')
    .addStringOption(o =>
      o.setName('command')
        .setDescription('The command to configure')
        .setRequired(true)
        .addChoices(...ALL_COMMANDS.slice(0, 25).map(c => ({ name: c, value: c })))
    )
    .addRoleOption(o => o.setName('role').setDescription('The role to add/remove').setRequired(true))
    .addStringOption(o =>
      o.setName('action')
        .setDescription('Add or remove the role')
        .setRequired(true)
        .addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' })
    ),

  async execute(interaction, db, utils) {
    if (!utils.hasSetupPermission(interaction.member)) {
      return utils.replyNoPermission(interaction, 'setup-roles');
    }

    const cmd = interaction.options.getString('command');
    const role = interaction.options.getRole('role');
    const action = interaction.options.getString('action');
    if (!role) return utils.replyError(interaction, 'Could not find that role.');

    const field = cmd.replace(/-/g, '_') + '_roles';
    const existing = await db.getGuildRoles(interaction.guildId, field);

    let updated;
    if (action === 'add') {
      if (existing.includes(role.id)) return utils.replyError(interaction, `${role} already has permission for **/${cmd}**.`);
      updated = [...existing, role.id];
    } else {
      updated = existing.filter(id => id !== role.id);
    }

    await db.setGuildRoles(interaction.guildId, field, updated);
    return utils.replySuccess(interaction, `${action === 'add' ? 'Added' : 'Removed'} ${role} ${action === 'add' ? 'to' : 'from'} **/${cmd}** permissions.`);
  },
};

// ── /setup-roles-extra (commands 26–30) ────────────────────────────────────
const setupRolesExtraCommand = {
  data: new SlashCommandBuilder()
    .setName('setup-roles-extra')
    .setDescription('Quickly add or remove a role for the remaining commands (reset-messages, snipe, etc.)')
    .addStringOption(o =>
      o.setName('command')
        .setDescription('The command to configure')
        .setRequired(true)
        .addChoices(...ALL_COMMANDS.slice(25).map(c => ({ name: c, value: c })))
    )
    .addRoleOption(o => o.setName('role').setDescription('The role to add/remove').setRequired(true))
    .addStringOption(o =>
      o.setName('action')
        .setDescription('Add or remove the role')
        .setRequired(true)
        .addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' })
    ),

  async execute(interaction, db, utils) {
    return setupRolesCommand.execute(interaction, db, utils);
  },
};

// ── /setup-status ──────────────────────────────────────────────────────────
const setupStatusCommand = {
  data: new SlashCommandBuilder()
    .setName('setup-status')
    .setDescription('View the current bot configuration for this server'),

  async execute(interaction, db, utils) {
    const cfg = await db.getGuild(interaction.guildId);
    if (!cfg) {
      return utils.replyError(interaction, 'This server has not been set up yet. Run **/setup** to get started.');
    }

    const ch = id => id ? `<#${id}>` : '`Not set`';
    const ro = id => id ? `<@&${id}>` : '`Not set`';

    return utils.safeReply(interaction, {
      embeds: [utils.buildEmbed({
        title: '⚙️ Bot Setup Status',
        color: Colors.Blurple,
        fields: [
          { name: '📋 General Log', value: ch(cfg.general_log_channel), inline: true },
          { name: '⚠️ Warn Log', value: ch(cfg.warn_log_channel), inline: true },
          { name: '📢 Ad-Warn Log', value: ch(cfg.ad_warn_log_channel), inline: true },
          { name: '🔨 Ban Request', value: ch(cfg.ban_request_channel), inline: true },
          { name: '🚫 Blacklist Request', value: ch(cfg.blacklist_request_channel), inline: true },
          { name: '🌐 Network Ban Request', value: ch(cfg.network_ban_request_channel), inline: true },
          { name: '🤝 Partnership Request', value: ch(cfg.partnership_request_channel), inline: true },
          { name: '✅ Partnership Accepted', value: ch(cfg.partnership_accepted_channel), inline: true },
          { name: '🔒 Jail Role', value: ro(cfg.jail_role), inline: true },
        ],
        footer: cfg.updated_at ? `Last updated: ${new Date(cfg.updated_at * 1000).toLocaleString()}` : 'Never updated',
      })],
      ephemeral: true,
    });
  },
};

// ── /setup-edit ────────────────────────────────────────────────────────────
const setupEditCommand = {
  data: new SlashCommandBuilder()
    .setName('setup-edit')
    .setDescription('Quickly edit a single channel or role in the bot configuration')
    .addStringOption(o =>
      o.setName('field')
        .setDescription('The setting to change')
        .setRequired(true)
        .addChoices(
          { name: 'General Log Channel', value: 'general_log_channel' },
          { name: 'Warn Log Channel', value: 'warn_log_channel' },
          { name: 'Ad-Warn Log Channel', value: 'ad_warn_log_channel' },
          { name: 'Ban Request Channel', value: 'ban_request_channel' },
          { name: 'Blacklist Request Channel', value: 'blacklist_request_channel' },
          { name: 'Network Ban Request Channel', value: 'network_ban_request_channel' },
          { name: 'Partnership Request Channel', value: 'partnership_request_channel' },
          { name: 'Partnership Accepted Channel', value: 'partnership_accepted_channel' },
          { name: 'Jail Role', value: 'jail_role' },
        )
    )
    .addChannelOption(o => o.setName('channel').setDescription('New channel value').setRequired(false))
    .addRoleOption(o => o.setName('role').setDescription('New role value (for Jail Role only)').setRequired(false)),

  async execute(interaction, db, utils) {
    const allowedRoles = await db.getGuildRoles(interaction.guildId, 'setup_edit_roles');
    if (!utils.hasSetupPermission(interaction.member) && !utils.hasPermission(interaction.member, allowedRoles)) {
      return utils.replyNoPermission(interaction, 'setup-edit');
    }

    const field = interaction.options.getString('field');
    const channel = interaction.options.getChannel('channel');
    const role = interaction.options.getRole('role');
    const isRoleField = field === 'jail_role';

    if (isRoleField && !role) return utils.replyError(interaction, 'Please provide a role for this field.');
    if (!isRoleField && !channel) return utils.replyError(interaction, 'Please provide a channel for this field.');

    const value = isRoleField ? role.id : channel.id;
    await db.upsertGuild(interaction.guildId, { [field]: value });

    const display = isRoleField ? `<@&${value}>` : `<#${value}>`;
    return utils.replySuccess(interaction, `**${field.replace(/_/g, ' ')}** updated to ${display}.`);
  },
};

// ── /setup-roles-all ───────────────────────────────────────────────────────
const COMMAND_GROUPS = {
  all:        ALL_COMMANDS,
  moderation: ['warn', 'warns', 'warn-leaderboard', 'ad-warn', 'remove-ad-warn', 'mute', 'unmute', 'ban', 'fire', 'promote', 'demote-user', 'strike', 'strike-remove', 'jail', 'unjail'],
  requests:   ['ban-request', 'blacklist-request', 'network-ban-request', 'partnership-request'],
  utility:    ['messages', 'message-leaderboard', 'case-info', 'balance', 'snipe', 'current-breaks', 'reset-messages', 'reset-messages-all', 'delete', 'request-break', 'break-end'],
  setup:      ['setup-status', 'setup-edit'],
};

const setupRolesAllCommand = {
  data: new SlashCommandBuilder()
    .setName('setup-roles-all')
    .setDescription('Instantly apply a role to every command (or a group) — fastest way to set permissions')
    .addRoleOption(o => o.setName('role').setDescription('Role to grant access').setRequired(true))
    .addStringOption(o =>
      o.setName('group')
        .setDescription('Which commands to apply to (default: all)')
        .setRequired(false)
        .addChoices(
          { name: 'all commands', value: 'all' },
          { name: 'moderation only', value: 'moderation' },
          { name: 'requests only', value: 'requests' },
          { name: 'utility only', value: 'utility' },
          { name: 'setup only', value: 'setup' },
        )
    )
    .addStringOption(o =>
      o.setName('action')
        .setDescription('Add or remove the role (default: add)')
        .setRequired(false)
        .addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' })
    ),

  async execute(interaction, db, utils) {
    if (!utils.hasSetupPermission(interaction.member)) {
      return utils.replyNoPermission(interaction, 'setup-roles-all');
    }

    const role   = interaction.options.getRole('role');
    const group  = interaction.options.getString('group') || 'all';
    const action = interaction.options.getString('action') || 'add';
    const cmds   = COMMAND_GROUPS[group] || ALL_COMMANDS;

    for (const cmd of cmds) {
      const field    = cmd.replace(/-/g, '_') + '_roles';
      const existing = await db.getGuildRoles(interaction.guildId, field);
      let updated;
      if (action === 'add') {
        updated = existing.includes(role.id) ? existing : [...existing, role.id];
      } else {
        updated = existing.filter(id => id !== role.id);
      }
      await db.setGuildRoles(interaction.guildId, field, updated);
    }

    const groupLabel = group === 'all' ? 'all commands' : `all **${group}** commands`;
    return utils.replySuccess(
      interaction,
      `${action === 'add' ? 'Added' : 'Removed'} ${role} ${action === 'add' ? 'to' : 'from'} ${groupLabel} (${cmds.length} commands updated).`,
    );
  },
};

// ── /setup-ad-channel ──────────────────────────────────────────────────────
const setupAdChannelCommand = {
  data: new SlashCommandBuilder()
    .setName('setup-ad-channel')
    .setDescription('Add or remove a channel or category from the ad auto-promotion list')
    .addStringOption(o =>
      o.setName('action')
        .setDescription('Add, remove, or list')
        .setRequired(true)
        .addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }, { name: 'list', value: 'list' })
    )
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('Channel or category to add/remove — adding a category covers ALL channels inside it')
        .setRequired(false)
    ),

  async execute(interaction, db, utils) {
    if (!utils.hasSetupPermission(interaction.member)) {
      return utils.replyNoPermission(interaction, 'setup-ad-channel');
    }

    const { ChannelType } = require('discord.js');
    const action  = interaction.options.getString('action');
    const channel = interaction.options.getChannel('channel');
    const current = await db.getAdChannels(interaction.guildId);

    if (action === 'list') {
      const display = current.length > 0
        ? current.map(id => {
            const ch = interaction.guild.channels.cache.get(id);
            const isCategory = ch?.type === ChannelType.GuildCategory;
            return isCategory ? `📁 **${ch?.name ?? id}** (category — all channels inside)` : `<#${id}>`;
          }).join('\n')
        : '`No ad channels or categories configured.`';

      return utils.safeReply(interaction, {
        embeds: [utils.buildEmbed({
          title: '📣 Ad Channels / Categories',
          description: `Cloudy Promotions is auto-sent when anyone posts in these:\n\n${display}`,
          color: Colors.Blurple,
        })],
        ephemeral: true,
      });
    }

    if (!channel) return utils.replyError(interaction, 'Please provide a channel or category.');

    const isCategory = channel.type === ChannelType.GuildCategory;
    const label = isCategory ? `category **${channel.name}**` : `${channel}`;

    if (action === 'add') {
      const added = await db.addAdChannel(interaction.guildId, channel.id);
      if (!added) return utils.replyError(interaction, `${label} is already in the ad list.`);
      const note = isCategory ? ' Every channel inside it will trigger the auto-promotion.' : '';
      return utils.replySuccess(interaction, `${label} added.${note}`);
    }

    if (action === 'remove') {
      if (!current.includes(channel.id)) return utils.replyError(interaction, `${label} is not in the ad list.`);
      await db.removeAdChannel(interaction.guildId, channel.id);
      return utils.replySuccess(interaction, `${label} removed from the ad list.`);
    }
  },
};

module.exports = [
  setupCommand,
  setupRolesAllCommand,
  setupRolesWizardCommand,
  setupRolesCommand,
  setupRolesExtraCommand,
  setupStatusCommand,
  setupEditCommand,
  setupAdChannelCommand,
];
