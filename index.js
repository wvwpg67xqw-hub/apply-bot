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

const GUILDS_PATH  = "./data/guilds.json";
const CONFIG_PATH  = "./data/config.json";

// ─── Per-server config map ────────────────────────────────────────────────────
// `channelName` is the channel the bot will create in the staff server.
// `channelNames` are fallback names to detect if the channel already exists.
// `roleName` is the HR role to ping (looked up in the staff server).
const SERVER_CONFIG_MAP = [
  {
    match:        "plain promotions",
    channelName:  "plain-promotions-apps",
    channelNames: ["plain-promotions-apps", "plain-promotions", "pp-apps"],
    roleName:     "Plain Promotions Apps",
  },
  {
    match:        "advertising legends",
    channelName:  "advertising-legends-apps",
    channelNames: ["advertising-legends-apps", "advertising-legends", "al-apps"],
    roleName:     "Advertising Legends Apps",
  },
  {
    match:        "devil advertising",
    channelName:  "devil-advertising-apps",
    channelNames: ["devil-advertising-apps", "devil-advertising", "da-apps"],
    roleName:     "Devil Advertising Apps",
  },
  {
    match:        "prime promotions",
    channelName:  "prime-promotions-apps",
    channelNames: ["prime-promotions-apps", "prime-promotions", "pp-apps"],
    roleName:     "Prime Promotions Apps",
  },
  {
    match:        "shadow advertising",
    channelName:  "shadow-advertising-apps",
    channelNames: ["shadow-advertising-apps", "shadow-advertising", "sa-apps"],
    roleName:     "Shadow Advertising Apps",
  },
];

function getServerConfig(guildName) {
  const lower = guildName.toLowerCase();
  return SERVER_CONFIG_MAP.find((e) => lower.includes(e.match)) || null;
}

// ─── Global config (staff server ID, category ID) ────────────────────────────

function getConfig()          { return read(CONFIG_PATH); }
function setConfig(updates)   { write(CONFIG_PATH, { ...getConfig(), ...updates }); }

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
  const idx    = guilds.findIndex((g) => g.id === guildId);
  if (idx === -1) return;
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
// Creates a locked category + one channel per SERVER_CONFIG_MAP entry.
// Skips channels that already exist.  Auto-links every matching guild the bot
// is currently in by saving routeChannelId into their guild config.
// Returns a summary string describing what was done.

async function autoSetupStaffChannels(client, staffGuild) {
  const cfg = getConfig();

  // 1. Create or reuse the Applications category
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

  // 2. Create channels, one per config entry
  const lines = [];

  for (const entry of SERVER_CONFIG_MAP) {
    // Does the channel already exist?
    let ch = staffGuild.channels.cache.find(
      (c) =>
        c.parentId === category.id &&
        entry.channelNames.includes(c.name) &&
        c.isTextBased()
    );

    if (!ch) {
      // Find the matching HR role in the staff server (if it exists) to grant access
      const hrRole = staffGuild.roles.cache.find((r) => r.name === entry.roleName);
      const overwrites = [
        { id: staffGuild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      ];
      if (hrRole) {
        overwrites.push({ id: hrRole.id, allow: [PermissionsBitField.Flags.ViewChannel] });
      }

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

    // 3. Auto-link every matching guild the bot is in
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

// Link a single newly-joined guild to its staff channel (if staff server is set up).
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
  console.log(`🔗 Auto-linked new guild [${guild.name}] → #${ch.name} in [${staffGuild.name}]`);
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
  // 1. Cross-server route set via /setroute or auto-setup
  if (guildConfig?.routeChannelId) {
    try {
      const ch = await client.channels.fetch(guildConfig.routeChannelId);
      if (ch) return { channel: ch, guild: ch.guild };
    } catch (e) {
      console.warn(`[warn] Could not fetch routeChannelId ${guildConfig.routeChannelId}:`, e.message);
    }
  }
  // 2. Same-server saved channel
  if (guildConfig?.applicationChannel) {
    const ch = sourceGuild.channels.cache.get(guildConfig.applicationChannel);
    if (ch) return { channel: ch, guild: sourceGuild };
  }
  // 3. Auto-detect by name in same server
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
    .setDescription("(Admin) Post the application panel with an Apply button in a channel.")
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
        .setDescription("ID of the destination channel. Right-click the channel → Copy Channel ID.")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("(Admin) Set a same-server fallback channel and/or HR role override.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addChannelOption((o) =>
      o.setName("channel")
        .setDescription("The channel where application threads will be created.")
        .setRequired(true)
    )
    .addRoleOption((o) =>
      o.setName("role")
        .setDescription("The HR role to ping.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("setrole")
    .setDescription("(Admin) Override the HR role to ping on new applications.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addRoleOption((o) =>
      o.setName("role").setDescription("The HR role.").setRequired(true)
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
      .setCustomId("panel_apply")
      .setLabel("Apply Now")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("📋")
  );
}

// ─── Shared application flow ──────────────────────────────────────────────────

async function runApplication(client, user, sourceGuild) {
  const guildConfig = getGuild(sourceGuild.id);

  if (isBlacklisted(sourceGuild.id, user.id)) return { ok: false, reason: "blacklisted" };

  const resolved = await resolveAppChannel(client, sourceGuild, guildConfig);
  if (!resolved) return { ok: false, reason: "no_channel" };
  const { channel: appChannel, guild: destGuild } = resolved;

  let dmChannel;
  try {
    dmChannel = await user.createDM();
    await dmChannel.send(
      `📋 **Welcome to the ${sourceGuild.name} staff application!**\n` +
      `Answer each question below. You have **2 minutes** per question.\n` +
      `Type your answer and press Enter to move on.`
    );
  } catch {
    return { ok: false, reason: "no_dm" };
  }

  const answers = [];
  for (let i = 0; i < questions.length; i++) {
    await dmChannel.send(`**Question ${i + 1} of ${questions.length}**\n${questions[i]}`);
    try {
      const collected = await dmChannel.awaitMessages({
        filter: (m) => m.author.id === user.id,
        max: 1,
        time: 120_000,
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
    .setTitle(`📄 New Application${crossServer ? ` — ${sourceGuild.name}` : ""}`)
    .setColor(0x5865f2)
    .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
    .setTimestamp()
    .setFooter({ text: `User ID: ${user.id} • From: ${sourceGuild.name}` });

  questions.forEach((q, i) => {
    embed.addFields({ name: q, value: answers[i] || "*No answer*", inline: false });
  });

  let thread;
  try {
    thread = await appChannel.threads.create({
      name:      `app · ${user.username} (${sourceGuild.name})`,
      type:      ChannelType.PrivateThread,
      invitable: false,
      reason:    `Application from ${user.tag} in ${sourceGuild.name}`,
    });
  } catch (err) {
    console.error("Failed to create private thread:", err);
    await dmChannel.send("❌ Could not create a private thread. Please contact an admin.");
    return { ok: false, reason: "no_thread" };
  }

  const hrRole   = resolveHRRole(sourceGuild.name, destGuild, guildConfig?.hrRole);
  const pingLine = hrRole ? `<@&${hrRole.id}> — new application to review.\n` : "";

  await thread.send({
    content:    `${pingLine}**Applicant:** <@${user.id}>`,
    embeds:     [embed],
    components: [buildReviewRow()],
  });

  console.log(`📄 [${sourceGuild.name}] → #${appChannel.name} in [${destGuild.name}] | ${user.tag} → ${thread.id}`);
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
  console.log(`✅ Logged in as ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  try {
    console.log("🔄 Registering global slash commands...");
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log(`✅ Registered ${commands.length} slash commands globally.`);
  } catch (err) {
    console.error("❌ Failed to register slash commands:", err);
  }

  // If a staff server was previously configured, try to link any unlinked guilds
  const cfg = getConfig();
  if (cfg.staffGuildId) {
    const staffGuild = client.guilds.cache.get(cfg.staffGuildId);
    if (staffGuild) {
      for (const guild of client.guilds.cache.values()) {
        if (guild.id === staffGuild.id) continue;
        const guildCfg = getGuild(guild.id);
        if (guildCfg?.routeChannelId) continue; // already linked

        const entry = getServerConfig(guild.name);
        if (!entry) continue;

        const ch = staffGuild.channels.cache.find(
          (c) => entry.channelNames.includes(c.name) && c.isTextBased()
        );
        if (ch) {
          setGuildConfig(guild.id, { routeChannelId: ch.id });
          console.log(`🔗 Linked [${guild.name}] → #${ch.name}`);
        }
      }
    }
  }
});

// Auto-link new guilds when the bot joins them
client.on("guildCreate", async (guild) => {
  console.log(`➕ Joined guild: ${guild.name}`);
  await autoLinkNewGuild(client, guild);
});

// ─── Interaction handler ──────────────────────────────────────────────────────

client.on("interactionCreate", async (interaction) => {

  // ── Slash commands ──────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    const { commandName, guild, user } = interaction;

    // /setstaffserver
    if (commandName === "setstaffserver") {
      await interaction.deferReply({ ephemeral: true });

      let summary;
      try {
        summary = await autoSetupStaffChannels(client, guild);
      } catch (err) {
        console.error("autoSetupStaffChannels error:", err);
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
          { name: "`/setstaffserver`", value: "*(Admin, staff server)* Create all app channels and auto-link every server.", inline: false },
          { name: "`/panel`",          value: "*(Admin)* Post the application panel in a channel.",                          inline: false },
          { name: "`/apply`",          value: "Start a staff application via DM.",                                           inline: false },
          { name: "`/setroute`",       value: "*(Admin)* Manually route apps to a specific channel ID.",                    inline: false },
          { name: "`/setup`",          value: "*(Admin)* Set a same-server fallback channel + optional HR role.",            inline: false },
          { name: "`/setrole`",        value: "*(Admin)* Override the HR role to ping.",                                    inline: false },
          { name: "`/blacklist`",      value: "*(Mod)* Prevent a user from applying.",                                      inline: false },
          { name: "`/unblacklist`",    value: "*(Admin)* Remove a user from the blacklist.",                                inline: false },
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
      const roleText = role ? ` HR role set to ${role}.` : "";
      return interaction.reply({ content: `✅ Fallback channel set to ${channel}.${roleText}`, ephemeral: true });
    }

    // /setrole
    if (commandName === "setrole") {
      const role = interaction.options.getRole("role");
      setGuildConfig(guild.id, { hrRole: role.id });
      return interaction.reply({ content: `✅ HR role set to ${role}.`, ephemeral: true });
    }

    // /blacklist
    if (commandName === "blacklist") {
      const target = interaction.options.getUser("user");
      addToBlacklist(guild.id, target.id);
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
          `Click the button below to start your application.\n` +
          `The questions will be sent to your **DMs** — make sure they are open!\n\n` +
          `> ⏱️ You have **2 minutes** to answer each question.\n` +
          `> 📬 You'll be notified once a decision has been made.`
        )
        .setColor(0x5865f2)
        .setTimestamp()
        .setFooter({ text: guild.name });

      await target.send({ embeds: [panelEmbed], components: [buildPanelRow()] });
      return interaction.reply({ content: `✅ Panel sent to ${target}.`, ephemeral: true });
    }

    // /apply
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

      let dmChannel;
      try {
        dmChannel = await user.createDM();
        await dmChannel.send(
          `📋 **Welcome to the ${guild.name} staff application!**\n` +
          `Answer each question below. You have **2 minutes** per question.`
        );
      } catch {
        return interaction.reply({ content: "❌ I couldn't DM you. Please enable DMs from server members and try again.", ephemeral: true });
      }

      await interaction.reply({ content: "📬 Check your DMs — your application has started!", ephemeral: true });
      await runApplication(client, user, guild);
    }

    return;
  }

  // ── Button interactions ─────────────────────────────────────────────────────
  if (interaction.isButton()) {

    // ── Panel apply button ──
    if (interaction.customId === "panel_apply") {
      const { guild, user } = interaction;

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

      await interaction.reply({ content: "📬 Check your DMs — your application has started!", ephemeral: true });

      const result = await runApplication(client, user, guild);
      if (!result.ok && result.reason === "no_dm") {
        await interaction.editReply({ content: "❌ I couldn't DM you. Please enable DMs from server members and try again." });
      }
      return;
    }

    // ── Review buttons (accept / deny / blacklist) ──
    if (["app_accept", "app_deny", "app_blacklist"].includes(interaction.customId)) {
      const destGuild = interaction.guild;
      const isAdmin   = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);

      const footer          = interaction.message.embeds[0]?.footer?.text ?? "";
      const fromMatch       = footer.match(/From:\s*(.+)$/);
      const sourceGuildName = fromMatch ? fromMatch[1].trim() : destGuild.name;

      const guildConfig = getGuild(destGuild.id);
      const hrRole      = resolveHRRole(sourceGuildName, destGuild, guildConfig?.hrRole);

      // If an HR role exists → must have it (admin alone is not enough).
      // If no HR role is configured → fall back to admin-only access.
      const hasAccess = hrRole
        ? interaction.member.roles.cache.has(hrRole.id)
        : isAdmin;

      if (!hasAccess) {
        const msg = hrRole
          ? `❌ You need the <@&${hrRole.id}> role to manage applications.`
          : "❌ You don't have permission to manage applications.";
        return interaction.reply({ content: msg, ephemeral: true });
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

      if (interaction.customId === "app_accept") {
        const updated = EmbedBuilder.from(msg.embeds[0]).setColor(0x57f287).setTitle(`✅ Application Accepted — ${sourceGuildName}`);
        await msg.edit({ embeds: [updated], components: [buildReviewRow(true)] });
        await interaction.reply({ content: `✅ Application **accepted** by ${reviewer}.` });
        try { await applicantUser?.send(`✅ **Your application has been accepted!** Congratulations! A staff member from **${sourceGuildName}** will reach out to you soon.`); } catch {}
      }

      else if (interaction.customId === "app_deny") {
        const updated = EmbedBuilder.from(msg.embeds[0]).setColor(0xed4245).setTitle(`❌ Application Denied — ${sourceGuildName}`);
        await msg.edit({ embeds: [updated], components: [buildReviewRow(true)] });
        await interaction.reply({ content: `❌ Application **denied** by ${reviewer}.` });
        try { await applicantUser?.send(`❌ **Your application has been denied.** Unfortunately your application to **${sourceGuildName}** was not accepted at this time. You're welcome to apply again in the future.`); } catch {}
      }

      else if (interaction.customId === "app_blacklist") {
        const sourceGuild = client.guilds.cache.find((g) => g.name === sourceGuildName);
        if (sourceGuild) addToBlacklist(sourceGuild.id, applicantId);

        const updated = EmbedBuilder.from(msg.embeds[0]).setColor(0x000000).setTitle(`🚫 Denied & Blacklisted — ${sourceGuildName}`);
        await msg.edit({ embeds: [updated], components: [buildReviewRow(true)] });
        await interaction.reply({ content: `🚫 Application **denied & user blacklisted** by ${reviewer}.` });
        try { await applicantUser?.send(`🚫 **Your application has been denied** and you have been blacklisted from applying to **${sourceGuildName}** in the future.`); } catch {}
      }
    }
  }
});

// ─── Login ────────────────────────────────────────────────────────────────────

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("❌ DISCORD_TOKEN is not set. Please add it as a secret.");
  process.exit(1);
}

client.login(token).catch((err) => {
  console.error("❌ Failed to login:", err.message);
  process.exit(1);
});
