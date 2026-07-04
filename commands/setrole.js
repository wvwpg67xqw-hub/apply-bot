const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");
const { setGuildConfig } = require("../lib/db");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setrole")
    .setDescription("(Admin) Override the HR role to ping on new applications.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addRoleOption((o) =>
      o.setName("role").setDescription("The HR role.").setRequired(true)
    ),

  async execute(interaction) {
    const { guild } = interaction;
    const role = interaction.options.getRole("role");
    setGuildConfig(guild.id, { hrRole: role.id });
    return interaction.reply({ content: `✅ HR role set to ${role}.`, ephemeral: true });
  },
};
