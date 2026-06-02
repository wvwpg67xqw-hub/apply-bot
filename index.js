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

// ─── Server → HR role name map ────────────────────────────────────────────────
const SERVER_ROLE_MAP = [
  { match: "plain promotions",    role: "Plain Promotions Apps"    },
  { match: "advertising legends", role: "Advertising Legends Apps" },
  { match: "devil advertising",   role: "Devil Advertising Apps"   },
  { match: "prime promotions",    role: "Prime Promotions Apps"    },
  { match: "shadow advertising",  role: "Shadow Advertising Apps"  },
];

function resolveHRRole(guild, savedHrRoleId) {
  const lower = guild.name.toLowerCase();
  const entry = SERVER_ROLE_MAP.find((e) => lower.includes(e.match));
  if (entry) {
    const role = guild.roles.cache.find((r) => r.name === entry.role);
    if (role) return role;
  }
  if (savedHrRoleId) return guild.roles.cache.get(savedHrRoleId) || null;
  return null;
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

function getGuilds()              { return read(GUILDS_PATH); }
function getGuild(id)             { return getGuilds().find((g) => g.id === id) || null; }

function setGuildConfig(guildId, config) {
  const guilds = getGuilds();
  const idx = guilds.findIndex((g) => g.id === guildId);
  if (idx === -1) guilds.push({ id: guildId, blacklist: [], ...config });
  else guilds[idx] = { blacklist: [], ...guilds[idx], ...config };
  write(GUILDS_PATH, guilds);
}

function isBlacklisted(guildId, userId) {
  const g = getGuild(guildId);
  return g?.blacklist?.includes(userId) ?? false;
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
  return (guilds[idx].blacklist.length < before);
}

// ─── Slash command definitions ────────────────────────────────────────────────

const commands = [
  new SlashCommandBuilder()
    .setName("apply")
    .setDescription("Submit a staff application — questions will be sent to your DMs."),

  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("(Admin) Set the channel for application threads and optionally the HR role.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addChannelOption((o) =>
      o.setName("channel")
        .setDescription("The channel where private application threads will be created.")
        .setRequired(true)
    )
    .addRoleOption((o) =>
      o.setName("role")
        .setDescription("The HR role to ping on new applications (auto-detected for known servers).")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("setrole")
    .setDescription("(Admin) Set or update the HR role to ping on new applications.")
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

// ─── Button row ───────────────────────────────────────────────────────────────

function buildActionRow(disabled = false) {
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

// ─── Slash command handler ────────────────────────────────────────────────────

client.on("interactionCreate", async (interaction) => {

  // ── Slash commands ──────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    const { commandName, guild, member, user } = interaction;

    // /help
    if (commandName === "help") {
      const embed = new EmbedBuilder()
        .setTitle("📋 Apply Bot — Commands")
        .setColor(0x5865f2)
        .addFields(
          { name: "`/apply`",            value: "Start a staff application via DM.",                                      inline: false },
          { name: "`/setup`",            value: "*(Admin)* Set the applications channel and optional HR role.",           inline: false },
          { name: "`/setrole`",          value: "*(Admin)* Set or update the HR role to ping.",                           inline: false },
          { name: "`/blacklist`",        value: "*(Mod)* Prevent a user from applying.",                                  inline: false },
          { name: "`/unblacklist`",      value: "*(Admin)* Remove a user from the blacklist.",                            inline: false },
        )
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

    // /apply
    if (commandName === "apply") {
      const guildConfig = getGuild(guild.id);
      if (!guildConfig?.applicationChannel) {
        return interaction.reply({ content: "❌ Applications are not set up yet. Ask an admin to run `/setup`.", ephemeral: true });
      }

      if (isBlacklisted(guild.id, user.id)) {
        return interaction.reply({ content: "🚫 You are blacklisted from submitting applications.", ephemeral: true });
      }

      // Try to open DM before acknowledging
      let dmChannel;
      try {
        dmChannel = await user.createDM();
        await dmChannel.send("📋 Starting your application! Answer each question. You have **2 minutes** per question.");
      } catch {
        return interaction.reply({ content: "❌ I couldn't DM you. Please enable DMs from server members and try again.", ephemeral: true });
      }

      await interaction.reply({ content: "📬 Check your DMs — your application has started!", ephemeral: true });

      const answers = [];
      for (let i = 0; i < questions.length; i++) {
        await dmChannel.send(`**Question ${i + 1}/${questions.length}:**\n${questions[i]}`);
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

      await dmChannel.send("✅ Your application has been submitted! You will be notified of the decision.");

      const appChannel = guild.channels.cache.get(guildConfig.applicationChannel);
      if (!appChannel) {
        return dmChannel.send("❌ Could not find the applications channel. Please contact an admin.");
      }

      const embed = new EmbedBuilder()
        .setTitle("📄 New Staff Application")
        .setColor(0x5865f2)
        .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
        .setTimestamp()
        .setFooter({ text: `User ID: ${user.id}` });

      questions.forEach((q, i) => {
        embed.addFields({ name: q, value: answers[i] || "*No answer*", inline: false });
      });

      let thread;
      try {
        thread = await appChannel.threads.create({
          name: `app-${user.username}`,
          type: ChannelType.PrivateThread,
          invitable: false,
          reason: `Application from ${user.tag}`,
        });
      } catch (err) {
        console.error("Failed to create private thread:", err);
        return dmChannel.send("❌ Could not create a private thread. Make sure the bot has the correct permissions.");
      }

      const hrRole    = resolveHRRole(guild, guildConfig?.hrRole);
      const pingLine  = hrRole ? `<@&${hrRole.id}> — new application to review.\n` : "";

      await thread.send({
        content: `${pingLine}**Applicant:** <@${user.id}>`,
        embeds: [embed],
        components: [buildActionRow()],
      });

      console.log(`📄 Application thread created for ${user.tag}: ${thread.id}`);
    }

    return;
  }

  // ── Button interactions ─────────────────────────────────────────────────────
  if (interaction.isButton()) {
    if (!["app_accept", "app_deny", "app_blacklist"].includes(interaction.customId)) return;

    const guildConfig = getGuild(interaction.guild.id);
    const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
    const hrRole  = resolveHRRole(interaction.guild, guildConfig?.hrRole);
    const isHR    = hrRole && interaction.member.roles.cache.has(hrRole.id);

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
      await msg.edit({ embeds: [updated], components: [buildActionRow(true)] });
      await interaction.reply({ content: `✅ Application **accepted** by ${reviewer}.` });
      try { await applicantUser?.send(`✅ **Your application has been accepted!** Congratulations! A staff member from **${interaction.guild.name}** will reach out to you soon.`); } catch {}
    }

    else if (interaction.customId === "app_deny") {
      const updated = EmbedBuilder.from(msg.embeds[0]).setColor(0xed4245).setTitle("❌ Application Denied");
      await msg.edit({ embeds: [updated], components: [buildActionRow(true)] });
      await interaction.reply({ content: `❌ Application **denied** by ${reviewer}.` });
      try { await applicantUser?.send(`❌ **Your application has been denied.** Unfortunately your application to **${interaction.guild.name}** was not accepted at this time. You're welcome to apply again in the future.`); } catch {}
    }

    else if (interaction.customId === "app_blacklist") {
      addToBlacklist(interaction.guild.id, applicantId);
      const updated = EmbedBuilder.from(msg.embeds[0]).setColor(0x000000).setTitle("🚫 Application Denied — Blacklisted");
      await msg.edit({ embeds: [updated], components: [buildActionRow(true)] });
      await interaction.reply({ content: `🚫 Application **denied & user blacklisted** by ${reviewer}.` });
      try { await applicantUser?.send(`🚫 **Your application has been denied** and you have been blacklisted from applying to **${interaction.guild.name}** in the future.`); } catch {}
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
