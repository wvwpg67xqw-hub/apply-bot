const log = require("../utils/logger");
const { getPendingJoins, removePendingJoin, getJoinTimeoutMs } = require("./db");

const JOIN_ALERT_ROLE_ID    = "1521652278694514843";
const JOIN_ALERT_CHANNEL_ID = "1519706422735274195";

// ─── Pending join watcher ─────────────────────────────────────────────────────
// Alerts staff if an accepted applicant hasn't joined the staff server in time.

async function startJoinWatcher(client) {
  setInterval(async () => {
    const list    = await getPendingJoins();
    const timeout = await getJoinTimeoutMs();
    const now     = Date.now();
    const expired = list.filter((e) => now - e.invitedAt >= timeout);
    if (!expired.length) return;

    let alertChannel = null;
    try {
      alertChannel = await client.channels.fetch(JOIN_ALERT_CHANNEL_ID);
    } catch {
      log.warn("JOIN_WATCH", `Could not fetch alert channel ${JOIN_ALERT_CHANNEL_ID}`);
      return;
    }
    if (!alertChannel?.isTextBased()) return;

    for (const entry of expired) {
      const hoursAgo = Math.round((now - entry.invitedAt) / 3_600_000);
      try {
        await alertChannel.send(
          `<@&${JOIN_ALERT_ROLE_ID}> ⚠️ **${entry.applicantTag ?? `<@${entry.userId}>`}** was accepted for **${entry.roleType?.toUpperCase() ?? "Staff"}** from **${entry.sourceGuildName}** but has not joined the staff server in **${hoursAgo} hour${hoursAgo === 1 ? "" : "s"}**.`
        );
        log.info("JOIN_WATCH", `Alerted: ${entry.applicantTag ?? entry.userId} not joined after ${hoursAgo}h`);
      } catch (err) {
        log.error("JOIN_WATCH", "Failed to send join alert", err.message);
      }
      await removePendingJoin(entry.userId);
    }
  }, 60_000);

  log.info("JOIN_WATCH", `Join watcher started — timeout: ${(await getJoinTimeoutMs()) / 60_000} min`);
}

module.exports = { startJoinWatcher, JOIN_ALERT_ROLE_ID, JOIN_ALERT_CHANNEL_ID };
