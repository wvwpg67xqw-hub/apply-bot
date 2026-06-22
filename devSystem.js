const {
  SlashCommandBuilder,
  PermissionsBitField,
  EmbedBuilder,
  AttachmentBuilder,
  ChannelType,
  REST,
  Routes,
} = require("discord.js");
const fs   = require("fs");
const path = require("path");
const { read, write } = require("./utils/jsondb");
const { devLog }      = require("./utils/devlog");
const log             = require("./utils/logger");

const CONFIG_PATH = "./data/config.json";
const DATA_FILES  = {
  guilds:       "./data/guilds.json",
  applications: "./data/applications.json",
  config:       "./data/config.json",
  status:       "./data/status.json",
  activity:     "./data/activity.json",
};

function getConfig()        { return read(CONFIG_PATH) || {}; }
function setConfig(updates) { write(CONFIG_PATH, { ...getConfig(), ...updates }); }

// ─── Dev channel definitions ──────────────────────────────────────────────────

const DEV_CHANNEL_DEFS = [
  { key: "devControl", name: "🤖・dev-control", topic: "Developer control panel — bot commands and restarts" },
  { key: "devTools",   name: "🛠️・dev-tools",   topic: "Developer utilities and diagnostics" },
  { key: "devLogs",    name: "📜・dev-logs",     topic: "All dev command usage and action logs" },
  { key: "devErrors",  name: "⚠️・dev-errors",   topic: "Runtime errors and bot error alerts" },
  { key: "devTesting", name: "🧪・dev-testing",  topic: "Test commands and application flow simulations" },
  { key: "devData",    name: "🗄️・dev-data",     topic: "Data backups, restores, and resets" },
];

// ─── Dev channel setup ────────────────────────────────────────────────────────

async function setupDevCategory(guild, devRole) {
  const everyoneId = guild.roles.everyone.id;

  const baseOverwrites = [
    { id: everyoneId, deny: [PermissionsBitField.Flags.ViewChannel] },
  ];
  if (devRole) {
    baseOverwrites.push({
      id: devRole.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.AttachFiles,
      ],
    });
  }

  // Find existing dev category or create one
  const botName = guild.members.me?.displayName || "Bot";
  let category = guild.channels.cache.find(
    c => c.type === ChannelType.GuildCategory &&
         (c.name.toLowerCase().includes("dev") || c.id === getConfig().devCategoryId)
  );

  if (!category) {
    category = await guild.channels.create({
      name: `🔧 ${botName} Dev`,
      type: ChannelType.GuildCategory,
      permissionOverwrites: baseOverwrites,
    });
  } else {
    await category.permissionOverwrites.set(baseOverwrites);
  }

  const devChannelIds = {};
  const lines = [];

  for (const def of DEV_CHANNEL_DEFS) {
    // Look for existing channel in the category
    let ch = guild.channels.cache.find(
      c => c.parentId === category.id && c.isTextBased() &&
           c.name.replace(/\s/g, "-").toLowerCase().includes(def.key.replace("dev", "dev-"))
    );

    if (!ch) {
      ch = await guild.channels.create({
        name:                 def.name,
        type:                 ChannelType.GuildText,
        parent:               category.id,
        topic:                def.topic,
        permissionOverwrites: baseOverwrites,
      });
      lines.push(`✅ Created ${ch}`);
    } else {
      lines.push(`⏭️ Already exists ${ch}`);
    }
    devChannelIds[def.key] = ch.id;
  }

  setConfig({
    devChannels:    devChannelIds,
    devRoleId:      devRole?.id || null,
    devCategoryId:  category.id,
    devGuildId:     guild.id,
  });

  return { lines, devChannelIds, category };
}

// ─── Permission check ─────────────────────────────────────────────────────────

function isDevUser(interaction) {
  const member = interaction.member;
  if (!member) return false;
  if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) return false;
  const devRoleId = getConfig().devRoleId;
  if (devRoleId && !member.roles.cache.has(devRoleId)) return false;
  return true;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function bytesToMB(bytes) { return (bytes / 1024 / 1024).toFixed(2); }
function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

async function reRegisterCommands(client, allCommandsJson) {
  const token     = process.env.DISCORD_TOKEN;
  const clientId  = client.user.id;
  const rest      = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationCommands(clientId), { body: allCommandsJson });
}

// ─── Slash command definitions ────────────────────────────────────────────────

const DEV_COMMANDS = [
  // Setup
  new SlashCommandBuilder()
    .setName("setupdev")
    .setDescription("(Dev) Create the dev category and all dev channels in this server.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addRoleOption(o =>
      o.setName("role")
        .setDescription("Developer/admin role that gets access to the dev channels.")
        .setRequired(false)
    ),

  // Control
  new SlashCommandBuilder()
    .setName("reload")
    .setDescription("(Dev) Reload and re-register all slash commands with Discord.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName("restart")
    .setDescription("(Dev) Safely restart the bot process.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName("shutdown")
    .setDescription("(Dev) Shut down the bot process.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("(Dev) Show bot status: uptime, ping, and memory usage.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("(Dev) Check bot WebSocket and API latency.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName("sync")
    .setDescription("(Dev) Sync slash commands with Discord.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName("deploy")
    .setDescription("(Dev) Deploy latest command changes to Discord globally.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  // Testing
  new SlashCommandBuilder()
    .setName("test")
    .setDescription("(Dev) Run a basic system health test.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName("test-app")
    .setDescription("(Dev) Simulate an application submission for a user.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addUserOption(o =>
      o.setName("user").setDescription("User to simulate the application for.").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("type")
        .setDescription("Application type (default: hr).")
        .setRequired(false)
        .addChoices(
          { name: "👥 HR",                  value: "hr"          },
          { name: "🔨 Mod",                  value: "mod"         },
          { name: "🤝 Partnership Manager",  value: "partnership" },
        )
    ),

  new SlashCommandBuilder()
    .setName("simulate-flow")
    .setDescription("(Dev) Run a full application flow diagnostic and report results.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  // Data
  new SlashCommandBuilder()
    .setName("backup")
    .setDescription("(Dev) Backup all bot data as a downloadable JSON file.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName("restore")
    .setDescription("(Dev) Restore bot data from a backup JSON file attachment.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addAttachmentOption(o =>
      o.setName("file").setDescription("Backup JSON file exported from /backup.").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("reset-app")
    .setDescription("(Dev) Reset all application records for a specific user.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addUserOption(o =>
      o.setName("user").setDescription("User whose applications to reset.").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("delete-app")
    .setDescription("(Dev) Permanently delete an application by ID.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addStringOption(o =>
      o.setName("id").setDescription("Application ID (e.g. APP-ABC123).").setRequired(true)
    ),
].map(c => c.toJSON());

// ─── Command handler ──────────────────────────────────────────────────────────

async function handleDevCommand(interaction, client, helpers) {
  const { allCommandsJson } = helpers;
  const { commandName, user, guild } = interaction;

  const devCommandNames = new Set(DEV_COMMANDS.map(c => c.name));
  if (!devCommandNames.has(commandName)) return false;

  // Permission gate
  if (!isDevUser(interaction)) {
    await interaction.reply({ content: "🔒 You don't have permission to use dev commands.", ephemeral: true });
    return true;
  }

  // ── /setupdev ────────────────────────────────────────────────────────────────
  if (commandName === "setupdev") {
    await interaction.deferReply({ ephemeral: true });
    const devRole = interaction.options.getRole("role");
    try {
      const { lines, category } = await setupDevCategory(guild, devRole);
      await interaction.editReply({
        content:
          `✅ Dev system set up under **${category.name}**.\n\n` +
          lines.join("\n") +
          (devRole ? `\n\n🔐 Access restricted to <@&${devRole.id}>.` : "\n\n⚠️ No role set — only the channel's permission overwrites apply."),
      });
      await devLog(client, "devLogs", {
        title: "⚙️ Dev System Initialized",
        fields: [
          { name: "By",     value: `<@${user.id}> (${user.tag})`, inline: true },
          { name: "Guild",  value: guild.name,                     inline: true },
          { name: "Role",   value: devRole ? `<@&${devRole.id}>` : "None", inline: true },
        ],
      });
    } catch (err) {
      log.error("DEV", "setupdev failed", err.message);
      await interaction.editReply({ content: `❌ Setup failed: ${err.message}` });
    }
    return true;
  }

  // ── /reload ──────────────────────────────────────────────────────────────────
  if (commandName === "reload") {
    await interaction.deferReply({ ephemeral: true });
    try {
      await reRegisterCommands(client, allCommandsJson);
      await interaction.editReply(`✅ ${allCommandsJson.length} slash commands reloaded.`);
      await devLog(client, "devLogs", {
        title: "🔄 Commands Reloaded",
        fields: [
          { name: "By",    value: `<@${user.id}> (${user.tag})`, inline: true },
          { name: "Count", value: `${allCommandsJson.length}`,   inline: true },
        ],
      });
    } catch (err) {
      await interaction.editReply(`❌ Reload failed: ${err.message}`);
      await devLog(client, "devErrors", { title: "❌ Reload Failed", description: err.message });
    }
    return true;
  }

  // ── /restart ─────────────────────────────────────────────────────────────────
  if (commandName === "restart") {
    await interaction.reply({ content: "🔄 Restarting bot...", ephemeral: true });
    await devLog(client, "devLogs", {
      title: "🔄 Bot Restarting",
      fields: [{ name: "By", value: `<@${user.id}> (${user.tag})`, inline: true }],
    });
    log.info("DEV", `Restart requested by ${user.tag}`);
    setTimeout(() => process.exit(0), 1500);
    return true;
  }

  // ── /shutdown ────────────────────────────────────────────────────────────────
  if (commandName === "shutdown") {
    await interaction.reply({ content: "⛔ Shutting down bot...", ephemeral: true });
    await devLog(client, "devLogs", {
      title: "⛔ Bot Shutdown",
      fields: [{ name: "By", value: `<@${user.id}> (${user.tag})`, inline: true }],
      color: 0xed4245,
    });
    log.info("DEV", `Shutdown requested by ${user.tag}`);
    setTimeout(async () => { await client.destroy(); process.exit(0); }, 1500);
    return true;
  }

  // ── /status ──────────────────────────────────────────────────────────────────
  if (commandName === "status") {
    const mem    = process.memoryUsage();
    const uptime = formatUptime(process.uptime());
    const embed = new EmbedBuilder()
      .setTitle("📊 Bot Status")
      .setColor(0x57f287)
      .addFields(
        { name: "⏱️ Uptime",         value: uptime,                              inline: true },
        { name: "📶 WS Ping",         value: `${client.ws.ping}ms`,              inline: true },
        { name: "🔗 Guilds",          value: `${client.guilds.cache.size}`,       inline: true },
        { name: "🧠 Heap Used",       value: `${bytesToMB(mem.heapUsed)} MB`,     inline: true },
        { name: "🧠 Heap Total",      value: `${bytesToMB(mem.heapTotal)} MB`,    inline: true },
        { name: "💾 RSS",             value: `${bytesToMB(mem.rss)} MB`,          inline: true },
      )
      .setTimestamp();
    await interaction.reply({ embeds: [embed], ephemeral: true });
    await devLog(client, "devLogs", {
      title: "📊 Status Checked",
      fields: [{ name: "By", value: `<@${user.id}> (${user.tag})`, inline: true }],
    });
    return true;
  }

  // ── /ping ────────────────────────────────────────────────────────────────────
  if (commandName === "ping") {
    const sent = await interaction.reply({ content: "🏓 Pinging...", fetchReply: true, ephemeral: true });
    const apiLatency = sent.createdTimestamp - interaction.createdTimestamp;
    await interaction.editReply(
      `🏓 **Pong!**\n> WS Latency: \`${client.ws.ping}ms\`\n> API Latency: \`${apiLatency}ms\``
    );
    return true;
  }

  // ── /sync ────────────────────────────────────────────────────────────────────
  if (commandName === "sync") {
    await interaction.deferReply({ ephemeral: true });
    try {
      await reRegisterCommands(client, allCommandsJson);
      await interaction.editReply(`✅ Synced ${allCommandsJson.length} commands with Discord.`);
      await devLog(client, "devLogs", {
        title: "🔃 Commands Synced",
        fields: [
          { name: "By",    value: `<@${user.id}> (${user.tag})`, inline: true },
          { name: "Count", value: `${allCommandsJson.length}`,   inline: true },
        ],
      });
    } catch (err) {
      await interaction.editReply(`❌ Sync failed: ${err.message}`);
      await devLog(client, "devErrors", { title: "❌ Sync Failed", description: err.message });
    }
    return true;
  }

  // ── /deploy ──────────────────────────────────────────────────────────────────
  if (commandName === "deploy") {
    await interaction.deferReply({ ephemeral: true });
    try {
      await reRegisterCommands(client, allCommandsJson);
      await interaction.editReply(`✅ Deployed ${allCommandsJson.length} commands globally.`);
      await devLog(client, "devLogs", {
        title: "🚀 Commands Deployed",
        fields: [
          { name: "By",    value: `<@${user.id}> (${user.tag})`,  inline: true },
          { name: "Count", value: `${allCommandsJson.length}`,    inline: true },
        ],
      });
    } catch (err) {
      await interaction.editReply(`❌ Deploy failed: ${err.message}`);
      await devLog(client, "devErrors", { title: "❌ Deploy Failed", description: err.message });
    }
    return true;
  }

  // ── /test ────────────────────────────────────────────────────────────────────
  if (commandName === "test") {
    await interaction.deferReply({ ephemeral: true });
    const cfg    = getConfig();
    const guilds = read("./data/guilds.json") || [];
    const apps   = read("./data/applications.json") || [];

    const checks = [
      { name: "Discord Connection",    pass: client.isReady()              },
      { name: "WS Ping < 500ms",       pass: client.ws.ping < 500          },
      { name: "Config file readable",  pass: !!cfg                         },
      { name: "Staff guild set",       pass: !!cfg.staffGuildId            },
      { name: "Dev channels set",      pass: !!cfg.devChannels?.devLogs    },
      { name: "Guilds DB readable",    pass: Array.isArray(guilds)         },
      { name: "Applications DB readable", pass: Array.isArray(apps)       },
    ];

    const passed = checks.filter(c => c.pass).length;
    const embed  = new EmbedBuilder()
      .setTitle("🧪 System Test Results")
      .setColor(passed === checks.length ? 0x57f287 : 0xfee75c)
      .setDescription(
        checks.map(c => `${c.pass ? "✅" : "❌"} ${c.name}`).join("\n")
      )
      .addFields(
        { name: "Result", value: `${passed}/${checks.length} passed`, inline: true },
        { name: "WS Ping", value: `${client.ws.ping}ms`, inline: true },
        { name: "Guilds",  value: `${client.guilds.cache.size}`, inline: true },
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    await devLog(client, "devTesting", {
      title: "🧪 System Test Run",
      fields: [
        { name: "By",     value: `<@${user.id}> (${user.tag})`, inline: true },
        { name: "Result", value: `${passed}/${checks.length}`,  inline: true },
      ],
      color: passed === checks.length ? 0x57f287 : 0xfee75c,
    });
    return true;
  }

  // ── /test-app ────────────────────────────────────────────────────────────────
  if (commandName === "test-app") {
    const target   = interaction.options.getUser("user");
    const roleType = interaction.options.getString("type") || "hr";
    const ROLE_LABELS = { hr: "👥 HR", mod: "🔨 Mod", partnership: "🤝 Partnership Manager" };

    const embed = new EmbedBuilder()
      .setTitle("🧪 Application Simulation")
      .setColor(0x57f287)
      .setDescription(`Simulated a **${ROLE_LABELS[roleType]}** application.`)
      .addFields(
        { name: "Target User", value: `<@${target.id}> (${target.tag})`, inline: true },
        { name: "Role Type",   value: ROLE_LABELS[roleType],              inline: true },
        { name: "Guild",       value: guild.name,                         inline: true },
        { name: "Note",        value: "This is a simulation only — no DMs were sent and no real application was created.", inline: false },
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
    await devLog(client, "devTesting", {
      title: "🧪 Application Simulated",
      fields: [
        { name: "By",          value: `<@${user.id}> (${user.tag})`,    inline: true },
        { name: "Target User", value: `<@${target.id}> (${target.tag})`, inline: true },
        { name: "Role",        value: ROLE_LABELS[roleType],              inline: true },
      ],
    });
    return true;
  }

  // ── /simulate-flow ────────────────────────────────────────────────────────────
  if (commandName === "simulate-flow") {
    await interaction.deferReply({ ephemeral: true });
    const cfg    = getConfig();
    const guilds = read("./data/guilds.json") || [];

    const steps = [
      { step: "Bot is online and connected",          pass: client.isReady()           },
      { step: "Staff guild configured",               pass: !!cfg.staffGuildId         },
      { step: "Staff guild is in cache",              pass: !!client.guilds.cache.get(cfg.staffGuildId) },
      { step: "Dev channels configured",              pass: !!cfg.devChannels?.devLogs  },
      { step: "At least one source guild configured", pass: guilds.some(g => g.routeChannelId) },
      { step: "Applications DB writable",             pass: (() => { try { const a = read("./data/applications.json"); write("./data/applications.json", a); return true; } catch { return false; } })() },
    ];

    const passed = steps.filter(s => s.pass).length;
    const allOk  = passed === steps.length;

    const embed = new EmbedBuilder()
      .setTitle("🔁 Application Flow Simulation")
      .setColor(allOk ? 0x57f287 : 0xed4245)
      .setDescription(steps.map(s => `${s.pass ? "✅" : "❌"} ${s.step}`).join("\n"))
      .addFields({ name: "Overall", value: allOk ? "✅ All checks passed" : `⚠️ ${steps.length - passed} check(s) failed`, inline: false })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    await devLog(client, "devTesting", {
      title: "🔁 Flow Simulation Run",
      fields: [
        { name: "By",     value: `<@${user.id}> (${user.tag})`, inline: true },
        { name: "Result", value: `${passed}/${steps.length}`,   inline: true },
        { name: "Status", value: allOk ? "All passed" : "Some failed", inline: true },
      ],
      color: allOk ? 0x57f287 : 0xed4245,
    });
    return true;
  }

  // ── /backup ──────────────────────────────────────────────────────────────────
  if (commandName === "backup") {
    await interaction.deferReply({ ephemeral: true });
    try {
      const snapshot = { _meta: { timestamp: new Date().toISOString(), by: user.tag } };
      for (const [key, filePath] of Object.entries(DATA_FILES)) {
        snapshot[key] = read(filePath) ?? null;
      }
      const json       = JSON.stringify(snapshot, null, 2);
      const buffer     = Buffer.from(json, "utf-8");
      const filename   = `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      const attachment = new AttachmentBuilder(buffer, { name: filename });

      await interaction.editReply({ content: "✅ Backup created.", files: [attachment] });
      await devLog(client, "devData", {
        title: "🗄️ Backup Created",
        fields: [
          { name: "By",   value: `<@${user.id}> (${user.tag})`, inline: true },
          { name: "File", value: filename,                       inline: true },
        ],
      });
    } catch (err) {
      await interaction.editReply(`❌ Backup failed: ${err.message}`);
      await devLog(client, "devErrors", { title: "❌ Backup Failed", description: err.message });
    }
    return true;
  }

  // ── /restore ─────────────────────────────────────────────────────────────────
  if (commandName === "restore") {
    await interaction.deferReply({ ephemeral: true });
    const attachment = interaction.options.getAttachment("file");
    if (!attachment.name.endsWith(".json")) {
      await interaction.editReply("❌ Please attach a `.json` file exported from `/backup`.");
      return true;
    }
    try {
      const response = await fetch(attachment.url);
      const text     = await response.text();
      const snapshot = JSON.parse(text);

      let restored = 0;
      for (const [key, filePath] of Object.entries(DATA_FILES)) {
        if (snapshot[key] !== undefined) {
          write(filePath, snapshot[key]);
          restored++;
        }
      }

      await interaction.editReply(`✅ Restored ${restored} data file(s) from \`${attachment.name}\`.`);
      await devLog(client, "devData", {
        title: "♻️ Data Restored",
        fields: [
          { name: "By",           value: `<@${user.id}> (${user.tag})`, inline: true },
          { name: "File",         value: attachment.name,                inline: true },
          { name: "Files Restored", value: `${restored}`,               inline: true },
        ],
        color: 0xfee75c,
      });
    } catch (err) {
      await interaction.editReply(`❌ Restore failed: ${err.message}`);
      await devLog(client, "devErrors", { title: "❌ Restore Failed", description: err.message });
    }
    return true;
  }

  // ── /reset-app ───────────────────────────────────────────────────────────────
  if (commandName === "reset-app") {
    const target = interaction.options.getUser("user");
    const apps   = read("./data/applications.json") || [];
    const before = apps.length;
    const kept   = apps.filter(a => a.applicantId !== target.id);
    write("./data/applications.json", kept);
    const removed = before - kept.length;

    await interaction.reply({
      content: `✅ Removed **${removed}** application record(s) for <@${target.id}>.`,
      ephemeral: true,
    });
    await devLog(client, "devData", {
      title: "🗑️ User Applications Reset",
      fields: [
        { name: "By",      value: `<@${user.id}> (${user.tag})`,    inline: true },
        { name: "Target",  value: `<@${target.id}> (${target.tag})`, inline: true },
        { name: "Removed", value: `${removed} record(s)`,            inline: true },
      ],
      color: 0xfee75c,
    });
    return true;
  }

  // ── /delete-app ──────────────────────────────────────────────────────────────
  if (commandName === "delete-app") {
    const rawId = interaction.options.getString("id").trim().toUpperCase();
    const apps  = read("./data/applications.json") || [];
    const idx   = apps.findIndex(a => a.id === rawId);

    if (idx === -1) {
      await interaction.reply({ content: `❌ No application found with ID \`${rawId}\`.`, ephemeral: true });
      return true;
    }

    const deleted = apps.splice(idx, 1)[0];
    write("./data/applications.json", apps);

    await interaction.reply({
      content: `✅ Permanently deleted application \`${rawId}\` (submitted by <@${deleted.applicantId}>).`,
      ephemeral: true,
    });
    await devLog(client, "devData", {
      title: "🗑️ Application Deleted",
      fields: [
        { name: "By",        value: `<@${user.id}> (${user.tag})`,       inline: true },
        { name: "App ID",    value: `\`${rawId}\``,                       inline: true },
        { name: "Applicant", value: `<@${deleted.applicantId}>`,          inline: true },
      ],
      color: 0xed4245,
    });
    return true;
  }

  return false;
}

module.exports = { DEV_COMMANDS, handleDevCommand, setupDevCategory };
