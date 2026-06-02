const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
} = require("discord.js");
const { read, write } = require("./utils/jsondb");
const questions = require("./questions.json");

const GUILDS_PATH = "./data/guilds.json";

// ─── Server → HR role name map ────────────────────────────────────────────────
// Keys are case-insensitive substrings matched against the guild name.
// Values are the exact role names to ping in that server.
const SERVER_ROLE_MAP = [
  { match: "plain promotions",    role: "Plain Promotions Apps"    },
  { match: "advertising legends", role: "Advertising Legends Apps" },
  { match: "devil advertising",   role: "Devil Advertising Apps"   },
  { match: "prime promotions",    role: "Prime Promotions Apps"    },
  { match: "shadow advertising",  role: "Shadow Advertising Apps"  },
];

// Returns the Discord Role object for the HR role in a guild, or null.
// Priority: auto-map by server name → manually saved hrRole → null.
function resolveHRRole(guild, savedHrRoleId) {
  const guildNameLower = guild.name.toLowerCase();
  const entry = SERVER_ROLE_MAP.find((e) => guildNameLower.includes(e.match));
  if (entry) {
    const role = guild.roles.cache.find((r) => r.name === entry.role);
    if (role) return role;
  }
  if (savedHrRoleId) return guild.roles.cache.get(savedHrRoleId) || null;
  return null;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
  ],
});

// ─── DB helpers ───────────────────────────────────────────────────────────────

function getGuilds() {
  return read(GUILDS_PATH);
}

function getGuild(guildId) {
  return getGuilds().find((g) => g.id === guildId) || null;
}

function setGuildConfig(guildId, config) {
  const guilds = getGuilds();
  const idx = guilds.findIndex((g) => g.id === guildId);
  if (idx === -1) {
    guilds.push({ id: guildId, blacklist: [], ...config });
  } else {
    guilds[idx] = { blacklist: [], ...guilds[idx], ...config };
  }
  write(GUILDS_PATH, guilds);
}

function isBlacklisted(guildId, userId) {
  const g = getGuild(guildId);
  return g && Array.isArray(g.blacklist) && g.blacklist.includes(userId);
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

// ─── Buttons row ──────────────────────────────────────────────────────────────

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

// ─── Ready ────────────────────────────────────────────────────────────────────

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`📋 Loaded ${questions.length} application questions.`);
});

// ─── Commands ─────────────────────────────────────────────────────────────────

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;
  if (!message.content.startsWith("!")) return;

  const args = message.content.slice(1).trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  // ── !setup #channel [@hr-role] ──────────────────────────────────────────────
  if (command === "setup") {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply("❌ You need Administrator permission to use this command.");
    }

    const channelMention = args[0];
    if (!channelMention) {
      return message.reply(
        "**Usage:** `!setup #channel [@hr-role]`\nSets the channel where private application threads are created, and optionally the HR role to ping."
      );
    }

    const channelId = channelMention.replace(/[<#>]/g, "");
    const channel = message.guild.channels.cache.get(channelId);
    if (!channel) return message.reply("❌ Channel not found.");

    const update = { applicationChannel: channelId };

    const roleMention = args[1];
    if (roleMention) {
      const roleId = roleMention.replace(/[<@&>]/g, "");
      const role = message.guild.roles.cache.get(roleId);
      if (!role) return message.reply("❌ Role not found.");
      update.hrRole = roleId;
    }

    setGuildConfig(message.guild.id, update);

    const roleText = update.hrRole ? ` HR role set to <@&${update.hrRole}>.` : "";
    return message.reply(`✅ Application channel set to <#${channelId}>.${roleText}`);
  }

  // ── !setrole @hr-role ───────────────────────────────────────────────────────
  if (command === "setrole") {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply("❌ You need Administrator permission to use this command.");
    }

    const roleMention = args[0];
    if (!roleMention) return message.reply("**Usage:** `!setrole @role`");

    const roleId = roleMention.replace(/[<@&>]/g, "");
    const role = message.guild.roles.cache.get(roleId);
    if (!role) return message.reply("❌ Role not found.");

    setGuildConfig(message.guild.id, { hrRole: roleId });
    return message.reply(`✅ HR role set to <@&${roleId}>.`);
  }

  // ── !unblacklist @user ──────────────────────────────────────────────────────
  if (command === "unblacklist") {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply("❌ You need Administrator permission to use this command.");
    }

    const userMention = args[0];
    if (!userMention) return message.reply("**Usage:** `!unblacklist @user`");

    const userId = userMention.replace(/[<@!>]/g, "");
    const removed = removeFromBlacklist(message.guild.id, userId);
    return message.reply(removed ? `✅ <@${userId}> has been removed from the blacklist.` : `⚠️ That user is not blacklisted.`);
  }

  // ── !blacklist @user ────────────────────────────────────────────────────────
  if (command === "blacklist") {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      return message.reply("❌ You need Manage Server permission to use this command.");
    }

    const userMention = args[0];
    if (!userMention) return message.reply("**Usage:** `!blacklist @user`");

    const userId = userMention.replace(/[<@!>]/g, "");
    addToBlacklist(message.guild.id, userId);
    return message.reply(`🚫 <@${userId}> has been blacklisted from applying.`);
  }

  // ── !apply ──────────────────────────────────────────────────────────────────
  if (command === "apply") {
    const guildConfig = getGuild(message.guild.id);
    if (!guildConfig || !guildConfig.applicationChannel) {
      return message.reply("❌ Applications are not set up yet. Ask an admin to run `!setup #channel`.");
    }

    if (isBlacklisted(message.guild.id, message.author.id)) {
      return message.reply("🚫 You are blacklisted from submitting applications.");
    }

    let dmChannel;
    try {
      dmChannel = await message.author.createDM();
      await dmChannel.send("📋 Starting your application! Answer each question. You have **2 minutes** per question.");
      await message.reply("📬 Check your DMs — your application has started!");
    } catch {
      return message.reply("❌ I couldn't DM you. Please enable DMs from server members and try again.");
    }

    const answers = [];

    for (let i = 0; i < questions.length; i++) {
      await dmChannel.send(`**Question ${i + 1}/${questions.length}:**\n${questions[i]}`);

      try {
        const collected = await dmChannel.awaitMessages({
          filter: (m) => m.author.id === message.author.id,
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

    const appChannel = message.guild.channels.cache.get(guildConfig.applicationChannel);
    if (!appChannel) {
      return dmChannel.send("❌ Could not find the applications channel. Please contact an admin.");
    }

    // Build embed
    const embed = new EmbedBuilder()
      .setTitle("📄 New Staff Application")
      .setColor(0x5865f2)
      .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
      .setTimestamp()
      .setFooter({ text: `User ID: ${message.author.id}` });

    questions.forEach((q, i) => {
      embed.addFields({ name: q, value: answers[i] || "*No answer*", inline: false });
    });

    // Create private thread
    let thread;
    try {
      thread = await appChannel.threads.create({
        name: `app-${message.author.username}`,
        type: ChannelType.PrivateThread,
        invitable: false,
        reason: `Application from ${message.author.tag}`,
      });
    } catch (err) {
      console.error("Failed to create private thread:", err);
      return dmChannel.send("❌ Could not create a private thread. Make sure the bot has the correct permissions.");
    }

    // Ping HR role — auto-detected by server name, falls back to saved role
    const hrRole = resolveHRRole(message.guild, guildConfig?.hrRole);
    const hrPing = hrRole ? `<@&${hrRole.id}>` : "";
    const pingLine = hrPing ? `${hrPing} — new application to review.\n` : "";

    await thread.send({
      content: `${pingLine}**Applicant:** <@${message.author.id}>`,
      embeds: [embed],
      components: [buildActionRow()],
    });

    console.log(`📄 Application thread created for ${message.author.tag}: ${thread.id}`);
    return;
  }

  // ── !help ───────────────────────────────────────────────────────────────────
  if (command === "help") {
    const embed = new EmbedBuilder()
      .setTitle("📋 Apply Bot — Commands")
      .setColor(0x5865f2)
      .addFields(
        { name: "`!apply`", value: "Start a staff application via DM.", inline: false },
        { name: "`!setup #channel [@hr-role]`", value: "*(Admin)* Set the applications channel and optional HR role.", inline: false },
        { name: "`!setrole @role`", value: "*(Admin)* Set or update the HR role to ping.", inline: false },
        { name: "`!blacklist @user`", value: "*(Mod)* Prevent a user from applying.", inline: false },
        { name: "`!unblacklist @user`", value: "*(Admin)* Remove a user from the blacklist.", inline: false },
        { name: "`!help`", value: "Show this help message.", inline: false }
      )
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  }
});

// ─── Button interactions ──────────────────────────────────────────────────────

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  if (!["app_accept", "app_deny", "app_blacklist"].includes(interaction.customId)) return;

  // Only HR or admins can press the buttons
  const guildConfig = getGuild(interaction.guild.id);
  const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
  const hrRole = resolveHRRole(interaction.guild, guildConfig?.hrRole);
  const isHR = hrRole && interaction.member.roles.cache.has(hrRole.id);

  if (!isAdmin && !isHR) {
    return interaction.reply({ content: "❌ You don't have permission to manage applications.", ephemeral: true });
  }

  // Parse applicant user ID from the thread's first message content
  const message = interaction.message;
  const applicantMatch = message.content.match(/\*\*Applicant:\*\* <@(\d+)>/);
  if (!applicantMatch) {
    return interaction.reply({ content: "❌ Could not determine the applicant from this message.", ephemeral: true });
  }
  const applicantId = applicantMatch[1];

  const reviewer = interaction.user.tag;
  let applicantUser;
  try {
    applicantUser = await client.users.fetch(applicantId);
  } catch {
    applicantUser = null;
  }

  // ── Accept ──
  if (interaction.customId === "app_accept") {
    const updatedEmbed = EmbedBuilder.from(message.embeds[0])
      .setColor(0x57f287)
      .setTitle("✅ Application Accepted");

    await message.edit({ embeds: [updatedEmbed], components: [buildActionRow(true)] });

    await interaction.reply({ content: `✅ Application **accepted** by ${reviewer}.`, ephemeral: false });

    if (applicantUser) {
      try {
        await applicantUser.send(`✅ **Your application has been accepted!** Congratulations! A staff member from **${interaction.guild.name}** will reach out to you soon.`);
      } catch {}
    }
  }

  // ── Deny ──
  else if (interaction.customId === "app_deny") {
    const updatedEmbed = EmbedBuilder.from(message.embeds[0])
      .setColor(0xed4245)
      .setTitle("❌ Application Denied");

    await message.edit({ embeds: [updatedEmbed], components: [buildActionRow(true)] });

    await interaction.reply({ content: `❌ Application **denied** by ${reviewer}.`, ephemeral: false });

    if (applicantUser) {
      try {
        await applicantUser.send(`❌ **Your application has been denied.** Unfortunately, your application to **${interaction.guild.name}** was not accepted at this time. You're welcome to apply again in the future.`);
      } catch {}
    }
  }

  // ── Blacklist ──
  else if (interaction.customId === "app_blacklist") {
    addToBlacklist(interaction.guild.id, applicantId);

    const updatedEmbed = EmbedBuilder.from(message.embeds[0])
      .setColor(0x000000)
      .setTitle("🚫 Application Denied — Blacklisted");

    await message.edit({ embeds: [updatedEmbed], components: [buildActionRow(true)] });

    await interaction.reply({ content: `🚫 Application **denied & user blacklisted** by ${reviewer}.`, ephemeral: false });

    if (applicantUser) {
      try {
        await applicantUser.send(`🚫 **Your application has been denied** and you have been blacklisted from applying to **${interaction.guild.name}** in the future.`);
      } catch {}
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
