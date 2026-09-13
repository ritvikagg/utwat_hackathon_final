import fs from 'node:fs';
import path from 'node:path';
import { generateToken } from './auth.js';

const DB_PATH = path.join(process.cwd(), 'data', 'sessions.json');

function readAll(): Record<string, string> {
  if (!fs.existsSync(DB_PATH)) return {};
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

function writeAll(sessions: Record<string, string>): void {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(sessions, null, 2));
}

export function createSession(userId: string): string {
  const sessions = readAll();
  const token = generateToken();
  sessions[token] = userId;
  writeAll(sessions);
  return token;
}

export function getUserIdForToken(token: string): string | undefined {
  return readAll()[token];
}

export function deleteSession(token: string): void {
  const sessions = readAll();
  delete sessions[token];
  writeAll(sessions);
}
