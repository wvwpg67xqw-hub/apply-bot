const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");
const { read, write } = require("../utils/jsondb");
const { applyPresence } = require("../utils/presence");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setstatus")
    .setDescription("(Admin) Change the bot's online status.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addStringOption((o) =>
      o.setName("status")
        .setDescription("The status to display.")
        .setRequired(true)
        .addChoices(
          { name: "🟢 Online",          value: "online"    },
          { name: "🟡 Idle",            value: "idle"      },
          { name: "🔴 Do Not Disturb",  value: "dnd"       },
          { name: "⚫ Invisible",       value: "invisible" },
        )
    ),

  async execute(interaction) {
    const status = interaction.options.getString("status");
    const statusData = read("./data/status.json") ?? {};
    statusData.status = status;
    write("./data/status.json", statusData);
    applyPresence(interaction.client);
    const labels = { online: "🟢 Online", idle: "🟡 Idle", dnd: "🔴 Do Not Disturb", invisible: "⚫ Invisible" };
    return interaction.reply({ content: `✅ Bot status set to **${labels[status] ?? status}**.`, ephemeral: true });
  },
};
