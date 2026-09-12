import os from 'node:os';
import crypto from 'node:crypto';
import Steel from 'steel-sdk';
import { chromium } from 'playwright';
import { getPlaybook, recordRun, usingHub, compileViaHub } from './library/repo.js';
import { compileSession } from './library/compile.js';
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

export async function runTask(
  startUrl: string,
  taskDescription: string,
  params: Record<string, string> = {}
): Promise<RunTaskResult> {
  const domain = new URL(startUrl).hostname;
  const taskSignature = slug(taskDescription);
  const existing = await getPlaybook(domain, taskSignature);
  const agentName = process.env.HIVEMIND_AGENT_NAME || os.userInfo().username || 'anonymous';

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

      if (success) {
        try {
          const updated = usingHub()
            ? await compileViaHub(session.id, domain, taskSignature, result.typedValues)
            : compileSession(session.id, domain, taskSignature, result.typedValues);
          if (updated) {
            trace = updated.lastTrace ?? [];
            console.log(`Library updated: status=${updated.status}, successCount=${updated.successCount}`);
          }
        } catch (err) {
          console.warn(`Could not update shared library: ${(err as Error).message}`);
        }
      }
    }
  } finally {
    await client.sessions.release(session.id);
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(`Done in ${elapsedMs}ms. Success: ${success}. LLM calls: ${llmCalls}. ${summary}`);

  await recordRun({
    id: crypto.randomUUID(),
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
