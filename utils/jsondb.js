const fs = require("fs");

function read(path) {
  if (!fs.existsSync(path)) fs.writeFileSync(path, "[]");
  return JSON.parse(fs.readFileSync(path));
}

function write(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

module.exports = { read, write };