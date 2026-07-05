'use strict';

const {
  Client,
  GatewayIntentBits,
  Collection,
  REST,
  Routes,
  Events,
  EmbedBuilder
} = require('discord.js');

const db            = require('./database');
const utils         = require('./utils');
const setupCommands = require('./setup');
const commands      = require('./commands');
const extraCommands = require('./extraCommands');
const startWebServer = require('./webServer');

const { injectHandlers } = require('./handlers/injectHandlers');

const config    = require('./config');

const TOKEN     = process.env.A_TOKEN;
const CLIENT_ID = process.env.A_CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error('[FATAL] Missing A_TOKEN or A_CLIENT_ID env variables');
  process.exit(1);
}

// ── BREAK SYSTEM CONSTANTS ───────────────────────────────────
const BREAK_REQUEST_CHANNEL_ID = '1502595936952516709';
const MAIN_BREAK_ROLE_ID       = '1502596275521060884';
const STAFF_BREAK_ROLE_ID      = '1502596491745693758';

// Returns all "main" guild IDs (env var + any marked as 'main' in DB)
async function getMainGuildIds() {
  const envIds = (process.env.MAIN_GUILD_IDS || process.env.MAIN_GUILD_ID || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const dbIds = await db.getMainGuildIds();
  return [...new Set([...envIds, ...dbIds])];
}

// ── CLIENT ──────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildBans,
    GatewayIntentBits.GuildModeration,
  ],
});

const lastPromoMessage = new Map();

// ── COMMANDS ────────────────────────────────────────────────
client.commands = new Collection();

const allCommands = [
  ...setupCommands,
  ...commands,
  ...extraCommands
];

injectHandlers(allCommands);

for (const cmd of allCommands) {
  if (!cmd?.data?.name) continue;
  client.commands.set(cmd.data.name, cmd);
}

// ── COMMAND SCOPES ───────────────────────────────────────────
const MAIN_GUILD_COMMANDS = new Set([
  'warn', 'warns', 'warn-leaderboard',
  'ad-warn', 'remove-ad-warn',
  'mute', 'unmute', 'ban',
  'strike', 'strike-remove',
  'jail', 'unjail',
  'ban-request', 'blacklist-request', 'network-ban-request', 'partnership-request',
  'messages', 'message-leaderboard', 'case-info', 'balance',
  'snipe', 'current-breaks',
  'request-break', 'break-end',
  'delete',
  'setup', 'setup-roles-all', 'setup-roles-wizard',
  'setup-roles', 'setup-roles-extra', 'setup-status', 'setup-edit', 'setup-ad-channel',
]);

const STAFF_GUILD_COMMANDS = new Set([
  'fire', 'promote', 'demote-user',
  'strike-remove', 'remove-ad-warn',
  'reset-messages', 'reset-messages-all',
  'messages', 'message-leaderboard', 'case-info', 'warn-leaderboard',
  'current-breaks', 'snipe',
  'delete',
  'setup', 'setup-roles-all', 'setup-roles-wizard',
  'setup-roles', 'setup-roles-extra', 'setup-status', 'setup-edit', 'setup-ad-channel',
]);

// ── REGISTER ────────────────────────────────────────────────
async function registerCommands() {
  const rest    = new REST({ version: '10' }).setToken(TOKEN);
  const allJson = allCommands.filter(c => c?.data?.toJSON);

  const globalBody = allJson
    .filter(c => MAIN_GUILD_COMMANDS.has(c.data.name))
    .map(c => c.data.toJSON());

  const staffBody = allJson
    .filter(c => STAFF_GUILD_COMMANDS.has(c.data.name))
    .map(c => c.data.toJSON());

  // Clear old guild-specific commands from MAIN_GUILD_ID (legacy cleanup)
  if (process.env.MAIN_GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, process.env.MAIN_GUILD_ID), { body: [] });
  }

  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: globalBody });
  const staffGuildId = await config.getStaffGuildId();
  if (staffGuildId) {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, staffGuildId), { body: staffBody });
  }

  console.log(`[Slash Commands] Global: ${globalBody.length} | Staff server: ${staffBody.length}`);
}

// ── READY ───────────────────────────────────────────────────
client.once(Events.ClientReady, async (c) => {
  console.log(`[Bot] Logged in as ${c.user.tag}`);
  await registerCommands();
  processExpiredBreaks();
  setInterval(processExpiredBreaks, 5 * 60 * 1000);
});

// ── COMMAND HANDLER ─────────────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) return;

  try {
    await cmd.execute(interaction, db, utils, client);
  } catch (err) {
    console.error(err);
    await utils.safeReply(interaction, { content: '❌ An error occurred.', ephemeral: true });
  }
});

// ── BREAK BUTTON HANDLER ─────────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;

  // ── ACCEPT ──
  if (interaction.customId.startsWith('break_accept_')) {
    try {
      const parts  = interaction.customId.split('_');
      const userId = parts[2];
      const endTime = parts[3] ? Number(parts[3]) : null;

      const staffGuildId = await config.getStaffGuildId();
      const staffGuild = client.guilds.cache.get(staffGuildId);
      const staffMember = staffGuild ? await staffGuild.members.fetch(userId).catch(() => null) : null;

      // Add break role to ALL main guilds
      const mainGuildIds = await getMainGuildIds();
      for (const gid of mainGuildIds) {
        const g = client.guilds.cache.get(gid);
        if (!g) continue;
        const m = await g.members.fetch(userId).catch(() => null);
        if (m) await m.roles.add(MAIN_BREAK_ROLE_ID).catch(() => {});
      }

      // Staff server: save roles, remove them, add break role
      if (staffMember) {
        const removeRoles = staffMember.roles.cache.filter(
          r => r.id !== staffGuild.id && !r.managed && r.id !== STAFF_BREAK_ROLE_ID
        );
        await db.saveBreakRoles(userId, removeRoles.map(r => r.id));
        await staffMember.roles.remove(removeRoles);
        await staffMember.roles.add(STAFF_BREAK_ROLE_ID);
      }

      // Store timed break in DB
      if (endTime) {
        await db.insertTimedBreak(staffGuildId, userId, 'Approved break', Date.now(), endTime);
      }

      const embed = EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(0x57F287)
        .addFields({ name: 'Accepted By', value: `${interaction.user}` });

      await interaction.update({ embeds: [embed], components: [] });

    } catch (err) {
      console.error('[Break Accept]', err);
    }
  }

  // ── DENY ──
  if (interaction.customId.startsWith('break_deny_')) {
    const embed = EmbedBuilder.from(interaction.message.embeds[0])
      .setColor(0xED4245)
      .addFields({ name: 'Denied By', value: `${interaction.user}` });

    await interaction.update({ embeds: [embed], components: [] });
  }
});

// ── MESSAGE TRACKING ─────────────────────────────────────────
client.on(Events.MessageCreate, async (message) => {
  if (!message.guild || message.author.bot) return;
  try { await db.incrementMessageCount(message.guild.id, message.author.id); } catch {}
});

// ── SNIPE ────────────────────────────────────────────────────
client.on(Events.MessageDelete, async (message) => {
  if (!message.guild || message.author?.bot) return;
  try { await db.setSnipe(message.guild.id, message.channel.id, message.author?.id, message.content || '[No content]'); } catch {}
});

// ── BREAK AUTO-EXPIRY ────────────────────────────────────────
async function processExpiredBreaks() {
  const expired = await db.getExpiredBreaks();
  if (expired.length === 0) return;

  const staffGuildId = await config.getStaffGuildId();
  const staffGuild = client.guilds.cache.get(staffGuildId);
  const mainGuildIds = await getMainGuildIds();

  for (const row of expired) {
    const { id, user_id } = row;

    try {
      // Remove break role from all main guilds
      for (const gid of mainGuildIds) {
        const g = client.guilds.cache.get(gid);
        if (!g) continue;
        const m = await g.members.fetch(user_id).catch(() => null);
        if (m) await m.roles.remove(MAIN_BREAK_ROLE_ID).catch(() => {});
      }

      // Restore staff roles
      if (staffGuild) {
        const staffMember = await staffGuild.members.fetch(user_id).catch(() => null);
        if (staffMember) {
          const savedRoles = await db.getBreakRoles(user_id);
          if (savedRoles.length > 0) {
            const valid = savedRoles.filter(rid => staffGuild.roles.cache.has(rid));
            await staffMember.roles.set(valid).catch(() => {});
          } else {
            await staffMember.roles.remove(STAFF_BREAK_ROLE_ID).catch(() => {});
          }
        }
      }

      await db.deleteBreakRoles(user_id);
      await db.markBreakCompleted(id);

      const user = await client.users.fetch(user_id).catch(() => null);
      if (user) await user.send('☕ Your break has ended and your roles have been restored. Welcome back!').catch(() => {});

      const breakCh = await client.channels.fetch(BREAK_REQUEST_CHANNEL_ID).catch(() => null);
      if (breakCh) await breakCh.send(`✅ Break auto-ended for <@${user_id}> — roles restored.`).catch(() => {});

      console.log(`[Break Auto-Expiry] Processed break #${id} for ${user_id}`);

    } catch (err) {
      console.error(`[Break Auto-Expiry] Error on break #${id}:`, err);
    }
  }
}

// ── ERROR HANDLING ───────────────────────────────────────────
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

// ── START WEB SERVER ─────────────────────────────────────────
startWebServer(client, db);

// ── LOGIN ────────────────────────────────────────────────────
client.login(TOKEN);
