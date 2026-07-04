const { EmbedBuilder, ChannelType, Events } = require("discord.js");
const log = require("../utils/logger");
const questions = require("../questions.json");
const { getGuild, saveApp, generateAppId, isBlacklisted } = require("./db");
const { memberHasStaffBlacklistRole } = require("./blacklistRole");
const { ROLE_TYPES } = require("./serverConfig");
const { resolveAppChannel, resolveHRRole } = require("./staffSetup");
const { buildReviewRow } = require("./panel");

// ─── Typing-speed tracking ─────────────────────────────────────────────────────
// Discord does not let a bot block clipboard paste inside a DM — that's a
// client-side restriction the API simply doesn't expose. What we *can* do is
// listen for the real "typingStart" indicator Discord fires while a user is
// actively typing, and measure how long they were seen typing before their
// answer arrived. A message that lands with no typing indicator at all (or
// implausibly fast for its length) is a strong signal it was pasted rather
// than composed live.

const FAST_CHARS_PER_SEC = 14; // sustained human typing tops out well below this
const MIN_CHARS_TO_FLAG  = 25; // don't flag short one-word answers

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
  const charsPerSec = typingDurationMs > 0 ? charCount / (typingDurationMs / 1000) : null;

  let verdict = "normal";
  if (!firstTypingAt && charCount >= MIN_CHARS_TO_FLAG) {
    verdict = "no_typing";
  } else if (charsPerSec !== null && charsPerSec > FAST_CHARS_PER_SEC && charCount >= MIN_CHARS_TO_FLAG) {
    verdict = "too_fast";
  }

  return { charCount, typingDurationMs, charsPerSec, verdict };
}

function verdictLabel(verdict) {
  switch (verdict) {
    case "no_typing": return "🚩 No typing indicator seen — likely pasted";
    case "too_fast":  return "⚠️ Typed far faster than humanly plausible";
    default:          return "✅ Normal";
  }
}

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
      `Type your answer live and press Enter to move on — your typing activity is monitored to verify answers are written by you in real time.`
    );
  } catch {
    return { ok: false, reason: "no_dm" };
  }

  const answers = [];
  const typingReports = [];
  for (let i = 0; i < questionSet.length; i++) {
    await dmChannel.send(`**Question ${i + 1} of ${questionSet.length}**\n${questionSet[i]}`);

    const tracker = trackTyping(client, dmChannel.id, user.id);
    let content;
    try {
      const collected = await dmChannel.awaitMessages({
        filter: (m) => m.author.id === user.id,
        max:    1,
        time:   120_000,
        errors: ["time"],
      });
      content = collected.first().content;
    } catch {
      tracker.stop();
      await dmChannel.send("⏰ You took too long to answer. Application cancelled.");
      return { ok: false, reason: "timeout" };
    }

    const answeredAt = Date.now();
    const firstTypingAt = tracker.getFirstTypingAt();
    tracker.stop();

    answers.push(content);
    typingReports.push(evaluateTyping(content, firstTypingAt, answeredAt));
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

  // ── Typing behavior report ────────────────────────────────────────────────
  const flagged = typingReports.some((r) => r.verdict !== "normal");
  const typingEmbed = new EmbedBuilder()
    .setTitle(flagged ? "🚩 Typing Behavior Analysis — Flagged" : "✅ Typing Behavior Analysis")
    .setColor(flagged ? 0xed4245 : 0x57f287)
    .setDescription(
      "Measures how long the applicant was seen actively typing (Discord's typing indicator) before each answer arrived. " +
      "A missing typing indicator or implausible typing speed suggests the answer was pasted or auto-generated rather than written live."
    )
    .setTimestamp();

  questionSet.forEach((q, i) => {
    const r = typingReports[i];
    const seconds = r.typingDurationMs > 0 ? (r.typingDurationMs / 1000).toFixed(1) : "0.0";
    const speed   = r.charsPerSec !== null ? `${r.charsPerSec.toFixed(1)} chars/sec` : "n/a (no typing seen)";
    typingEmbed.addFields({
      name:  `Q${i + 1}: ${verdictLabel(r.verdict)}`,
      value: `${r.charCount} chars • typed for ${seconds}s • ${speed}`,
      inline: false,
    });
  });

  await thread.send({ embeds: [typingEmbed] });

  // Notify the parent channel without pinging — ping stays in the thread
  try {
    await appChannel.send({
      content: `📥 New **${meta.label}** application from **${user.tag}** (${sourceGuild.name}) — ID: \`${appId}\`${flagged ? " 🚩 *(flagged: possible pasted/AI answer)*" : ""}\n> Review it in ${thread}`,
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
    typingFlagged: flagged,
  });

  log.info("APP", `Submitted | [${sourceGuild.name}] ${meta.label} → #${appChannel.name} in [${destGuild.name}] | ${user.tag} | ID: ${appId}${flagged ? " | FLAGGED (typing)" : ""}`);
  return { ok: true };
}

module.exports = { runApplication };
