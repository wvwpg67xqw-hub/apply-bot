const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } = require("discord.js");
const log = require("../utils/logger");
const { setGuildConfig } = require("../lib/db");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setacceptroles")
    .setDescription("(Admin) Set the roles granted per application type when accepted. Run in each source server.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addRoleOption((o) =>
      o.setName("hr-role").setDescription("Role given to accepted HR applicants (e.g. @HR).").setRequired(true)
    )
    .addRoleOption((o) =>
      o.setName("hr-team").setDescription("Team role also given to accepted HR applicants (e.g. @Staff Team).").setRequired(true)
    )
    .addRoleOption((o) =>
      o.setName("mod-role").setDescription("Role given to accepted Mod applicants (e.g. @Moderator).").setRequired(true)
    )
    .addRoleOption((o) =>
      o.setName("mod-team").setDescription("Team role also given to accepted Mod applicants (e.g. @Staff Team).").setRequired(true)
    )
    .addRoleOption((o) =>
      o.setName("partnership-role").setDescription("Role given to accepted Partnership applicants (e.g. @Partnership Manager).").setRequired(true)
    )
    .addRoleOption((o) =>
      o.setName("partnership-team").setDescription("Team role also given to accepted Partnership applicants (e.g. @Staff Team).").setRequired(true)
    )
    .addRoleOption((o) =>
      o.setName("growth-role").setDescription("Role given to accepted Growth Manager applicants (e.g. @Growth Manager).").setRequired(false)
    )
    .addRoleOption((o) =>
      o.setName("growth-team").setDescription("Team role also given to accepted Growth Manager applicants (e.g. @Staff Team).").setRequired(false)
    ),

  async execute(interaction) {
    const { guild } = interaction;
    try {
      const hrRole          = interaction.options.getRole("hr-role");
      const hrTeam          = interaction.options.getRole("hr-team");
      const modRole         = interaction.options.getRole("mod-role");
      const modTeam         = interaction.options.getRole("mod-team");
      const partnerRole     = interaction.options.getRole("partnership-role");
      const partnerTeam     = interaction.options.getRole("partnership-team");
      const growthRole      = interaction.options.getRole("growth-role");
      const growthTeam      = interaction.options.getRole("growth-team");

      const missing = [
        !hrRole      && "hr-role",
        !hrTeam      && "hr-team",
        !modRole     && "mod-role",
        !modTeam     && "mod-team",
        !partnerRole && "partnership-role",
        !partnerTeam && "partnership-team",
      ].filter(Boolean);

      if (missing.length) {
        return interaction.reply({
          content: `❌ Could not resolve the following roles: **${missing.join(", ")}**. Make sure the roles exist in this server and try again.`,
          ephemeral: true,
        });
      }

      const configUpdate = {
        hrRoleId:              hrRole.id,
        hrTeamRoleId:          hrTeam.id,
        modRoleId:             modRole.id,
        modTeamRoleId:         modTeam.id,
        partnershipRoleId:     partnerRole.id,
        partnershipTeamRoleId: partnerTeam.id,
      };
      if (growthRole) configUpdate.growthRoleId     = growthRole.id;
      if (growthTeam) configUpdate.growthTeamRoleId = growthTeam.id;
      await setGuildConfig(guild.id, configUpdate);

      const embedFields = [
        { name: "👥 HR Role",                  value: `${hrRole}`,      inline: true },
        { name: "👥 HR Team Role",              value: `${hrTeam}`,      inline: true },
        { name: "\u200b",                       value: "\u200b",          inline: true },
        { name: "🔨 Mod Role",                  value: `${modRole}`,     inline: true },
        { name: "🔨 Mod Team Role",              value: `${modTeam}`,     inline: true },
        { name: "\u200b",                       value: "\u200b",          inline: true },
        { name: "🤝 Partnership Manager Role",  value: `${partnerRole}`, inline: true },
        { name: "🤝 Partnership Team Role",     value: `${partnerTeam}`, inline: true },
        { name: "\u200b",                       value: "\u200b",          inline: true },
      ];
      if (growthRole) embedFields.push(
        { name: "📈 Growth Manager Role",  value: `${growthRole}`,                    inline: true },
        { name: "📈 Growth Team Role",     value: growthTeam ? `${growthTeam}` : "—", inline: true },
        { name: "\u200b",                  value: "\u200b",                            inline: true },
      );

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`✅ Accept roles configured for ${guild.name}`)
            .setColor(0x57f287)
            .addFields(...embedFields)
            .setFooter({ text: "These roles will be granted when an application is accepted." }),
        ],
        ephemeral: true,
      });
    } catch (err) {
      log.error("SETROLES", "setacceptroles error", err.message);
      return interaction.reply({
        content: `❌ Something went wrong while saving roles: ${err.message}`,
        ephemeral: true,
      });
    }
  },
};
