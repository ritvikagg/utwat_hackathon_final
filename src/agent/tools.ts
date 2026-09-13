import type { Page, Locator } from 'playwright';
import type { TraceStep } from '../types.js';

/** Shared by executeAction (cold runs) and replayScript (replay.ts).
 *  Playwright's coordinate-based locator.click() doesn't know Steel's actual
 *  rendered viewport when attached via connectOverCDP() (it reports
 *  viewportSize() as null) — confirmed by testing that it "succeeds" without
 *  error while missing the real element entirely on some layouts.
 *  locator.evaluate() resolves the selector as usual, then runs a native DOM
 *  click on the actual element, sidestepping coordinate math altogether.
 *
 *  One side effect: when the click itself triggers a navigation, the JS
 *  realm this function is evaluating in can get torn down before the
 *  round-trip back to Playwright completes, surfacing as "Execution context
 *  was destroyed, most likely because of a navigation." That error is
 *  actually proof the click worked, not a failure — swallow it rather than
 *  reporting a working click as broken. */
export async function nativeClick(locator: Locator): Promise<void> {
  await locator.waitFor({ state: 'attached', timeout: 5000 });
  try {
    await locator.evaluate((target) => {
      (target as HTMLElement).scrollIntoView({ block: 'center', inline: 'center' });
      (target as HTMLElement).click();
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (!msg.includes('context was destroyed') && !msg.includes('Execution context')) {
      throw err;
    }
  }
}

export interface PageElement {
  id: number;
  tag: string;
  label: string;
  /** Durable, cross-session selector computed at extraction time — this is
   *  what gets recorded into the trace for replay, never the throwaway
   *  data-hivemind-id (which only exists for this run's own clicks). */
  selector: string;
}

// Handed to page.evaluate() as a plain string (not a TS closure). tsx compiles
// this file through esbuild, which injects `__name(...)` helper calls around
// function declarations to preserve their names — those helpers live in
// Node's module scope, but page.evaluate ships only the callback's own source
// into the browser's separate JS realm, so a serialized closure referencing
// them throws "ReferenceError: __name is not defined". A string is never
// parsed by esbuild, so it can't pick up that transform.
const EXTRACT_SCRIPT = `
(function () {
  // Clear ids from the previous read first — without this, an element that
  // drops out of this read's filtered/sliced list (e.g. a slide-out menu
  // link that used to be on-screen) keeps its old id forever, while a
  // different element can independently be assigned that same number this
  // time. Two elements sharing one id makes the click locator match both
  // and throw a strict-mode violation.
  Array.from(document.querySelectorAll('[data-hivemind-id]')).forEach(function (el) {
    el.removeAttribute('data-hivemind-id');
  });

  function textOf(el) {
    return (
      el.getAttribute('aria-label') ||
      (el.textContent || '').trim().slice(0, 80) ||
      el.placeholder ||
      ''
    ).trim();
  }

  function labelFor(el) {
    var text = textOf(el) || el.name || '';
    // Lists of similar items (e.g. a product grid) often repeat the exact
    // same visible text on every row's button ("Add to cart" x N) — the only
    // thing actually distinguishing them is usually the id/data-test
    // attribute a well-built site puts there for its own test automation.
    // Surface it so the model can tell rows apart instead of guessing.
    var idAttr = el.id || el.getAttribute('data-test') || '';
    if (idAttr && text.indexOf(idAttr) === -1) {
      return text ? text + ' [' + idAttr + ']' : idAttr;
    }
    return text;
  }

  function roleOf(el) {
    var explicit = el.getAttribute('role');
    if (explicit) return explicit;
    var tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      var type = (el.getAttribute('type') || 'text').toLowerCase();
      return type === 'submit' || type === 'button' ? 'button' : 'textbox';
    }
    return null;
  }

  function cssPath(el) {
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      var selector = node.tagName.toLowerCase();
      var parent = node.parentElement;
      if (parent) {
        var siblings = Array.from(parent.children).filter(function (c) {
          return c.tagName === node.tagName;
        });
        if (siblings.length > 1) {
          selector += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
        }
      }
      parts.unshift(selector);
      node = parent;
    }
    return parts.join(' > ');
  }

  // Same priority Steel's own docs recommend: accessible name+role first
  // (most durable, survives DOM restructuring), then testid, then id, then
  // name attribute, then a structural CSS path as last resort.
  function durableSelector(el) {
    var role = roleOf(el);
    var name = textOf(el);
    if (role && name) {
      return 'role=' + role + '[name="' + name.replace(/"/g, '\\\\"') + '"]';
    }
    var testIdAttr = el.hasAttribute('data-testid')
      ? 'data-testid'
      : el.hasAttribute('data-test')
        ? 'data-test'
        : null;
    if (testIdAttr) return '[' + testIdAttr + '="' + el.getAttribute(testIdAttr) + '"]';
    if (el.id) return '#' + CSS.escape(el.id);
    var nameAttr = el.getAttribute('name');
    if (nameAttr) return el.tagName.toLowerCase() + '[name="' + nameAttr + '"]';
    return cssPath(el);
  }

  function isOnScreen(rect) {
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.right > 0 &&
      rect.bottom > 0 &&
      rect.left < window.innerWidth &&
      rect.top < window.innerHeight
    );
  }

  var nodes = Array.from(
    document.querySelectorAll('a, button, input, textarea, select, [role="button"], [onclick]')
  );

  return nodes
    .filter(function (el) {
      return isOnScreen(el.getBoundingClientRect()) && !el.hasAttribute('disabled');
    })
    .slice(0, 60)
    .map(function (el, i) {
      el.setAttribute('data-hivemind-id', String(i));
      return {
        id: i,
        tag: el.tagName.toLowerCase(),
        label: labelFor(el),
        selector: durableSelector(el),
      };
    });
})()
`;

/** Assigns a throwaway data-hivemind-id to each visible interactive element
 *  so this run's clicks/types can target them reliably, and computes a
 *  durable selector per element for the trace this run contributes. */
export async function extractPageState(
  page: Page
): Promise<{ text: string; elements: PageElement[] }> {
  let elements: PageElement[];
  try {
    elements = await page.evaluate<PageElement[]>(EXTRACT_SCRIPT);
  } catch (err) {
    const msg = (err as Error).message;
    if (!msg.includes('context was destroyed') && !msg.includes('Execution context')) {
      throw err;
    }
    // The click just before this call triggered a navigation that was still
    // in flight when we tried to read the new page's state — same class of
    // error nativeClick() handles, just from the read side instead of the
    // click side. Wait for it to settle and retry once.
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    elements = await page.evaluate<PageElement[]>(EXTRACT_SCRIPT);
  }
  const text = elements.map((e) => `[${e.id}] <${e.tag}> "${e.label}"`).join('\n');
  return { text, elements };
}

/** Never throws — a bad click/fill (timeout, detached element, strict-mode
 *  violation from a stale id, etc.) becomes an error string fed back to the
 *  model so it can adapt, instead of an uncaught exception that kills the
 *  whole process. That matters a lot more now than it used to: this same
 *  code runs inside the shared hub server when a run is triggered from the
 *  dashboard, so an uncaught exception there would take the hub down for
 *  every teammate connected to it, not just this one run.
 *
 *  Every real action is also appended to `trace`, in the exact order it
 *  actually happened, with the durable selector computed above and (for
 *  typed fields) the real value — this is now the sole source of truth for
 *  what gets compiled into a script. Steel's own session trace was tried
 *  for this earlier and dropped: it redacts typed values to just a length,
 *  uses an undocumented mix of event type names, and — worse — fires extra
 *  phantom change events on some SPA sites, throwing off any attempt to
 *  align values by position. Our own log has none of those problems; we
 *  are the ones actually doing the typing, so we already know exactly what
 *  happened without needing to reconstruct it from anywhere. */
export async function executeAction(
  page: Page,
  elements: PageElement[],
  name: string,
  input: Record<string, unknown>,
  trace: TraceStep[]
): Promise<string> {
  try {
    if (name === 'goto') {
      const url = String(input.url);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      trace.push({ action: 'goto', selector: url, value: null });
      return `Navigated to ${url}`;
    }

    const el = elements.find((e) => e.id === input.element_id);
    if (!el) {
      return `Error: no element with id ${input.element_id} on this page. Re-check the current listing.`;
    }

    const locator = page.locator(`[data-hivemind-id="${el.id}"]`);

    if (name === 'click') {
      await nativeClick(locator);
      trace.push({ action: 'click', selector: el.selector, value: null });
      return `Clicked [${el.id}] "${el.label}"`;
    }

    if (name === 'type') {
      const text = String(input.text ?? '');
      await locator.fill(text, { timeout: 5000 });
      trace.push({ action: 'type', selector: el.selector, value: text });
      return `Typed "${text}" into [${el.id}] "${el.label}"`;
    }

    return `Unknown action: ${name}`;
  } catch (err) {
    return `Error performing ${name}: ${(err as Error).message.split('\n')[0]}. Re-check the current listing and try a different element.`;
  }
}
