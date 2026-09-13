import { spawnSync } from 'node:child_process';
import type { TraceStep } from '../types.js';

// NOT part of the live compile pipeline — see tools.ts's executeAction for
// why: Steel's trace redacts typed values to a length only, uses
// undocumented event-type naming, and on some SPA sites fires extra phantom
// change events that break any attempt to align values by position. Our own
// action log (built in tools.ts, used by runTask.ts) is the actual source
// of truth for compiled scripts now. This module is kept because it's
// genuinely useful for manual debugging — e.g. `steel --json sessions
// traces <id>` was how the above problems were actually diagnosed.
//
// Schema confirmed against a live `steel --json sessions traces <id>` call —
// see steel-dev/skills' steel-skill-creator reference docs for the general
// shape; field names here are from an actual response, not just the docs.
export interface SteelTraceEvent {
  type: string; // 'navigate' | 'click' | 'input' | 'error' | ...
  timestamp: string;
  navigation?: { url: string };
  page?: { url: string };
  // Steel redacts typed text to just a length, even for non-sensitive
  // fields — it never hands back the literal string. See compile.ts for
  // where the real value actually comes from.
  value?: { inputType?: string; valueLength?: number; redacted?: boolean };
  target?: {
    accessibleName?: string;
    role?: string;
    tagName?: string;
    text?: string;
    attributes?: Record<string, string>;
    selector?: {
      testId?: string;
      id?: string;
      aria?: string;
      css?: string;
      xpath?: string;
    };
  };
}

export function fetchSteelTrace(sessionId: string): SteelTraceEvent[] {
  const result = spawnSync('steel', ['--json', 'sessions', 'traces', sessionId], {
    encoding: 'utf8',
  });

  if (result.error) {
    if ((result.error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        'steel CLI not found on PATH. Install with: curl -fsS https://setup.steel.dev | sh'
      );
    }
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `steel sessions traces failed: ${result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`}`
    );
  }

  const payload = JSON.parse(result.stdout);
  return payload?.data?.events ?? [];
}

// Steel's own priority guidance: accessible name + role first (most durable,
// survives DOM restructuring), then testId, id, aria, css, xpath.
function bestSelector(target: SteelTraceEvent['target']): string {
  if (!target) return '';
  const sel = target.selector ?? {};

  if (target.accessibleName && target.role) {
    const escaped = target.accessibleName.replace(/"/g, '\\"');
    return `role=${target.role}[name="${escaped}"]`;
  }
  if (sel.testId) return `[data-testid="${sel.testId}"]`;
  if (sel.id) return `#${sel.id}`;
  if (sel.aria) return sel.aria;
  if (sel.css) return sel.css;
  if (sel.xpath) return `xpath=${sel.xpath}`;
  return '';
}

/** Converts Steel's raw session trace into our compact action-log shape. */
export function toTraceSteps(events: SteelTraceEvent[]): TraceStep[] {
  const steps: TraceStep[] = [];

  for (const event of events) {
    if (event.type === 'navigate') {
      const url = event.navigation?.url;
      if (!url || url === 'about:blank') continue;
      steps.push({ action: 'goto', selector: url, value: null });
      continue;
    }

    if (event.type === 'click') {
      const selector = bestSelector(event.target);
      if (!selector) continue;
      steps.push({ action: 'click', selector, value: null });
      continue;
    }

    if (event.type === 'input' || event.type === 'change') {
      const selector = bestSelector(event.target);
      if (!selector) continue;
      // value is filled in by compile.ts from the caller's own record of
      // what it typed — Steel's trace only gives us a redacted length.
      steps.push({ action: 'type', selector, value: null });
      continue;
    }
    // Other event types (error, scroll, etc.) aren't part of the replayable script.
  }

  // Drop trailing navigations back to an already-visited URL — that's
  // post-task wandering, not part of accomplishing the task, and otherwise
  // makes two genuine successes of the same flow look like different traces
  // (e.g. the agent revisiting the start page after it already finished).
  while (steps.length > 0) {
    const last = steps[steps.length - 1];
    if (last.action !== 'goto') break;
    const revisitsEarlierUrl = steps
      .slice(0, -1)
      .some((s) => s.action === 'goto' && s.selector === last.selector);
    if (!revisitsEarlierUrl) break;
    steps.pop();
  }

  return steps;
}
