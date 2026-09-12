import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { getPlaybook, upsertPlaybook, allPlaybooks } from '../src/library/store.js';
import { recordRun, recentRuns } from '../src/library/runLog.js';
import { compileSession } from '../src/library/compile.js';
import { runTask } from '../src/runTask.js';
import type { RunLogEntry } from '../src/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.HUB_PORT) || 4001;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/playbooks', (_req, res) => {
  res.json(allPlaybooks());
});

app.get('/api/playbooks/:domain/:taskSignature', (req, res) => {
  const entry = getPlaybook(req.params.domain, req.params.taskSignature);
  if (!entry) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json(entry);
});

app.put('/api/playbooks', (req, res) => {
  upsertPlaybook(req.body);
  res.json({ ok: true });
});

app.get('/api/runs', (req, res) => {
  const limit = Number(req.query.limit) || 50;
  res.json(recentRuns(limit));
});

app.post('/api/runs', (req, res) => {
  recordRun(req.body as RunLogEntry);
  res.json({ ok: true });
});

app.get('/api/agents', (_req, res) => {
  const runs = recentRuns(500);
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

// Called by a teammate's client after its own successful cold run. Only the
// hub needs the `steel` CLI (installed here on the host machine) — clients
// just hand over the session id and let the hub fetch the trace and fold it
// into the shared library, so a machine without the CLI (e.g. Windows) can
// still fully participate.
app.post('/api/tasks/distill', (req, res) => {
  const { sessionId, domain, taskSignature, typedValues } = req.body as {
    sessionId?: string;
    domain?: string;
    taskSignature?: string;
    typedValues?: string[];
  };
  if (!sessionId || !domain || !taskSignature) {
    res.status(400).json({ error: 'sessionId, domain, and taskSignature are required' });
    return;
  }
  try {
    const updated = compileSession(sessionId, domain, taskSignature, typedValues ?? []);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Lets the dashboard trigger a run directly instead of the CLI. Runs
// server-side with the hub's own .env (STEEL_API_KEY / LLM_PROVIDER), so it
// always operates in local-store mode — never set HIVEMIND_HUB_URL when
// running the hub itself, or this would try to call back into its own API.
app.post('/api/tasks/run', async (req, res) => {
  const { url, task, agentName } = req.body as { url?: string; task?: string; agentName?: string };
  if (!url || !task) {
    res.status(400).json({ error: 'url and task are required' });
    return;
  }
  if (agentName) process.env.HIVEMIND_AGENT_NAME = agentName;
  try {
    const result = await runTask(url, task);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.listen(PORT, () => {
  console.log(`Hivemind hub listening on http://localhost:${PORT}`);
});
