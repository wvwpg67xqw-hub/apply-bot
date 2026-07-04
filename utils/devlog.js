const { EmbedBuilder } = require("discord.js");
const { read } = require("./jsondb");

const CONFIG_PATH = "./data/config.json";

const CHANNEL_COLORS = {
  devLogs:     0x5865f2,
  devErrors:   0xed4245,
  devTesting:  0x57f287,
  devData:     0xfee75c,
  devControl:  0xeb459e,
  devTools:    0x9b59b6,
  devAiErrors: 0xff6b35,
};

async function devLog(client, channelKey, { title, description = null, fields = [], color = null }) {
  if (!client?.isReady()) return;
  const cfg = read(CONFIG_PATH) || {};
  const channelId = cfg.devChannels?.[channelKey];
  if (!channelId) return;

  try {
    const ch = await client.channels.fetch(channelId);
    if (!ch?.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(color ?? CHANNEL_COLORS[channelKey] ?? 0x5865f2)
      .setTimestamp();

    if (description) embed.setDescription(description);
    if (fields.length) embed.addFields(fields);

    await ch.send({ embeds: [embed] });
  } catch {
    // Never crash the bot if dev logging fails
  }
}

module.exports = { devLog };
