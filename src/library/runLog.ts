import fs from 'node:fs';
import path from 'node:path';
import type { RunLogEntry } from '../types.js';

const DB_PATH = path.join(process.cwd(), 'data', 'runs.json');
const MAX_ENTRIES = 500;

function readAll(): RunLogEntry[] {
  if (!fs.existsSync(DB_PATH)) return [];
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

function writeAll(entries: RunLogEntry[]): void {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(entries, null, 2));
}

export function recordRun(entry: RunLogEntry): void {
  const entries = readAll();
  entries.push(entry);
  writeAll(entries.slice(-MAX_ENTRIES));
}

export function recentRuns(groupId: string, limit = 50): RunLogEntry[] {
  const entries = readAll().filter((e) => e.groupId === groupId);
  return entries.slice(-limit).reverse();
}
