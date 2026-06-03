const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");
const { read, write } = require("./utils/jsondb");
const questions = require("./questions.json");
const log = require("./utils/logger");

const GUILDS_PATH          = "./data/guilds.json";
const CONFIG_PATH          = "./data/config.json";
const STAFF_INVITE         = "https://discord.gg/qcXfZqQVC4";
const BLACKLIST_LOG_CHANNEL = "1492165517279232090";


// ─── Blacklist log helper ─────────────────────────────────────────────────────

async function sendBlacklistLog(clientRef, { applicantId, applicantTag, roleLabel, roleEmoji, sourceGuildName, moderator, reason }) {
  try {
    const ch = await clientRef.channels.fetch(BLACKLIST_LOG_CHANNEL);
    if (!ch?.isTextBased()) return;
    const embed = new EmbedBuilder()
      .setTitle("🚫 User Blacklisted")
      .setColor(0x000000)
      .addFields(
        { name: "User",    value: applicantTag ? `<@${applicantId}> (${applicantTag})` : `<@${applicantId}>`, inline: false },
        { name: "Server",  value: sourceGuildName, inline: true },
        { name: "Role",    value: `${roleEmoji} ${roleLabel}`,  inline: true },
        { name: "By",      value: moderator,        inline: true },
      )
      .setTimestamp();
    if (reason) embed.addFields({ name: "Reason", value: reason, inline: false });
    await ch.send({ embeds: [embed] });
    log.info("BLACKLIST", `Log posted to channel ${BLACKLIST_LOG_CHANNEL}`);
  } catch (err) {
    log.error("BLACKLIST", "Failed to post to blacklist log channel", err.message);
  }
}

// ─── Role type metadata ───────────────────────────────────────────────────────

const ROLE_TYPES = {
  hr:          { label: "HR",                  emoji: "👥", color: 0x5865f2 },
  mod:         { label: "Moderator",           emoji: "🔨", color: 0xed4245 },
  partnership: { label: "Partnership Manager", emoji: "🤝", color: 0xfee75c },
};

// ─── Per-server config map ────────────────────────────────────────────────────

const SERVER_CONFIG_MAP = [
  {
    match:          "plain promotions",
    channelName:    "plain-promotions-apps",
    channelNames:   ["plain-promotions-apps", "plain-promotions", "pp-apps"],
    roleName:       "Plain Promotions Apps",
    reviewerRoleId: "1488370139286995135",
  },
  {
    match:          "advertising legends",
    channelName:    "advertising-legends-apps",
    channelNames:   ["advertising-legends-apps", "advertising-legends", "al-apps"],
    roleName:       "Advertising Legends Apps",
    reviewerRoleId: "1488375799819276358",
  },
  {
    match:          "devil advertising",
    channelName:    "devil-advertising-apps",
    channelNames:   ["devil-advertising-apps", "devil-advertising", "da-apps"],
    roleName:       "Devil Advertising Apps",
    reviewerRoleId: "1488370171293733000",
  },
  {
    match:          "prime promotions",
    channelName:    "prime-promotions-apps",
    channelNames:   ["prime-promotions-apps", "prime-promotions", "pp-apps"],
    roleName:       "Prime Promotions Apps",
    reviewerRoleId: "1488375900629106808",
  },
  {
    match:          "shadow advertising",
    channelName:    "shadow-advertising-apps",
    channelNames:   ["shadow-advertising-apps", "shadow-advertising", "sa-apps"],
    roleName:       "Shadow Advertising Apps",
    reviewerRoleId: "1488369842225680465",
  },
];

function getServerConfig(guildName) {
  const lower = guildName.toLowerCase();
  return SERVER_CONFIG_MAP.find((e) => lower.includes(e.match)) || null;
}

// ─── Global config ────────────────────────────────────────────────────────────

function getConfig()        { return read(CONFIG_PATH); }
function setConfig(updates) { write(CONFIG_PATH, { ...getConfig(), ...updates }); }

// ─── DB helpers ───────────────────────────────────────────────────────────────

function getGuilds()  { return read(GUILDS_PATH); }
function getGuild(id) { return getGuilds().find((g) => g.id === id) || null; }

function setGuildConfig(guildId, config) {
  const guilds = getGuilds();
  const idx    = guilds.findIndex((g) => g.id === guildId);
  if (idx === -1) guilds.push({ id: guildId, blacklist: [], ...config });
  else            guilds[idx] = { blacklist: [], ...guilds[idx], ...config };
  write(GUILDS_PATH, guilds);
}

function isBlacklisted(guildId, userId) {
  return getGuild(guildId)?.blacklist?.includes(userId) ?? false;
}

function addToBlacklist(guildId, userId) {
  const guilds = getGuilds();
  let idx      = guilds.findIndex((g) => g.id === guildId);
  if (idx === -1) {
    guilds.push({ id: guildId, blacklist: [userId] });
    write(GUILDS_PATH, guilds);
    return;
  }
  if (!Array.isArray(guilds[idx].blacklist)) guilds[idx].blacklist = [];
  if (!guilds[idx].blacklist.includes(userId)) guilds[idx].blacklist.push(userId);
  write(GUILDS_PATH, guilds);
}

function removeFromBlacklist(guildId, userId) {
  const guilds = getGuilds();
  const idx    = guilds.findIndex((g) => g.id === guildId);
  if (idx === -1) return false;
  const before = guilds[idx].blacklist?.length || 0;
  guilds[idx].blacklist = (guilds[idx].blacklist || []).filter((id) => id !== userId);
  write(GUILDS_PATH, guilds);
  return guilds[idx].blacklist.length < before;
}

// ─── Staff server channel setup ───────────────────────────────────────────────

async function autoSetupStaffChannels(client, staffGuild) {
  const cfg = getConfig();

  let category = cfg.staffCategoryId
    ? staffGuild.channels.cache.get(cfg.staffCategoryId)
    : staffGuild.channels.cache.find(
        (c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase().includes("application")
      );

  if (!category) {
    category = await staffGuild.channels.create({
      name: "📋 Applications",
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        { id: staffGuild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      ],
    });
  }

  setConfig({ staffGuildId: staffGuild.id, staffCategoryId: category.id });

  const lines = [];

  for (const entry of SERVER_CONFIG_MAP) {
    let ch = staffGuild.channels.cache.find(
      (c) => c.parentId === category.id && entry.channelNames.includes(c.name) && c.isTextBased()
    );

    if (!ch) {
      const hrRole = staffGuild.roles.cache.find((r) => r.name === entry.roleName);
      const overwrites = [
        { id: staffGuild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      ];
      if (hrRole) overwrites.push({ id: hrRole.id, allow: [PermissionsBitField.Flags.ViewChannel] });

      ch = await staffGuild.channels.create({
        name:                 entry.channelName,
        type:                 ChannelType.GuildText,
        parent:               category.id,
        permissionOverwrites: overwrites,
      });

      lines.push(`✅ Created <#${ch.id}>`);
    } else {
      lines.push(`⏭️ Already exists <#${ch.id}>`);
    }

    for (const guild of client.guilds.cache.values()) {
      if (guild.id === staffGuild.id) continue;
      const gcfg = getServerConfig(guild.name);
      if (gcfg?.match === entry.match) {
        setGuildConfig(guild.id, { routeChannelId: ch.id });
        lines.push(`   ↳ Linked **${guild.name}** → <#${ch.id}>`);
      }
    }
  }

  return lines.join("\n");
}

async function autoLinkNewGuild(client, guild) {
  const cfg = getConfig();
  if (!cfg.staffGuildId) return;

  const entry = getServerConfig(guild.name);
  if (!entry) return;

  const staffGuild = client.guilds.cache.get(cfg.staffGuildId);
  if (!staffGuild) return;

  const ch = staffGuild.channels.cache.find(
    (c) => entry.channelNames.includes(c.name) && c.isTextBased()
  );
  if (!ch) return;

  setGuildConfig(guild.id, { routeChannelId: ch.id });
  log.info("LINK", `Auto-linked [${guild.name}] → #${ch.name}`);
}

// ─── Role & channel resolution ────────────────────────────────────────────────

function resolveHRRole(sourceGuildName, destGuild, savedHrRoleId) {
  const entry = getServerConfig(sourceGuildName);
  if (entry) {
    const role = destGuild.roles.cache.find((r) => r.name === entry.roleName);
    if (role) return role;
  }
  if (savedHrRoleId) return destGuild.roles.cache.get(savedHrRoleId) || null;
  return null;
}

async function resolveAppChannel(client, sourceGuild, guildConfig) {
  if (guildConfig?.routeChannelId) {
    try {
      const ch = await client.channels.fetch(guildConfig.routeChannelId);
      if (ch) return { channel: ch, guild: ch.guild };
    } catch (e) {
      log.warn("ROUTE", `Could not fetch routeChannelId ${guildConfig.routeChannelId}`, e.message);
    }
  }
  if (guildConfig?.applicationChannel) {
    const ch = sourceGuild.channels.cache.get(guildConfig.applicationChannel);
    if (ch) return { channel: ch, guild: sourceGuild };
  }
  const entry = getServerConfig(sourceGuild.name);
  if (entry) {
    for (const name of entry.channelNames) {
      const ch = sourceGuild.channels.cache.find((c) => c.name === name && c.isTextBased());
      if (ch) return { channel: ch, guild: sourceGuild };
    }
  }
  return null;
}

// ─── Slash command definitions ────────────────────────────────────────────────

const commands = [
  new SlashCommandBuilder()
    .setName("setstaffserver")
    .setDescription("(Admin) Mark this server as the staff hub and auto-create all application channels.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("(Admin) Post the application panel with HR / Mod / Partnership buttons.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addChannelOption((o) =>
      o.setName("channel")
        .setDescription("Channel to send the panel to (defaults to current channel).")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("apply")
    .setDescription("Submit a staff application — questions will be sent to your DMs."),

  new SlashCommandBuilder()
    .setName("setroute")
    .setDescription("(Admin) Manually route this server's apps to a specific channel ID.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addStringOption((o) =>
      o.setName("channel-id")
        .setDescription("ID of the destination channel.")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("(Admin) Set a same-server fallback channel and/or HR role override.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addChannelOption((o) =>
      o.setName("channel").setDescription("Channel for application threads.").setRequired(true)
    )
    .addRoleOption((o) =>
      o.setName("role").setDescription("HR role to ping.").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("setrole")
    .setDescription("(Admin) Override the HR role to ping on new applications.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addRoleOption((o) =>
      o.setName("role").setDescription("The HR role.").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("setacceptroles")
    .setDescription("(Admin) Set the roles granted per application type when accepted. Run in each source server.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addRoleOption((o) =>
      o.setName("hr-role").setDescription("Role given to accepted HR applicants (e.g. @HR).").setRequired(true)
    )
    .addRoleOption((o) =>
      o.setName("hr-team").setDescription("Team role also given to accepted HR applicants (e.g. @Staff Team).").setRequired(true)
    )
    .addRoleOption((o) =>
      o.setName("mod-role").setDescription("Role given to accepted Mod applicants (e.g. @Moderator).").setRequired(true)
    )
    .addRoleOption((o) =>
      o.setName("mod-team").setDescription("Team role also given to accepted Mod applicants (e.g. @Staff Team).").setRequired(true)
    )
    .addRoleOption((o) =>
      o.setName("partnership-role").setDescription("Role given to accepted Partnership applicants (e.g. @Partnership Manager).").setRequired(true)
    )
    .addRoleOption((o) =>
      o.setName("partnership-team").setDescription("Team role also given to accepted Partnership applicants (e.g. @Staff Team).").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("(Mod) Prevent a user from submitting applications.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
    .addUserOption((o) =>
      o.setName("user").setDescription("The user to blacklist.").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("unblacklist")
    .setDescription("(Admin) Remove a user from the blacklist.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addUserOption((o) =>
      o.setName("user").setDescription("The user to unblacklist.").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show all commands and this server's current routing."),
].map((c) => c.toJSON());

// ─── Button rows ──────────────────────────────────────────────────────────────

function buildReviewRow(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("app_accept")
      .setLabel("Accept")
      .setStyle(ButtonStyle.Success)
      .setEmoji("✅")
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("app_deny")
      .setLabel("Deny")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("❌")
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("app_blacklist")
      .setLabel("Blacklist")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🚫")
      .setDisabled(disabled)
  );
}

function buildPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("panel_apply_hr")
      .setLabel("HR")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("👥"),
    new ButtonBuilder()
      .setCustomId("panel_apply_mod")
      .setLabel("Mod")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("🔨"),
    new ButtonBuilder()
      .setCustomId("panel_apply_partnership")
      .setLabel("Partnership Manager")
      .setStyle(ButtonStyle.Success)
      .setEmoji("🤝")
  );
}

// ─── Shared application flow ──────────────────────────────────────────────────

async function runApplication(client, user, sourceGuild, roleType) {
  const meta        = ROLE_TYPES[roleType];
  const questionSet = questions[roleType];
  const guildConfig = getGuild(sourceGuild.id);

  if (isBlacklisted(sourceGuild.id, user.id)) return { ok: false, reason: "blacklisted" };

  const resolved = await resolveAppChannel(client, sourceGuild, guildConfig);
  if (!resolved) return { ok: false, reason: "no_channel" };
  const { channel: appChannel, guild: destGuild } = resolved;

  let dmChannel;
  try {
    dmChannel = await user.createDM();
    await dmChannel.send(
      `${meta.emoji} **${sourceGuild.name} — ${meta.label} Application**\n` +
      `Answer each question below. You have **2 minutes** per question.\n` +
      `Type your answer and press Enter to move on.`
    );
  } catch {
    return { ok: false, reason: "no_dm" };
  }

  const answers = [];
  for (let i = 0; i < questionSet.length; i++) {
    await dmChannel.send(`**Question ${i + 1} of ${questionSet.length}**\n${questionSet[i]}`);
    try {
      const collected = await dmChannel.awaitMessages({
        filter: (m) => m.author.id === user.id,
        max:    1,
        time:   120_000,
        errors: ["time"],
      });
      answers.push(collected.first().content);
    } catch {
      await dmChannel.send("⏰ You took too long to answer. Application cancelled.");
      return { ok: false, reason: "timeout" };
    }
  }

  await dmChannel.send("✅ **Your application has been submitted!** You'll be notified once a decision is made.");

  const crossServer = destGuild.id !== sourceGuild.id;
  const embed = new EmbedBuilder()
    .setTitle(`${meta.emoji} ${meta.label} Application${crossServer ? ` — ${sourceGuild.name}` : ""}`)
    .setColor(meta.color)
    .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
    .setTimestamp()
    .setFooter({ text: `User ID: ${user.id} • From: ${sourceGuild.name} • Type: ${roleType}` });

  questionSet.forEach((q, i) => {
    embed.addFields({ name: q, value: answers[i] || "*No answer*", inline: false });
  });

  let thread;
  try {
    thread = await appChannel.threads.create({
      name:      `[${meta.label}] ${user.username} (${sourceGuild.name})`,
      type:      ChannelType.PrivateThread,
      invitable: false,
      reason:    `${meta.label} application from ${user.tag} in ${sourceGuild.name}`,
    });
  } catch (err) {
    log.error("APP", "Failed to create private thread", err.message);
    await dmChannel.send("❌ Could not create a private thread. Please contact an admin.");
    return { ok: false, reason: "no_thread" };
  }

  const hrRole   = resolveHRRole(sourceGuild.name, destGuild, guildConfig?.hrRole);
  const pingLine = hrRole ? `<@&${hrRole.id}> — new **${meta.label}** application to review.\n` : "";

  await thread.send({
    content:    `${pingLine}**Applicant:** <@${user.id}>`,
    embeds:     [embed],
    components: [buildReviewRow()],
  });

  log.info("APP", `Submitted | [${sourceGuild.name}] ${meta.label} → #${appChannel.name} in [${destGuild.name}] | ${user.tag}`);
  return { ok: true };
}

// ─── Client ───────────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once("ready", async () => {
  log.info("BOT", `Logged in as ${client.user.tag} (${client.user.id})`);
  log.info("BOT", `In ${client.guilds.cache.size} guild(s)`);

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  try {
    log.info("COMMANDS", "Registering global slash commands...");
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    log.info("COMMANDS", `Registered ${commands.length} slash commands globally`);
  } catch (err) {
    log.error("COMMANDS", "Failed to register slash commands", err.message);
  }

  // Link any unlinked guilds if a staff server is already configured
  const cfg = getConfig();
  if (cfg.staffGuildId) {
    const staffGuild = client.guilds.cache.get(cfg.staffGuildId);
    if (staffGuild) {
      for (const guild of client.guilds.cache.values()) {
        if (guild.id === staffGuild.id) continue;
        const guildCfg = getGuild(guild.id);
        if (guildCfg?.routeChannelId) continue;
        const entry = getServerConfig(guild.name);
        if (!entry) continue;
        const ch = staffGuild.channels.cache.find(
          (c) => entry.channelNames.includes(c.name) && c.isTextBased()
        );
        if (ch) {
          setGuildConfig(guild.id, { routeChannelId: ch.id });
          log.info("LINK", `Linked [${guild.name}] → #${ch.name}`);
        }
      }
    }
  }
});

client.on("guildCreate", async (guild) => {
  log.info("GUILD", `Joined guild: ${guild.name}`);
  await autoLinkNewGuild(client, guild);
});

// ─── Interaction handler ──────────────────────────────────────────────────────

client.on("interactionCreate", async (interaction) => {

  // ── Slash commands ──────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    const { commandName, guild, user } = interaction;
    log.info("CMD", `/${commandName} — ${user.tag} (${user.id}) in [${guild?.name}]`);

    // /setstaffserver
    if (commandName === "setstaffserver") {
      await interaction.deferReply({ ephemeral: true });
      let summary;
      try {
        summary = await autoSetupStaffChannels(client, guild);
      } catch (err) {
        log.error("SETUP", "autoSetupStaffChannels error", err.message);
        return interaction.editReply(`❌ Something went wrong: ${err.message}`);
      }
      const embed = new EmbedBuilder()
        .setTitle("✅ Staff Server Configured")
        .setDescription(
          `**${guild.name}** is now the staff hub.\n\n` +
          `A **📋 Applications** category has been created with one channel per server:\n\n` +
          summary
        )
        .setColor(0x57f287)
        .setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }

    // /help
    if (commandName === "help") {
      const guildConfig = getGuild(guild.id);
      const resolved    = await resolveAppChannel(client, guild, guildConfig);
      const hrRole      = resolved
        ? resolveHRRole(guild.name, resolved.guild, guildConfig?.hrRole)
        : null;

      let routeDesc = "❌ Not configured — run `/setstaffserver` in the staff server";
      if (resolved) {
        const crossServer = resolved.guild.id !== guild.id;
        routeDesc = crossServer
          ? `<#${resolved.channel.id}> in **${resolved.guild.name}**`
          : `<#${resolved.channel.id}> (this server)`;
      }

      const embed = new EmbedBuilder()
        .setTitle("📋 Apply Bot — Commands")
        .setColor(0x5865f2)
        .addFields(
          { name: "`/setstaffserver`", value: "*(Admin, staff server)* Create all app channels and link every server.", inline: false },
          { name: "`/panel`",          value: "*(Admin)* Post the HR / Mod / Partnership panel.",                       inline: false },
          { name: "`/apply`",          value: "Start an application via DM.",                                           inline: false },
          { name: "`/setroute`",       value: "*(Admin)* Manually route apps to a specific channel ID.",               inline: false },
          { name: "`/setup`",          value: "*(Admin)* Set a fallback channel + optional HR role.",                  inline: false },
          { name: "`/setrole`",        value: "*(Admin)* Override the HR role to ping.",                               inline: false },
          { name: "`/blacklist`",      value: "*(Mod)* Prevent a user from applying.",                                 inline: false },
          { name: "`/unblacklist`",    value: "*(Admin)* Remove a user from the blacklist.",                           inline: false },
        )
        .addFields({
          name: "⚙️ This server's routing",
          value: [
            `**Applications →** ${routeDesc}`,
            `**HR Role:** ${hrRole ? `<@&${hrRole.id}>` : "not found"}`,
          ].join("\n"),
          inline: false,
        })
        .setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // /setroute
    if (commandName === "setroute") {
      const channelId = interaction.options.getString("channel-id").trim();
      let destChannel;
      try {
        destChannel = await client.channels.fetch(channelId);
      } catch {
        return interaction.reply({
          content: "❌ Could not find that channel. Make sure the ID is correct and the bot is in that server.",
          ephemeral: true,
        });
      }
      if (!destChannel.isTextBased()) {
        return interaction.reply({ content: "❌ That channel is not a text channel.", ephemeral: true });
      }
      setGuildConfig(guild.id, { routeChannelId: channelId });
      return interaction.reply({
        content: `✅ Applications from **${guild.name}** will now go to <#${channelId}> in **${destChannel.guild?.name ?? "the staff server"}**.`,
        ephemeral: true,
      });
    }

    // /setup
    if (commandName === "setup") {
      const channel = interaction.options.getChannel("channel");
      const role    = interaction.options.getRole("role");
      const update  = { applicationChannel: channel.id };
      if (role) update.hrRole = role.id;
      setGuildConfig(guild.id, update);
      return interaction.reply({
        content: `✅ Fallback channel set to ${channel}.${role ? ` HR role set to ${role}.` : ""}`,
        ephemeral: true,
      });
    }

    // /setrole
    if (commandName === "setrole") {
      const role = interaction.options.getRole("role");
      setGuildConfig(guild.id, { hrRole: role.id });
      return interaction.reply({ content: `✅ HR role set to ${role}.`, ephemeral: true });
    }

    // /setacceptroles
    if (commandName === "setacceptroles") {
      try {
        const hrRole          = interaction.options.getRole("hr-role");
        const hrTeam          = interaction.options.getRole("hr-team");
        const modRole         = interaction.options.getRole("mod-role");
        const modTeam         = interaction.options.getRole("mod-team");
        const partnerRole     = interaction.options.getRole("partnership-role");
        const partnerTeam     = interaction.options.getRole("partnership-team");

        const missing = [
          !hrRole      && "hr-role",
          !hrTeam      && "hr-team",
          !modRole     && "mod-role",
          !modTeam     && "mod-team",
          !partnerRole && "partnership-role",
          !partnerTeam && "partnership-team",
        ].filter(Boolean);

        if (missing.length) {
          return interaction.reply({
            content: `❌ Could not resolve the following roles: **${missing.join(", ")}**. Make sure the roles exist in this server and try again.`,
            ephemeral: true,
          });
        }

        setGuildConfig(guild.id, {
          hrRoleId:              hrRole.id,
          hrTeamRoleId:          hrTeam.id,
          modRoleId:             modRole.id,
          modTeamRoleId:         modTeam.id,
          partnershipRoleId:     partnerRole.id,
          partnershipTeamRoleId: partnerTeam.id,
        });

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(`✅ Accept roles configured for ${guild.name}`)
              .setColor(0x57f287)
              .addFields(
                { name: "👥 HR Role",                  value: `${hrRole}`,      inline: true },
                { name: "👥 HR Team Role",              value: `${hrTeam}`,      inline: true },
                { name: "\u200b",                       value: "\u200b",          inline: true },
                { name: "🔨 Mod Role",                  value: `${modRole}`,     inline: true },
                { name: "🔨 Mod Team Role",              value: `${modTeam}`,     inline: true },
                { name: "\u200b",                       value: "\u200b",          inline: true },
                { name: "🤝 Partnership Manager Role",  value: `${partnerRole}`, inline: true },
                { name: "🤝 Partnership Team Role",     value: `${partnerTeam}`, inline: true },
                { name: "\u200b",                       value: "\u200b",          inline: true },
              )
              .setFooter({ text: "These roles will be granted when an application is accepted." }),
          ],
          ephemeral: true,
        });
      } catch (err) {
        log.error("SETROLES", "setacceptroles error", err.message);
        return interaction.reply({
          content: `❌ Something went wrong while saving roles: ${err.message}`,
          ephemeral: true,
        });
      }
    }

    // /blacklist
    if (commandName === "blacklist") {
      const target = interaction.options.getUser("user");
      addToBlacklist(guild.id, target.id);
      await sendBlacklistLog(client, {
        applicantId:     target.id,
        applicantTag:    target.tag,
        roleLabel:       "Manual",
        roleEmoji:       "🚫",
        sourceGuildName: guild.name,
        moderator:       interaction.user.tag,
      });
      return interaction.reply({ content: `🚫 ${target} has been blacklisted from applying.`, ephemeral: true });
    }

    // /unblacklist
    if (commandName === "unblacklist") {
      const target  = interaction.options.getUser("user");
      const removed = removeFromBlacklist(guild.id, target.id);
      return interaction.reply({
        content: removed
          ? `✅ ${target} has been removed from the blacklist.`
          : `⚠️ That user is not blacklisted.`,
        ephemeral: true,
      });
    }

    // /panel
    if (commandName === "panel") {
      const target = interaction.options.getChannel("channel") ?? interaction.channel;
      const panelEmbed = new EmbedBuilder()
        .setTitle("📋 Staff Applications")
        .setDescription(
          `Want to join the team at **${guild.name}**?\n\n` +
          `Choose the role you'd like to apply for below.\n` +
          `The questions will be sent to your **DMs** — make sure they are open!\n\n` +
          `> ⏱️ You have **2 minutes** to answer each question.\n` +
          `> 📬 You'll be notified once a decision has been made.`
        )
        .setColor(0x5865f2)
        .addFields(
          { name: "👥 HR",                   value: "Help manage and recruit our staff team.",           inline: true },
          { name: "🔨 Mod",                   value: "Keep the server safe and enforce the rules.",      inline: true },
          { name: "🤝 Partnership Manager",   value: "Build relationships with other Discord servers.",  inline: true },
        )
        .setTimestamp()
        .setFooter({ text: guild.name });

      await target.send({ embeds: [panelEmbed], components: [buildPanelRow()] });
      return interaction.reply({ content: `✅ Panel sent to ${target}.`, ephemeral: true });
    }

    // /apply (text command fallback — asks user to pick a role)
    if (commandName === "apply") {
      if (isBlacklisted(guild.id, user.id)) {
        return interaction.reply({ content: "🚫 You are blacklisted from submitting applications.", ephemeral: true });
      }
      const resolved = await resolveAppChannel(client, guild, getGuild(guild.id));
      if (!resolved) {
        return interaction.reply({
          content: "❌ No application channel configured. Ask an admin to run `/setstaffserver` in the staff server.",
          ephemeral: true,
        });
      }
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("apply_pick_hr").setLabel("HR").setStyle(ButtonStyle.Primary).setEmoji("👥"),
        new ButtonBuilder().setCustomId("apply_pick_mod").setLabel("Mod").setStyle(ButtonStyle.Danger).setEmoji("🔨"),
        new ButtonBuilder().setCustomId("apply_pick_partnership").setLabel("Partnership Manager").setStyle(ButtonStyle.Success).setEmoji("🤝")
      );
      return interaction.reply({
        content: "Which role would you like to apply for?",
        components: [row],
        ephemeral: true,
      });
    }

    return;
  }

  // ── Button interactions ─────────────────────────────────────────────────────
  if (interaction.isButton()) {
    const { guild, user } = interaction;

    // ── Panel apply buttons (3 role types) ──
    const panelMap = {
      panel_apply_hr:          "hr",
      panel_apply_mod:         "mod",
      panel_apply_partnership: "partnership",
      apply_pick_hr:           "hr",
      apply_pick_mod:          "mod",
      apply_pick_partnership:  "partnership",
    };

    if (panelMap[interaction.customId]) {
      const roleType = panelMap[interaction.customId];
      const meta     = ROLE_TYPES[roleType];

      if (isBlacklisted(guild.id, user.id)) {
        return interaction.reply({ content: "🚫 You are blacklisted from submitting applications.", ephemeral: true });
      }

      const resolved = await resolveAppChannel(client, guild, getGuild(guild.id));
      if (!resolved) {
        return interaction.reply({
          content: "❌ No application channel configured. Ask an admin to run `/setstaffserver` in the staff server.",
          ephemeral: true,
        });
      }

      await interaction.reply({
        content: `${meta.emoji} Check your DMs — your **${meta.label}** application has started!`,
        ephemeral: true,
      });

      const result = await runApplication(client, user, guild, roleType);
      if (!result.ok && result.reason === "no_dm") {
        await interaction.editReply({ content: "❌ I couldn't DM you. Please enable DMs from server members and try again." });
      }
      return;
    }

    // ── Review buttons (accept / deny / blacklist) ──
    if (["app_accept", "app_deny", "app_blacklist"].includes(interaction.customId)) {
      const destGuild = interaction.guild;

      const footer          = interaction.message.embeds[0]?.footer?.text ?? "";
      const fromMatch       = footer.match(/From:\s*([^•]+)/);
      const sourceGuildName = fromMatch ? fromMatch[1].trim() : destGuild.name;
      const typeMatch       = footer.match(/Type:\s*(\w+)/);
      const roleType        = typeMatch ? typeMatch[1] : "hr";
      const meta            = ROLE_TYPES[roleType] || ROLE_TYPES.hr;

      log.info("REVIEW", `Button: ${interaction.customId} — ${interaction.user.tag} (${interaction.user.id}) in [${destGuild.name}] | source: ${sourceGuildName} | type: ${roleType}`);

      // Fetch the member fresh so we always have their real current roles
      let reviewer_member;
      try {
        reviewer_member = await destGuild.members.fetch(interaction.user.id);
      } catch (err) {
        log.warn("REVIEW", "Could not fetch reviewer member fresh, falling back to interaction.member", err.message);
        reviewer_member = interaction.member;
      }

      const serverEntry     = getServerConfig(sourceGuildName);
      const reviewerRoleId  = serverEntry?.reviewerRoleId;
      const hasAccess       = reviewerRoleId
        ? reviewer_member.roles.cache.has(reviewerRoleId)
        : false;

      log.debug("REVIEW", "Permission check", {
        reviewer:       interaction.user.tag,
        reviewerRoles:  [...reviewer_member.roles.cache.keys()],
        sourceGuild:    sourceGuildName,
        requiredRoleId: reviewerRoleId ?? "none",
        hasAccess,
      });

      if (!hasAccess) {
        log.warn("REVIEW", `Access denied for ${interaction.user.tag} — missing role ${reviewerRoleId}`);
        const roleTag = reviewerRoleId ? `<@&${reviewerRoleId}>` : "the correct reviewer role";
        return interaction.reply({
          content: `❌ You need the ${roleTag} role to manage applications from **${sourceGuildName}**.`,
          ephemeral: true,
        });
      }

      const msg            = interaction.message;
      const applicantMatch = msg.content.match(/\*\*Applicant:\*\* <@(\d+)>/);
      if (!applicantMatch) {
        return interaction.reply({ content: "❌ Could not determine the applicant from this message.", ephemeral: true });
      }

      const applicantId = applicantMatch[1];
      const reviewer    = interaction.user.tag;
      let applicantUser = null;
      try { applicantUser = await client.users.fetch(applicantId); } catch {}

      // Helper — posts a result card to the parent channel (visible outside the thread)
      const postResult = async (resultEmbed) => {
        const parentChannel = interaction.channel?.parent;
        if (parentChannel?.isTextBased()) {
          try { await parentChannel.send({ embeds: [resultEmbed] }); } catch {}
        }
      };

      if (interaction.customId === "app_accept") {
        const updated = EmbedBuilder.from(msg.embeds[0])
          .setColor(0x57f287)
          .setTitle(`✅ ${meta.label} Application Accepted — ${sourceGuildName}`);
        await msg.edit({ embeds: [updated], components: [buildReviewRow(true)] });
        await interaction.reply({ content: `✅ **${meta.label}** application **accepted** by ${reviewer}.` });
        try {
          await interaction.channel.edit({ locked: true, archived: true });
        } catch (err) {
          log.error("LOCK", "Failed to lock thread", err.message);
          await interaction.channel.send("⚠️ Could not lock this thread — make sure the bot has **Manage Threads** permission.").catch(() => {});
        }

        // Grant team + normal roles in the source server
        const sourceGuild    = client.guilds.cache.find((g) => g.name === sourceGuildName);
        const sourceGuildCfg = sourceGuild ? getGuild(sourceGuild.id) : null;
        const rolesGranted   = [];
        const roleErrors     = [];

        log.info("ACCEPT", `Accepted by ${reviewer} | applicant: ${applicantId} | type: ${roleType} | server: ${sourceGuildName}`);
        log.debug("ACCEPT", "Source guild lookup", { found: !!sourceGuild, hasCfg: !!sourceGuildCfg, cfg: sourceGuildCfg });

        if (sourceGuild && sourceGuildCfg) {
          let member = null;
          try { member = await sourceGuild.members.fetch(applicantId); } catch (err) {
            log.warn("ACCEPT", `Could not fetch applicant ${applicantId} from [${sourceGuildName}]`, err.message);
          }

          if (member) {
            const typeRoleKeys = {
              hr:          ["hrRoleId",          "hrTeamRoleId"],
              mod:         ["modRoleId",          "modTeamRoleId"],
              partnership: ["partnershipRoleId",  "partnershipTeamRoleId"],
            };
            const [specificKey, teamKey] = typeRoleKeys[roleType] ?? [];
            for (const [key, label] of [[specificKey, "role"], [teamKey, "team role"]]) {
              if (!key) continue;
              const roleId = sourceGuildCfg[key];
              if (!roleId) {
                log.warn("ACCEPT", `No saved role ID for key "${key}" in [${sourceGuildName}] config`);
                continue;
              }
              try {
                await member.roles.add(roleId);
                rolesGranted.push(`<@&${roleId}>`);
                log.info("ACCEPT", `Granted role ${roleId} (${label}) to ${applicantId} in [${sourceGuildName}]`);
              } catch (err) {
                log.error("ACCEPT", `Failed to grant role ${roleId} (${label}) to ${applicantId}`, err.message);
                roleErrors.push(label);
              }
            }
          } else {
            log.warn("ACCEPT", `Applicant ${applicantId} not found in [${sourceGuildName}]`);
            roleErrors.push("member not found in source server");
          }
        } else {
          log.warn("ACCEPT", `Could not find source guild or config for "${sourceGuildName}"`);
        }

        // Report role grant outcome in the thread
        if (rolesGranted.length) {
          await interaction.channel.send(`✅ Roles granted in **${sourceGuildName}**: ${rolesGranted.join(", ")}`);
        }
        if (roleErrors.length) {
          await interaction.channel.send(`⚠️ Could not grant some roles in **${sourceGuildName}**: ${roleErrors.join(", ")} — check bot permissions and role IDs.`);
        }

        const resultEmbed = new EmbedBuilder()
          .setTitle(`✅ Application Accepted`)
          .setColor(0x57f287)
          .addFields(
            { name: "Applicant",   value: `<@${applicantId}>`,         inline: true },
            { name: "Role",        value: `${meta.emoji} ${meta.label}`, inline: true },
            { name: "Server",      value: sourceGuildName,               inline: true },
            { name: "Reviewed by", value: reviewer,                      inline: true },
          )
          .setTimestamp();
        await postResult(resultEmbed);

        // DM the applicant — Partnership Managers stay in the main server so no staff invite
        try {
          if (roleType === "partnership") {
            await applicantUser?.send(
              `✅ **Your ${meta.label} application to ${sourceGuildName} has been accepted!** Congratulations!\n\n` +
              `A staff member will reach out to you soon.`
            );
          } else {
            await applicantUser?.send(
              `✅ **Your ${meta.label} application to ${sourceGuildName} has been accepted!** Congratulations!\n\n` +
              `You can join our staff server here: **${STAFF_INVITE}**\n\n` +
              `A staff member will reach out to you soon.`
            );
          }
        } catch {}
      }

      else if (interaction.customId === "app_deny") {
        const updated = EmbedBuilder.from(msg.embeds[0])
          .setColor(0xed4245)
          .setTitle(`❌ ${meta.label} Application Denied — ${sourceGuildName}`);
        await msg.edit({ embeds: [updated], components: [buildReviewRow(true)] });
        await interaction.reply({ content: `❌ **${meta.label}** application **denied** by ${reviewer}.` });
        try {
          await interaction.channel.edit({ locked: true, archived: true });
        } catch (err) {
          log.error("LOCK", "Failed to lock thread", err.message);
          await interaction.channel.send("⚠️ Could not lock this thread — make sure the bot has **Manage Threads** permission.").catch(() => {});
        }

        const resultEmbed = new EmbedBuilder()
          .setTitle(`❌ Application Denied`)
          .setColor(0xed4245)
          .addFields(
            { name: "Applicant", value: `<@${applicantId}>`, inline: true },
            { name: "Role",      value: `${meta.emoji} ${meta.label}`,    inline: true },
            { name: "Server",    value: sourceGuildName,                   inline: true },
            { name: "Reviewed by", value: reviewer,                        inline: true },
          )
          .setTimestamp();
        await postResult(resultEmbed);

        try {
          await applicantUser?.send(
            `❌ **Your ${meta.label} application has been denied.** ` +
            `Unfortunately your application to **${sourceGuildName}** was not accepted at this time. ` +
            `You're welcome to apply again in the future.`
          );
        } catch {}
      }

      else if (interaction.customId === "app_blacklist") {
        const sourceGuild = client.guilds.cache.find((g) => g.name === sourceGuildName);
        if (sourceGuild) addToBlacklist(sourceGuild.id, applicantId);

        const updated = EmbedBuilder.from(msg.embeds[0])
          .setColor(0x000000)
          .setTitle(`🚫 ${meta.label} Application Denied & Blacklisted — ${sourceGuildName}`);
        await msg.edit({ embeds: [updated], components: [buildReviewRow(true)] });
        await interaction.reply({ content: `🚫 **${meta.label}** application **denied & user blacklisted** by ${reviewer}.` });
        try {
          await interaction.channel.edit({ locked: true, archived: true });
        } catch (err) {
          log.error("LOCK", "Failed to lock thread", err.message);
          await interaction.channel.send("⚠️ Could not lock this thread — make sure the bot has **Manage Threads** permission.").catch(() => {});
        }

        const resultEmbed = new EmbedBuilder()
          .setTitle(`🚫 Application Denied & Blacklisted`)
          .setColor(0x000000)
          .addFields(
            { name: "Applicant", value: `<@${applicantId}>`, inline: true },
            { name: "Role",      value: `${meta.emoji} ${meta.label}`,    inline: true },
            { name: "Server",    value: sourceGuildName,                   inline: true },
            { name: "Reviewed by", value: reviewer,                        inline: true },
          )
          .setTimestamp();
        await postResult(resultEmbed);
        await sendBlacklistLog(client, {
          applicantId:     applicantId,
          applicantTag:    applicantUser?.tag,
          roleLabel:       meta.label,
          roleEmoji:       meta.emoji,
          sourceGuildName: sourceGuildName,
          moderator:       reviewer,
        });

        try {
          await applicantUser?.send(
            `🚫 **Your ${meta.label} application has been denied** and you have been blacklisted ` +
            `from applying to **${sourceGuildName}** in the future.`
          );
        } catch {}
      }
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
