const { EmbedBuilder, ChannelType, Events } = require("discord.js");
const log = require("../utils/logger");
const { analyzeText } = require("../utils/aiHeuristic");
const questions = require("../questions.json");
const { getGuild, saveApp, generateAppId, isBlacklisted } = require("./db");
const { memberHasStaffBlacklistRole } = require("./blacklistRole");
const { ROLE_TYPES } = require("./serverConfig");
const { resolveAppChannel, resolveHRRole } = require("./staffSetup");
const { buildReviewRow } = require("./panel");

// 🔴 cooldown system
const {
  getApplicationCooldown,
} = require("./applicationCooldowns");

// ─── Typing-speed tracking ─────────────────────────────────────────────────────

const FAST_CHARS_PER_SEC = 14;
const MIN_CHARS_TO_FLAG = 25;

function trackTyping(client, channelId, userId) {
  let firstTypingAt = null;

  const handler = (typing) => {
    if (typing.channel?.id !== channelId || typing.user?.id !== userId) return;
    if (firstTypingAt === null) firstTypingAt = Date.now();
  };

  client.on(Events.TypingStart, handler);

  return {
    stop: () => client.off(Events.TypingStart, handler),
    getFirstTypingAt: () => firstTypingAt,
  };
}

function evaluateTyping(content, firstTypingAt, answeredAt) {
  const charCount = content.length;
  const typingDurationMs = firstTypingAt ? answeredAt - firstTypingAt : 0;
  const charsPerSec =
    typingDurationMs > 0 ? charCount / (typingDurationMs / 1000) : null;

  let verdict = "normal";

  if (!firstTypingAt && charCount >= MIN_CHARS_TO_FLAG) {
    verdict = "no_typing";
  } else if (
    charsPerSec !== null &&
    charsPerSec > FAST_CHARS_PER_SEC &&
    charCount >= MIN_CHARS_TO_FLAG
  ) {
    verdict = "too_fast";
  }

  return { charCount, typingDurationMs, charsPerSec, verdict };
}

function verdictLabel(verdict) {
  switch (verdict) {
    case "no_typing":
      return "🚩 No typing indicator seen — likely pasted";
    case "too_fast":
      return "⚠️ Typed far faster than humanly plausible";
    default:
      return "✅ Normal";
  }
}

// ─── Shared application flow ──────────────────────────────────────────────────

async function runApplication(client, user, sourceGuild, roleType) {
  const meta = ROLE_TYPES[roleType];
  const questionSet = questions[roleType];
  const guildConfig = await getGuild(sourceGuild.id);

  // ❌ basic blocks
  if (await isBlacklisted(sourceGuild.id, user.id))
    return { ok: false, reason: "blacklisted" };

  if (await memberHasStaffBlacklistRole(sourceGuild, user.id))
    return { ok: false, reason: "blacklisted" };

  // 🔴 COOLDOWN CHECK (BEFORE ANYTHING ELSE)
  const cooldown = await getApplicationCooldown(user.id, roleType);

  if (cooldown && cooldown.reapplyAt > Date.now()) {
    return {
      ok: false,
      reason: "cooldown",
      cooldownAt: cooldown.reapplyAt,
    };
  }

  const resolved = await resolveAppChannel(client, sourceGuild, guildConfig);
  if (!resolved) return { ok: false, reason: "no_channel" };

  const { channel: appChannel, guild: destGuild } = resolved;

  let dmChannel;
  try {
    dmChannel = await user.createDM();

    const introEmbed = new EmbedBuilder()
      .setTitle(`${meta.emoji} ${sourceGuild.name} — ${meta.label} Application`)
      .setColor(0xe67e22)
      .setDescription(
        `Answer each question below. You have **2 minutes** per question.`
      );

    await dmChannel.send({ embeds: [introEmbed] });
  } catch {
    return { ok: false, reason: "no_dm" };
  }

  const answers = [];
  const typingReports = [];

  for (let i = 0; i < questionSet.length; i++) {
    await dmChannel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(`Question ${i + 1} of ${questionSet.length}`)
          .setColor(0xe67e22)
          .setDescription(questionSet[i]),
      ],
    });

    const tracker = trackTyping(client, dmChannel.id, user.id);

    let content;
    try {
      const collected = await dmChannel.awaitMessages({
        filter: (m) => m.author.id === user.id,
        max: 1,
        time: 120_000,
        errors: ["time"],
      });

      content = collected.first().content;
    } catch {
      tracker.stop();
      await dmChannel.send("⏰ You took too long. Application cancelled.");
      return { ok: false, reason: "timeout" };
    }

    const answeredAt = Date.now();
    const firstTypingAt = tracker.getFirstTypingAt();
    tracker.stop();

    answers.push(content);
    typingReports.push(
      evaluateTyping(content, firstTypingAt, answeredAt)
    );
  }

  await dmChannel.send("✅ Application submitted!");

  const appId = generateAppId();

  const embed = new EmbedBuilder()
    .setTitle(`${meta.emoji} ${meta.label} Application`)
    .setColor(meta.color)
    .setAuthor({ name: user.tag })
    .setTimestamp();

  questionSet.forEach((q, i) => {
    embed.addFields({
      name: q,
      value: answers[i] || "*No answer*",
    });
  });

  const thread = await appChannel.threads.create({
    name: `[${meta.label}] ${user.username}`,
    type: ChannelType.PrivateThread,
    invitable: false,
  });

  const hrRole = resolveHRRole(
    sourceGuild.name,
    destGuild,
    guildConfig?.hrRole,
    sourceGuild.id
  );

  await thread.send({
    content: hrRole
      ? `<@&${hrRole.id}> new application`
      : "New application",
    embeds: [embed],
    components: [buildReviewRow()],
  });

  const flagged = typingReports.some((r) => r.verdict !== "normal");

  await saveApp({
    id: appId,
    threadId: thread.id,
    channelId: appChannel.id,
    guildId: destGuild.id,
    sourceGuild: sourceGuild.name,
    roleType,
    applicantId: user.id,
    submittedAt: Date.now(),
    typingFlagged: flagged,
  });

  return { ok: true };
}

module.exports = { runApplication };