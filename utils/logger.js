const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const COLORS = {
  DEBUG: "\x1b[36m",
  INFO:  "\x1b[32m",
  WARN:  "\x1b[33m",
  ERROR: "\x1b[31m",
  RESET: "\x1b[0m",
};

function timestamp() {
  return new Date().toISOString();
}

function format(level, tag, message, data) {
  const color = COLORS[level] || "";
  const reset = COLORS.RESET;
  const base  = `${color}[${timestamp()}] [${level}] [${tag}]${reset} ${message}`;
  if (data !== undefined) {
    const extra = typeof data === "object" ? JSON.stringify(data, null, 2) : data;
    return `${base}\n${extra}`;
  }
  return base;
}

const logger = {
  debug: (tag, message, data) => console.debug(format("DEBUG", tag, message, data)),
  info:  (tag, message, data) => console.log(format("INFO",  tag, message, data)),
  warn:  (tag, message, data) => console.warn(format("WARN",  tag, message, data)),
  error: (tag, message, data) => console.error(format("ERROR", tag, message, data)),
};

module.exports = logger;
