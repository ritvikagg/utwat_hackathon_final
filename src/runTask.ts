import os from 'node:os';
import crypto from 'node:crypto';
import Steel from 'steel-sdk';
import { chromium } from 'playwright';
import { getPlaybook, upsertPlaybook, recordRun, localGroupId, setTaskRunning } from './library/repo.js';
import { distill } from './library/distill.js';
import { runColdAgent } from './agent/loop.js';
import { runColdAgentLocal } from './agent/loop.local.js';
import { replayScript } from './agent/replay.js';
import type { TraceStep } from './types.js';

function slug(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export interface RunTaskResult {
  success: boolean;
  summary: string;
  elapsedMs: number;
  llmCalls: number;
  usedLibrary: 'script' | 'tips' | 'none';
  sessionViewerUrl: string;
  trace: TraceStep[];
}

export interface RunTaskOptions {
  params?: Record<string, string>;
  /** Only meaningful for a run happening in-process on the hub itself (the
   *  dashboard's "run a task" button) — the hub's own repo.ts calls always
   *  resolve to the local "default" group otherwise, since the hub doesn't
   *  set HIVEMIND_HUB_URL on itself. Lets that one call site use the
   *  authenticated dashboard user's actual current group instead. */
  groupId?: string;
  agentName?: string;
}

export async function runTask(
  startUrl: string,
  taskDescription: string,
  options: RunTaskOptions = {}
): Promise<RunTaskResult> {
  const params = options.params ?? {};
  const domain = new URL(startUrl).hostname;
  const taskSignature = slug(taskDescription);
  const existing = await getPlaybook(domain, taskSignature, options.groupId);
  const agentName =
    options.agentName || process.env.HIVEMIND_AGENT_NAME || os.userInfo().username || 'anonymous';
  const groupId = options.groupId ?? localGroupId();

  await setTaskRunning(true);

  const client = new Steel({ steelAPIKey: process.env.STEEL_API_KEY });
  const session = await client.sessions.create();
  console.log(`Session: ${session.id}`);
  console.log(`Watch live: ${session.sessionViewerUrl}`);

  const browser = await chromium.connectOverCDP(
    `${session.websocketUrl}&apiKey=${process.env.STEEL_API_KEY}`
  );
  const page = browser.contexts()[0].pages()[0];

  const startedAt = Date.now();
  let trace: TraceStep[] = [];
  let success = false;
  let summary = '';
  let llmCalls = 0;
  let usedLibrary: 'script' | 'tips' | 'none' = 'none';

  try {
    await page.goto(startUrl, { waitUntil: 'domcontentloaded' });

    if (existing?.status === 'verified' && existing.script) {
      console.log(`Found verified script (${existing.script.length} steps) — replaying, 0 LLM calls.`);
      await replayScript(page, existing.script, params);
      trace = existing.script;
      usedLibrary = 'script';

      // Replaying without throwing isn't proof it worked (e.g. submitting a
      // login form with a missing field fails silently, no exception) — at
      // minimum, check we actually landed where the script expects to.
      const lastGoto = [...existing.script].reverse().find((s) => s.action === 'goto');
      const actualUrl = page.url();
      if (lastGoto && actualUrl !== lastGoto.selector) {
        success = false;
        summary = `Replay finished on ${actualUrl}, expected ${lastGoto.selector} — script may be stale or broken.`;
      } else {
        success = true;
        summary = 'Replayed from shared library.';
      }
    } else {
      usedLibrary = existing?.tips ? 'tips' : 'none';
      console.log(
        existing?.tips ? 'Found tips for this site — using them.' : 'No prior knowledge — cold run.'
      );
      const useLocal = process.env.LLM_PROVIDER === 'local';
      console.log(`Brain: ${useLocal ? 'local (LM Studio)' : 'Anthropic API'}`);
      const result = useLocal
        ? await runColdAgentLocal(page, taskDescription, existing?.tips)
        : await runColdAgent(page, taskDescription, existing?.tips);
      success = result.success;
      summary = result.summary;
      llmCalls = result.llmCalls;
      trace = result.trace;

      // Our own action log is the source of truth here — see tools.ts for
      // why Steel's session trace was tried and dropped for this.
      if (success && trace.length > 0) {
        const updated = distill(existing, groupId, domain, taskSignature, trace);
        await upsertPlaybook(updated);
        console.log(`Library updated: status=${updated.status}, successCount=${updated.successCount}`);
      }
    }
  } finally {
    await client.sessions.release(session.id);
    await setTaskRunning(false);
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(`Done in ${elapsedMs}ms. Success: ${success}. LLM calls: ${llmCalls}. ${summary}`);

  await recordRun({
    id: crypto.randomUUID(),
    groupId,
    agentName,
    domain,
    taskSignature,
    taskDescription,
    mode: usedLibrary,
    success,
    summary,
    llmCalls,
    elapsedMs,
    sessionViewerUrl: session.sessionViewerUrl,
    timestamp: new Date().toISOString(),
  }).catch((err) => console.warn(`Could not record run: ${(err as Error).message}`));

  return {
    success,
    summary,
    elapsedMs,
    llmCalls,
    usedLibrary,
    sessionViewerUrl: session.sessionViewerUrl,
    trace,
  };
}
