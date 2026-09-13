import type { Page } from 'playwright';
import type { ScriptStep } from '../types.js';
import { nativeClick } from './tools.js';

const PARAM_PATTERN = /^\{\{(\w+)\}\}$/;

function resolveValue(value: string | null, params: Record<string, string>): string {
  if (!value) return '';
  const match = value.match(PARAM_PATTERN);
  if (!match) return value;
  const name = match[1];
  if (!(name in params)) {
    throw new Error(`Replay is missing required param "${name}" for placeholder ${value}`);
  }
  return params[name];
}

export async function replayScript(
  page: Page,
  steps: ScriptStep[],
  params: Record<string, string> = {}
): Promise<void> {
  for (const step of steps) {
    if (step.action === 'goto') {
      await page.goto(step.selector, { waitUntil: 'domcontentloaded' });
      continue;
    }
    const locator = page.locator(step.selector).first();
    if (step.action === 'click') {
      await nativeClick(locator);
    }
    if (step.action === 'type') {
      await locator.fill(resolveValue(step.value, params), { timeout: 5000 });
    }
  }
}
