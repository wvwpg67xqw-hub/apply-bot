const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType } = require("discord.js");
const { read, write } = require("./utils/jsondb");
const questions = require("./questions.json");

const GUILDS_PATH = "./data/guilds.json";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

function getGuilds() {
  return read(GUILDS_PATH);
}

function saveGuilds(guilds) {
  write(GUILDS_PATH, guilds);
}

function getGuild(guildId) {
  const guilds = getGuilds();
  return guilds.find((g) => g.id === guildId) || null;
}

function setGuildConfig(guildId, config) {
  const guilds = getGuilds();
  const idx = guilds.findIndex((g) => g.id === guildId);
  if (idx === -1) {
    guilds.push({ id: guildId, ...config });
  } else {
    guilds[idx] = { ...guilds[idx], ...config };
  }
  saveGuilds(guilds);
}

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`📋 Loaded ${questions.length} application questions.`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith("!")) return;

  const args = message.content.slice(1).trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  if (command === "setup") {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply("❌ You need Administrator permission to use this command.");
    }

    const channelMention = args[0];
    if (!channelMention) {
      return message.reply("Usage: `!setup #channel` — sets the channel where applications are sent.");
    }

    const channelId = channelMention.replace(/[<#>]/g, "");
    const channel = message.guild.channels.cache.get(channelId);
    if (!channel) {
      return message.reply("❌ Channel not found.");
    }

    setGuildConfig(message.guild.id, { applicationChannel: channelId });
    return message.reply(`✅ Application channel set to <#${channelId}>.`);
  }

  if (command === "apply") {
    const guildConfig = getGuild(message.guild.id);
    if (!guildConfig || !guildConfig.applicationChannel) {
      return message.reply("❌ Applications are not set up yet. Ask an admin to run `!setup #channel`.");
    }

    try {
      await message.author.send("📋 Starting your application! Please answer each question.");
      if (message.guild) {
        await message.reply("📬 Check your DMs — I've sent you the application questions!");
      }
    } catch {
      return message.reply("❌ I couldn't DM you. Please enable DMs from server members and try again.");
    }

    const answers = [];
    const dmChannel = await message.author.createDM();

    for (let i = 0; i < questions.length; i++) {
      await dmChannel.send(`**Question ${i + 1}/${questions.length}:**\n${questions[i]}`);

      const filter = (m) => m.author.id === message.author.id;
      try {
        const collected = await dmChannel.awaitMessages({ filter, max: 1, time: 120000, errors: ["time"] });
        answers.push(collected.first().content);
      } catch {
        await dmChannel.send("⏰ You took too long to answer. Application cancelled.");
        return;
      }
    }

    await dmChannel.send("✅ Thanks! Your application has been submitted.");

    const appChannel = message.guild.channels.cache.get(guildConfig.applicationChannel);
    if (!appChannel) {
      return dmChannel.send("❌ Could not find the applications channel. Please contact an admin.");
    }

    const embed = new EmbedBuilder()
      .setTitle("📄 New Staff Application")
      .setColor(0x5865f2)
      .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
      .setTimestamp()
      .setFooter({ text: `User ID: ${message.author.id}` });

    questions.forEach((q, i) => {
      embed.addFields({ name: q, value: answers[i] || "No answer", inline: false });
    });

    await appChannel.send({ embeds: [embed] });
  }

  if (command === "help") {
    const embed = new EmbedBuilder()
      .setTitle("📋 Apply Bot — Help")
      .setColor(0x5865f2)
      .addFields(
        { name: "`!apply`", value: "Start a staff application via DM.", inline: false },
        { name: "`!setup #channel`", value: "*(Admin)* Set the channel where applications are posted.", inline: false },
        { name: "`!help`", value: "Show this help message.", inline: false }
      )
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  }
});

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("❌ DISCORD_TOKEN is not set. Please add it as a secret.");
  process.exit(1);
}

client.login(token).catch((err) => {
  console.error("❌ Failed to login:", err.message);
  process.exit(1);
});
