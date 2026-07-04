const fs   = require("fs");
const path = require("path");

// Every button handler lives in its own file and exports `{ matches, execute }`.
// This loader picks them all up automatically — adding a new button is just
// adding a new file here.

const SKIP = new Set(["index.js", "reviewShared.js"]);

const modules = fs
  .readdirSync(__dirname)
  .filter((f) => f.endsWith(".js") && !SKIP.has(f))
  .map((f) => require(path.join(__dirname, f)));

async function dispatchButton(interaction) {
  for (const mod of modules) {
    if (mod.matches(interaction.customId)) {
      await mod.execute(interaction);
      return true;
    }
  }
  return false;
}

module.exports = { dispatchButton };
