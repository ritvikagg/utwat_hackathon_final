import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { hashPassword, verifyPassword } from './auth.js';
import type { User } from '../types.js';

const DB_PATH = path.join(process.cwd(), 'data', 'users.json');

function readAll(): User[] {
  if (!fs.existsSync(DB_PATH)) return [];
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

function writeAll(users: User[]): void {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(users, null, 2));
}

export function findUserByEmail(email: string): User | undefined {
  const needle = email.trim().toLowerCase();
  return readAll().find((u) => u.email.toLowerCase() === needle);
}

export function getUserById(id: string): User | undefined {
  return readAll().find((u) => u.id === id);
}

export function createUser(email: string, password: string): User {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) {
    throw new Error('A valid email is required.');
  }
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
  const users = readAll();
  if (users.some((u) => u.email.toLowerCase() === normalized)) {
    throw new Error('An account with that email already exists.');
  }
  const user: User = {
    id: crypto.randomUUID(),
    email: normalized,
    passwordHash: hashPassword(password),
    displayName: null,
    currentGroupId: null,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  writeAll(users);
  return user;
}

export function checkPassword(user: User, password: string): boolean {
  return verifyPassword(password, user.passwordHash);
}

export function setUserGroup(userId: string, groupId: string): void {
  const users = readAll();
  const user = users.find((u) => u.id === userId);
  if (!user) throw new Error('User not found.');
  user.currentGroupId = groupId;
  writeAll(users);
}

export function setDisplayName(userId: string, displayName: string): User {
  const trimmed = displayName.trim();
  if (!trimmed) throw new Error('Display name cannot be empty.');
  if (trimmed.length > 40) throw new Error('Display name must be 40 characters or fewer.');
  const users = readAll();
  const user = users.find((u) => u.id === userId);
  if (!user) throw new Error('User not found.');
  user.displayName = trimmed;
  writeAll(users);
  return user;
}
