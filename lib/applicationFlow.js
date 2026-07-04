const { EmbedBuilder, ChannelType } = require("discord.js");
const log = require("../utils/logger");
const questions = require("../questions.json");
const { getGuild, saveApp, generateAppId, isBlacklisted } = require("./db");
const { memberHasStaffBlacklistRole } = require("./blacklistRole");
const { ROLE_TYPES } = require("./serverConfig");
const { resolveAppChannel, resolveHRRole } = require("./staffSetup");
const { buildReviewRow } = require("./panel");

// ─── Shared application flow ──────────────────────────────────────────────────

async function runApplication(client, user, sourceGuild, roleType) {
  const meta        = ROLE_TYPES[roleType];
  const questionSet = questions[roleType];
  const guildConfig = getGuild(sourceGuild.id);

  if (isBlacklisted(sourceGuild.id, user.id)) return { ok: false, reason: "blacklisted" };
  if (await memberHasStaffBlacklistRole(sourceGuild, user.id)) return { ok: false, reason: "blacklisted" };

  const resolved = await resolveAppChannel(client, sourceGuild, guildConfig);
  if (!resolved) return { ok: false, reason: "no_channel" };
  const { channel: appChannel, guild: destGuild } = resolved;

  let dmChannel;
  try {
    dmChannel = await user.createDM();
    await dmChannel.send(
      `${meta.emoji} **${sourceGuild.name} — ${meta.label} Application**\n` +
      `Answer each question below. You have **2 minutes** per question.\n` +
      `Type your answer and press Enter to move on.`
    );
  } catch {
    return { ok: false, reason: "no_dm" };
  }

  const answers = [];
  for (let i = 0; i < questionSet.length; i++) {
    await dmChannel.send(`**Question ${i + 1} of ${questionSet.length}**\n${questionSet[i]}`);
    try {
      const collected = await dmChannel.awaitMessages({
        filter: (m) => m.author.id === user.id,
        max:    1,
        time:   120_000,
        errors: ["time"],
      });
      answers.push(collected.first().content);
    } catch {
      await dmChannel.send("⏰ You took too long to answer. Application cancelled.");
      return { ok: false, reason: "timeout" };
    }
  }

  await dmChannel.send("✅ **Your application has been submitted!** You'll be notified once a decision is made.");

  const crossServer = destGuild.id !== sourceGuild.id;
  const appId = generateAppId();

  const embed = new EmbedBuilder()
    .setTitle(`${meta.emoji} ${meta.label} Application${crossServer ? ` — ${sourceGuild.name}` : ""}`)
    .setColor(meta.color)
    .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
    .setTimestamp()
    .setFooter({ text: `User ID: ${user.id} • From: ${sourceGuild.name} • Type: ${roleType} • App: ${appId}` });

  questionSet.forEach((q, i) => {
    embed.addFields({ name: q, value: answers[i] || "*No answer*", inline: false });
  });

  let thread;
  try {
    thread = await appChannel.threads.create({
      name:      `[${meta.label}] ${user.username} (${sourceGuild.name})`,
      type:      ChannelType.PrivateThread,
      invitable: false,
      reason:    `${meta.label} application from ${user.tag} in ${sourceGuild.name}`,
    });
  } catch (err) {
    log.error("APP", "Failed to create private thread", err.message);
    await dmChannel.send("❌ Could not create a private thread. Please contact an admin.");
    return { ok: false, reason: "no_thread" };
  }

  const hrRole   = resolveHRRole(sourceGuild.name, destGuild, guildConfig?.hrRole, sourceGuild.id);
  const pingLine = hrRole ? `<@&${hrRole.id}> — new **${meta.label}** application to review.\n` : "";

  await thread.send({
    content:    `${pingLine}**Applicant:** <@${user.id}>`,
    embeds:     [embed],
    components: [buildReviewRow()],
  });

  // Notify the parent channel without pinging — ping stays in the thread
  try {
    await appChannel.send({
      content: `📥 New **${meta.label}** application from **${user.tag}** (${sourceGuild.name}) — ID: \`${appId}\`\n> Review it in ${thread}`,
    });
  } catch (err) {
    log.warn("APP", "Could not send channel notification", err.message);
  }

  saveApp({
    id:          appId,
    threadId:    thread.id,
    channelId:   appChannel.id,
    guildId:     destGuild.id,
    sourceGuild: sourceGuild.name,
    roleType,
    applicantId: user.id,
    applicantTag: user.tag,
    submittedAt: Date.now(),
  });

  log.info("APP", `Submitted | [${sourceGuild.name}] ${meta.label} → #${appChannel.name} in [${destGuild.name}] | ${user.tag} | ID: ${appId}`);
  return { ok: true };
}

module.exports = { runApplication };
