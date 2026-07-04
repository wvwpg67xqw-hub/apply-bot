const { EmbedBuilder } = require("discord.js");
const { addToBlacklist } = require("../lib/db");
const { applyStaffBlacklistRole, sendBlacklistLog } = require("../lib/blacklistRole");
const { buildReviewRow } = require("../lib/panel");
const { buildReviewContext, lockThread } = require("./reviewShared");

module.exports = {
  matches: (customId) => customId === "app_blacklist",

  async execute(interaction) {
    const client = interaction.client;
    const ctx    = await buildReviewContext(interaction);

    if (!ctx.ok) {
      if (ctx.noApplicant) {
        return interaction.reply({ content: "❌ Could not determine the applicant from this message.", ephemeral: true });
      }
      const roleTag = ctx.reviewerRoleId ? `<@&${ctx.reviewerRoleId}>` : "the correct reviewer role";
      return interaction.reply({
        content: `❌ You need the ${roleTag} role to manage applications from **${ctx.sourceGuildName}**.`,
        ephemeral: true,
      });
    }

    const { sourceGuildName, meta, appId, msg, applicantId, reviewer, applicantUser, postResult } = ctx;

    const sourceGuild = client.guilds.cache.find((g) => g.name === sourceGuildName);
    if (sourceGuild) {
      addToBlacklist(sourceGuild.id, applicantId);
      await applyStaffBlacklistRole(sourceGuild, applicantId);
    }

    const updated = EmbedBuilder.from(msg.embeds[0])
      .setColor(0x000000)
      .setTitle(`🚫 ${meta.label} Application Denied & Blacklisted — ${sourceGuildName}`);
    await msg.edit({ embeds: [updated], components: [buildReviewRow(true)] });
    await interaction.reply({ content: `🚫 **${meta.label}** application **denied & user blacklisted** by ${reviewer}.` });
    await lockThread(interaction);

    const resultEmbed = new EmbedBuilder()
      .setTitle(`🚫 Application Denied & Blacklisted`)
      .setColor(0x000000)
      .addFields(
        { name: "Applicant", value: `<@${applicantId}>`, inline: true },
        { name: "Role",      value: `${meta.emoji} ${meta.label}`,    inline: true },
        { name: "Server",    value: sourceGuildName,                   inline: true },
        { name: "Reviewed by", value: reviewer,                        inline: true },
      )
      .setTimestamp();
    await postResult(resultEmbed);
    await sendBlacklistLog(client, {
      applicantId:     applicantId,
      applicantTag:    applicantUser?.tag,
      roleLabel:       meta.label,
      roleEmoji:       meta.emoji,
      sourceGuildName: sourceGuildName,
      moderator:       reviewer,
      appId:           appId,
    });

    try {
      await applicantUser?.send(
        `🚫 **Your ${meta.label} application has been denied** and you have been blacklisted ` +
        `from applying to **${sourceGuildName}** in the future.`
      );
    } catch {}
  },
};
