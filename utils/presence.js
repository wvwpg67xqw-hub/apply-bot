const fs          = require("fs");
const path        = require("path");
const { ActivityType } = require("discord.js");

const STATUS_PATH   = path.resolve(__dirname, "../data/status.json");
const ACTIVITY_PATH = path.resolve(__dirname, "../data/activity.json");

// ActivityType.Custom is NOT supported for bots — only these work:
const TYPE_MAP = {
  PLAYING:   ActivityType.Playing,
  WATCHING:  ActivityType.Watching,
  LISTENING: ActivityType.Listening,
  COMPETING: ActivityType.Competing,
  STREAMING: ActivityType.Streaming,
};

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch { return {}; }
}

function applyPresence(client) {
  if (!client.user) return;

  const statusData   = readJson(STATUS_PATH);
  const activityData = readJson(ACTIVITY_PATH);

  const status   = statusData.status ?? "online";
  const typeName = (activityData.type ?? "WATCHING").toUpperCase();
  const name     = activityData.name ?? "";
  const url      = activityData.url  ?? "";

  const activityType = TYPE_MAP[typeName] ?? ActivityType.Watching;

  const activities = name ? [{
    name,
    type: activityType,
    ...(activityType === ActivityType.Streaming && url ? { url } : {}),
  }] : [];

  client.user.setPresence({ status, activities });
  console.log(`\x1b[35m[PRESENCE]\x1b[0m Status: ${status} | ${typeName} ${name}`);
}

function watchPresence(client) {
  applyPresence(client);

  let debounce = null;
  const onChange = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => applyPresence(client), 300);
  };

  fs.watch(STATUS_PATH,   onChange);
  fs.watch(ACTIVITY_PATH, onChange);
}

module.exports = { watchPresence, applyPresence };
