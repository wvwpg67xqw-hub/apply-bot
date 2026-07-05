const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getGuild } = require("../lib/db");
const { resolveAppChannel, resolveHRRole } = require("../lib/staffSetup");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show all commands and this server's current routing."),

  async execute(interaction) {
    const { guild, client } = interaction;
    const guildConfig = await getGuild(guild.id);
    const resolved    = await resolveAppChannel(client, guild, guildConfig);
    const hrRole      = resolved
      ? resolveHRRole(guild.name, resolved.guild, guildConfig?.hrRole, guild.id)
      : null;

    let routeDesc = "❌ Not configured — run `/setstaffserver` in the staff server";
    if (resolved) {
      const crossServer = resolved.guild.id !== guild.id;
      routeDesc = crossServer
        ? `<#${resolved.channel.id}> in **${resolved.guild.name}**`
        : `<#${resolved.channel.id}> (this server)`;
    }

    const embed = new EmbedBuilder()
      .setTitle("📋 Apply Bot — Commands")
      .setColor(0x5865f2)
      .addFields(
        { name: "`/setstaffserver`", value: "*(Admin, staff server)* Create all app channels and link every server.", inline: false },
        { name: "`/panel`",          value: "*(Admin)* Post the HR / Mod / Partnership panel.",                       inline: false },
        { name: "`/setroute`",       value: "*(Admin)* Manually route apps to a specific channel ID.",               inline: false },
        { name: "`/setup`",          value: "*(Admin)* Set a fallback channel + optional HR role.",                  inline: false },
        { name: "`/setrole`",        value: "*(Admin)* Override the HR role to ping.",                               inline: false },
        { name: "`/blacklist`",      value: "*(Mod)* Prevent a user from applying.",                                 inline: false },
        { name: "`/unblacklist`",    value: "*(Admin)* Remove a user from the blacklist.",                           inline: false },
      )
      .addFields({
        name: "⚙️ This server's routing",
        value: [
          `**Applications →** ${routeDesc}`,
          `**HR Role:** ${hrRole ? `<@&${hrRole.id}>` : "not found"}`,
        ].join("\n"),
        inline: false,
      })
      .setTimestamp();
    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
