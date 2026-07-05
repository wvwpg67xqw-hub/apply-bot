const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");
const log = require("../utils/logger");
const { setConfig } = require("../lib/db");
const { parseDurationMs } = require("../lib/duration");
const { JOIN_ALERT_ROLE_ID, JOIN_ALERT_CHANNEL_ID } = require("../lib/joinWatcher");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setjointimeout")
    .setDescription("(Admin) Set how long to wait before alerting that an accepted applicant hasn't joined.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addStringOption((o) =>
      o.setName("duration")
        .setDescription("Time to wait, e.g. 1m, 30m, 48h, 7d. Default is 48h.")
        .setRequired(true)
    ),

  async execute(interaction) {
    const durationStr = interaction.options.getString("duration");
    const ms          = parseDurationMs(durationStr);
    if (!ms) {
      return interaction.reply({
        content: "❌ Invalid duration. Use formats like `1m`, `30m`, `48h`, `7d`.",
        ephemeral: true,
      });
    }
    await setConfig({ joinTimeoutMs: ms });
    const friendly = durationStr.endsWith("m")
      ? `${parseInt(durationStr)} minute${parseInt(durationStr) === 1 ? "" : "s"}`
      : durationStr.endsWith("h")
      ? `${parseInt(durationStr)} hour${parseInt(durationStr) === 1 ? "" : "s"}`
      : durationStr.endsWith("d")
      ? `${parseInt(durationStr)} day${parseInt(durationStr) === 1 ? "" : "s"}`
      : durationStr.endsWith("w")
      ? `${parseInt(durationStr)} week${parseInt(durationStr) === 1 ? "" : "s"}`
      : durationStr;
    log.info("CONFIG", `Join timeout set to ${ms}ms (${friendly}) by ${interaction.user.tag}`);
    return interaction.reply({
      content: `✅ Join alert timeout set to **${friendly}**. If an accepted applicant hasn't joined the staff server within that time, <@&${JOIN_ALERT_ROLE_ID}> will be pinged in <#${JOIN_ALERT_CHANNEL_ID}>.`,
      ephemeral: true,
    });
  },
};
