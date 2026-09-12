import type { Page } from 'playwright';

export interface PageElement {
  id: number;
  tag: string;
  label: string;
}

// Handed to page.evaluate() as a plain string (not a TS closure). tsx compiles
// this file through esbuild, which injects `__name(...)` helper calls around
// function declarations to preserve their names — those helpers live in
// Node's module scope, but page.evaluate ships only the callback's own source
// into the browser's separate JS realm, so a serialized closure referencing
// them throws "ReferenceError: __name is not defined". A string is never
// parsed by esbuild, so it can't pick up that transform.
//
// Durable selectors for replay come from Steel's own session trace (see
// library/steelTrace.ts) after the run, not from anything computed here —
// this only needs to identify elements well enough for THIS run's clicks.
const EXTRACT_SCRIPT = `
(function () {
  function labelFor(el) {
    return (
      el.getAttribute('aria-label') ||
      el.placeholder ||
      (el.textContent || '').trim().slice(0, 80) ||
      el.name ||
      ''
    ).trim();
  }

  var nodes = Array.from(
    document.querySelectorAll('a, button, input, textarea, select, [role="button"], [onclick]')
  );

  return nodes
    .filter(function (el) {
      var rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && !el.hasAttribute('disabled');
    })
    .slice(0, 60)
    .map(function (el, i) {
      el.setAttribute('data-hivemind-id', String(i));
      return {
        id: i,
        tag: el.tagName.toLowerCase(),
        label: labelFor(el),
      };
    });
})()
`;

/** Assigns a throwaway data-hivemind-id to each visible interactive element
 *  so this run's clicks/types can target them reliably. */
export async function extractPageState(
  page: Page
): Promise<{ text: string; elements: PageElement[] }> {
  const elements = await page.evaluate<PageElement[]>(EXTRACT_SCRIPT);
  const text = elements.map((e) => `[${e.id}] <${e.tag}> "${e.label}"`).join('\n');
  return { text, elements };
}

export async function executeAction(
  page: Page,
  elements: PageElement[],
  name: string,
  input: Record<string, unknown>,
  typedValues: string[]
): Promise<string> {
  if (name === 'goto') {
    const url = String(input.url);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    return `Navigated to ${url}`;
  }

  const el = elements.find((e) => e.id === input.element_id);
  if (!el) {
    return `Error: no element with id ${input.element_id} on this page. Re-check the current listing.`;
  }

  const locator = page.locator(`[data-hivemind-id="${el.id}"]`);

  if (name === 'click') {
    await locator.click({ timeout: 5000 });
    return `Clicked [${el.id}] "${el.label}"`;
  }

  if (name === 'type') {
    const text = String(input.text ?? '');
    await locator.fill(text, { timeout: 5000 });
    // Steel's own trace redacts typed values to just a length, for privacy —
    // it never hands back the literal text. We're the only ones who actually
    // know what was typed, so track it ourselves to merge in later
    // (see library/compile.ts) rather than trying to recover it from Steel.
    typedValues.push(text);
    return `Typed "${text}" into [${el.id}] "${el.label}"`;
  }

  return `Unknown action: ${name}`;
}
