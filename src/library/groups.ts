import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Group } from '../types.js';

const DB_PATH = path.join(process.cwd(), 'data', 'groups.json');

function readAll(): Group[] {
  if (!fs.existsSync(DB_PATH)) return [];
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

function writeAll(groups: Group[]): void {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(groups, null, 2));
}

export function listGroups(query?: string): Group[] {
  const groups = readAll();
  if (!query) return groups;
  const q = query.trim().toLowerCase();
  return groups.filter((g) => g.name.toLowerCase().includes(q));
}

export function getGroup(id: string): Group | undefined {
  return readAll().find((g) => g.id === id);
}

export function createGroup(name: string, creatorUserId: string): Group {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Group name is required.');
  const groups = readAll();
  if (groups.some((g) => g.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error('A group with that name already exists — join it instead.');
  }
  const group: Group = {
    id: crypto.randomUUID(),
    name: trimmed,
    createdAt: new Date().toISOString(),
    memberUserIds: [creatorUserId],
  };
  groups.push(group);
  writeAll(groups);
  return group;
}

export function joinGroup(groupId: string, userId: string): Group {
  const groups = readAll();
  const group = groups.find((g) => g.id === groupId);
  if (!group) throw new Error('Group not found.');
  if (!group.memberUserIds.includes(userId)) {
    group.memberUserIds.push(userId);
    writeAll(groups);
  }
  return group;
}
