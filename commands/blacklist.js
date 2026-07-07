const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");
const { addToBlacklist } = require("../lib/db");
const { parseDuration } = require("../lib/duration");
const { applyStaffBlacklistRole, sendBlacklistLog } = require("../lib/blacklistRole");
const { getServerConfig } = require("../lib/serverConfig");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("(Mod) Prevent a user from submitting applications.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
    .addUserOption((o) =>
      o.setName("user")
        .setDescription("The user to blacklist.")
        .setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("duration")
        .setDescription("How long to blacklist (e.g. 1h, 2d, 7d, 2w, permanent). Default: permanent.")
        .setRequired(false)
    ),

  async execute(interaction) {
    const { guild, client } = interaction;

    const target = interaction.options.getUser("user");
    const durationStr =
      interaction.options.getString("duration") ?? "permanent";

    const expiresAt = parseDuration(durationStr);


    if (
      durationStr.toLowerCase() !== "permanent" &&
      expiresAt === null
    ) {
      return interaction.reply({
        content:
          "❌ Invalid duration. Use formats like `1h`, `2d`, `7d`, `2w`, or `permanent`.",
        ephemeral: true,
      });
    }


    const config = getServerConfig(
      guild.name,
      guild.id
    );


    if (!config?.blacklistRoleId) {
      return interaction.reply({
        content:
          "❌ This server does not have a blacklist role configured.",
        ephemeral: true,
      });
    }


    // Save blacklist with role + expiration
    await addToBlacklist(
      guild.id,
      target.id,
      config.blacklistRoleId,
      expiresAt
    );


    // Give blacklist role immediately
    await applyStaffBlacklistRole(
      guild,
      target.id
    );


    // Log blacklist
    await sendBlacklistLog(client, {
      applicantId: target.id,
      applicantTag: target.tag,
      roleLabel: "Manual",
      roleEmoji: "🚫",
      sourceGuildName: guild.name,
      moderator: interaction.user.tag,
      expiresAt,
    });


    const durationDisplay = expiresAt
      ? `until <t:${Math.floor(expiresAt / 1000)}:F>`
      : "permanently";


    return interaction.reply({
      content:
        `🚫 ${target} has been blacklisted from applying ${durationDisplay}.`,
      ephemeral: true,
    });
  },
};