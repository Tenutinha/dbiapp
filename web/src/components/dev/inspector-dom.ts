/**
 * Browser-side half of the element inspector: reads what the pure describer needs from a live
 * element (React component names, nearby heading, text, box) and copies the result.
 */
import { cleanComponentChain, describeElement, type InspectableElement } from "@/lib/dev-inspector/describe";

/** Marks the inspector's own UI so it is never inspected itself. */
export const INSPECTOR_ATTR = "data-dev-inspector";

interface FiberLike {
  type: unknown;
  return: FiberLike | null;
  _debugInfo?: ReadonlyArray<{ name?: unknown }> | null;
}

function fiberOf(el: Element): FiberLike | null {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"));
    if (key) return (node as unknown as Record<string, FiberLike>)[key] ?? null;
  }
  return null;
}

function typeName(type: unknown): string | null {
  if (typeof type === "function") {
    const fn = type as { displayName?: string; name?: string };
    return fn.displayName || fn.name || null;
  }
  if (type && typeof type === "object") {
    const obj = type as { displayName?: string; render?: { name?: string }; type?: { name?: string } };
    return obj.displayName || obj.render?.name || obj.type?.name || null;
  }
  return null;
}

/**
 * App component names around the element, outermost first. Server Components show up through
 * React's dev-only debug info; production builds have minified names, which get filtered out.
 */
export function reactComponentNames(el: Element): string[] {
  const innermostFirst: string[] = [];
  for (let fiber = fiberOf(el); fiber; fiber = fiber.return) {
    const name = typeName(fiber.type);
    if (name) innermostFirst.push(name);
    // Server Components that produced this fiber, listed outermost first → walk them backwards.
    const serverParents = fiber._debugInfo ?? [];
    for (let i = serverParents.length - 1; i >= 0; i--) {
      const name = serverParents[i]?.name;
      if (typeof name === "string") innermostFirst.push(name);
    }
  }
  return cleanComponentChain(innermostFirst);
}

/** The last h1–h3 that comes before the element (or contains it). */
export function nearestHeading(el: Element): string | null {
  const headings = Array.from(document.querySelectorAll("h1, h2, h3"));
  let found: Element | null = null;
  for (const h of headings) {
    const before = h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING;
    if (before || h.contains(el)) found = h;
  }
  return found?.textContent?.trim() || null;
}

export function describeLiveElement(el: Element): string {
  const rect = el.getBoundingClientRect();
  const text = el instanceof HTMLElement ? el.innerText : el.textContent ?? "";
  return describeElement({
    element: el as unknown as InspectableElement,
    url: window.location.href,
    text,
    components: reactComponentNames(el),
    heading: nearestHeading(el),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    html: el.outerHTML,
  });
}

/** Copies text, falling back to a hidden textarea where the async clipboard is unavailable. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute(INSPECTOR_ATTR, "");
    area.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

/** The element under the pointer, skipping the inspector's own UI. */
export function elementAt(x: number, y: number): Element | null {
  return document.elementsFromPoint(x, y).find((e) => !e.closest(`[${INSPECTOR_ATTR}]`)) ?? null;
}
