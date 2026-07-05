const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getAppById } = require("../lib/db");
const { ROLE_TYPES } = require("../lib/serverConfig");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("application")
    .setDescription("Look up a specific application by its ID.")
    .addStringOption((o) =>
      o.setName("id").setDescription("The application ID (e.g. APP-ABC123).").setRequired(true)
    ),

  async execute(interaction) {
    const rawId  = interaction.options.getString("id").trim();
    const appRec = await getAppById(rawId);
    if (!appRec) {
      return interaction.reply({
        content: `❌ No application found with ID \`${rawId.toUpperCase()}\`. IDs look like \`APP-ABC123\`.`,
        ephemeral: true,
      });
    }
    const meta        = ROLE_TYPES[appRec.roleType] || ROLE_TYPES.hr;
    const threadLink  = `https://discord.com/channels/${appRec.guildId}/${appRec.threadId}`;
    const embed = new EmbedBuilder()
      .setTitle(`${meta.emoji} Application \`${appRec.id}\``)
      .setColor(meta.color)
      .addFields(
        { name: "Applicant",   value: `<@${appRec.applicantId}> (${appRec.applicantTag})`, inline: false },
        { name: "Role",        value: `${meta.emoji} ${meta.label}`,                       inline: true  },
        { name: "Server",      value: appRec.sourceGuild,                                  inline: true  },
        { name: "Submitted",   value: `<t:${Math.floor(appRec.submittedAt / 1000)}:F>`,   inline: true  },
        { name: "Thread",      value: `[Jump to thread](${threadLink})`,                   inline: false },
      )
      .setTimestamp();
    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
