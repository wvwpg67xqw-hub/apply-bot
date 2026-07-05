'use strict';

const express = require('express');
const path = require('path');

const config = require('./config');
async function getStaffGuildId() { return config.getStaffGuildId(); }
const PORT = process.env.ADBOT_PORT || 3001;

const CHANNEL_FIELDS = [
  { key: 'general_log_channel', label: 'General Log Channel' },
  { key: 'warn_log_channel', label: 'Warn Log Channel' },
  { key: 'ad_warn_log_channel', label: 'Ad-Warn Log Channel' },
  { key: 'ban_request_channel', label: 'Ban Request Channel' },
  { key: 'blacklist_request_channel', label: 'Blacklist Request Channel' },
  { key: 'network_ban_request_channel', label: 'Network Ban Request Channel' },
  { key: 'partnership_request_channel', label: 'Partnership Request Channel' },
  { key: 'partnership_accepted_channel', label: 'Partnership Accepted Channel' },
];

const ROLE_FIELDS = [
  { key: 'jail_role', label: 'Jail Role' },
];

const COMMAND_GROUPS = [
  {
    name: 'Moderation',
    commands: [
      'warn',
      'warns',
      'warn-leaderboard',
      'ad-warn',
      'remove-ad-warn',
      'mute',
      'unmute',
      'ban',
      'strike',
      'strike-remove',
    ],
  },
  {
    name: 'Jail',
    commands: ['jail', 'unjail'],
  },
  {
    name: 'Requests',
    commands: [
      'ban-request',
      'blacklist-request',
      'network-ban-request',
      'partnership-request',
    ],
  },
  {
    name: 'Stats & Utility',
    commands: [
      'messages',
      'message-leaderboard',
      'case-info',
      'balance',
      'snipe',
      'current-breaks',
    ],
  },
  {
    name: 'Break System',
    commands: ['request-break', 'break-end'],
  },
  {
    name: 'Staff Actions',
    commands: [
      'fire',
      'promote',
      'demote-user',
      'reset-messages',
      'reset-messages-all',
    ],
  },
  {
    name: 'Setup',
    commands: [
      'setup',
      'setup-roles',
      'setup-roles-extra',
      'setup-status',
      'setup-edit',
    ],
  },
];

module.exports = function startWebServer(client, db) {
  const app = express();

  app.use(express.json());

  app.use(
    express.static(path.join(__dirname, '..', 'public'))
  );

  // ─────────────────────────────────────────────
  // ROOT
  // ─────────────────────────────────────────────

  app.get('/', (_req, res) => {
    res.sendFile(
      path.join(__dirname, '..', 'public', 'index.html')
    );
  });

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      bot: client.user?.tag || 'offline',
    });
  });

  // ─────────────────────────────────────────────
  // ALL GUILDS
  // ─────────────────────────────────────────────

  app.get('/api/guilds', async (_req, res) => {
    try {
      const staffGuildId = await getStaffGuildId();
      const mainGuildIds = new Set([
        ...(process.env.MAIN_GUILD_IDS ||
          process.env.MAIN_GUILD_ID ||
          '')
          .split(',')
          .map(s => s.trim())
          .filter(Boolean),

        ...(await db.getMainGuildIds()),
      ]);

      const guilds = await Promise.all([...client.guilds.cache.values()]
        .map(async g => {
          const cfg = await db.getGuild(g.id);

          let type = cfg?.type || 'network';

          if (g.id === staffGuildId) {
            type = 'staff';
          } else if (mainGuildIds.has(g.id)) {
            type = 'main';
          }

          return {
            id: g.id,
            name: g.name,
            icon: g.iconURL?.({ size: 128 }) || null,
            type,
            memberCount: g.memberCount || 0,
          };
        }));
      guilds.sort((a, b) => {
          const order = {
            staff: 0,
            main: 1,
            network: 2,
          };

          return (
            (order[a.type] ?? 3) -
              (order[b.type] ?? 3) ||
            a.name.localeCompare(b.name)
          );
        });

      res.json(guilds);
    } catch (err) {
      console.error('[API guilds]', err);

      res.status(500).json({
        error: 'Failed to fetch guilds',
      });
    }
  });

  // ─────────────────────────────────────────────
  // SINGLE GUILD
  // ─────────────────────────────────────────────

  app.get('/api/guild/:id', async (req, res) => {
    const { id } = req.params;

    const guild = client.guilds.cache.get(id);

    if (!guild) {
      return res.status(404).json({
        error: 'Bot is not in this server',
      });
    }

    try {
      const channels = await guild.channels.fetch();
      const roles = await guild.roles.fetch();

      const textChannels = [...channels.values()]
        .filter(c => c && [0, 5].includes(c.type))
        .map(c => ({
          id: c.id,
          name: c.name,
        }))
        .sort((a, b) =>
          a.name.localeCompare(b.name)
        );

      const guildRoles = [...roles.values()]
        .filter(
          r =>
            r &&
            !r.managed &&
            r.id !== guild.id
        )
        .map(r => ({
          id: r.id,
          name: r.name,
          color: r.hexColor,
          position: r.rawPosition,
        }))
        .sort((a, b) => b.position - a.position);

      const cfg =
        await db.getGuild(id) || {};

      const permissions =
        await db.getGuildCommandPermissions(id);

      let type =
        cfg.type || 'network';

      if (id === (await getStaffGuildId())) {
        type = 'staff';
      }

      res.json({
        id,
        name: guild.name,
        icon: guild.iconURL({
          size: 128,
        }),
        type,
        config: cfg,
        channels: textChannels,
        roles: guildRoles,
        permissions,
        channelFields: CHANNEL_FIELDS,
        roleFields: ROLE_FIELDS,
        commandGroups: COMMAND_GROUPS,
      });
    } catch (err) {
      console.error('[API guild]', err);

      res.status(500).json({
        error: 'Failed to fetch guild data',
      });
    }
  });

  // ─────────────────────────────────────────────
  // SAVE CONFIG
  // ─────────────────────────────────────────────

  app.post('/api/guild/:id/config', (req, res) => {
    const { id } = req.params;

    if (!client.guilds.cache.has(id)) {
      return res.status(404).json({
        error: 'Guild not found',
      });
    }

    try {
      const allowed = [
        'type',
        ...CHANNEL_FIELDS.map(f => f.key),
        ...ROLE_FIELDS.map(f => f.key),
      ];

      const data = {};

      for (const key of allowed) {
        if (
          Object.prototype.hasOwnProperty.call(
            req.body,
            key
          )
        ) {
          data[key] =
            req.body[key] || null;
        }
      }

      await db.upsertGuild(id, data);

      res.json({
        success: true,
      });
    } catch (err) {
      console.error('[SAVE CONFIG]', err);

      res.status(500).json({
        error: 'Failed to save config',
      });
    }
  });

  // ─────────────────────────────────────────────
  // SAVE PERMISSIONS
  // ─────────────────────────────────────────────

  app.post(
    '/api/guild/:id/permissions/batch',
    (req, res) => {
      const { id } = req.params;

      if (!client.guilds.cache.has(id)) {
        return res.status(404).json({
          error: 'Guild not found',
        });
      }

      try {
        const { permissions } = req.body;

        if (
          !permissions ||
          typeof permissions !== 'object'
        ) {
          return res.status(400).json({
            error:
              'Invalid permissions object',
          });
        }

        for (const [
          command,
          roleIds,
        ] of Object.entries(
          permissions
        )) {
          const field =
            command.replace(/-/g, '_') +
            '_roles';

          await db.setGuildRoles(
            id,
            field,
            Array.isArray(roleIds)
              ? roleIds
              : []
          );
        }

        res.json({
          success: true,
        });
      } catch (err) {
        console.error(
          '[SAVE PERMISSIONS]',
          err
        );

        res.status(500).json({
          error:
            'Failed to save permissions',
        });
      }
    }
  );

  // ─────────────────────────────────────────────
  // START SERVER
  // ─────────────────────────────────────────────

  if (global.__WEB_SERVER_RUNNING__) {
    console.log(
      '[Dashboard] Web server already running'
    );

    return;
  }

  global.__WEB_SERVER_RUNNING__ = true;

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `[Dashboard] Running on port ${PORT}`
    );
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[Dashboard] Port ${PORT} already in use`
      );
    } else {
      console.error(
        '[Dashboard] Server error:',
        err
      );
    }
  });

  return server;
};