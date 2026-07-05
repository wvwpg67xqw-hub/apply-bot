const readline = require("readline");
const { EmbedBuilder } = require("discord.js");

const CYAN   = "\x1b[36m";
const GREEN  = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED    = "\x1b[31m";
const GREY   = "\x1b[90m";
const BOLD   = "\x1b[1m";
const RESET  = "\x1b[0m";

function tag(label, color) {
  return `${color}${BOLD}[${label}]${RESET}`;
}

function printHelp() {
  console.log(`
${BOLD}${CYAN}━━━ Bot Console Commands ━━━${RESET}

  ${BOLD}Messaging${RESET}
  ${GREEN}say <channelId> <message>${RESET}         — Send a message to a channel
  ${GREEN}dm <userId> <message>${RESET}             — DM a user
  ${GREEN}reply <channelId> <msgId> <msg>${RESET}  — Reply to a specific message

  ${BOLD}Info${RESET}
  ${GREEN}guilds${RESET}                            — List all servers the bot is in
  ${GREEN}channels <guildId>${RESET}               — List text channels in a server
  ${GREEN}user <userId>${RESET}                    — Look up a user

  ${BOLD}Moderation${RESET}
  ${GREEN}blacklist <guildId> <userId> [dur]${RESET} — Blacklist a user (e.g. 7d, permanent)
  ${GREEN}unblacklist <guildId> <userId>${RESET}   — Remove a user from the blacklist
  ${GREEN}isblacklisted <guildId> <userId>${RESET} — Check if a user is blacklisted

  ${BOLD}Other${RESET}
  ${GREEN}help${RESET}                              — Show this list
  ${GREEN}exit${RESET}                              — Shut down the bot

${GREY}Tip: channel/user/guild IDs can be found by right-clicking in Discord with Developer Mode on.${RESET}
`);
}

function startCLI(client, helpers) {
  const { addToBlacklist, removeFromBlacklist, isBlacklisted, parseDuration } = helpers;

  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
    prompt: `${CYAN}bot>${RESET} `,
  });

  rl.prompt();

  rl.on("line", async (raw) => {
    const line  = raw.trim();
    if (!line) { rl.prompt(); return; }

    const [cmd, ...rest] = line.split(/\s+/);

    try {
      switch (cmd.toLowerCase()) {

        // ── say <channelId> <message> ────────────────────────────────────────
        case "say": {
          const [channelId, ...words] = rest;
          if (!channelId || !words.length) {
            console.log(`${tag("ERR", RED)} Usage: say <channelId> <message>`);
            break;
          }
          const ch = await client.channels.fetch(channelId).catch(() => null);
          if (!ch?.isTextBased()) {
            console.log(`${tag("ERR", RED)} Channel not found or not a text channel.`);
            break;
          }
          const msg = await ch.send(words.join(" "));
          console.log(`${tag("SENT", GREEN)} Message sent → #${ch.name} (${msg.id})`);
          break;
        }

        // ── dm <userId> <message> ────────────────────────────────────────────
        case "dm": {
          const [userId, ...words] = rest;
          if (!userId || !words.length) {
            console.log(`${tag("ERR", RED)} Usage: dm <userId> <message>`);
            break;
          }
          const user = await client.users.fetch(userId).catch(() => null);
          if (!user) {
            console.log(`${tag("ERR", RED)} User not found.`);
            break;
          }
          await user.send(words.join(" "));
          console.log(`${tag("SENT", GREEN)} DM sent to ${user.tag} (${user.id})`);
          break;
        }

        // ── reply <channelId> <msgId> <message> ──────────────────────────────
        case "reply": {
          const [channelId, msgId, ...words] = rest;
          if (!channelId || !msgId || !words.length) {
            console.log(`${tag("ERR", RED)} Usage: reply <channelId> <messageId> <message>`);
            break;
          }
          const ch = await client.channels.fetch(channelId).catch(() => null);
          if (!ch?.isTextBased()) {
            console.log(`${tag("ERR", RED)} Channel not found.`);
            break;
          }
          const target = await ch.messages.fetch(msgId).catch(() => null);
          if (!target) {
            console.log(`${tag("ERR", RED)} Message not found.`);
            break;
          }
          await target.reply(words.join(" "));
          console.log(`${tag("SENT", GREEN)} Replied to ${target.author.tag} in #${ch.name}`);
          break;
        }

        // ── guilds ───────────────────────────────────────────────────────────
        case "guilds": {
          const list = [...client.guilds.cache.values()];
          if (!list.length) {
            console.log(`${tag("INFO", CYAN)} Not in any guilds.`);
            break;
          }
          console.log(`${tag("GUILDS", CYAN)} In ${list.length} server(s):`);
          list.forEach((g) => console.log(`  ${GREY}${g.id}${RESET}  ${BOLD}${g.name}${RESET}  (${g.memberCount} members)`));
          break;
        }

        // ── channels <guildId> ───────────────────────────────────────────────
        case "channels": {
          const [guildId] = rest;
          if (!guildId) {
            console.log(`${tag("ERR", RED)} Usage: channels <guildId>`);
            break;
          }
          const guild = client.guilds.cache.get(guildId);
          if (!guild) {
            console.log(`${tag("ERR", RED)} Guild not found. Use 'guilds' to list them.`);
            break;
          }
          const text = [...guild.channels.cache.values()].filter((c) => c.isTextBased());
          console.log(`${tag("CHANNELS", CYAN)} ${guild.name} — ${text.length} text channel(s):`);
          text.forEach((c) => console.log(`  ${GREY}${c.id}${RESET}  #${c.name}`));
          break;
        }

        // ── user <userId> ────────────────────────────────────────────────────
        case "user": {
          const [userId] = rest;
          if (!userId) {
            console.log(`${tag("ERR", RED)} Usage: user <userId>`);
            break;
          }
          const user = await client.users.fetch(userId).catch(() => null);
          if (!user) {
            console.log(`${tag("ERR", RED)} User not found.`);
            break;
          }
          console.log(`${tag("USER", CYAN)}`);
          console.log(`  Tag:      ${BOLD}${user.tag}${RESET}`);
          console.log(`  ID:       ${user.id}`);
          console.log(`  Bot:      ${user.bot}`);
          console.log(`  Created:  ${user.createdAt.toUTCString()}`);
          console.log(`  Avatar:   ${user.displayAvatarURL()}`);
          break;
        }

        // ── blacklist <guildId> <userId> [duration] ──────────────────────────
        case "blacklist": {
          const [guildId, userId, durStr] = rest;
          if (!guildId || !userId) {
            console.log(`${tag("ERR", RED)} Usage: blacklist <guildId> <userId> [duration]`);
            break;
          }
          const expiresAt = parseDuration(durStr ?? "permanent");
          await addToBlacklist(guildId, userId, expiresAt);
          const display = expiresAt
            ? `until ${new Date(expiresAt).toUTCString()}`
            : "permanently";
          console.log(`${tag("BL", YELLOW)} Blacklisted ${userId} in guild ${guildId} ${display}.`);
          break;
        }

        // ── unblacklist <guildId> <userId> ───────────────────────────────────
        case "unblacklist": {
          const [guildId, userId] = rest;
          if (!guildId || !userId) {
            console.log(`${tag("ERR", RED)} Usage: unblacklist <guildId> <userId>`);
            break;
          }
          const removed = await removeFromBlacklist(guildId, userId);
          console.log(removed
            ? `${tag("OK", GREEN)} Removed ${userId} from blacklist in guild ${guildId}.`
            : `${tag("WARN", YELLOW)} That user was not blacklisted.`
          );
          break;
        }

        // ── isblacklisted <guildId> <userId> ─────────────────────────────────
        case "isblacklisted": {
          const [guildId, userId] = rest;
          if (!guildId || !userId) {
            console.log(`${tag("ERR", RED)} Usage: isblacklisted <guildId> <userId>`);
            break;
          }
          const bl = await isBlacklisted(guildId, userId);
          console.log(bl
            ? `${tag("BL", YELLOW)} ${userId} IS blacklisted in guild ${guildId}.`
            : `${tag("OK", GREEN)} ${userId} is NOT blacklisted in guild ${guildId}.`
          );
          break;
        }

        // ── help ─────────────────────────────────────────────────────────────
        case "help": {
          printHelp();
          break;
        }

        // ── exit ─────────────────────────────────────────────────────────────
        case "exit":
        case "quit": {
          console.log(`${tag("BOT", CYAN)} Shutting down...`);
          await client.destroy();
          process.exit(0);
        }

        default: {
          console.log(`${tag("ERR", RED)} Unknown command: '${cmd}'. Type 'help' for a list.`);
        }
      }
    } catch (err) {
      console.log(`${tag("ERR", RED)} ${err.message}`);
    }

    rl.prompt();
  });

  rl.on("close", () => {
    console.log(`\n${tag("BOT", CYAN)} Console closed.`);
  });

  console.log(`\n${BOLD}${CYAN}Bot console ready.${RESET} Type ${GREEN}help${RESET} for available commands.\n`);
  printHelp();
}

module.exports = { startCLI };
