const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");
const { setGuildConfig } = require("../lib/db");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setroute")
    .setDescription("(Admin) Manually route this server's apps to a specific channel ID.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addStringOption((o) =>
      o.setName("channel-id")
        .setDescription("ID of the destination channel.")
        .setRequired(true)
    ),

  async execute(interaction) {
    const { guild, client } = interaction;
    const channelId = interaction.options.getString("channel-id").trim();
    let destChannel;
    try {
      destChannel = await client.channels.fetch(channelId);
    } catch {
      return interaction.reply({
        content: "❌ Could not find that channel. Make sure the ID is correct and the bot is in that server.",
        ephemeral: true,
      });
    }
    if (!destChannel.isTextBased()) {
      return interaction.reply({ content: "❌ That channel is not a text channel.", ephemeral: true });
    }
    await setGuildConfig(guild.id, { routeChannelId: channelId });
    return interaction.reply({
      content: `✅ Applications from **${guild.name}** will now go to <#${channelId}> in **${destChannel.guild?.name ?? "the staff server"}**.`,
      ephemeral: true,
    });
  },
};
