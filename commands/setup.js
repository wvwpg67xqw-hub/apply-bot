const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");
const { setGuildConfig } = require("../lib/db");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("(Admin) Set a same-server fallback channel and/or HR role override.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addChannelOption((o) =>
      o.setName("channel").setDescription("Channel for application threads.").setRequired(true)
    )
    .addRoleOption((o) =>
      o.setName("role").setDescription("HR role to ping.").setRequired(false)
    ),

  async execute(interaction) {
    const { guild } = interaction;
    const channel = interaction.options.getChannel("channel");
    const role    = interaction.options.getRole("role");
    const update  = { applicationChannel: channel.id };
    if (role) update.hrRole = role.id;
    setGuildConfig(guild.id, update);
    return interaction.reply({
      content: `✅ Fallback channel set to ${channel}.${role ? ` HR role set to ${role}.` : ""}`,
      ephemeral: true,
    });
  },
};
