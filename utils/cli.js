const readline = require("readline");
const { EmbedBuilder } = require("discord.js");
const { getServerConfig } = require("../lib/serverConfig");

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
  ${GREEN}blacklist <guildId> <userId> [dur]${RESET} — Blacklist a user
  ${GREEN}unblacklist <guildId> <userId>${RESET}   — Remove a user from blacklist
  ${GREEN}isblacklisted <guildId> <userId>${RESET} — Check blacklist status

  ${BOLD}Other${RESET}
  ${GREEN}help${RESET}                              — Show help
  ${GREEN}exit${RESET}                              — Shutdown bot
`);
}


function startCLI(client, helpers) {

  const {
    addToBlacklist,
    removeFromBlacklist,
    isBlacklisted,
    parseDuration
  } = helpers;


  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${CYAN}bot>${RESET} `,
  });


  rl.prompt();


  rl.on("line", async(raw)=>{

    const line = raw.trim();

    if(!line){
      rl.prompt();
      return;
    }


    const [cmd,...rest] = line.split(/\s+/);


    try {

      switch(cmd.toLowerCase()){


        case "blacklist": {

          const [
            guildId,
            userId,
            durStr
          ] = rest;


          if(!guildId || !userId){

            console.log(
              `${tag("ERR",RED)} Usage: blacklist <guildId> <userId> [duration]`
            );

            break;
          }


          const guild =
            client.guilds.cache.get(guildId);


          if(!guild){

            console.log(
              `${tag("ERR",RED)} Guild not found`
            );

            break;
          }


          const cfg =
            getServerConfig(
              guild.name,
              guild.id
            );


          if(!cfg?.blacklistRoleId){

            console.log(
              `${tag("ERR",RED)} No blacklist role configured for this guild`
            );

            break;
          }


          const expiresAt =
            parseDuration(
              durStr ?? "permanent"
            );


          await addToBlacklist(
            guildId,
            userId,
            cfg.blacklistRoleId,
            expiresAt
          );


          try {

            const member =
              await guild.members.fetch(userId);

            await member.roles.add(
              cfg.blacklistRoleId
            );

          } catch {}


          const display =
            expiresAt
              ? `until ${new Date(expiresAt).toUTCString()}`
              : "permanently";


          console.log(
            `${tag("BL",YELLOW)} Blacklisted ${userId} in ${guildId} ${display}`
          );


          break;
        }


        case "unblacklist": {

          const [
            guildId,
            userId
          ] = rest;


          if(!guildId || !userId){

            console.log(
              `${tag("ERR",RED)} Usage: unblacklist <guildId> <userId>`
            );

            break;
          }


          const removed =
            await removeFromBlacklist(
              guildId,
              userId
            );


          console.log(
            removed
              ? `${tag("OK",GREEN)} Removed ${userId}`
              : `${tag("WARN",YELLOW)} User was not blacklisted`
          );


          break;
        }



        case "isblacklisted": {

          const [
            guildId,
            userId
          ] = rest;


          if(!guildId || !userId){

            console.log(
              `${tag("ERR",RED)} Usage: isblacklisted <guildId> <userId>`
            );

            break;
          }


          const bl =
            await isBlacklisted(
              guildId,
              userId
            );


          console.log(
            bl
              ? `${tag("BL",YELLOW)} User is blacklisted`
              : `${tag("OK",GREEN)} User is not blacklisted`
          );


          break;
        }



        case "help": {

          printHelp();

          break;
        }



        case "exit":
        case "quit": {

          console.log(
            `${tag("BOT",CYAN)} Shutting down`
          );

          await client.destroy();
          process.exit(0);
        }



        default: {

          console.log(
            `${tag("ERR",RED)} Unknown command`
          );

        }

      }


    } catch(err){

      console.log(
        `${tag("ERR",RED)} ${err.message}`
      );

    }


    rl.prompt();

  });


  console.log(
    `\n${BOLD}${CYAN}Bot console ready.${RESET}\n`
  );

  printHelp();

}


module.exports = {
  startCLI
};