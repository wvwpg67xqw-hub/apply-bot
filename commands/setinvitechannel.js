const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");
const { setConfig } = require("../lib/db");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setinvitechannel")
    .setDescription("(Admin) Set which channel staff invite links are created for.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addChannelOption((o) =>
      o.setName("channel").setDescription("The channel to generate invites for.").setRequired(true)
    ),

  async execute(interaction) {
    const channel = interaction.options.getChannel("channel");
    await setConfig({ inviteChannelId: channel.id });
    return interaction.reply({
      content: `✅ Staff invites will now be created for ${channel}. Each accepted applicant gets a unique 1-use link valid for 24 hours.`,
      ephemeral: true,
    });
  },
};
