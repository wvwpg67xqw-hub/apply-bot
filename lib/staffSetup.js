const { ChannelType, PermissionsBitField } = require("discord.js");
const log = require("../utils/logger");
const { getConfig, setConfig, getGuild, setGuildConfig } = require("./db");
const { SERVER_CONFIG_MAP, getServerConfig } = require("./serverConfig");

// ─── Staff server channel setup ───────────────────────────────────────────────

async function autoSetupStaffChannels(client, staffGuild) {
  const cfg = await getConfig();

  let category = cfg.staffCategoryId
    ? staffGuild.channels.cache.get(cfg.staffCategoryId)
    : staffGuild.channels.cache.find(
        (c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase().includes("application")
      );

  if (!category) {
    category = await staffGuild.channels.create({
      name: "📋 Applications",
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        { id: staffGuild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      ],
    });
  }

  await setConfig({ staffGuildId: staffGuild.id, staffCategoryId: category.id });

  const lines = [];

  for (const entry of SERVER_CONFIG_MAP) {
    let ch = staffGuild.channels.cache.find(
      (c) => c.parentId === category.id && entry.channelNames.includes(c.name) && c.isTextBased()
    );

    if (!ch) {
      const hrRole = staffGuild.roles.cache.find((r) => r.name === entry.roleName);
      const overwrites = [
        { id: staffGuild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      ];
      if (hrRole) overwrites.push({ id: hrRole.id, allow: [PermissionsBitField.Flags.ViewChannel] });

      ch = await staffGuild.channels.create({
        name:                 entry.channelName,
        type:                 ChannelType.GuildText,
        parent:               category.id,
        permissionOverwrites: overwrites,
      });

      lines.push(`✅ Created <#${ch.id}>`);
    } else {
      lines.push(`⏭️ Already exists <#${ch.id}>`);
    }

    for (const guild of client.guilds.cache.values()) {
      if (guild.id === staffGuild.id) continue;
      const gcfg = getServerConfig(guild.name, guild.id);
      if (gcfg?.match === entry.match) {
        await setGuildConfig(guild.id, { routeChannelId: ch.id });
        lines.push(`   ↳ Linked **${guild.name}** → <#${ch.id}>`);
      }
    }
  }

  return lines.join("\n");
}

async function autoLinkNewGuild(client, guild) {
  const cfg = await getConfig();
  if (!cfg.staffGuildId) return;

  const entry = getServerConfig(guild.name, guild.id);
  if (!entry) return;

  const staffGuild = client.guilds.cache.get(cfg.staffGuildId);
  if (!staffGuild) return;

  const ch = staffGuild.channels.cache.find(
    (c) => entry.channelNames.includes(c.name) && c.isTextBased()
  );
  if (!ch) return;

  await setGuildConfig(guild.id, { routeChannelId: ch.id });
  log.info("LINK", `Auto-linked [${guild.name}] → #${ch.name}`);
}

// ─── Role & channel resolution ────────────────────────────────────────────────

function resolveHRRole(sourceGuildName, destGuild, savedHrRoleId, sourceGuildId) {
  const entry = getServerConfig(sourceGuildName, sourceGuildId);
  if (entry) {
    const role = destGuild.roles.cache.find((r) => r.name === entry.roleName);
    if (role) return role;
  }
  if (savedHrRoleId) return destGuild.roles.cache.get(savedHrRoleId) || null;
  return null;
}

async function resolveAppChannel(client, sourceGuild, guildConfig) {
  if (guildConfig?.routeChannelId) {
    try {
      const ch = await client.channels.fetch(guildConfig.routeChannelId);
      if (ch) return { channel: ch, guild: ch.guild };
    } catch (e) {
      log.warn("ROUTE", `Could not fetch routeChannelId ${guildConfig.routeChannelId}`, e.message);
    }
  }
  if (guildConfig?.applicationChannel) {
    const ch = sourceGuild.channels.cache.get(guildConfig.applicationChannel);
    if (ch) return { channel: ch, guild: sourceGuild };
  }
  const entry = getServerConfig(sourceGuild.name, sourceGuild.id);
  if (entry) {
    for (const name of entry.channelNames) {
      const ch = sourceGuild.channels.cache.find((c) => c.name === name && c.isTextBased());
      if (ch) return { channel: ch, guild: sourceGuild };
    }
  }
  return null;
}

module.exports = { autoSetupStaffChannels, autoLinkNewGuild, resolveHRRole, resolveAppChannel };
