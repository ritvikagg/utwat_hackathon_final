import type { PlaybookEntry, TraceStep, ScriptStep } from '../types.js';

/**
 * Steel's own steel-skill-creator methodology: align two traces of the same
 * task by index. Where action+selector match but the value differs, that's a
 * parameter. Where action or selector differs, the traces aren't the same
 * flow (a real branch, not just a different input) — don't compile.
 */
function diffToScript(prev: TraceStep[], curr: TraceStep[]): ScriptStep[] | null {
  if (prev.length !== curr.length) return null;

  const script: ScriptStep[] = [];
  let paramIndex = 0;

  for (let i = 0; i < curr.length; i++) {
    const a = prev[i];
    const b = curr[i];
    if (a.action !== b.action || a.selector !== b.selector) return null;

    if (a.value !== b.value) {
      paramIndex += 1;
      script.push({ ...b, value: `{{value_${paramIndex}}}` });
    } else {
      script.push({ ...b });
    }
  }

  return script;
}

export function distill(
  existing: PlaybookEntry | undefined,
  domain: string,
  taskSignature: string,
  trace: TraceStep[]
): PlaybookEntry {
  const base: PlaybookEntry = existing ?? {
    domain,
    taskSignature,
    tips: '',
    script: null,
    status: 'draft',
    successCount: 0,
    lastTrace: null,
    updatedAt: new Date().toISOString(),
  };

  const successCount = base.successCount + 1;
  const updatedAt = new Date().toISOString();

  if (base.lastTrace) {
    const script = diffToScript(base.lastTrace, trace);
    if (script) {
      return { ...base, script, status: 'verified', successCount, lastTrace: trace, updatedAt };
    }
  }

  return { ...base, successCount, lastTrace: trace, updatedAt };
}
