const { fireUser } = require("../services/fireService");

function injectHandlers(commandRegistry) {
  if (!commandRegistry.fire) return;

  commandRegistry.fire = async (interaction, client) => {
    const user = interaction.options.getUser("user");

    await fireUser(client, user, interaction.user.tag);

    return interaction.reply({
      content: `🔥 Fired <@${user.id}>`,
      ephemeral: true,
    });
  };
}

module.exports = { injectHandlers };