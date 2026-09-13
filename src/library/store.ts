import fs from 'node:fs';
import path from 'node:path';
import type { PlaybookEntry } from '../types.js';

const DB_PATH = path.join(process.cwd(), 'data', 'playbooks.json');

/** Used by solo (non-hub) runs, which have no account/group concept at all. */
export const DEFAULT_GROUP_ID = 'default';

function readAll(): PlaybookEntry[] {
  if (!fs.existsSync(DB_PATH)) return [];
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

function writeAll(entries: PlaybookEntry[]): void {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(entries, null, 2));
}

export function getPlaybook(
  groupId: string,
  domain: string,
  taskSignature: string
): PlaybookEntry | undefined {
  return readAll().find(
    (e) => e.groupId === groupId && e.domain === domain && e.taskSignature === taskSignature
  );
}

export function upsertPlaybook(entry: PlaybookEntry): void {
  const entries = readAll();
  const idx = entries.findIndex(
    (e) =>
      e.groupId === entry.groupId &&
      e.domain === entry.domain &&
      e.taskSignature === entry.taskSignature
  );
  if (idx >= 0) entries[idx] = entry;
  else entries.push(entry);
  writeAll(entries);
}

export function allPlaybooks(groupId: string): PlaybookEntry[] {
  return readAll().filter((e) => e.groupId === groupId);
}
