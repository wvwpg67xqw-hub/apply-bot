const { EmbedBuilder } = require("discord.js");
const log = require("../utils/logger");
const { buildReviewRow } = require("../lib/panel");
const { buildReviewContext, lockThread } = require("./reviewShared");

module.exports = {
  matches: (customId) => customId === "app_deny",

  async execute(interaction) {
    const ctx = await buildReviewContext(interaction);
    if (ctx.deferFailed) return;

    if (!ctx.ok) {
      if (ctx.noApplicant) {
        return interaction.editReply({ content: "❌ Could not determine the applicant from this message." });
      }
      const roleTag = ctx.reviewerRoleId ? `<@&${ctx.reviewerRoleId}>` : "the correct reviewer role";
      return interaction.editReply({
        content: `❌ You need the ${roleTag} role to manage applications from **${ctx.sourceGuildName}**.`,
      });
    }

    const { sourceGuildName, meta, msg, applicantId, reviewer, applicantUser, postResult } = ctx;

    try {
      const updated = EmbedBuilder.from(msg.embeds[0])
        .setColor(0xed4245)
        .setTitle(`❌ ${meta.label} Application Denied — ${sourceGuildName}`);
      await msg.edit({ embeds: [updated], components: [buildReviewRow(true)] });
    } catch (err) {
      log.error("DENY", "Failed to update application message", err.message);
    }

    await interaction.editReply({ content: `❌ **${meta.label}** application **denied** by ${reviewer}.` });
    await lockThread(interaction);

    const resultEmbed = new EmbedBuilder()
      .setTitle(`❌ Application Denied`)
      .setColor(0xed4245)
      .addFields(
        { name: "Applicant", value: `<@${applicantId}>`, inline: true },
        { name: "Role",      value: `${meta.emoji} ${meta.label}`,    inline: true },
        { name: "Server",    value: sourceGuildName,                   inline: true },
        { name: "Reviewed by", value: reviewer,                        inline: true },
      )
      .setTimestamp();
    await postResult(resultEmbed);

    try {
      await applicantUser?.send(
        `❌ **Your ${meta.label} application has been denied.** ` +
        `Unfortunately your application to **${sourceGuildName}** was not accepted at this time. ` +
        `You're welcome to apply again in the future.`
      );
    } catch {}
  },
};
