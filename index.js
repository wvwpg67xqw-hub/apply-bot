const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");
const { read, write }      = require("./utils/jsondb");
const { detectAI }         = require("./utils/aiDetector");
const { startCLI }         = require("./utils/cli");
const { startWebServer }   = require("./server/web");
const { watchPresence, applyPresence } = require("./utils/presence");
const { DEV_COMMANDS, handleDevCommand, DEV_GUILD_ID } = require("./devSystem");
const { devLog }           = require("./utils/devlog");
const questions = require("./questions.json");
const log = require("./utils/logger");

const GUILDS_PATH           = "./data/guilds.json";
const CONFIG_PATH           = "./data/config.json";
const APPS_PATH             = "./data/applications.json";
const BLACKLIST_LOG_CHANNEL  = "1492165517279232090";
const PENDING_JOINS_PATH     = "./data/pending_joins.json";
const JOIN_ALERT_ROLE_ID     = "1521652278694514843";
const JOIN_ALERT_CHANNEL_ID  = "1519706422735274195";
const DEFAULT_JOIN_TIMEOUT   = 48 * 60 * 60 * 1000;


// ─── Blacklist log helper ─────────────────────────────────────────────────────

async function sendBlacklistLog(clientRef, { applicantId, applicantTag, roleLabel, roleEmoji, sourceGuildName, moderator, reason, appId, expiresAt }) {
  try {
    const ch = await clientRef.channels.fetch(BLACKLIST_LOG_CHANNEL);
    if (!ch?.isTextBased()) return;
    const userValue = applicantTag
      ? `<@${applicantId}> (${applicantTag})\nID: \`${applicantId}\``
      : `<@${applicantId}>\nID: \`${applicantId}\``;
    const embed = new EmbedBuilder()
      .setTitle("🚫 User Blacklisted")
      .setColor(0x000000)
      .addFields(
        { name: "User",    value: userValue,                       inline: false },
        { name: "Server",  value: sourceGuildName,                 inline: true },
        { name: "Role",    value: `${roleEmoji} ${roleLabel}`,     inline: true },
        { name: "By",      value: moderator,                       inline: true },
      )
      .setTimestamp();
    if (appId)     embed.addFields({ name: "App ID",   value: `\`${appId}\``,                                          inline: true });
    if (expiresAt) embed.addFields({ name: "Expires",  value: `<t:${Math.floor(expiresAt / 1000)}:R>`,                 inline: true });
    else           embed.addFields({ name: "Duration", value: "Permanent",                                             inline: true });
    if (reason)    embed.addFields({ name: "Reason",   value: reason,                                                   inline: false });
    await ch.send({ embeds: [embed] });
    log.info("BLACKLIST", `Log posted to channel ${BLACKLIST_LOG_CHANNEL}`);
  } catch (err) {
    log.error("BLACKLIST", "Failed to post to blacklist log channel", err.message);
  }
}

// ─── Role type metadata ───────────────────────────────────────────────────────

const SA_GUILD_ID = "1487744336908124190";
const GROWTH_GUILD_IDS = new Set([SA_GUILD_ID, "1487798778986758257"]);

const ROLE_TYPES = {
  hr:          { label: "HR",                  emoji: "👥", color: 0x5865f2 },
  mod:         { label: "Moderator",           emoji: "🔨", color: 0xed4245 },
  partnership: { label: "Partnership Manager", emoji: "🤝", color: 0xfee75c },
  growth:      { label: "Growth Manager",      emoji: "📈", color: 0x57f287 },
};

// ─── Per-server config map ────────────────────────────────────────────────────

const SERVER_CONFIG_MAP = [
  {
    match:          "plain promotions",
    channelName:    "plain-promotions-apps",
    channelNames:   ["plain-promotions-apps", "plain-promotions", "pp-apps"],
    roleName:       "Plain Promotions Apps",
    reviewerRoleId: "1488370139286995135",
  },
  {
    match:          "advertising legends",
    channelName:    "advertising-legends-apps",
    channelNames:   ["advertising-legends-apps", "advertising-legends", "al-apps"],
    roleName:       "Advertising Legends Apps",
    reviewerRoleId: "1488375799819276358",
  },
  {
    match:          "devil advertising",
    channelName:    "devil-advertising-apps",
    channelNames:   ["devil-advertising-apps", "devil-advertising", "da-apps"],
    roleName:       "Devil Advertising Apps",
    reviewerRoleId: "1488370171293733000",
  },
  {
    match:          "shadow advertising",
    guildIds:       ["1487798778986758257"],
    channelName:    "shadow-advertising-apps",
    channelNames:   ["shadow-advertising-apps", "shadow-advertising", "sa-apps"],
    roleName:       "Shadow Advertising Apps",
    reviewerRoleId: "1488369842225680465",
  },
];

function getServerConfig(guildName, guildId) {
  if (guildId) {
    const byId = SERVER_CONFIG_MAP.find((e) => e.guildIds?.includes(guildId));
    if (byId) return byId;
  }
  const lower = guildName.toLowerCase();
  return SERVER_CONFIG_MAP.find((e) => lower.includes(e.match)) || null;
}

// ─── Global config ────────────────────────────────────────────────────────────

function getConfig()        { return read(CONFIG_PATH); }
function setConfig(updates) { write(CONFIG_PATH, { ...getConfig(), ...updates }); }

// ─── DB helpers ───────────────────────────────────────────────────────────────

function getGuilds()  { return read(GUILDS_PATH); }
function getGuild(id) { return getGuilds().find((g) => g.id === id) || null; }

function setGuildConfig(guildId, config) {
  const guilds = getGuilds();
  const idx    = guilds.findIndex((g) => g.id === guildId);
  if (idx === -1) guilds.push({ id: guildId, blacklist: [], ...config });
  else            guilds[idx] = { blacklist: [], ...guilds[idx], ...config };
  write(GUILDS_PATH, guilds);
}

function isBlacklisted(guildId, userId) {
  const blacklist = getGuild(guildId)?.blacklist;
  if (!blacklist) return false;
  const entry = blacklist.find((e) => (typeof e === "string" ? e : e.userId) === userId);
  if (!entry) return false;
  const expiresAt = typeof entry === "object" ? entry.expiresAt : null;
  if (expiresAt && Date.now() > expiresAt) return false;
  return true;
}

function addToBlacklist(guildId, userId, expiresAt = null) {
  const guilds = getGuilds();
  let idx      = guilds.findIndex((g) => g.id === guildId);
  const entry  = { userId, expiresAt };
  if (idx === -1) {
    guilds.push({ id: guildId, blacklist: [entry] });
    write(GUILDS_PATH, guilds);
    return;
  }
  if (!Array.isArray(guilds[idx].blacklist)) guilds[idx].blacklist = [];
  const existing = guilds[idx].blacklist.findIndex(
    (e) => (typeof e === "string" ? e : e.userId) === userId
  );
  if (existing !== -1) guilds[idx].blacklist[existing] = entry;
  else                 guilds[idx].blacklist.push(entry);
  write(GUILDS_PATH, guilds);
}

function removeFromBlacklist(guildId, userId) {
  const guilds = getGuilds();
  const idx    = guilds.findIndex((g) => g.id === guildId);
  if (idx === -1) return false;
  const before = guilds[idx].blacklist?.length || 0;
  guilds[idx].blacklist = (guilds[idx].blacklist || []).filter(
    (e) => (typeof e === "string" ? e : e.userId) !== userId
  );
  write(GUILDS_PATH, guilds);
  return guilds[idx].blacklist.length < before;
}

// Removes a user from the blacklist in every guild (handles cross-server reviews)
function removeFromBlacklistAllGuilds(userId) {
  const guilds = getGuilds();
  let totalRemoved = 0;
  for (const g of guilds) {
    if (!Array.isArray(g.blacklist)) continue;
    const before = g.blacklist.length;
    g.blacklist = g.blacklist.filter(
      (e) => (typeof e === "string" ? e : e.userId) !== userId
    );
    totalRemoved += before - g.blacklist.length;
  }
  if (totalRemoved > 0) write(GUILDS_PATH, guilds);
  return totalRemoved;
}

// ─── Staff invite — cached, auto-rotating every 30 min ───────────────────────

let _cachedInviteUrl  = null;
let _inviteRefreshTimer = null;

async function _buildInvite(client) {
  const cfg = getConfig();
  if (!cfg.staffGuildId) return null;
  const staffGuild = client.guilds.cache.get(cfg.staffGuildId);
  if (!staffGuild) return null;

  let channel = null;
  if (cfg.inviteChannelId) {
    channel = staffGuild.channels.cache.get(cfg.inviteChannelId) ?? null;
  }
  if (!channel) {
    channel = staffGuild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText &&
             c.permissionsFor(staffGuild.members.me)?.has("CreateInstantInvite")
    ) ?? null;
  }
  if (!channel) return null;

  try {
    const invite = await channel.createInvite({
      maxAge:  86400,
      maxUses: 1,
      unique:  true,
      reason:  "Staff application acceptance — single-use 24 hour rotating invite",
    });
    log.info("INVITE", `Generated invite ${invite.code} → #${invite.channel.name} (1 use, 24 hr)`);
    return invite.url;
  } catch (err) {
    log.error("INVITE", "Failed to generate invite", err.message);
    return null;
  }
}

async function startInviteRotation(client) {
  if (_inviteRefreshTimer) clearInterval(_inviteRefreshTimer);
  _cachedInviteUrl = await _buildInvite(client);

  _inviteRefreshTimer = setInterval(async () => {
    log.info("INVITE", "24-hr rotation — generating new invite...");
    _cachedInviteUrl = await _buildInvite(client);
  }, 24 * 60 * 60 * 1000);
}

async function generateStaffInvite(client) {
  // If the cached invite was already consumed (1-use), build a fresh one immediately
  if (!_cachedInviteUrl) _cachedInviteUrl = await _buildInvite(client);
  const url = _cachedInviteUrl;
  _cachedInviteUrl = null;               // mark consumed — next call rebuilds
  _buildInvite(client).then(u => { _cachedInviteUrl = u; }); // pre-warm next
  return url;
}

// ─── Application ID helpers ───────────────────────────────────────────────────

function getApps() {
  return read(APPS_PATH);
}

function saveApp(appData) {
  const apps = getApps();
  apps.push(appData);
  write(APPS_PATH, apps);
}

function getAppById(id) {
  return getApps().find((a) => a.id === id.toUpperCase()) || null;
}

function generateAppId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let suffix = "";
  for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  return "APP-" + suffix;
}

// ─── Duration parser ──────────────────────────────────────────────────────────

function parseDuration(str) {
  if (!str || str.toLowerCase() === "permanent") return null;
  const match = str.match(/^(\d+)\s*(m|h|d|w)$/i);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const ms = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
  return Date.now() + n * ms[unit];
}

function parseDurationMs(str) {
  if (!str) return null;
  const match = str.match(/^(\d+)\s*(m|h|d|w)$/i);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const ms = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
  return n * ms[unit];
}

// ─── Pending join tracker ─────────────────────────────────────────────────────

function getPendingJoins() { return read(PENDING_JOINS_PATH); }

function addPendingJoin(entry) {
  const list = getPendingJoins();
  list.push(entry);
  write(PENDING_JOINS_PATH, list);
}

function removePendingJoin(userId) {
  const list = getPendingJoins().filter((e) => e.userId !== userId);
  write(PENDING_JOINS_PATH, list);
}

function getJoinTimeoutMs() {
  return getConfig().joinTimeoutMs ?? DEFAULT_JOIN_TIMEOUT;
}

async function startJoinWatcher(client) {
  setInterval(async () => {
    const list    = getPendingJoins();
    const timeout = getJoinTimeoutMs();
    const now     = Date.now();
    const expired = list.filter((e) => now - e.invitedAt >= timeout);
    if (!expired.length) return;

    let alertChannel = null;
    try {
      alertChannel = await client.channels.fetch(JOIN_ALERT_CHANNEL_ID);
    } catch {
      log.warn("JOIN_WATCH", `Could not fetch alert channel ${JOIN_ALERT_CHANNEL_ID}`);
      return;
    }
    if (!alertChannel?.isTextBased()) return;

    for (const entry of expired) {
      const hoursAgo = Math.round((now - entry.invitedAt) / 3_600_000);
      try {
        await alertChannel.send(
          `<@&${JOIN_ALERT_ROLE_ID}> ⚠️ **${entry.applicantTag ?? `<@${entry.userId}>`}** was accepted for **${entry.roleType?.toUpperCase() ?? "Staff"}** from **${entry.sourceGuildName}** but has not joined the staff server in **${hoursAgo} hour${hoursAgo === 1 ? "" : "s"}**.`
        );
        log.info("JOIN_WATCH", `Alerted: ${entry.applicantTag ?? entry.userId} not joined after ${hoursAgo}h`);
      } catch (err) {
        log.error("JOIN_WATCH", "Failed to send join alert", err.message);
      }
      removePendingJoin(entry.userId);
    }
  }, 60_000);

  log.info("JOIN_WATCH", `Join watcher started — timeout: ${getJoinTimeoutMs() / 60_000} min`);
}

// ─── Staff server channel setup ───────────────────────────────────────────────

async function autoSetupStaffChannels(client, staffGuild) {
  const cfg = getConfig();

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

  setConfig({ staffGuildId: staffGuild.id, staffCategoryId: category.id });

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
        setGuildConfig(guild.id, { routeChannelId: ch.id });
        lines.push(`   ↳ Linked **${guild.name}** → <#${ch.id}>`);
      }
    }
  }

  return lines.join("\n");
}

async function autoLinkNewGuild(client, guild) {
  const cfg = getConfig();
  if (!cfg.staffGuildId) return;

  const entry = getServerConfig(guild.name, guild.id);
  if (!entry) return;

  const staffGuild = client.guilds.cache.get(cfg.staffGuildId);
  if (!staffGuild) return;

  const ch = staffGuild.channels.cache.find(
    (c) => entry.channelNames.includes(c.name) && c.isTextBased()
  );
  if (!ch) return;

  setGuildConfig(guild.id, { routeChannelId: ch.id });
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

// ─── Slash command definitions ────────────────────────────────────────────────

const commands = [
  new SlashCommandBuilder()
    .setName("setstaffserver")
    .setDescription("(Admin) Mark this server as the staff hub and auto-create all application channels.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("(Admin) Post the application panel. Choose which roles to include.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addChannelOption((o) =>
      o.setName("channel")
        .setDescription("Channel to send the panel to (defaults to current channel).")
        .setRequired(false)
    )
    .addBooleanOption((o) =>
      o.setName("hr")
        .setDescription("Include the HR button? (default: yes)")
        .setRequired(false)
    )
    .addBooleanOption((o) =>
      o.setName("mod")
        .setDescription("Include the Mod button? (default: yes)")
        .setRequired(false)
    )
    .addBooleanOption((o) =>
      o.setName("partnership")
        .setDescription("Include the Partnership Manager button? (default: yes)")
        .setRequired(false)
    )
    .addBooleanOption((o) =>
      o.setName("growth")
        .setDescription("Include the Growth Manager button? (default: yes)")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("setroute")
    .setDescription("(Admin) Manually route this server's apps to a specific channel ID.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addStringOption((o) =>
      o.setName("channel-id")
        .setDescription("ID of the destination channel.")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("(Admin) Set a same-server fallback channel and/or HR role override.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addChannelOption((o) =>
      o.setName("channel").setDescription("Channel for application threads.").setRequired(true)
    )
    .addRoleOption((o) =>
      o.setName("role").setDescription("HR role to ping.").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("setrole")
    .setDescription("(Admin) Override the HR role to ping on new applications.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addRoleOption((o) =>
      o.setName("role").setDescription("The HR role.").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("setacceptroles")
    .setDescription("(Admin) Set the roles granted per application type when accepted. Run in each source server.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addRoleOption((o) =>
      o.setName("hr-role").setDescription("Role given to accepted HR applicants (e.g. @HR).").setRequired(true)
    )
    .addRoleOption((o) =>
      o.setName("hr-team").setDescription("Team role also given to accepted HR applicants (e.g. @Staff Team).").setRequired(true)
    )
    .addRoleOption((o) =>
      o.setName("mod-role").setDescription("Role given to accepted Mod applicants (e.g. @Moderator).").setRequired(true)
    )
    .addRoleOption((o) =>
      o.setName("mod-team").setDescription("Team role also given to accepted Mod applicants (e.g. @Staff Team).").setRequired(true)
    )
    .addRoleOption((o) =>
      o.setName("partnership-role").setDescription("Role given to accepted Partnership applicants (e.g. @Partnership Manager).").setRequired(true)
    )
    .addRoleOption((o) =>
      o.setName("partnership-team").setDescription("Team role also given to accepted Partnership applicants (e.g. @Staff Team).").setRequired(true)
    )
    .addRoleOption((o) =>
      o.setName("growth-role").setDescription("Role given to accepted Growth Manager applicants (e.g. @Growth Manager).").setRequired(false)
    )
    .addRoleOption((o) =>
      o.setName("growth-team").setDescription("Team role also given to accepted Growth Manager applicants (e.g. @Staff Team).").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("(Mod) Prevent a user from submitting applications.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
    .addUserOption((o) =>
      o.setName("user").setDescription("The user to blacklist.").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("duration")
        .setDescription("How long to blacklist (e.g. 1h, 2d, 7d, 2w, permanent). Default: permanent.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("unblacklist")
    .setDescription("(Admin) Remove a user from the blacklist.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addUserOption((o) =>
      o.setName("user").setDescription("The user to unblacklist.").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("setinvitechannel")
    .setDescription("(Admin) Set which channel staff invite links are created for.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addChannelOption((o) =>
      o.setName("channel").setDescription("The channel to generate invites for.").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("application")
    .setDescription("Look up a specific application by its ID.")
    .addStringOption((o) =>
      o.setName("id").setDescription("The application ID (e.g. APP-ABC123).").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show all commands and this server's current routing."),

  new SlashCommandBuilder()
    .setName("setjointimeout")
    .setDescription("(Admin) Set how long to wait before alerting that an accepted applicant hasn't joined.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addStringOption((o) =>
      o.setName("duration")
        .setDescription("Time to wait, e.g. 1m, 30m, 48h, 7d. Default is 48h.")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("setstatus")
    .setDescription("(Admin) Change the bot's online status.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addStringOption((o) =>
      o.setName("status")
        .setDescription("The status to display.")
        .setRequired(true)
        .addChoices(
          { name: "🟢 Online",          value: "online"    },
          { name: "🟡 Idle",            value: "idle"      },
          { name: "🔴 Do Not Disturb",  value: "dnd"       },
          { name: "⚫ Invisible",       value: "invisible" },
        )
    ),

  new SlashCommandBuilder()
    .setName("setactivity")
    .setDescription("(Admin) Change the bot's activity text.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addStringOption((o) =>
      o.setName("type")
        .setDescription("Activity type.")
        .setRequired(true)
        .addChoices(
          { name: "🎮 Playing",   value: "PLAYING"   },
          { name: "👀 Watching",  value: "WATCHING"  },
          { name: "🎧 Listening", value: "LISTENING" },
          { name: "🏆 Competing", value: "COMPETING" },
          { name: "📡 Streaming", value: "STREAMING" },
        )
    )
    .addStringOption((o) =>
      o.setName("text")
        .setDescription("The activity text — e.g. 'for staff', 'applications'.")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("detectai")
    .setDescription("Check whether a piece of text appears to be AI-generated.")
    .addStringOption((o) =>
      o.setName("text")
        .setDescription("The text to analyse (min 50 characters recommended).")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("sethftoken")
    .setDescription("(Admin) Set the Hugging Face API token used for AI detection.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addStringOption((o) =>
      o.setName("token")
        .setDescription("Your Hugging Face API token (hf_...).")
        .setRequired(true)
    ),
].map((c) => c.toJSON());

const allCommands = [...commands, ...DEV_COMMANDS];

// ─── Button rows ──────────────────────────────────────────────────────────────

function buildReviewRow(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("app_accept")
      .setLabel("Accept")
      .setStyle(ButtonStyle.Success)
      .setEmoji("✅")
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("app_deny")
      .setLabel("Deny")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("❌")
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("app_blacklist")
      .setLabel("Blacklist")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🚫")
      .setDisabled(disabled)
  );
}

const PANEL_ROLE_DEFS = [
  { roleType: "hr",          customId: "panel_apply_hr",          label: "HR",                   style: ButtonStyle.Primary,   emoji: "👥", fieldName: "👥 HR",                   fieldValue: "Help manage and recruit our staff team.",          growthOnly: false },
  { roleType: "mod",         customId: "panel_apply_mod",         label: "Mod",                  style: ButtonStyle.Danger,    emoji: "🔨", fieldName: "🔨 Mod",                   fieldValue: "Keep the server safe and enforce the rules.",      growthOnly: false },
  { roleType: "partnership", customId: "panel_apply_partnership", label: "Partnership Manager",  style: ButtonStyle.Success,   emoji: "🤝", fieldName: "🤝 Partnership Manager",   fieldValue: "Build relationships with other Discord servers.",  growthOnly: false },
  { roleType: "growth",      customId: "panel_apply_growth",      label: "Growth Manager",       style: ButtonStyle.Secondary, emoji: "📈", fieldName: "📈 Growth Manager",        fieldValue: "Drive server growth, partnerships, and activity.", growthOnly: true  },
];

function buildPanelRow(guildId, disabledRoles = []) {
  const buttons = PANEL_ROLE_DEFS
    .filter(d => !d.growthOnly || GROWTH_GUILD_IDS.has(guildId))
    .filter(d => !disabledRoles.includes(d.roleType))
    .map(d =>
      new ButtonBuilder()
        .setCustomId(d.customId)
        .setLabel(d.label)
        .setStyle(d.style)
        .setEmoji(d.emoji)
    );
  return new ActionRowBuilder().addComponents(...buttons);
}

function buildPanelEmbed(guild, disabledRoles = []) {
  const embed = new EmbedBuilder()
    .setTitle("📋 Staff Applications")
    .setDescription(
      `Want to join the team at **${guild.name}**?\n\n` +
      `Choose the role you'd like to apply for below.\n` +
      `The questions will be sent to your **DMs** — make sure they are open!\n\n` +
      `> ⏱️ You have **2 minutes** to answer each question.\n` +
      `> 📬 You'll be notified once a decision has been made.`
    )
    .setColor(0x5865f2);

  const activeFields = PANEL_ROLE_DEFS
    .filter(d => !d.growthOnly || GROWTH_GUILD_IDS.has(guild.id))
    .filter(d => !disabledRoles.includes(d.roleType));

  for (const d of activeFields) {
    embed.addFields({ name: d.fieldName, value: d.fieldValue, inline: true });
  }

  return embed.setTimestamp().setFooter({ text: guild.name });
}

// ─── Shared application flow ──────────────────────────────────────────────────

async function runApplication(client, user, sourceGuild, roleType) {
  const meta        = ROLE_TYPES[roleType];
  const questionSet = questions[roleType];
  const guildConfig = getGuild(sourceGuild.id);

  if (isBlacklisted(sourceGuild.id, user.id)) return { ok: false, reason: "blacklisted" };

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

  // ── AI detection scan ──────────────────────────────────────────────────────
  try {
    const combinedText = answers.join("\n\n");
    if (combinedText.trim().length >= 20) {
      const aiResult = await detectAI(combinedText);
      const bar = (pct) => {
        const filled = Math.round(pct / 10);
        return "█".repeat(filled) + "░".repeat(10 - filled);
      };
      const aiColor   = aiResult.isAI ? 0xed4245 : 0x57f287;
      const aiIcon    = aiResult.isAI ? "🤖" : "✅";
      const aiVerdict = aiResult.isAI
        ? `**Likely AI-generated** (${aiResult.confidence}% confidence)`
        : `**Likely human-written** (${aiResult.confidence}% confidence)`;
      const scoreLines = aiResult.allScores
        .map((s) => `\`${s.label.padEnd(10)}\` ${bar(Math.round(s.score * 100))} ${Math.round(s.score * 100)}%`)
        .join("\n");
      const aiEmbed = new EmbedBuilder()
        .setTitle(`${aiIcon} AI Detection Scan`)
        .setColor(aiColor)
        .setDescription("Automatically scanned all answers for AI-generated content.")
        .addFields(
          { name: "Verdict", value: aiVerdict,   inline: false },
          { name: "Scores",  value: scoreLines,  inline: false },
        )
        .setFooter({ text: "Model: Hello-SimpleAI/chatgpt-detector-roberta • Powered by Hugging Face" })
        .setTimestamp();
      await thread.send({ embeds: [aiEmbed] });
    }
  } catch (err) {
    log.warn("DETECTAI", "Auto-scan failed for application", err.message);
    await thread.send({ content: `⚠️ AI detection scan failed: ${err.message}` });
    devLog(client, "devAiErrors", {
      title: "🧠 Hugging Face API Error — Auto-scan",
      fields: [
        { name: "Error",       value: `\`\`\`${err.message}\`\`\``,                       inline: false },
        { name: "Applicant",   value: `<@${user.id}> (${user.tag})`,                       inline: true  },
        { name: "Server",      value: sourceGuild.name,                                    inline: true  },
        { name: "Role Type",   value: roleType,                                            inline: true  },
        { name: "App ID",      value: appId ?? "unknown",                                  inline: true  },
        { name: "Thread",      value: `<#${thread.id}>`,                                   inline: true  },
        { name: "Tip",         value: "Set `HF_TOKEN` in Secrets if hitting rate limits.", inline: false },
      ],
    }).catch(() => {});
  }

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

// ─── Client ───────────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageTyping,
    GatewayIntentBits.DirectMessageTyping,
  ],
});

client.once("ready", async () => {
  log.info("BOT", `Logged in as ${client.user.tag} (${client.user.id})`);
  log.info("BOT", `In ${client.guilds.cache.size} guild(s)`);

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  try {
    log.info("COMMANDS", "Registering global slash commands...");
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    log.info("COMMANDS", `Registered ${commands.length} global commands`);
  } catch (err) {
    log.error("COMMANDS", "Failed to register global commands", err.message);
  }
  try {
    log.info("COMMANDS", `Registering ${DEV_COMMANDS.length} dev commands to guild ${DEV_GUILD_ID}...`);
    await rest.put(Routes.applicationGuildCommands(client.user.id, DEV_GUILD_ID), { body: DEV_COMMANDS });
    log.info("COMMANDS", `Registered ${DEV_COMMANDS.length} dev commands (guild-only)`);
  } catch (err) {
    log.error("COMMANDS", "Failed to register dev guild commands", err.message);
  }

  // Link any unlinked guilds if a staff server is already configured
  const cfg = getConfig();
  if (cfg.staffGuildId) {
    const staffGuild = client.guilds.cache.get(cfg.staffGuildId);
    if (staffGuild) {
      for (const guild of client.guilds.cache.values()) {
        if (guild.id === staffGuild.id) continue;
        const guildCfg = getGuild(guild.id);
        if (guildCfg?.routeChannelId) continue;
        const entry = getServerConfig(guild.name, guild.id);
        if (!entry) continue;
        const ch = staffGuild.channels.cache.find(
          (c) => entry.channelNames.includes(c.name) && c.isTextBased()
        );
        if (ch) {
          setGuildConfig(guild.id, { routeChannelId: ch.id });
          log.info("LINK", `Linked [${guild.name}] → #${ch.name}`);
        }
      }
    }
  }

  startCLI(client, { addToBlacklist, removeFromBlacklist, isBlacklisted, parseDuration });

  const webPort = parseInt(process.env.PORT ?? "3000", 10);
  startWebServer(client, webPort);

  await startInviteRotation(client);
  watchPresence(client);
  startJoinWatcher(client);
});

client.on("guildCreate", async (guild) => {
  log.info("GUILD", `Joined guild: ${guild.name}`);
  await autoLinkNewGuild(client, guild);
});

client.on("guildMemberAdd", (member) => {
  const cfg = getConfig();
  if (member.guild.id !== cfg.staffGuildId) return;
  const pending = getPendingJoins().find((e) => e.userId === member.id);
  if (!pending) return;
  removePendingJoin(member.id);
  log.info("JOIN_WATCH", `${member.user.tag} joined staff server — removed from pending list`);
});

const AUTO_UNBLACKLIST_ROLE = "1487774070094168135";

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  const gained = !oldMember.roles.cache.has(AUTO_UNBLACKLIST_ROLE) &&
                  newMember.roles.cache.has(AUTO_UNBLACKLIST_ROLE);
  if (!gained) return;

  const removed = removeFromBlacklist(newMember.guild.id, newMember.id);
  if (removed) {
    log.info("UNBLACKLIST", `Auto-unblacklisted ${newMember.user.tag} (${newMember.id}) in [${newMember.guild.name}] — gained role ${AUTO_UNBLACKLIST_ROLE}`);
    try {
      await newMember.send(
        `✅ You have been automatically removed from the blacklist in **${newMember.guild.name}** because you were granted a trusted role.`
      );
    } catch {}
  }
});

// ─── Interaction handler ──────────────────────────────────────────────────────

client.on("interactionCreate", async (interaction) => {

  // ── Slash commands ──────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    const { commandName, guild, user } = interaction;
    log.info("CMD", `/${commandName} — ${user.tag} (${user.id}) in [${guild?.name}]`);

    // Route dev commands first
    try {
      const handled = await handleDevCommand(interaction, client, {
        allCommandsJson: allCommands,
        getGuild,
        setGuildConfig,
        buildPanelEmbed,
        buildPanelRow,
        GROWTH_GUILD_IDS,
        PANEL_ROLE_DEFS,
      });
      if (handled) {
        devLog(client, "devLogs", {
          title: `🛠️ Dev Command: /${commandName}`,
          fields: [
            { name: "By",    value: `<@${user.id}> (${user.tag})`, inline: true },
            { name: "Guild", value: guild?.name ?? "Unknown",       inline: true },
          ],
        });
        return;
      }
    } catch (err) {
      log.error("DEV", `Dev command error in /${commandName}`, err.message);
      devLog(client, "devErrors", {
        title: `❌ Dev Command Error: /${commandName}`,
        fields: [
          { name: "Error",  value: err.message,                    inline: false },
          { name: "By",     value: `<@${user.id}> (${user.tag})`, inline: true  },
        ],
      });
      return;
    }

    // /setstaffserver
    if (commandName === "setstaffserver") {
      await interaction.deferReply({ ephemeral: true });
      let summary;
      try {
        summary = await autoSetupStaffChannels(client, guild);
      } catch (err) {
        log.error("SETUP", "autoSetupStaffChannels error", err.message);
        return interaction.editReply(`❌ Something went wrong: ${err.message}`);
      }
      const embed = new EmbedBuilder()
        .setTitle("✅ Staff Server Configured")
        .setDescription(
          `**${guild.name}** is now the staff hub.\n\n` +
          `A **📋 Applications** category has been created with one channel per server:\n\n` +
          summary
        )
        .setColor(0x57f287)
        .setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }

    // /sethftoken
    if (commandName === "sethftoken") {
      if (interaction.guild?.id !== SA_GUILD_ID) {
        return interaction.reply({ content: "❌ This command can only be used in the Shadow Advertising server.", ephemeral: true });
      }
      const token = interaction.options.getString("token");
      if (!token.startsWith("hf_")) {
        return interaction.reply({ content: "❌ That doesn't look like a valid Hugging Face token — it should start with `hf_`.", ephemeral: true });
      }
      const cfg = getConfig();
      setConfig({ ...cfg, hfToken: token });
      log.info("SETHFTOKEN", `HF token updated by ${interaction.user.tag}`);
      return interaction.reply({ content: "✅ Hugging Face API token saved. AI detection will use it from now on.", ephemeral: true });
    }

    // /detectai
    if (commandName === "detectai") {
      const text = interaction.options.getString("text");
      if (text.length < 20) {
        return interaction.reply({ content: "⚠️ Please provide at least 20 characters of text for a meaningful result.", ephemeral: true });
      }
      await interaction.deferReply();
      try {
        const result = await detectAI(text);
        const bar = (pct) => {
          const filled = Math.round(pct / 10);
          return "█".repeat(filled) + "░".repeat(10 - filled);
        };
        const color  = result.isAI ? 0xed4245 : 0x57f287;
        const icon   = result.isAI ? "🤖" : "✅";
        const verdict = result.isAI
          ? `**Likely AI-generated** (${result.confidence}% confidence)`
          : `**Likely human-written** (${result.confidence}% confidence)`;

        const scoreLines = result.allScores
          .map((s) => `\`${s.label.padEnd(10)}\` ${bar(Math.round(s.score * 100))} ${Math.round(s.score * 100)}%`)
          .join("\n");

        const preview = text.length > 200 ? text.slice(0, 200) + "…" : text;

        const embed = new EmbedBuilder()
          .setTitle(`${icon} AI Detection Result`)
          .setColor(color)
          .addFields(
            { name: "Verdict",  value: verdict,     inline: false },
            { name: "Scores",   value: scoreLines,  inline: false },
            { name: "Input preview", value: `> ${preview.replace(/\n/g, "\n> ")}`, inline: false },
          )
          .setFooter({ text: "Model: Hello-SimpleAI/chatgpt-detector-roberta • Powered by Hugging Face" })
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      } catch (err) {
        log.error("DETECTAI", "Hugging Face API error", err.message);
        devLog(client, "devAiErrors", {
          title: "🧠 Hugging Face API Error — /detectai",
          fields: [
            { name: "Error",   value: `\`\`\`${err.message}\`\`\``,                       inline: false },
            { name: "Used by", value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
            { name: "Server",  value: guild?.name ?? "unknown",                            inline: true  },
            { name: "Tip",     value: "Set `HF_TOKEN` in Secrets if hitting rate limits.", inline: false },
          ],
        }).catch(() => {});
        return interaction.editReply(`❌ Detection failed: ${err.message}\n\nMake sure \`HF_TOKEN\` is set as an environment variable if you are hitting rate limits.`);
      }
    }

    // /help
    if (commandName === "help") {
      const guildConfig = getGuild(guild.id);
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
    }

    // /setroute
    if (commandName === "setroute") {
      const channelId = interaction.options.getString("channel-id").trim();
      let destChannel;
      try {
        destChannel = await client.channels.fetch(channelId);
      } catch {
        return interaction.reply({
          content: "❌ Could not find that channel. Make sure the ID is correct and the bot is in that server.",
          ephemeral: true,
        });
      }
      if (!destChannel.isTextBased()) {
        return interaction.reply({ content: "❌ That channel is not a text channel.", ephemeral: true });
      }
      setGuildConfig(guild.id, { routeChannelId: channelId });
      return interaction.reply({
        content: `✅ Applications from **${guild.name}** will now go to <#${channelId}> in **${destChannel.guild?.name ?? "the staff server"}**.`,
        ephemeral: true,
      });
    }

    // /setup
    if (commandName === "setup") {
      const channel = interaction.options.getChannel("channel");
      const role    = interaction.options.getRole("role");
      const update  = { applicationChannel: channel.id };
      if (role) update.hrRole = role.id;
      setGuildConfig(guild.id, update);
      return interaction.reply({
        content: `✅ Fallback channel set to ${channel}.${role ? ` HR role set to ${role}.` : ""}`,
        ephemeral: true,
      });
    }

    // /setrole
    if (commandName === "setrole") {
      const role = interaction.options.getRole("role");
      setGuildConfig(guild.id, { hrRole: role.id });
      return interaction.reply({ content: `✅ HR role set to ${role}.`, ephemeral: true });
    }

    // /setacceptroles
    if (commandName === "setacceptroles") {
      try {
        const hrRole          = interaction.options.getRole("hr-role");
        const hrTeam          = interaction.options.getRole("hr-team");
        const modRole         = interaction.options.getRole("mod-role");
        const modTeam         = interaction.options.getRole("mod-team");
        const partnerRole     = interaction.options.getRole("partnership-role");
        const partnerTeam     = interaction.options.getRole("partnership-team");
        const growthRole      = interaction.options.getRole("growth-role");
        const growthTeam      = interaction.options.getRole("growth-team");

        const missing = [
          !hrRole      && "hr-role",
          !hrTeam      && "hr-team",
          !modRole     && "mod-role",
          !modTeam     && "mod-team",
          !partnerRole && "partnership-role",
          !partnerTeam && "partnership-team",
        ].filter(Boolean);

        if (missing.length) {
          return interaction.reply({
            content: `❌ Could not resolve the following roles: **${missing.join(", ")}**. Make sure the roles exist in this server and try again.`,
            ephemeral: true,
          });
        }

        const configUpdate = {
          hrRoleId:              hrRole.id,
          hrTeamRoleId:          hrTeam.id,
          modRoleId:             modRole.id,
          modTeamRoleId:         modTeam.id,
          partnershipRoleId:     partnerRole.id,
          partnershipTeamRoleId: partnerTeam.id,
        };
        if (growthRole) configUpdate.growthRoleId     = growthRole.id;
        if (growthTeam) configUpdate.growthTeamRoleId = growthTeam.id;
        setGuildConfig(guild.id, configUpdate);

        const embedFields = [
          { name: "👥 HR Role",                  value: `${hrRole}`,      inline: true },
          { name: "👥 HR Team Role",              value: `${hrTeam}`,      inline: true },
          { name: "\u200b",                       value: "\u200b",          inline: true },
          { name: "🔨 Mod Role",                  value: `${modRole}`,     inline: true },
          { name: "🔨 Mod Team Role",              value: `${modTeam}`,     inline: true },
          { name: "\u200b",                       value: "\u200b",          inline: true },
          { name: "🤝 Partnership Manager Role",  value: `${partnerRole}`, inline: true },
          { name: "🤝 Partnership Team Role",     value: `${partnerTeam}`, inline: true },
          { name: "\u200b",                       value: "\u200b",          inline: true },
        ];
        if (growthRole) embedFields.push(
          { name: "📈 Growth Manager Role",  value: `${growthRole}`,                    inline: true },
          { name: "📈 Growth Team Role",     value: growthTeam ? `${growthTeam}` : "—", inline: true },
          { name: "\u200b",                  value: "\u200b",                            inline: true },
        );

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(`✅ Accept roles configured for ${guild.name}`)
              .setColor(0x57f287)
              .addFields(...embedFields)
              .setFooter({ text: "These roles will be granted when an application is accepted." }),
          ],
          ephemeral: true,
        });
      } catch (err) {
        log.error("SETROLES", "setacceptroles error", err.message);
        return interaction.reply({
          content: `❌ Something went wrong while saving roles: ${err.message}`,
          ephemeral: true,
        });
      }
    }

    // /blacklist
    if (commandName === "blacklist") {
      const target      = interaction.options.getUser("user");
      const durationStr = interaction.options.getString("duration") ?? "permanent";
      const expiresAt   = parseDuration(durationStr);

      if (durationStr.toLowerCase() !== "permanent" && expiresAt === null) {
        return interaction.reply({
          content: "❌ Invalid duration. Use formats like `1h`, `2d`, `7d`, `2w`, or `permanent`.",
          ephemeral: true,
        });
      }

      addToBlacklist(guild.id, target.id, expiresAt);
      await sendBlacklistLog(client, {
        applicantId:     target.id,
        applicantTag:    target.tag,
        roleLabel:       "Manual",
        roleEmoji:       "🚫",
        sourceGuildName: guild.name,
        moderator:       interaction.user.tag,
        expiresAt,
      });

      const durationDisplay = expiresAt
        ? `until <t:${Math.floor(expiresAt / 1000)}:F>`
        : "permanently";
      return interaction.reply({
        content: `🚫 ${target} has been blacklisted from applying ${durationDisplay}.`,
        ephemeral: true,
      });
    }

    // /unblacklist
    if (commandName === "unblacklist") {
      const target  = interaction.options.getUser("user");
      const count   = removeFromBlacklistAllGuilds(target.id);
      return interaction.reply({
        content: count > 0
          ? `✅ ${target} has been removed from the blacklist${count > 1 ? ` across ${count} server(s)` : ""}.`
          : `⚠️ That user is not blacklisted in any server.`,
        ephemeral: true,
      });
    }

    if (commandName === "setstatus") {
      const status = interaction.options.getString("status");
      const statusData = read("./data/status.json") ?? {};
      statusData.status = status;
      write("./data/status.json", statusData);
      applyPresence(client);
      const labels = { online: "🟢 Online", idle: "🟡 Idle", dnd: "🔴 Do Not Disturb", invisible: "⚫ Invisible" };
      return interaction.reply({ content: `✅ Bot status set to **${labels[status] ?? status}**.`, ephemeral: true });
    }

    if (commandName === "setactivity") {
      const type = interaction.options.getString("type");
      const name = interaction.options.getString("text");
      const activityData = read("./data/activity.json") ?? {};
      activityData.type = type;
      activityData.name = name;
      write("./data/activity.json", activityData);
      applyPresence(client);
      const typeLabel = { PLAYING: "🎮 Playing", WATCHING: "👀 Watching", LISTENING: "🎧 Listening", COMPETING: "🏆 Competing", STREAMING: "📡 Streaming" };
      return interaction.reply({ content: `✅ Activity set to **${typeLabel[type] ?? type} ${name}**.`, ephemeral: true });
    }

    if (commandName === "setinvitechannel") {
      const channel = interaction.options.getChannel("channel");
      setConfig({ inviteChannelId: channel.id });
      return interaction.reply({
        content: `✅ Staff invites will now be created for ${channel}. Each accepted applicant gets a unique 1-use link valid for 24 hours.`,
        ephemeral: true,
      });
    }

    // /setjointimeout
    if (commandName === "setjointimeout") {
      const durationStr = interaction.options.getString("duration");
      const ms          = parseDurationMs(durationStr);
      if (!ms) {
        return interaction.reply({
          content: "❌ Invalid duration. Use formats like `1m`, `30m`, `48h`, `7d`.",
          ephemeral: true,
        });
      }
      setConfig({ joinTimeoutMs: ms });
      const friendly = durationStr.endsWith("m")
        ? `${parseInt(durationStr)} minute${parseInt(durationStr) === 1 ? "" : "s"}`
        : durationStr.endsWith("h")
        ? `${parseInt(durationStr)} hour${parseInt(durationStr) === 1 ? "" : "s"}`
        : durationStr.endsWith("d")
        ? `${parseInt(durationStr)} day${parseInt(durationStr) === 1 ? "" : "s"}`
        : durationStr.endsWith("w")
        ? `${parseInt(durationStr)} week${parseInt(durationStr) === 1 ? "" : "s"}`
        : durationStr;
      log.info("CONFIG", `Join timeout set to ${ms}ms (${friendly}) by ${interaction.user.tag}`);
      return interaction.reply({
        content: `✅ Join alert timeout set to **${friendly}**. If an accepted applicant hasn't joined the staff server within that time, <@&${JOIN_ALERT_ROLE_ID}> will be pinged in <#${JOIN_ALERT_CHANNEL_ID}>.`,
        ephemeral: true,
      });
    }

    // /application
    if (commandName === "application") {
      const rawId  = interaction.options.getString("id").trim();
      const appRec = getAppById(rawId);
      if (!appRec) {
        return interaction.reply({
          content: `❌ No application found with ID \`${rawId.toUpperCase()}\`. IDs look like \`APP-ABC123\`.`,
          ephemeral: true,
        });
      }
      const meta        = ROLE_TYPES[appRec.roleType] || ROLE_TYPES.hr;
      const threadLink  = `https://discord.com/channels/${appRec.guildId}/${appRec.threadId}`;
      const embed = new EmbedBuilder()
        .setTitle(`${meta.emoji} Application \`${appRec.id}\``)
        .setColor(meta.color)
        .addFields(
          { name: "Applicant",   value: `<@${appRec.applicantId}> (${appRec.applicantTag})`, inline: false },
          { name: "Role",        value: `${meta.emoji} ${meta.label}`,                       inline: true  },
          { name: "Server",      value: appRec.sourceGuild,                                  inline: true  },
          { name: "Submitted",   value: `<t:${Math.floor(appRec.submittedAt / 1000)}:F>`,   inline: true  },
          { name: "Thread",      value: `[Jump to thread](${threadLink})`,                   inline: false },
        )
        .setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // /panel
    if (commandName === "panel") {
      const target   = interaction.options.getChannel("channel") ?? interaction.channel;
      const guildCfg = getGuild(guild.id);

      // Build disabled list from options; if an option wasn't provided, fall
      // back to whatever was already saved so re-running /panel doesn't reset choices.
      const prevDisabled = guildCfg?.disabledRoles ?? [];
      const roleKeys = ["hr", "mod", "partnership", "growth"];
      const disabled = roleKeys.filter((key) => {
        const opt = interaction.options.getBoolean(key);
        if (opt === null) return prevDisabled.includes(key); // not provided — keep existing
        return opt === false;                                 // false = exclude (disable)
      });

      const panelEmbed = buildPanelEmbed(guild, disabled);
      const row        = buildPanelRow(guild.id, disabled);

      if (!row.components.length) {
        return interaction.reply({ content: "❌ You disabled every role — enable at least one to post a panel.", ephemeral: true });
      }

      const sent = await target.send({ embeds: [panelEmbed], components: [row] });
      setGuildConfig(guild.id, { panelChannelId: target.id, panelMessageId: sent.id, disabledRoles: disabled });

      const included = roleKeys.filter(k => !disabled.includes(k)).join(", ") || "none";
      return interaction.reply({ content: `✅ Panel sent to ${target}.\n**Roles included:** ${included}`, ephemeral: true });
    }

    return;
  }

  // ── Button interactions ─────────────────────────────────────────────────────
  if (interaction.isButton()) {
    const { guild, user } = interaction;

    // ── Panel apply buttons (3 role types) ──
    const panelMap = {
      panel_apply_hr:          "hr",
      panel_apply_mod:         "mod",
      panel_apply_partnership: "partnership",
      panel_apply_growth:      "growth",
      apply_pick_hr:           "hr",
      apply_pick_mod:          "mod",
      apply_pick_partnership:  "partnership",
      apply_pick_growth:       "growth",
    };

    if (panelMap[interaction.customId]) {
      const roleType = panelMap[interaction.customId];
      const meta     = ROLE_TYPES[roleType];

      if (roleType === "growth" && !GROWTH_GUILD_IDS.has(guild.id)) {
        return interaction.reply({ content: "❌ The Growth Manager application is not available in this server.", ephemeral: true });
      }

      if (isBlacklisted(guild.id, user.id)) {
        return interaction.reply({ content: "🚫 You are blacklisted from submitting applications.", ephemeral: true });
      }

      const resolved = await resolveAppChannel(client, guild, getGuild(guild.id));
      if (!resolved) {
        return interaction.reply({
          content: "❌ No application channel configured. Ask an admin to run `/setstaffserver` in the staff server.",
          ephemeral: true,
        });
      }

      await interaction.reply({
        content: `${meta.emoji} Check your DMs — your **${meta.label}** application has started!`,
        ephemeral: true,
      });

      const result = await runApplication(client, user, guild, roleType);
      if (!result.ok && result.reason === "no_dm") {
        await interaction.editReply({ content: "❌ I couldn't DM you. Please enable DMs from server members and try again." });
      }
      return;
    }

    // ── Review buttons (accept / deny / blacklist) ──
    if (["app_accept", "app_deny", "app_blacklist"].includes(interaction.customId)) {
      const destGuild = interaction.guild;

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

      const sourceGuild2    = client.guilds.cache.find((g) => g.name === sourceGuildName);
      const serverEntry     = getServerConfig(sourceGuildName, sourceGuild2?.id);
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
        const roleTag = reviewerRoleId ? `<@&${reviewerRoleId}>` : "the correct reviewer role";
        return interaction.reply({
          content: `❌ You need the ${roleTag} role to manage applications from **${sourceGuildName}**.`,
          ephemeral: true,
        });
      }

      const msg            = interaction.message;
      const applicantMatch = msg.content.match(/\*\*Applicant:\*\* <@(\d+)>/);
      if (!applicantMatch) {
        return interaction.reply({ content: "❌ Could not determine the applicant from this message.", ephemeral: true });
      }

      const applicantId = applicantMatch[1];
      const reviewer    = interaction.user.tag;
      let applicantUser = null;
      try { applicantUser = await client.users.fetch(applicantId); } catch {}

      // Helper — posts a result card to the parent channel (visible outside the thread)
      const postResult = async (resultEmbed) => {
        const parentChannel = interaction.channel?.parent;
        if (parentChannel?.isTextBased()) {
          try { await parentChannel.send({ embeds: [resultEmbed] }); } catch {}
        }
      };

      if (interaction.customId === "app_accept") {
        const updated = EmbedBuilder.from(msg.embeds[0])
          .setColor(0x57f287)
          .setTitle(`✅ ${meta.label} Application Accepted — ${sourceGuildName}`);
        await msg.edit({ embeds: [updated], components: [buildReviewRow(true)] });
        await interaction.reply({ content: `✅ **${meta.label}** application **accepted** by ${reviewer}.` });
        try {
          await interaction.channel.edit({ locked: true, archived: true });
        } catch (err) {
          log.error("LOCK", "Failed to lock thread", err.message);
          await interaction.channel.send("⚠️ Could not lock this thread — make sure the bot has **Manage Threads** permission.").catch(() => {});
        }

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
        if (rolesGranted.length) {
          await interaction.channel.send(`✅ Roles granted in **${sourceGuildName}**: ${rolesGranted.join(", ")}`);
        }
        if (roleErrors.length) {
          await interaction.channel.send(`⚠️ Could not grant some roles in **${sourceGuildName}**: ${roleErrors.join(", ")} — check bot permissions and role IDs.`);
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
      }

      else if (interaction.customId === "app_deny") {
        const updated = EmbedBuilder.from(msg.embeds[0])
          .setColor(0xed4245)
          .setTitle(`❌ ${meta.label} Application Denied — ${sourceGuildName}`);
        await msg.edit({ embeds: [updated], components: [buildReviewRow(true)] });
        await interaction.reply({ content: `❌ **${meta.label}** application **denied** by ${reviewer}.` });
        try {
          await interaction.channel.edit({ locked: true, archived: true });
        } catch (err) {
          log.error("LOCK", "Failed to lock thread", err.message);
          await interaction.channel.send("⚠️ Could not lock this thread — make sure the bot has **Manage Threads** permission.").catch(() => {});
        }

        const resultEmbed = new EmbedBuilder()
          .setTitle(`❌ Application Denied`)
          .setColor(0xed4245)
          .addFields(
            { name: "Applicant", value: `<@${applicantId}>`, inline: true },
            { name: "Role",      value: `${meta.emoji} ${meta.label}`,    inline: true },
            { name: "Server",    value: sourceGuildName,                   inline: true },
            { name: "Reviewed by", value: reviewer,                        inline: true },
          )
          .setTimestamp();
        await postResult(resultEmbed);

        try {
          await applicantUser?.send(
            `❌ **Your ${meta.label} application has been denied.** ` +
            `Unfortunately your application to **${sourceGuildName}** was not accepted at this time. ` +
            `You're welcome to apply again in the future.`
          );
        } catch {}
      }

      else if (interaction.customId === "app_blacklist") {
        const sourceGuild = client.guilds.cache.find((g) => g.name === sourceGuildName);
        if (sourceGuild) addToBlacklist(sourceGuild.id, applicantId);

        const updated = EmbedBuilder.from(msg.embeds[0])
          .setColor(0x000000)
          .setTitle(`🚫 ${meta.label} Application Denied & Blacklisted — ${sourceGuildName}`);
        await msg.edit({ embeds: [updated], components: [buildReviewRow(true)] });
        await interaction.reply({ content: `🚫 **${meta.label}** application **denied & user blacklisted** by ${reviewer}.` });
        try {
          await interaction.channel.edit({ locked: true, archived: true });
        } catch (err) {
          log.error("LOCK", "Failed to lock thread", err.message);
          await interaction.channel.send("⚠️ Could not lock this thread — make sure the bot has **Manage Threads** permission.").catch(() => {});
        }

        const resultEmbed = new EmbedBuilder()
          .setTitle(`🚫 Application Denied & Blacklisted`)
          .setColor(0x000000)
          .addFields(
            { name: "Applicant", value: `<@${applicantId}>`, inline: true },
            { name: "Role",      value: `${meta.emoji} ${meta.label}`,    inline: true },
            { name: "Server",    value: sourceGuildName,                   inline: true },
            { name: "Reviewed by", value: reviewer,                        inline: true },
          )
          .setTimestamp();
        await postResult(resultEmbed);
        await sendBlacklistLog(client, {
          applicantId:     applicantId,
          applicantTag:    applicantUser?.tag,
          roleLabel:       meta.label,
          roleEmoji:       meta.emoji,
          sourceGuildName: sourceGuildName,
          moderator:       reviewer,
          appId:           appId,
        });

        try {
          await applicantUser?.send(
            `🚫 **Your ${meta.label} application has been denied** and you have been blacklisted ` +
            `from applying to **${sourceGuildName}** in the future.`
          );
        } catch {}
      }
    }
  }
});

// ─── Login ────────────────────────────────────────────────────────────────────

const token = process.env.DISCORD_TOKEN;
if (!token) {
  log.error("BOT", "DISCORD_TOKEN is not set — add it as a secret");
  process.exit(1);
}

client.login(token).catch((err) => {
  log.error("BOT", "Failed to login", err.message);
  process.exit(1);
});
