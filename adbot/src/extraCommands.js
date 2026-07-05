'use strict';

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const BREAK_REQUEST_CHANNEL_ID =
  '1502595936952516709';

const MIN_MS =
  3 * 24 * 60 * 60 * 1000; // 3 days

// ── TIME PARSER ───────────────────────────────
function parseTime(input) {
  if (!input) return null;

  const match = input.match(/^(\d+)(d|h)$/i);
  if (!match) return null;

  const value = parseInt(match[1]);
  const unit = match[2].toLowerCase();

  if (unit === 'd') return value * 24 * 60 * 60 * 1000;
  if (unit === 'h') return value * 60 * 60 * 1000;

  return null;
}

module.exports = [

  // ─────────────────────────────────────────────
  // /request-break
  // ─────────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('request-break')
      .setDescription('Request a staff break')
      .addStringOption(option =>
        option
          .setName('reason')
          .setDescription('Reason for break')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('time')
          .setDescription('Duration (min 3d, example: 3d, 5d, 7d)')
          .setRequired(true)
      ),

    async execute(interaction, db, utils, client) {

      const reason =
        interaction.options.getString('reason');

      const time =
        interaction.options.getString('time');

      const duration =
        parseTime(time);

      // ❌ invalid format
      if (!duration) {
        return interaction.reply({
          content:
            '❌ Invalid time format. Use `3d`, `5d`, `7d`.',
          ephemeral: true
        });
      }

      // ❌ minimum 3 days
      if (duration < MIN_MS) {
        return interaction.reply({
          content:
            '❌ Minimum break is **3 days**.',
          ephemeral: true
        });
      }

      const endTime =
        Date.now() + duration;

      const channel =
        await client.channels
          .fetch(BREAK_REQUEST_CHANNEL_ID)
          .catch(() => null);

      if (!channel) {
        return interaction.reply({
          content:
            '❌ Break request channel not found.',
          ephemeral: true
        });
      }

      const embed =
        new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('📩 Break Request')
          .addFields(
            {
              name: 'Staff Member',
              value: `${interaction.user}`
            },
            {
              name: 'Reason',
              value: reason
            },
            {
              name: 'Duration',
              value: time
            },
            {
              name: 'Ends At',
              value: `<t:${Math.floor(endTime / 1000)}:F>`
            }
          )
          .setFooter({
            text: `User ID: ${interaction.user.id}`
          })
          .setTimestamp();

      // IMPORTANT FORMAT:
      // break_accept_userId_endTime
      const row =
        new ActionRowBuilder()
          .addComponents(

            new ButtonBuilder()
              .setCustomId(
                `break_accept_${interaction.user.id}_${endTime}`
              )
              .setLabel('Accept')
              .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
              .setCustomId(
                `break_deny_${interaction.user.id}`
              )
              .setLabel('Deny')
              .setStyle(ButtonStyle.Danger)
          );

      await channel.send({
        embeds: [embed],
        components: [row]
      });

      return interaction.reply({
        content:
          '✅ Break request sent to staff.',
        ephemeral: true
      });
    }
  }
];