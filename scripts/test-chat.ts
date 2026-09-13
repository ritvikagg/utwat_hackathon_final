import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hivemind-chat-test-'));
let hub: ChildProcess | null = null;
let origin = '';

async function startHub(): Promise<void> {
  const socket = net.createServer();
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  origin = 'http://127.0.0.1:' + port;
  hub = spawn(process.execPath, ['--import', path.join(root, 'node_modules/tsx/dist/loader.mjs'), path.join(root, 'server/index.ts')], {
    cwd: directory,
    env: { ...process.env, HUB_PORT: String(port), ANTHROPIC_API_KEY: 'test-key-not-used' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const child = hub;
  let output = '';
  child.stdout!.on('data', chunk => { output += chunk; });
  child.stderr!.on('data', chunk => { output += chunk; });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Hub did not start: ' + output)), 10000);
    child.once('exit', code => { clearTimeout(timeout); reject(new Error('Hub exited ' + code + ': ' + output)); });
    child.stdout!.on('data', () => {
      if (output.includes('Hivemind hub listening')) { clearTimeout(timeout); resolve(); }
    });
  });
}

async function stopHub(): Promise<void> {
  if (!hub) return;
  const child = hub;
  hub = null;
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>(resolve => { child.once('exit', () => resolve()); child.kill('SIGTERM'); });
}

async function api(endpoint: string, token?: string, body?: unknown, expected = 200) {
  const response = await fetch(origin + endpoint, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  assert.equal(response.status, expected, JSON.stringify(data));
  return data;
}

try {
  await startHub();
  const alice = await api('/api/auth/signup', undefined, { email: 'alice@example.com', password: 'test-password' });
  const bob = await api('/api/auth/signup', undefined, { email: 'bob@example.com', password: 'test-password' });
  const red = await api('/api/groups', alice.token, { name: 'Yellow team' });
  const blue = await api('/api/groups', bob.token, { name: 'Black team' });
  const redChat = '/api/groups/' + red.group.id + '/messages';
  const blueChat = '/api/groups/' + blue.group.id + '/messages';

  await api(redChat, undefined, undefined, 401);
  await api(redChat, undefined, { text: 'Unauthenticated' }, 401);
  await api(redChat, bob.token, undefined, 403);
  await api(redChat, bob.token, { text: 'Cross-group write' }, 403);
  assert.deepEqual(await api(redChat, alice.token), []);
  for (const text of ['', '   ', 123, null, 'a'.repeat(2001)]) {
    await api(redChat, alice.token, { text }, 400);
  }
  const first = await api(redChat, alice.token, {
    text: '  Hello team!\n<script>alert("hello")</script>  ',
    groupId: blue.group.id, authorId: bob.user.id, authorName: 'Spoofed',
  }, 201);
  assert.equal(first.groupId, red.group.id);
  assert.equal(first.authorId, alice.user.id);
  assert.equal(first.authorName, 'alice@example.com');
  assert.equal(first.text, 'Hello team!\n<script>alert("hello")</script>');
  assert(first.id && !Number.isNaN(Date.parse(first.createdAt)));
  assert.deepEqual(await api(blueChat, bob.token), []);
  await api('/api/groups/' + red.group.id + '/join', bob.token, {});
  assert.equal((await api(redChat, bob.token))[0].id, first.id);
  await api(redChat, bob.token, { text: 'Reply from Bob' }, 201);
  assert.deepEqual((await api(redChat, alice.token)).map((m: { text: string }) => m.text), [first.text, 'Reply from Bob']);
  await api(blueChat, bob.token, { text: 'Separate conversation' }, 201);
  assert.equal((await api(redChat, alice.token)).length, 2);
  assert.equal((await api(blueChat, bob.token)).length, 1);
  const logo = await fetch(origin + '/assets/hivemind-logo.png');
  assert.equal(logo.status, 200);
  assert.deepEqual(Buffer.from(await logo.arrayBuffer()), fs.readFileSync(path.join(root, 'server/public/assets/hivemind-logo.png')));
  const page = await (await fetch(origin)).text();
  assert(page.includes('id="chatForm"') && page.includes('src="/assets/hivemind-logo.png"'));

  await stopHub();
  await startHub();
  const persisted = await api(redChat, alice.token);
  assert.equal(persisted[0].id, first.id, 'Chat history must survive restart');
  assert.equal(persisted.length, 2);
  await api(redChat, alice.token, { text: 'a'.repeat(2000) }, 201);
  for (let i=0; i<101; i++) await api(redChat, alice.token, { text: 'History message ' + i }, 201);
  const recent = await api(redChat, alice.token);
  assert.equal(recent.length, 100);
  assert.equal(recent[0].text, 'History message 1');
  assert.equal(recent[99].text, 'History message 100');
  const stored = JSON.parse(fs.readFileSync(path.join(directory, 'data/chat', red.group.id + '.json'), 'utf8'));
  assert.equal(stored.length, 104, 'History outside the displayed window remains stored');
  console.log('PASS: authenticated/member-only chat, group isolation, server sender identity, input validation, chronological history, multi-user replies, durable restart, 100-message view without data loss, served logo and chat page.');
} finally {
  await stopHub();
  fs.rmSync(directory, { recursive: true, force: true });
}
