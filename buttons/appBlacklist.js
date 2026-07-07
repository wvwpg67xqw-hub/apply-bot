const { EmbedBuilder } = require("discord.js");
const log = require("../utils/logger");
const { addToBlacklist } = require("../lib/db");
const { applyStaffBlacklistRole, sendBlacklistLog } = require("../lib/blacklistRole");
const { getServerConfig } = require("../lib/serverConfig");
const { buildReviewRow } = require("../lib/panel");
const { buildReviewContext, lockThread } = require("./reviewShared");

module.exports = {
  matches: (customId) => customId === "app_blacklist",

  async execute(interaction) {
    const client = interaction.client;

    const ctx = await buildReviewContext(interaction);
    if (ctx.deferFailed) return;


    if (!ctx.ok) {

      if (ctx.noApplicant) {
        return interaction.editReply({
          content: "❌ Could not determine the applicant from this message."
        });
      }

      const roleTag = ctx.reviewerRoleId
        ? `<@&${ctx.reviewerRoleId}>`
        : "the correct reviewer role";


      return interaction.editReply({
        content:
          `❌ You need the ${roleTag} role to manage applications from **${ctx.sourceGuildName}**.`,
      });
    }


    const {
      sourceGuild,
      sourceGuildName,
      meta,
      appId,
      msg,
      applicantId,
      reviewer,
      applicantUser,
      postResult
    } = ctx;



    if (sourceGuild) {

      try {

        const config = getServerConfig(
          sourceGuild.name,
          sourceGuild.id
        );


        if (!config?.blacklistRoleId) {
          throw new Error(
            "No blacklist role configured for this server"
          );
        }


        await addToBlacklist(
          sourceGuild.id,
          applicantId,
          config.blacklistRoleId,
          null
        );


        await applyStaffBlacklistRole(
          sourceGuild,
          applicantId
        );


        log.info(
          "BLACKLIST",
          `Blacklisted ${applicantId} in ${sourceGuild.name}`
        );


      } catch (err) {

        log.error(
          "BLACKLIST",
          "Failed to blacklist applicant",
          err.message
        );

      }
    }



    try {

      const updated = EmbedBuilder
        .from(msg.embeds[0])
        .setColor(0x000000)
        .setTitle(
          `🚫 ${meta.label} Application Denied & Blacklisted — ${sourceGuildName}`
        );


      await msg.edit({
        embeds: [updated],
        components: [
          buildReviewRow(true)
        ],
      });


    } catch (err) {

      log.error(
        "BLACKLIST",
        "Failed to update application message",
        err.message
      );

    }



    await interaction.editReply({
      content:
        `🚫 **${meta.label}** application **denied & user blacklisted** by ${reviewer}.`
    });



    await lockThread(interaction);



    const resultEmbed = new EmbedBuilder()

      .setTitle(
        "🚫 Application Denied & Blacklisted"
      )

      .setColor(0x000000)

      .addFields(

        {
          name: "Applicant",
          value: `<@${applicantId}>`,
          inline: true
        },

        {
          name: "Role",
          value: `${meta.emoji} ${meta.label}`,
          inline: true
        },

        {
          name: "Server",
          value: sourceGuildName,
          inline: true
        },

        {
          name: "Reviewed by",
          value: reviewer,
          inline: true
        }

      )

      .setTimestamp();



    await postResult(resultEmbed);



    await sendBlacklistLog(client, {

      applicantId,

      applicantTag:
        applicantUser?.tag,

      roleLabel:
        meta.label,

      roleEmoji:
        meta.emoji,

      sourceGuildName,

      moderator:
        reviewer,

      appId,

    }).catch(() => {});



    try {

      await applicantUser?.send(

        `🚫 **Your ${meta.label} application has been denied** and you have been blacklisted ` +
        `from applying to **${sourceGuildName}** in the future.`

      );

    } catch {}

  },
};