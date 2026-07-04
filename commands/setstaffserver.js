const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } = require("discord.js");
const log = require("../utils/logger");
const { autoSetupStaffChannels } = require("../lib/staffSetup");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setstaffserver")
    .setDescription("(Admin) Mark this server as the staff hub and auto-create all application channels.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  async execute(interaction) {
    const { guild } = interaction;
    await interaction.deferReply({ ephemeral: true });
    let summary;
    try {
      summary = await autoSetupStaffChannels(interaction.client, guild);
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
  },
};
