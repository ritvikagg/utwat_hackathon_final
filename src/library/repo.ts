import * as localStore from './store.js';
import * as localRunLog from './runLog.js';
import type { PlaybookEntry, RunLogEntry } from '../types.js';

const HUB_URL = process.env.HIVEMIND_HUB_URL?.replace(/\/$/, '');
const API_TOKEN = process.env.HIVEMIND_API_TOKEN;

/**
 * Every agent process (yours, a teammate's) goes through this module instead
 * of touching store.ts/runLog.ts directly. With HIVEMIND_HUB_URL set, reads
 * and writes go to the shared hub server over HTTP — authenticated with
 * HIVEMIND_API_TOKEN (get one by logging into the dashboard) — so the whole
 * team sees the same library and activity feed, scoped to your group. Unset,
 * it falls back to the local JSON file under a fixed "default" group — same
 * behavior as before accounts/groups existed.
 *
 * In hub mode, the group a write lands in is always resolved server-side
 * from your token, never trusted from the client — see server/index.ts.
 * That means the groupId on entries built locally before an upsertPlaybook
 * call is really only meaningful in solo mode; in hub mode it's a
 * placeholder the server overwrites, not a value being asserted.
 */

function authHeaders(): Record<string, string> {
  return API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {};
}

export function localGroupId(): string {
  return localStore.DEFAULT_GROUP_ID;
}

export async function getPlaybook(
  domain: string,
  taskSignature: string,
  localGroupOverride?: string
): Promise<PlaybookEntry | undefined> {
  if (!HUB_URL) {
    return localStore.getPlaybook(
      localGroupOverride ?? localStore.DEFAULT_GROUP_ID,
      domain,
      taskSignature
    );
  }
  const res = await fetch(
    `${HUB_URL}/api/playbooks/${encodeURIComponent(domain)}/${encodeURIComponent(taskSignature)}`,
    { headers: authHeaders() }
  );
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`Hub getPlaybook failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function upsertPlaybook(entry: PlaybookEntry): Promise<void> {
  if (!HUB_URL) return localStore.upsertPlaybook(entry);
  const res = await fetch(`${HUB_URL}/api/playbooks`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(entry),
  });
  if (!res.ok) throw new Error(`Hub upsertPlaybook failed: ${res.status} ${await res.text()}`);
}

export async function recordRun(entry: RunLogEntry): Promise<void> {
  if (!HUB_URL) return localRunLog.recordRun(entry);
  const res = await fetch(`${HUB_URL}/api/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(entry),
  });
  if (!res.ok) throw new Error(`Hub recordRun failed: ${res.status} ${await res.text()}`);
}

/** Presence is a hub-only concept (there's no one else to show it to in solo
 *  mode) — best-effort and silent on failure, since a presence ping should
 *  never be the reason an actual task run fails. Only meaningful for the
 *  CLI: a dashboard-triggered run already has req.user in-process and marks
 *  presence directly in server/index.ts instead of round-tripping through
 *  this (the hub doesn't set HIVEMIND_HUB_URL on itself, so this would be a
 *  no-op for that path anyway). */
export async function setTaskRunning(running: boolean): Promise<void> {
  if (!HUB_URL) return;
  await fetch(`${HUB_URL}/api/presence/task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ running }),
  }).catch(() => {});
}
