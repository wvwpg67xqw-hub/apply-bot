require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  REST,
  Routes,
} = require("discord.js");
const { startCLI }       = require("./utils/cli");
const { startWebServer } = require("./server/web");
const { watchPresence }  = require("./utils/presence");
const { DEV_COMMANDS, handleDevCommand, DEV_GUILD_ID } = require("./devSystem");
const { devLog } = require("./utils/devlog");
const log = require("./utils/logger");

const { commands: commandModules, commandsJson } = require("./commands");
const { dispatchButton } = require("./buttons");

const {
  getConfig,
  getGuild,
  setGuildConfig,
  addToBlacklist,
  removeFromBlacklist,
  isBlacklisted,
  getPendingJoins,
  removePendingJoin,
  restoreBlacklistRole,
  startBlacklistExpiration,
} = require("./lib/db");

const { parseDuration } = require("./lib/duration");
const { 
  AUTO_UNBLACKLIST_ROLE, 
  getServerConfig, 
  GROWTH_GUILD_IDS 
} = require("./lib/serverConfig");

const { autoLinkNewGuild } = require("./lib/staffSetup");
const { buildPanelEmbed, buildPanelRow, PANEL_ROLE_DEFS } = require("./lib/panel");
const { startInviteRotation } = require("./lib/invite");
const { startJoinWatcher } = require("./lib/joinWatcher");

const allCommands = [...commandsJson, ...DEV_COMMANDS];

// ─── Client ───────────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageTyping,
    GatewayIntentBits.DirectMessageTyping,
  ],
});

client.once("ready", async () => {
  log.info("BOT", `Logged in as ${client.user.tag} (${client.user.id})`);
  log.info("BOT", `In ${client.guilds.cache.size} guild(s)`);

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  try {
    log.info("COMMANDS", "Registering global slash commands...");
    await rest.put(Routes.applicationCommands(client.user.id), { body: commandsJson });
    log.info("COMMANDS", `Registered ${commandsJson.length} global commands`);
  } catch (err) {
    log.error("COMMANDS", "Failed to register global commands", err.message);
  }
  try {
    log.info("COMMANDS", `Registering ${DEV_COMMANDS.length} dev commands to guild ${DEV_GUILD_ID}...`);
    await rest.put(Routes.applicationGuildCommands(client.user.id, DEV_GUILD_ID), { body: DEV_COMMANDS });
    log.info("COMMANDS", `Registered ${DEV_COMMANDS.length} dev commands (guild-only)`);
  } catch (err) {
    log.error("COMMANDS", "Failed to register dev guild commands", err.message);
  }

  // Link any unlinked guilds if a staff server is already configured
  const cfg = await getConfig();
  if (cfg.staffGuildId) {
    const staffGuild = client.guilds.cache.get(cfg.staffGuildId);
    if (staffGuild) {
      for (const guild of client.guilds.cache.values()) {
        if (guild.id === staffGuild.id) continue;
        const guildCfg = await getGuild(guild.id);
        if (guildCfg?.routeChannelId) continue;
        const entry = getServerConfig(guild.name, guild.id);
        if (!entry) continue;
        const ch = staffGuild.channels.cache.find(
          (c) => entry.channelNames.includes(c.name) && c.isTextBased()
        );
        if (ch) {
          await setGuildConfig(guild.id, { routeChannelId: ch.id });
          log.info("LINK", `Linked [${guild.name}] → #${ch.name}`);
        }
      }
    }
  }

  startCLI(client, { addToBlacklist, removeFromBlacklist, isBlacklisted, parseDuration });

  const webPort = parseInt(process.env.PORT ?? "3000", 10);
  startWebServer(client, webPort);

  await startInviteRotation(client);
  watchPresence(client);
  startJoinWatcher(client);
});

client.on("guildCreate", async (guild) => {
  log.info("GUILD", `Joined guild: ${guild.name}`);
  await autoLinkNewGuild(client, guild);
});

client.on("guildMemberAdd", async (member) => {
  const cfg = await getConfig();
  if (member.guild.id !== cfg.staffGuildId) return;
  const pendingList = await getPendingJoins();
  const pending = pendingList.find((e) => e.userId === member.id);
  if (!pending) return;
  await removePendingJoin(member.id);
  log.info("JOIN_WATCH", `${member.user.tag} joined staff server — removed from pending list`);
});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  const gained = !oldMember.roles.cache.has(AUTO_UNBLACKLIST_ROLE) &&
                  newMember.roles.cache.has(AUTO_UNBLACKLIST_ROLE);
  if (!gained) return;

  const removed = await removeFromBlacklist(newMember.guild.id, newMember.id);
  if (removed) {
    log.info("UNBLACKLIST", `Auto-unblacklisted ${newMember.user.tag} (${newMember.id}) in [${newMember.guild.name}] — gained role ${AUTO_UNBLACKLIST_ROLE}`);
    try {
      await newMember.send(
        `✅ You have been automatically removed from the blacklist in **${newMember.guild.name}** because you were granted a trusted role.`
      );
    } catch {}
  }
});

// ─── Interaction handler ──────────────────────────────────────────────────────

client.on("interactionCreate", async (interaction) => {

  // ── Slash commands ──────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    const { commandName, guild, user } = interaction;
    log.info("CMD", `/${commandName} — ${user.tag} (${user.id}) in [${guild?.name}]`);

    // Route dev commands first
    try {
      const handled = await handleDevCommand(interaction, client, {
        allCommandsJson: allCommands,
        getGuild,
        setGuildConfig,
        buildPanelEmbed,
        buildPanelRow,
        GROWTH_GUILD_IDS,
        PANEL_ROLE_DEFS,
      });
      if (handled) {
        devLog(client, "devLogs", {
          title: `🛠️ Dev Command: /${commandName}`,
          fields: [
            { name: "By",    value: `<@${user.id}> (${user.tag})`, inline: true },
            { name: "Guild", value: guild?.name ?? "Unknown",       inline: true },
          ],
        });
        return;
      }
    } catch (err) {
      log.error("DEV", `Dev command error in /${commandName}`, err.message);
      devLog(client, "devErrors", {
        title: `❌ Dev Command Error: /${commandName}`,
        fields: [
          { name: "Error",  value: err.message,                    inline: false },
          { name: "By",     value: `<@${user.id}> (${user.tag})`, inline: true  },
        ],
      });
      return;
    }

    const cmd = commandModules.get(commandName);
    if (!cmd) return;

    try {
      await cmd.execute(interaction, client);
    } catch (err) {
      log.error("CMD", `Error in /${commandName}`, err.message);
      devLog(client, "devErrors", {
        title: `❌ Command Error: /${commandName}`,
        fields: [
          { name: "Error", value: `\`\`\`${err.message}\`\`\``, inline: false },
          { name: "By",    value: `<@${user.id}> (${user.tag})`, inline: true },
          { name: "Guild", value: guild?.name ?? "Unknown",       inline: true },
        ],
      }).catch(() => {});
      const payload = { content: `❌ Something went wrong: ${err.message}`, ephemeral: true };
      try {
        if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
        else await interaction.reply(payload);
      } catch {}
    }
    return;
  }

  // ── Button interactions ─────────────────────────────────────────────────────
  if (interaction.isButton()) {
    try {
      await dispatchButton(interaction);
    } catch (err) {
      log.error("BUTTON", `Error handling button ${interaction.customId}`, err.message);
      devLog(client, "devErrors", {
        title: `❌ Button Error: ${interaction.customId}`,
        fields: [
          { name: "Error", value: `\`\`\`${err.message}\`\`\``, inline: false },
          { name: "By",    value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
        ],
      }).catch(() => {});
    }
  }
});

// ─── Login ────────────────────────────────────────────────────────────────────

const token = process.env.DISCORD_TOKEN;
if (!token) {
  log.error("BOT", "DISCORD_TOKEN is not set — add it as a secret");
  process.exit(1);
}

client.login(token).catch((err) => {
  log.error("BOT", "Failed to login", err.message);
  process.exit(1);
});
