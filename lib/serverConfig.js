// ─── Role type metadata ───────────────────────────────────────────────────────

const SA_GUILD_ID = "1487744336908124190";
const GROWTH_GUILD_IDS = new Set([SA_GUILD_ID, "1487798778986758257"]);

// Role that, when granted, automatically removes a user from the blacklist.
const AUTO_UNBLACKLIST_ROLE = "1487774070094168135";

const ROLE_TYPES = {
  hr:          { label: "HR",                  emoji: "👥", color: 0x5865f2 },
  mod:         { label: "Moderator",           emoji: "🔨", color: 0xed4245 },
  partnership: { label: "Partnership Manager", emoji: "🤝", color: 0xfee75c },
  growth:      { label: "Growth Manager",      emoji: "📈", color: 0x57f287 },
};

// ─── Per-server blacklist role IDs ────────────────────────────────────────────
// Each server has its own dedicated constant so it can be found and fixed
// independently without touching the others.

const BLACKLIST_ROLE_PLAIN_PROMOTIONS    = "1522845818359644200";
const BLACKLIST_ROLE_ADVERTISING_LEGENDS = "1522846270371135680";
const BLACKLIST_ROLE_DEVIL_ADVERTISING   = "1522846473283174430";
const BLACKLIST_ROLE_SHADOW_ADVERTISING  = "1522846909968945162";

// ─── Per-server reviewer role IDs ─────────────────────────────────────────────
// Same principle — one constant per server.

const REVIEWER_ROLE_PLAIN_PROMOTIONS    = "1488370139286995135";
const REVIEWER_ROLE_ADVERTISING_LEGENDS = "1488375799819276358";
const REVIEWER_ROLE_DEVIL_ADVERTISING   = "1488370171293733000";
const REVIEWER_ROLE_SHADOW_ADVERTISING  = "1488369842225680465";

// ─── Per-server config map ────────────────────────────────────────────────────

const SERVER_CONFIG_MAP = [
  {
    match:          "plain promotions",
    channelName:    "plain-promotions-apps",
    channelNames:   ["plain-promotions-apps", "plain-promotions", "pp-apps"],
    roleName:       "Plain Promotions Apps",
    reviewerRoleId: REVIEWER_ROLE_PLAIN_PROMOTIONS,
    blacklistRoleId: BLACKLIST_ROLE_PLAIN_PROMOTIONS,
  },
  {
    match:          "advertising legends",
    channelName:    "advertising-legends-apps",
    channelNames:   ["advertising-legends-apps", "advertising-legends", "al-apps"],
    roleName:       "Advertising Legends Apps",
    reviewerRoleId: REVIEWER_ROLE_ADVERTISING_LEGENDS,
    blacklistRoleId: BLACKLIST_ROLE_ADVERTISING_LEGENDS,
  },
  {
    match:          "devil advertising",
    channelName:    "devil-advertising-apps",
    channelNames:   ["devil-advertising-apps", "devil-advertising", "da-apps"],
    roleName:       "Devil Advertising Apps",
    reviewerRoleId: REVIEWER_ROLE_DEVIL_ADVERTISING,
    blacklistRoleId: BLACKLIST_ROLE_DEVIL_ADVERTISING,
  },
  {
    match:          "shadow advertising",
    guildIds:       ["1487798778986758257"],
    channelName:    "shadow-advertising-apps",
    channelNames:   ["shadow-advertising-apps", "shadow-advertising", "sa-apps"],
    roleName:       "Shadow Advertising Apps",
    reviewerRoleId: REVIEWER_ROLE_SHADOW_ADVERTISING,
    blacklistRoleId: BLACKLIST_ROLE_SHADOW_ADVERTISING,
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

module.exports = {
  SA_GUILD_ID, GROWTH_GUILD_IDS, AUTO_UNBLACKLIST_ROLE,
  ROLE_TYPES, SERVER_CONFIG_MAP, getServerConfig,
  BLACKLIST_ROLE_PLAIN_PROMOTIONS, BLACKLIST_ROLE_ADVERTISING_LEGENDS,
  BLACKLIST_ROLE_DEVIL_ADVERTISING, BLACKLIST_ROLE_SHADOW_ADVERTISING,
  REVIEWER_ROLE_PLAIN_PROMOTIONS, REVIEWER_ROLE_ADVERTISING_LEGENDS,
  REVIEWER_ROLE_DEVIL_ADVERTISING, REVIEWER_ROLE_SHADOW_ADVERTISING,
};
