import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { getPlaybook, upsertPlaybook, allPlaybooks } from '../src/library/store.js';
import { recordRun, recentRuns } from '../src/library/runLog.js';
import {
  createUser,
  findUserByEmail,
  checkPassword,
  getUserById,
  setUserGroup,
  setDisplayName,
} from '../src/library/users.js';
import { createGroup, joinGroup, listGroups, getGroup } from '../src/library/groups.js';
import { createSession, getUserIdForToken, deleteSession } from '../src/library/sessions.js';
import { heartbeat, markTaskRunning, getPresence } from '../src/library/presence.js';
import { runTask } from '../src/runTask.js';
import type { RunLogEntry, User } from '../src/types.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.HUB_PORT) || 4001;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function publicUser(user: User) {
  const group = user.currentGroupId ? getGroup(user.currentGroupId) : undefined;
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    currentGroupId: user.currentGroupId,
    currentGroupName: group?.name ?? null,
  };
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Not logged in.' });
    return;
  }
  const userId = getUserIdForToken(token);
  const user = userId ? getUserById(userId) : undefined;
  if (!user) {
    res.status(401).json({ error: 'Invalid or expired session.' });
    return;
  }
  req.user = user;
  next();
}

function requireGroup(req: Request, res: Response, next: NextFunction): void {
  if (!req.user?.currentGroupId) {
    res.status(403).json({ error: 'Join a group first.' });
    return;
  }
  next();
}

// --- Auth ---

app.post('/api/auth/signup', (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }
  try {
    const user = createUser(email, password);
    const token = createSession(user.id);
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }
  const user = findUserByEmail(email);
  if (!user || !checkPassword(user, password)) {
    res.status(401).json({ error: 'Incorrect email or password.' });
    return;
  }
  const token = createSession(user.id);
  res.json({ token, user: publicUser(user) });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) deleteSession(token);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user!) });
});

app.put('/api/auth/display-name', requireAuth, (req, res) => {
  const { displayName } = req.body as { displayName?: string };
  if (!displayName) {
    res.status(400).json({ error: 'Display name is required.' });
    return;
  }
  try {
    const updated = setDisplayName(req.user!.id, displayName);
    res.json({ user: publicUser(updated) });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// --- Groups ---

app.get('/api/groups', requireAuth, (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : undefined;
  const groups = listGroups(q).map((g) => ({
    id: g.id,
    name: g.name,
    memberCount: g.memberUserIds.length,
    isMember: g.memberUserIds.includes(req.user!.id),
  }));
  res.json(groups);
});

app.post('/api/groups', requireAuth, (req, res) => {
  const { name } = req.body as { name?: string };
  if (!name) {
    res.status(400).json({ error: 'Group name is required.' });
    return;
  }
  try {
    const group = createGroup(name, req.user!.id);
    setUserGroup(req.user!.id, group.id);
    res.json({ group, user: publicUser(getUserById(req.user!.id)!) });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/groups/:id/join', requireAuth, (req, res) => {
  try {
    const group = joinGroup(String(req.params.id), req.user!.id);
    setUserGroup(req.user!.id, group.id);
    res.json({ group, user: publicUser(getUserById(req.user!.id)!) });
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

// --- Presence (who's online / has a task running, within your group) ---

// The dashboard calls this on every poll tick — cheap, no group check needed
// since it just timestamps "this user is around," independent of which
// group they're currently viewing.
app.post('/api/presence/heartbeat', requireAuth, (req, res) => {
  heartbeat(req.user!.id);
  res.json({ ok: true });
});

// Called by the CLI (via repo.ts's setTaskRunning) at the start and end of a
// task run, so a teammate running something from their own terminal shows
// the same spinner a dashboard-triggered run would.
app.post('/api/presence/task', requireAuth, (req, res) => {
  const { running } = req.body as { running?: boolean };
  markTaskRunning(req.user!.id, Boolean(running));
  res.json({ ok: true });
});

app.get('/api/presence', requireAuth, requireGroup, (req, res) => {
  const group = getGroup(req.user!.currentGroupId!);
  const members = (group?.memberUserIds ?? [])
    .map((id) => getUserById(id))
    .filter((u): u is User => Boolean(u))
    .map((u) => ({
      name: u.displayName || u.email,
      ...getPresence(u.id),
    }));
  res.json(members);
});

// --- Shared library (group-scoped) ---

app.get('/api/playbooks', requireAuth, requireGroup, (req, res) => {
  res.json(allPlaybooks(req.user!.currentGroupId!));
});

app.get('/api/playbooks/:domain/:taskSignature', requireAuth, requireGroup, (req, res) => {
  const entry = getPlaybook(
    req.user!.currentGroupId!,
    String(req.params.domain),
    String(req.params.taskSignature)
  );
  if (!entry) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json(entry);
});

app.put('/api/playbooks', requireAuth, requireGroup, (req, res) => {
  // The group a write lands in always comes from the authenticated user's
  // session, never from the request body — a client claiming a different
  // groupId shouldn't be able to write into a group it isn't in.
  upsertPlaybook({ ...req.body, groupId: req.user!.currentGroupId! });
  res.json({ ok: true });
});

app.get('/api/runs', requireAuth, requireGroup, (req, res) => {
  const limit = Number(req.query.limit) || 50;
  res.json(recentRuns(req.user!.currentGroupId!, limit));
});

app.post('/api/runs', requireAuth, requireGroup, (req, res) => {
  recordRun({ ...(req.body as RunLogEntry), groupId: req.user!.currentGroupId! });
  res.json({ ok: true });
});

app.get('/api/agents', requireAuth, requireGroup, (req, res) => {
  const runs = recentRuns(req.user!.currentGroupId!, 500);
  const byName = new Map<string, { name: string; runCount: number; lastSeen: string; lastTask: string }>();
  for (const run of runs) {
    const existing = byName.get(run.agentName);
    if (existing) {
      existing.runCount += 1;
      if (run.timestamp > existing.lastSeen) {
        existing.lastSeen = run.timestamp;
        existing.lastTask = run.taskDescription;
      }
    } else {
      byName.set(run.agentName, {
        name: run.agentName,
        runCount: 1,
        lastSeen: run.timestamp,
        lastTask: run.taskDescription,
      });
    }
  }
  res.json([...byName.values()].sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1)));
});

// Lets the dashboard trigger a run directly instead of the CLI. Runs
// server-side with the hub's own .env (STEEL_API_KEY / LLM_PROVIDER), scoped
// to the authenticated dashboard user's current group (see RunTaskOptions —
// the hub's own repo.ts calls resolve to the local "default" group
// otherwise, since the hub doesn't set HIVEMIND_HUB_URL on itself).
app.post('/api/tasks/run', requireAuth, requireGroup, async (req, res) => {
  const { url, task } = req.body as { url?: string; task?: string };
  if (!url || !task) {
    res.status(400).json({ error: 'url and task are required' });
    return;
  }
  // The hub doesn't set HIVEMIND_HUB_URL on itself, so runTask's own
  // setTaskRunning() call (via repo.ts) is a no-op for this in-process path
  // — mark presence directly instead, same reason groupId/agentName are
  // passed in explicitly above rather than relying on repo.ts's env-based
  // resolution.
  markTaskRunning(req.user!.id, true);
  try {
    const result = await runTask(url, task, {
      groupId: req.user!.currentGroupId!,
      agentName: req.user!.displayName || req.user!.email,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  } finally {
    markTaskRunning(req.user!.id, false);
  }
});

app.listen(PORT, () => {
  console.log(`Hivemind hub listening on http://localhost:${PORT}`);
});
