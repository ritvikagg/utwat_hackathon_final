import { getPlaybook, upsertPlaybook } from './store.js';
import { distill } from './distill.js';
import { fetchSteelTrace, toTraceSteps } from './steelTrace.js';
import type { PlaybookEntry } from '../types.js';

/**
 * Fetches a session's trace and folds it into the shared library. Requires
 * the `steel` CLI and local file access, so this only ever runs on a
 * machine that owns the storage directly — the hub server, or a solo
 * (non-hub) local run. A teammate's client in hub mode never calls this;
 * it POSTs the sessionId to the hub and lets the hub do it instead, which
 * is what keeps the `steel` CLI off machines that don't have it (e.g.
 * Windows, which has no native Steel CLI build as of this writing).
 */
export function compileSession(
  sessionId: string,
  domain: string,
  taskSignature: string,
  typedValues: string[] = []
): PlaybookEntry | null {
  const trace = toTraceSteps(fetchSteelTrace(sessionId));
  if (trace.length === 0) return null;

  // Steel's trace redacts typed text; back-fill the real values here, in the
  // same order the caller issued its `type` actions (1:1 with Steel's
  // `input` events, since both are just the same sequence of real actions).
  let valueIndex = 0;
  for (const step of trace) {
    if (step.action === 'type') {
      step.value = typedValues[valueIndex] ?? '';
      valueIndex += 1;
    }
  }

  const existing = getPlaybook(domain, taskSignature);
  const updated = distill(existing, domain, taskSignature, trace);
  upsertPlaybook(updated);
  return updated;
}
