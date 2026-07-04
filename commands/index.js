const fs   = require("fs");
const path = require("path");

// Every command lives in its own file in this directory and exports
// `{ data, execute }`. This loader picks them all up automatically —
// adding a new command is just adding a new file here.

const commands = new Map();

for (const file of fs.readdirSync(__dirname)) {
  if (file === "index.js" || !file.endsWith(".js")) continue;
  const cmd = require(path.join(__dirname, file));
  if (!cmd?.data?.name || typeof cmd.execute !== "function") continue;
  commands.set(cmd.data.name, cmd);
}

const commandsJson = [...commands.values()].map((c) => c.data.toJSON());

module.exports = { commands, commandsJson };
