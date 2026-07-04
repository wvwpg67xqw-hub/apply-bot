const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");
const log = require("../utils/logger");
const { getConfig, setConfig } = require("../lib/db");
const { SA_GUILD_ID } = require("../lib/serverConfig");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("sethftoken")
    .setDescription("(Admin) Set the Hugging Face API token used for AI detection.")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addStringOption((o) =>
      o.setName("token")
        .setDescription("Your Hugging Face API token (hf_...).")
        .setRequired(true)
    ),

  async execute(interaction) {
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
  },
};
