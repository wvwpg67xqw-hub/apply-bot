const log = require("../utils/logger");
const { ROLE_TYPES, getServerConfig } = require("../lib/serverConfig");
const { isBlacklisted } = require("../lib/db");

// Shared preamble for the accept / deny / blacklist review buttons: acks the
// interaction immediately (so Discord never shows "This interaction failed"
// no matter how long the rest of the work takes), then parses the
// application embed footer, checks reviewer permissions, and resolves the
// applicant. Each button file only needs to implement its own specific action.

async function buildReviewContext(interaction) {
  const client     = interaction.client;
  const destGuild  = interaction.guild;

  // Ack right away — everything below this point can be slow (member
  // fetches, guild lookups) and must never block Discord's 3-second
  // acknowledgement window.
  try {
    await interaction.deferReply();
  } catch (err) {
    log.error("REVIEW", "Failed to defer reply — interaction likely expired", err.message);
    return { ok: false, deferFailed: true };
  }

  const footer          = interaction.message.embeds[0]?.footer?.text ?? "";
  const fromMatch       = footer.match(/From:\s*([^•]+)/);
  const sourceGuildName = fromMatch ? fromMatch[1].trim() : destGuild.name;
  const typeMatch       = footer.match(/Type:\s*(\w+)/);
  const roleType        = typeMatch ? typeMatch[1] : "hr";
  const appIdMatch      = footer.match(/App:\s*(APP-[A-Z0-9]+)/);
  const appId           = appIdMatch ? appIdMatch[1] : null;
  const meta            = ROLE_TYPES[roleType] || ROLE_TYPES.hr;

  log.info("REVIEW", `Button: ${interaction.customId} — ${interaction.user.tag} (${interaction.user.id}) in [${destGuild.name}] | source: ${sourceGuildName} | type: ${roleType}`);

  // Fetch the member fresh so we always have their real current roles
  let reviewer_member;
  try {
    reviewer_member = await destGuild.members.fetch(interaction.user.id);
  } catch (err) {
    log.warn("REVIEW", "Could not fetch reviewer member fresh, falling back to interaction.member", err.message);
    reviewer_member = interaction.member;
  }

  const sourceGuild     = client.guilds.cache.find((g) => g.name === sourceGuildName);
  const serverEntry     = getServerConfig(sourceGuildName, sourceGuild?.id);
  const reviewerRoleId  = serverEntry?.reviewerRoleId;
  const hasAccess       = reviewerRoleId
    ? reviewer_member.roles.cache.has(reviewerRoleId)
    : false;

  log.debug("REVIEW", "Permission check", {
    reviewer:       interaction.user.tag,
    reviewerRoles:  [...reviewer_member.roles.cache.keys()],
    sourceGuild:    sourceGuildName,
    requiredRoleId: reviewerRoleId ?? "none",
    hasAccess,
  });

  if (!hasAccess) {
    log.warn("REVIEW", `Access denied for ${interaction.user.tag} — missing role ${reviewerRoleId}`);
    return { ok: false, reviewerRoleId, sourceGuildName, roleType, meta, appId, destGuild };
  }

  const msg            = interaction.message;
  const applicantMatch = msg.content.match(/\*\*Applicant:\*\* <@(\d+)>/);
  if (!applicantMatch) {
    return { ok: false, noApplicant: true, sourceGuildName, roleType, meta, appId, destGuild };
  }

  const applicantId = applicantMatch[1];
  const reviewer     = interaction.user.tag;
  let applicantUser  = null;
  try { applicantUser = await client.users.fetch(applicantId); } catch {}

  const applicantBlacklisted = sourceGuild ? isBlacklisted(sourceGuild.id, applicantId) : false;

  // Posts a result card to the parent channel (visible outside the thread)
  const postResult = async (resultEmbed) => {
    const parentChannel = interaction.channel?.parent;
    if (parentChannel?.isTextBased()) {
      try { await parentChannel.send({ embeds: [resultEmbed] }); } catch {}
    }
  };

  return {
    ok: true,
    destGuild, sourceGuild, sourceGuildName, roleType, appId, meta,
    msg, applicantId, reviewer, applicantUser, postResult, applicantBlacklisted,
  };
}

async function lockThread(interaction) {
  try {
    await interaction.channel.edit({ locked: true, archived: true });
  } catch (err) {
    log.error("LOCK", "Failed to lock thread", err.message);
    await interaction.channel.send("⚠️ Could not lock this thread — make sure the bot has **Manage Threads** permission.").catch(() => {});
  }
}

module.exports = { buildReviewContext, lockThread };
