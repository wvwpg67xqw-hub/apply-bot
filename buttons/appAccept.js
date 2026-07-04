const { EmbedBuilder } = require("discord.js");
const log = require("../utils/logger");
const { getGuild, addPendingJoin } = require("../lib/db");
const { buildReviewRow } = require("../lib/panel");
const { generateStaffInvite } = require("../lib/invite");
const { buildReviewContext, lockThread } = require("./reviewShared");

module.exports = {
  matches: (customId) => customId === "app_accept",

  async execute(interaction) {
    const client = interaction.client;
    const ctx    = await buildReviewContext(interaction);
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

    const { sourceGuildName, roleType, meta, msg, applicantId, reviewer, applicantUser, postResult } = ctx;

    try {
      const updated = EmbedBuilder.from(msg.embeds[0])
        .setColor(0x57f287)
        .setTitle(`✅ ${meta.label} Application Accepted — ${sourceGuildName}`);
      await msg.edit({ embeds: [updated], components: [buildReviewRow(true)] });
    } catch (err) {
      log.error("ACCEPT", "Failed to update application message", err.message);
    }

    await interaction.editReply({ content: `✅ **${meta.label}** application **accepted** by ${reviewer}.` });
    await lockThread(interaction);

    // Grant team + normal roles in the source server
    const sourceGuild    = client.guilds.cache.find((g) => g.name === sourceGuildName);
    const sourceGuildCfg = sourceGuild ? getGuild(sourceGuild.id) : null;
    const rolesGranted   = [];
    const roleErrors     = [];

    log.info("ACCEPT", `Accepted by ${reviewer} | applicant: ${applicantId} | type: ${roleType} | server: ${sourceGuildName}`);
    log.debug("ACCEPT", "Source guild lookup", { found: !!sourceGuild, hasCfg: !!sourceGuildCfg, cfg: sourceGuildCfg });

    if (sourceGuild && sourceGuildCfg) {
      let member = null;
      try { member = await sourceGuild.members.fetch(applicantId); } catch (err) {
        log.warn("ACCEPT", `Could not fetch applicant ${applicantId} from [${sourceGuildName}]`, err.message);
      }

      if (member) {
        const typeRoleKeys = {
          hr:          ["hrRoleId",          "hrTeamRoleId"],
          mod:         ["modRoleId",          "modTeamRoleId"],
          partnership: ["partnershipRoleId",  "partnershipTeamRoleId"],
          growth:      ["growthRoleId",       "growthTeamRoleId"],
        };
        const [specificKey, teamKey] = typeRoleKeys[roleType] ?? [];
        for (const [key, label] of [[specificKey, "role"], [teamKey, "team role"]]) {
          if (!key) continue;
          const roleId = sourceGuildCfg[key];
          if (!roleId) {
            log.warn("ACCEPT", `No saved role ID for key "${key}" in [${sourceGuildName}] config`);
            continue;
          }
          try {
            await member.roles.add(roleId);
            rolesGranted.push(`<@&${roleId}>`);
            log.info("ACCEPT", `Granted role ${roleId} (${label}) to ${applicantId} in [${sourceGuildName}]`);
          } catch (err) {
            log.error("ACCEPT", `Failed to grant role ${roleId} (${label}) to ${applicantId}`, err.message);
            roleErrors.push(label);
          }
        }
      } else {
        log.warn("ACCEPT", `Applicant ${applicantId} not found in [${sourceGuildName}]`);
        roleErrors.push("member not found in source server");
      }
    } else {
      log.warn("ACCEPT", `Could not find source guild or config for "${sourceGuildName}"`);
    }

    // Report role grant outcome in the thread
    try {
      if (rolesGranted.length) {
        await interaction.channel.send(`✅ Roles granted in **${sourceGuildName}**: ${rolesGranted.join(", ")}`);
      }
      if (roleErrors.length) {
        await interaction.channel.send(`⚠️ Could not grant some roles in **${sourceGuildName}**: ${roleErrors.join(", ")} — check bot permissions and role IDs.`);
      }
    } catch (err) {
      log.warn("ACCEPT", "Could not send role-grant summary", err.message);
    }

    const resultEmbed = new EmbedBuilder()
      .setTitle(`✅ Application Accepted`)
      .setColor(0x57f287)
      .addFields(
        { name: "Applicant",   value: `<@${applicantId}>`,         inline: true },
        { name: "Role",        value: `${meta.emoji} ${meta.label}`, inline: true },
        { name: "Server",      value: sourceGuildName,               inline: true },
        { name: "Reviewed by", value: reviewer,                      inline: true },
      )
      .setTimestamp();
    await postResult(resultEmbed);

    // DM the applicant — Partnership Managers stay in the main server so no staff invite
    try {
      if (roleType === "partnership") {
        await applicantUser?.send(
          `✅ **Your ${meta.label} application to ${sourceGuildName} has been accepted!** Congratulations!\n\n` +
          `A staff member will reach out to you soon.`
        );
      } else {
        const inviteUrl = await generateStaffInvite(client);
        const inviteLine = inviteUrl
          ? `Your personal invite link (1 use, valid for 30 minutes):\n**${inviteUrl}**`
          : `Please ask a staff member for a server invite.`;
        await applicantUser?.send(
          `✅ **Your ${meta.label} application to ${sourceGuildName} has been accepted!** Congratulations!\n\n` +
          `${inviteLine}\n\n` +
          `A staff member will reach out to you soon.`
        );

        // Track this user — if they don't join the staff server within the timeout, alert the role
        if (applicantUser) {
          addPendingJoin({
            userId:          applicantUser.id,
            applicantTag:    applicantUser.tag,
            sourceGuildName,
            roleType,
            invitedAt:       Date.now(),
          });
          log.info("JOIN_WATCH", `Tracking pending join for ${applicantUser.tag} (${applicantUser.id})`);
        }
      }
    } catch {}
  },
};
