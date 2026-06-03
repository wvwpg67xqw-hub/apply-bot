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

const GUILDS_PATH = "./data/guilds.json";

// ─── Per-server config map ────────────────────────────────────────────────────
// The bot matches the guild name (case-insensitive) against `match`, then
// auto-finds the HR role by `roleName` and the application channel by any name
// in `channelNames`.  Update `channelNames` if your channel is named differently.
// `/setup` always overrides auto-detection for both role and channel.
const SERVER_CONFIG_MAP = [
  {
    match:        "plain promotions",
    roleName:     "Plain Promotions Apps",
    channelNames: ["plain-promotions-apps", "pp-apps", "applications", "staff-apps"],
  },
  {
    match:        "advertising legends",
    roleName:     "Advertising Legends Apps",
    channelNames: ["advertising-legends-apps", "al-apps", "applications", "staff-apps"],
  },
  {
    match:        "devil advertising",
    roleName:     "Devil Advertising Apps",
    channelNames: ["devil-advertising-apps", "da-apps", "applications", "staff-apps"],
  },
  {
    match:        "prime promotions",
    roleName:     "Prime Promotions Apps",
    channelNames: ["prime-promotions-apps", "pp-apps", "applications", "staff-apps"],
  },
  {
    match:        "shadow advertising",
    roleName:     "Shadow Advertising Apps",
    channelNames: ["shadow-advertising-apps", "sa-apps", "applications", "staff-apps"],
  },
];

// Find the config entry for a guild, or null.
function getServerConfig(guild) {
  const lower = guild.name.toLowerCase();
  return SERVER_CONFIG_MAP.find((e) => lower.includes(e.match)) || null;
}

// Resolve the HR role: auto-detected by server name first, then saved override.
function resolveHRRole(guild, savedHrRoleId) {
  const entry = getServerConfig(guild);
  if (entry) {
    const role = guild.roles.cache.find((r) => r.name === entry.roleName);
    if (role) return role;
  }
  if (savedHrRoleId) return guild.roles.cache.get(savedHrRoleId) || null;
  return null;
}

// Resolve the application channel:
//   1. Saved channel ID from /setup  (highest priority)
//   2. Auto-detected by name from SERVER_CONFIG_MAP
// Returns a Channel object or null.
function resolveAppChannel(guild, savedChannelId) {
  if (savedChannelId) {
    const ch = guild.channels.cache.get(savedChannelId);
    if (ch) return ch;
  }
  const entry = getServerConfig(guild);
  if (entry) {
    for (const name of entry.channelNames) {
      const ch = guild.channels.cache.find(
        (c) => c.name === name && c.isTextBased()
      );
      if (ch) return ch;
    }
  }
  return null;
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

function getGuilds()  { return read(GUILDS_PATH); }
function getGuild(id) { return getGuilds().find((g) => g.id === id) || null; }

function setGuildConfig(guildId, config) {
  const guilds = getGuilds();
  const idx = guilds.findIndex((g) => g.id === guildId);
  if (idx === -1) guilds.push({ id: guildId, blacklist: [], ...config });
  else guilds[idx] = { blacklist: [], ...guilds[idx], ...config };
  write(GUILDS_PATH, guilds);
}

function isBlacklisted(guildId, userId) {
  return getGuild(guildId)?.blacklist?.includes(userId) ?? false;
}

function addToBlacklist(guildId, userId) {
  const guilds = getGuilds();
  const idx = guilds.findIndex((g) => g.id === guildId);
  if (idx === -1) return;
  if (!Array.isArray(guilds[idx].blacklist)) guilds[idx].blacklist = [];
  if (!guilds[idx].blacklist.includes(userId)) guilds[idx].blacklist.push(userId);
  write(GUILDS_PATH, guilds);
}

function removeFromBlacklist(guildId, userId) {
  const guilds = getGuilds();
  const idx = guilds.findIndex((g) => g.id === guildId);
  if (idx === -1) return false;
  const before = guilds[idx].blacklist?.length || 0;
  guilds[idx].blacklist = (guilds[idx].blacklist || []).filter((id) => id !== userId);
  write(GUILDS_PATH, guilds);
  return guilds[idx].blacklist.length < before;
}

// ─── Slash command definitions ────────────────────────────────────────────────

const commands = [
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
    .setName("setup")
    .setDescription("(Admin) Override the auto-detected application channel and/or HR role.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addChannelOption((o) =>
      o.setName("channel")
        .setDescription("The channel where private application threads will be created.")
        .setRequired(true)
    )
    .addRoleOption((o) =>
      o.setName("role")
        .setDescription("The HR role to ping (auto-detected for known servers).")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("setrole")
    .setDescription("(Admin) Override the auto-detected HR role.")
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
    .setDescription("Show all available commands."),
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

async function runApplication(user, guild) {
  const guildConfig = getGuild(guild.id);

  if (isBlacklisted(guild.id, user.id)) return { ok: false, reason: "blacklisted" };

  // Resolve channel — auto-detected or manually configured
  const appChannel = resolveAppChannel(guild, guildConfig?.applicationChannel);
  if (!appChannel) return { ok: false, reason: "no_channel" };

  let dmChannel;
  try {
    dmChannel = await user.createDM();
    await dmChannel.send(
      `📋 **Welcome to the ${guild.name} staff application!**\n` +
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

  // Build result embed
  const embed = new EmbedBuilder()
    .setTitle("📄 New Staff Application")
    .setColor(0x5865f2)
    .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
    .setTimestamp()
    .setFooter({ text: `User ID: ${user.id} • ${guild.name}` });

  questions.forEach((q, i) => {
    embed.addFields({ name: q, value: answers[i] || "*No answer*", inline: false });
  });

  // Create private thread inside the resolved channel
  let thread;
  try {
    thread = await appChannel.threads.create({
      name: `app · ${user.username}`,
      type: ChannelType.PrivateThread,
      invitable: false,
      reason: `Application from ${user.tag}`,
    });
  } catch (err) {
    console.error("Failed to create private thread:", err);
    await dmChannel.send("❌ Could not create a private thread. Please contact an admin.");
    return { ok: false, reason: "no_thread" };
  }

  const hrRole   = resolveHRRole(guild, guildConfig?.hrRole);
  const pingLine = hrRole ? `<@&${hrRole.id}> — new application to review.\n` : "";

  await thread.send({
    content: `${pingLine}**Applicant:** <@${user.id}>`,
    embeds: [embed],
    components: [buildReviewRow()],
  });

  console.log(`📄 [${guild.name}] Thread for ${user.tag} → #${appChannel.name} → ${thread.id}`);
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
});

// ─── Interaction handler ──────────────────────────────────────────────────────

client.on("interactionCreate", async (interaction) => {

  // ── Slash commands ──────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    const { commandName, guild, user } = interaction;

    // /help
    if (commandName === "help") {
      const cfg    = getServerConfig(guild);
      const savedCh = resolveAppChannel(guild, getGuild(guild.id)?.applicationChannel);
      const hrRole  = resolveHRRole(guild, getGuild(guild.id)?.hrRole);

      const embed = new EmbedBuilder()
        .setTitle("📋 Apply Bot — Commands")
        .setColor(0x5865f2)
        .addFields(
          { name: "`/panel`",       value: "*(Admin)* Post the application panel in a channel.",                                  inline: false },
          { name: "`/apply`",       value: "Start a staff application via DM.",                                                   inline: false },
          { name: "`/setup`",       value: "*(Admin)* Override the auto-detected application channel and/or HR role.",            inline: false },
          { name: "`/setrole`",     value: "*(Admin)* Override the auto-detected HR role.",                                       inline: false },
          { name: "`/blacklist`",   value: "*(Mod)* Prevent a user from applying.",                                               inline: false },
          { name: "`/unblacklist`", value: "*(Admin)* Remove a user from the blacklist.",                                         inline: false },
        )
        .addFields({
          name: "⚙️ This server",
          value: [
            `**Channel:** ${savedCh ? `<#${savedCh.id}>` : cfg ? `auto-detecting by name` : "not configured — use \`/setup\`"}`,
            `**HR Role:** ${hrRole ? `<@&${hrRole.id}>` : "not found"}`,
          ].join("\n"),
          inline: false,
        })
        .setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // /setup
    if (commandName === "setup") {
      const channel = interaction.options.getChannel("channel");
      const role    = interaction.options.getRole("role");
      const update  = { applicationChannel: channel.id };
      if (role) update.hrRole = role.id;
      setGuildConfig(guild.id, update);
      const roleText = role ? ` HR role set to ${role}.` : "";
      return interaction.reply({ content: `✅ Application channel set to ${channel}.${roleText}`, ephemeral: true });
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

      const guildConfig = getGuild(guild.id);
      const appChannel  = resolveAppChannel(guild, guildConfig?.applicationChannel);
      if (!appChannel) {
        return interaction.reply({
          content: "❌ No application channel found for this server. Ask an admin to run `/setup`.",
          ephemeral: true,
        });
      }

      // Test DM access before replying
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
          return;
        }
      }

      await dmChannel.send("✅ **Your application has been submitted!** You'll be notified once a decision is made.");

      const embed = new EmbedBuilder()
        .setTitle("📄 New Staff Application")
        .setColor(0x5865f2)
        .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
        .setTimestamp()
        .setFooter({ text: `User ID: ${user.id} • ${guild.name}` });
      questions.forEach((q, i) => embed.addFields({ name: q, value: answers[i] || "*No answer*", inline: false }));

      let thread;
      try {
        thread = await appChannel.threads.create({
          name: `app · ${user.username}`,
          type: ChannelType.PrivateThread,
          invitable: false,
          reason: `Application from ${user.tag}`,
        });
      } catch (err) {
        console.error("Failed to create thread:", err);
        return dmChannel.send("❌ Could not create a private thread. Please contact an admin.");
      }

      const hrRole   = resolveHRRole(guild, guildConfig?.hrRole);
      const pingLine = hrRole ? `<@&${hrRole.id}> — new application to review.\n` : "";
      await thread.send({ content: `${pingLine}**Applicant:** <@${user.id}>`, embeds: [embed], components: [buildReviewRow()] });
      console.log(`📄 [${guild.name}] Thread for ${user.tag} → #${appChannel.name} → ${thread.id}`);
    }

    return;
  }

  // ── Button interactions ─────────────────────────────────────────────────────
  if (interaction.isButton()) {

    // ── Apply panel button ──
    if (interaction.customId === "panel_apply") {
      const { guild, user } = interaction;

      if (isBlacklisted(guild.id, user.id)) {
        return interaction.reply({ content: "🚫 You are blacklisted from submitting applications.", ephemeral: true });
      }

      const guildConfig = getGuild(guild.id);
      const appChannel  = resolveAppChannel(guild, guildConfig?.applicationChannel);
      if (!appChannel) {
        return interaction.reply({
          content: "❌ No application channel found for this server. Ask an admin to run `/setup`.",
          ephemeral: true,
        });
      }

      await interaction.reply({ content: "📬 Check your DMs — your application has started!", ephemeral: true });

      const result = await runApplication(user, guild);
      if (!result.ok && result.reason === "no_dm") {
        await interaction.editReply({ content: "❌ I couldn't DM you. Please enable DMs from server members and try again." });
      }
      return;
    }

    // ── Review buttons (accept / deny / blacklist) ──
    if (["app_accept", "app_deny", "app_blacklist"].includes(interaction.customId)) {
      const guildConfig = getGuild(interaction.guild.id);
      const isAdmin     = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
      const hrRole      = resolveHRRole(interaction.guild, guildConfig?.hrRole);
      const isHR        = hrRole && interaction.member.roles.cache.has(hrRole.id);

      if (!isAdmin && !isHR) {
        return interaction.reply({ content: "❌ You don't have permission to manage applications.", ephemeral: true });
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
        const updated = EmbedBuilder.from(msg.embeds[0]).setColor(0x57f287).setTitle("✅ Application Accepted");
        await msg.edit({ embeds: [updated], components: [buildReviewRow(true)] });
        await interaction.reply({ content: `✅ Application **accepted** by ${reviewer}.` });
        try { await applicantUser?.send(`✅ **Your application has been accepted!** Congratulations! A staff member from **${interaction.guild.name}** will reach out to you soon.`); } catch {}
      }

      else if (interaction.customId === "app_deny") {
        const updated = EmbedBuilder.from(msg.embeds[0]).setColor(0xed4245).setTitle("❌ Application Denied");
        await msg.edit({ embeds: [updated], components: [buildReviewRow(true)] });
        await interaction.reply({ content: `❌ Application **denied** by ${reviewer}.` });
        try { await applicantUser?.send(`❌ **Your application has been denied.** Unfortunately your application to **${interaction.guild.name}** was not accepted at this time. You're welcome to apply again in the future.`); } catch {}
      }

      else if (interaction.customId === "app_blacklist") {
        addToBlacklist(interaction.guild.id, applicantId);
        const updated = EmbedBuilder.from(msg.embeds[0]).setColor(0x000000).setTitle("🚫 Application Denied — Blacklisted");
        await msg.edit({ embeds: [updated], components: [buildReviewRow(true)] });
        await interaction.reply({ content: `🚫 Application **denied & user blacklisted** by ${reviewer}.` });
        try { await applicantUser?.send(`🚫 **Your application has been denied** and you have been blacklisted from applying to **${interaction.guild.name}** in the future.`); } catch {}
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
