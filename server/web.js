const express  = require("express");
const path     = require("path");
const { ChannelType } = require("discord.js");

const TEXT_TYPES = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.GuildForum,
]);

function startWebServer(client, port) {
  const app        = express();
  const sseClients = new Set();

  app.use(express.json());
  app.use(express.static(path.join(__dirname, "public")));

  // ── Real-time events via SSE ─────────────────────────────────────────────────
  app.get("/events", (req, res) => {
    res.setHeader("Content-Type",  "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection",    "keep-alive");
    res.flushHeaders();
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
  });

  function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sseClients) res.write(payload);
  }

  client.on("messageCreate", (msg) => {
    broadcast("message", {
      id:         msg.id,
      channelId:  msg.channelId,
      content:    msg.content,
      author:     msg.author.tag,
      authorId:   msg.author.id,
      avatar:     msg.author.displayAvatarURL({ size: 32 }),
      bot:        msg.author.bot,
      timestamp:  msg.createdTimestamp,
    });
  });

  // ── API: bot info ─────────────────────────────────────────────────────────────
  app.get("/api/me", (req, res) => {
    if (!client.user) return res.json({ error: "not ready" });
    res.json({
      tag:    client.user.tag,
      id:     client.user.id,
      avatar: client.user.displayAvatarURL({ size: 64 }),
    });
  });

  // ── API: guilds ───────────────────────────────────────────────────────────────
  app.get("/api/guilds", (req, res) => {
    const list = [...client.guilds.cache.values()].map((g) => ({
      id:          g.id,
      name:        g.name,
      icon:        g.iconURL({ size: 64 }) ?? null,
      memberCount: g.memberCount,
    }));
    res.json(list);
  });

  // ── API: channels for a guild ─────────────────────────────────────────────────
  app.get("/api/guilds/:guildId/channels", async (req, res) => {
    const guild = client.guilds.cache.get(req.params.guildId);
    if (!guild) return res.status(404).json({ error: "Guild not found" });

    const channels = [...guild.channels.cache.values()]
      .filter((c) => TEXT_TYPES.has(c.type))
      .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0))
      .map((c) => ({
        id:         c.id,
        name:       c.name,
        type:       c.type,
        parentName: c.parent?.name ?? null,
      }));
    res.json(channels);
  });

  // ── API: messages for a channel ───────────────────────────────────────────────
  app.get("/api/channels/:channelId/messages", async (req, res) => {
    try {
      const ch = await client.channels.fetch(req.params.channelId);
      if (!ch?.isTextBased()) return res.status(404).json({ error: "Not a text channel" });

      const limit = Math.min(parseInt(req.query.limit ?? "50", 10), 100);
      const msgs  = await ch.messages.fetch({ limit });
      const list  = [...msgs.values()].reverse().map((m) => ({
        id:        m.id,
        content:   m.content,
        author:    m.author.tag,
        authorId:  m.author.id,
        avatar:    m.author.displayAvatarURL({ size: 32 }),
        bot:       m.author.bot,
        timestamp: m.createdTimestamp,
        embeds:    m.embeds.length,
      }));
      res.json(list);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── API: send a message ───────────────────────────────────────────────────────
  app.post("/api/channels/:channelId/messages", async (req, res) => {
    try {
      const ch = await client.channels.fetch(req.params.channelId);
      if (!ch?.isTextBased()) return res.status(404).json({ error: "Not a text channel" });

      const { content, replyTo } = req.body;
      if (!content?.trim()) return res.status(400).json({ error: "Empty message" });

      let sent;
      if (replyTo) {
        const target = await ch.messages.fetch(replyTo).catch(() => null);
        sent = target ? await target.reply(content) : await ch.send(content);
      } else {
        sent = await ch.send(content);
      }
      res.json({ id: sent.id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── API: DM a user ────────────────────────────────────────────────────────────
  app.post("/api/dm/:userId", async (req, res) => {
    try {
      const user = await client.users.fetch(req.params.userId);
      const { content } = req.body;
      if (!content?.trim()) return res.status(400).json({ error: "Empty message" });
      await user.send(content);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.listen(port, "0.0.0.0", () => {
    console.log(`\x1b[36m[WEB]\x1b[0m Dashboard running → http://localhost:${port}`);
  });
}

module.exports = { startWebServer };
