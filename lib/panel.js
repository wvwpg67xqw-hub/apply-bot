const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");
const { GROWTH_GUILD_IDS } = require("./serverConfig");

// ─── Button rows ──────────────────────────────────────────────────────────────

function buildReviewRow(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("app_accept")
      .setLabel("Accept")
      .setStyle(ButtonStyle.Success)
      .setEmoji("✅")
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("app_deny")
      .setLabel("Deny")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("❌")
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("app_blacklist")
      .setLabel("Blacklist")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🚫")
      .setDisabled(disabled)
  );
}

const PANEL_ROLE_DEFS = [
  { roleType: "hr",          customId: "panel_apply_hr",          label: "HR",                   style: ButtonStyle.Primary,   emoji: "👥", fieldName: "👥 HR",                   fieldValue: "Help manage and recruit our staff team.",          growthOnly: false },
  { roleType: "mod",         customId: "panel_apply_mod",         label: "Mod",                  style: ButtonStyle.Danger,    emoji: "🔨", fieldName: "🔨 Mod",                   fieldValue: "Keep the server safe and enforce the rules.",      growthOnly: false },
  { roleType: "partnership", customId: "panel_apply_partnership", label: "Partnership Manager",  style: ButtonStyle.Success,   emoji: "🤝", fieldName: "🤝 Partnership Manager",   fieldValue: "Build relationships with other Discord servers.",  growthOnly: false },
  { roleType: "growth",      customId: "panel_apply_growth",      label: "Growth Manager",       style: ButtonStyle.Secondary, emoji: "📈", fieldName: "📈 Growth Manager",        fieldValue: "Drive server growth, partnerships, and activity.", growthOnly: true  },
];

function buildPanelRow(guildId, disabledRoles = []) {
  const buttons = PANEL_ROLE_DEFS
    .filter(d => !d.growthOnly || GROWTH_GUILD_IDS.has(guildId))
    .filter(d => !disabledRoles.includes(d.roleType))
    .map(d =>
      new ButtonBuilder()
        .setCustomId(d.customId)
        .setLabel(d.label)
        .setStyle(d.style)
        .setEmoji(d.emoji)
    );
  return new ActionRowBuilder().addComponents(...buttons);
}

function buildPanelEmbed(guild, disabledRoles = []) {
  const embed = new EmbedBuilder()
    .setTitle("📋 Staff Applications")
    .setDescription(
      `Want to join the team at **${guild.name}**?\n\n` +
      `Choose the role you'd like to apply for below.\n` +
      `The questions will be sent to your **DMs** — make sure they are open!\n\n` +
      `> ⏱️ You have **2 minutes** to answer each question.\n` +
      `> 📬 You'll be notified once a decision has been made.`
    )
    .setColor(0x5865f2);

  const activeFields = PANEL_ROLE_DEFS
    .filter(d => !d.growthOnly || GROWTH_GUILD_IDS.has(guild.id))
    .filter(d => !disabledRoles.includes(d.roleType));

  for (const d of activeFields) {
    embed.addFields({ name: d.fieldName, value: d.fieldValue, inline: true });
  }

  return embed.setTimestamp().setFooter({ text: guild.name });
}

module.exports = { PANEL_ROLE_DEFS, buildReviewRow, buildPanelRow, buildPanelEmbed };
