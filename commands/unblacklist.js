const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");
const { removeFromBlacklistAllGuilds } = require("../lib/db");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("unblacklist")
    .setDescription("(Admin) Remove a user from the blacklist.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addUserOption((o) =>
      o.setName("user").setDescription("The user to unblacklist.").setRequired(true)
    ),

  async execute(interaction) {
    const target  = interaction.options.getUser("user");
    const count   = await removeFromBlacklistAllGuilds(target.id);
    return interaction.reply({
      content: count > 0
        ? `✅ ${target} has been removed from the blacklist${count > 1 ? ` across ${count} server(s)` : ""}.`
        : `⚠️ That user is not blacklisted in any server.`,
      ephemeral: true,
    });
  },
};
