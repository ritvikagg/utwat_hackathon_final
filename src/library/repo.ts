import * as localStore from './store.js';
import * as localRunLog from './runLog.js';
import type { PlaybookEntry, RunLogEntry } from '../types.js';

const HUB_URL = process.env.HIVEMIND_HUB_URL?.replace(/\/$/, '');

/**
 * Every agent process (yours, a teammate's) goes through this module instead
 * of touching store.ts/runLog.ts directly. With HIVEMIND_HUB_URL set, reads
 * and writes go to the shared hub server over HTTP so the whole team sees
 * the same library and activity feed. Unset, it falls back to the local
 * JSON file — same behavior as before the hub existed.
 */

export async function getPlaybook(
  domain: string,
  taskSignature: string
): Promise<PlaybookEntry | undefined> {
  if (!HUB_URL) return localStore.getPlaybook(domain, taskSignature);
  const res = await fetch(
    `${HUB_URL}/api/playbooks/${encodeURIComponent(domain)}/${encodeURIComponent(taskSignature)}`
  );
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`Hub getPlaybook failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function upsertPlaybook(entry: PlaybookEntry): Promise<void> {
  if (!HUB_URL) return localStore.upsertPlaybook(entry);
  const res = await fetch(`${HUB_URL}/api/playbooks`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  });
  if (!res.ok) throw new Error(`Hub upsertPlaybook failed: ${res.status} ${await res.text()}`);
}

export async function recordRun(entry: RunLogEntry): Promise<void> {
  if (!HUB_URL) return localRunLog.recordRun(entry);
  const res = await fetch(`${HUB_URL}/api/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  });
  if (!res.ok) throw new Error(`Hub recordRun failed: ${res.status} ${await res.text()}`);
}

export function usingHub(): boolean {
  return Boolean(HUB_URL);
}

/** Hands a just-finished session off to the hub to fetch its trace (needs
 *  the `steel` CLI, which only the hub is required to have) and fold it
 *  into the shared library. Only valid when usingHub() is true. */
export async function compileViaHub(
  sessionId: string,
  domain: string,
  taskSignature: string,
  typedValues: string[] = []
): Promise<PlaybookEntry | null> {
  const res = await fetch(`${HUB_URL}/api/tasks/distill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, domain, taskSignature, typedValues }),
  });
  if (!res.ok) throw new Error(`Hub compileViaHub failed: ${res.status} ${await res.text()}`);
  return res.json();
}
