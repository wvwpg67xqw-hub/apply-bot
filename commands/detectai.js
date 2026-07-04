const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const log = require("../utils/logger");
const { detectAI } = require("../utils/aiDetector");
const { devLog } = require("../utils/devlog");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("detectai")
    .setDescription("Check whether a piece of text appears to be AI-generated.")
    .addStringOption((o) =>
      o.setName("text")
        .setDescription("The text to analyse (min 50 characters recommended).")
        .setRequired(true)
    ),

  async execute(interaction) {
    const { guild, client } = interaction;
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
  },
};
