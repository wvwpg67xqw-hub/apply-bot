const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");
const { read, write } = require("../utils/jsondb");
const { applyPresence } = require("../utils/presence");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setactivity")
    .setDescription("(Admin) Change the bot's activity text.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addStringOption((o) =>
      o.setName("type")
        .setDescription("Activity type.")
        .setRequired(true)
        .addChoices(
          { name: "🎮 Playing",   value: "PLAYING"   },
          { name: "👀 Watching",  value: "WATCHING"  },
          { name: "🎧 Listening", value: "LISTENING" },
          { name: "🏆 Competing", value: "COMPETING" },
          { name: "📡 Streaming", value: "STREAMING" },
        )
    )
    .addStringOption((o) =>
      o.setName("text")
        .setDescription("The activity text — e.g. 'for staff', 'applications'.")
        .setRequired(true)
    ),

  async execute(interaction) {
    const type = interaction.options.getString("type");
    const name = interaction.options.getString("text");
    const activityData = read("./data/activity.json") ?? {};
    activityData.type = type;
    activityData.name = name;
    write("./data/activity.json", activityData);
    applyPresence(interaction.client);
    const typeLabel = { PLAYING: "🎮 Playing", WATCHING: "👀 Watching", LISTENING: "🎧 Listening", COMPETING: "🏆 Competing", STREAMING: "📡 Streaming" };
    return interaction.reply({ content: `✅ Activity set to **${typeLabel[type] ?? type} ${name}**.`, ephemeral: true });
  },
};
