// In-memory only, deliberately not persisted to disk — presence is
// inherently transient (a hub restart legitimately means "everyone's
// offline until they reconnect"), and losing it on restart is the correct
// behavior, not a bug to work around.

interface PresenceRecord {
  lastSeenAt: number;
  taskRunning: boolean;
}

const presence = new Map<string, PresenceRecord>();

// Dashboard polls every 4s; a couple of missed beats shouldn't flip someone
// to "offline" as long as their tab is genuinely still open.
const ONLINE_WINDOW_MS = 15000;

export function heartbeat(userId: string): void {
  const existing = presence.get(userId);
  presence.set(userId, { lastSeenAt: Date.now(), taskRunning: existing?.taskRunning ?? false });
}

export function markTaskRunning(userId: string, running: boolean): void {
  presence.set(userId, { lastSeenAt: Date.now(), taskRunning: running });
}

export function getPresence(userId: string): { online: boolean; taskRunning: boolean } {
  const record = presence.get(userId);
  if (!record) return { online: false, taskRunning: false };
  // A CLI-triggered task only ever sends one heartbeat-equivalent, at
  // start — a cold run commonly takes well over ONLINE_WINDOW_MS to finish,
  // which would otherwise show someone as "offline" while their spinner is
  // still spinning. An in-flight task is definitionally "this person is
  // active right now," regardless of how stale the raw timestamp looks.
  const recentlySeen = Date.now() - record.lastSeenAt < ONLINE_WINDOW_MS;
  return {
    online: recentlySeen || record.taskRunning,
    taskRunning: record.taskRunning,
  };
}
