const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");
const { getGuild, setGuildConfig } = require("../lib/db");
const { buildPanelEmbed, buildPanelRow } = require("../lib/panel");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("panel")
    .setDescription("(Admin) Post the application panel. Choose which roles to include.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addChannelOption((o) =>
      o.setName("channel")
        .setDescription("Channel to send the panel to (defaults to current channel).")
        .setRequired(false)
    )
    .addBooleanOption((o) =>
      o.setName("hr")
        .setDescription("Include the HR button? (default: yes)")
        .setRequired(false)
    )
    .addBooleanOption((o) =>
      o.setName("mod")
        .setDescription("Include the Mod button? (default: yes)")
        .setRequired(false)
    )
    .addBooleanOption((o) =>
      o.setName("partnership")
        .setDescription("Include the Partnership Manager button? (default: yes)")
        .setRequired(false)
    )
    .addBooleanOption((o) =>
      o.setName("growth")
        .setDescription("Include the Growth Manager button? (default: yes)")
        .setRequired(false)
    ),

  async execute(interaction) {
    const { guild } = interaction;
    const target   = interaction.options.getChannel("channel") ?? interaction.channel;
    const guildCfg = getGuild(guild.id);

    // Build disabled list from options; if an option wasn't provided, fall
    // back to whatever was already saved so re-running /panel doesn't reset choices.
    const prevDisabled = guildCfg?.disabledRoles ?? [];
    const roleKeys = ["hr", "mod", "partnership", "growth"];
    const disabled = roleKeys.filter((key) => {
      const opt = interaction.options.getBoolean(key);
      if (opt === null) return prevDisabled.includes(key); // not provided — keep existing
      return opt === false;                                 // false = exclude (disable)
    });

    const panelEmbed = buildPanelEmbed(guild, disabled);
    const row        = buildPanelRow(guild.id, disabled);

    if (!row.components.length) {
      return interaction.reply({ content: "❌ You disabled every role — enable at least one to post a panel.", ephemeral: true });
    }

    const sent = await target.send({ embeds: [panelEmbed], components: [row] });
    setGuildConfig(guild.id, { panelChannelId: target.id, panelMessageId: sent.id, disabledRoles: disabled });

    const included = roleKeys.filter(k => !disabled.includes(k)).join(", ") || "none";
    return interaction.reply({ content: `✅ Panel sent to ${target}.\n**Roles included:** ${included}`, ephemeral: true });
  },
};
