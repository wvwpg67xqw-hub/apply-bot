const { isBlacklisted, getGuild } = require("../lib/db");
const { ROLE_TYPES, GROWTH_GUILD_IDS } = require("../lib/serverConfig");
const { resolveAppChannel } = require("../lib/staffSetup");
const { runApplication } = require("../lib/applicationFlow");

// Panel "apply" buttons — one button per role type, both the panel-post
// versions (panel_apply_*) and the legacy picker versions (apply_pick_*).

const PANEL_MAP = {
  panel_apply_hr:          "hr",
  panel_apply_mod:         "mod",
  panel_apply_partnership: "partnership",
  panel_apply_growth:      "growth",
  apply_pick_hr:           "hr",
  apply_pick_mod:          "mod",
  apply_pick_partnership:  "partnership",
  apply_pick_growth:       "growth",
};

module.exports = {
  matches: (customId) => Boolean(PANEL_MAP[customId]),

  async execute(interaction) {
    const client   = interaction.client;
    const { guild, user } = interaction;
    const roleType = PANEL_MAP[interaction.customId];
    const meta     = ROLE_TYPES[roleType];

    if (roleType === "growth" && !GROWTH_GUILD_IDS.has(guild.id)) {
      return interaction.reply({ content: "❌ The Growth Manager application is not available in this server.", ephemeral: true });
    }

    if (isBlacklisted(guild.id, user.id)) {
      return interaction.reply({ content: "🚫 You are blacklisted from submitting applications.", ephemeral: true });
    }

    const resolved = await resolveAppChannel(client, guild, getGuild(guild.id));
    if (!resolved) {
      return interaction.reply({
        content: "❌ No application channel configured. Ask an admin to run `/setstaffserver` in the staff server.",
        ephemeral: true,
      });
    }

    await interaction.reply({
      content: `${meta.emoji} Check your DMs — your **${meta.label}** application has started!`,
      ephemeral: true,
    });

    const result = await runApplication(client, user, guild, roleType);
    if (!result.ok && result.reason === "no_dm") {
      await interaction.editReply({ content: "❌ I couldn't DM you. Please enable DMs from server members and try again." });
    }
  },
};
