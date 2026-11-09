/**
 * Turns the element under the mouse into a short markdown brief that can be pasted to a
 * development agent ("change this button"). Pure: works on the small surface of an Element it
 * reads, so it is unit-tested without a browser.
 */

export interface InspectableElement {
  readonly tagName: string;
  readonly id: string;
  readonly classList: Iterable<string>;
  readonly attributes: ArrayLike<{ readonly name: string; readonly value: string }>;
  readonly parentElement: InspectableElement | null;
  readonly children: ArrayLike<InspectableElement>;
}

export interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElementSnapshot {
  element: InspectableElement;
  /** Full page URL. */
  url: string;
  /** Visible text inside the element. */
  text: string;
  /** App component names, outermost first (see cleanComponentChain). */
  components: readonly string[];
  /** Nearest heading before the element, for orientation. */
  heading: string | null;
  rect: ElementRect | null;
  /** The element's outerHTML. */
  html: string;
}

const MAX_SELECTOR_DEPTH = 8;
const MAX_CLASSES = 3;
const MAX_TEXT = 120;
const MAX_ATTR = 80;
const MAX_HTML = 600;
const DEFAULT_MAX_COMPONENTS = 6;

/** Classes usable in a selector as-is (Tailwind variants like `md:x` or `w-[10px]` need escaping). */
const PLAIN_CLASS = /^-?[a-zA-Z_][\w-]*$/;
/** Ids React or libraries generate (`:r1:`, `«r2»`, `radix-…`) change between renders. */
const UNSTABLE_ID = /[:«»]|^radix-|^headlessui-|^\d/;

const KEPT_ATTRIBUTES = ["href", "src", "alt", "title", "role", "name", "type", "placeholder", "for", "action"];

/** Next.js / React internals that only add noise to a component chain. */
const FRAMEWORK_COMPONENTS = new Set([
  "AppRouter",
  "AppDevOverlay",
  "AppDevOverlayErrorBoundary",
  "DevRootHTTPAccessFallbackBoundary",
  "ErrorBoundary",
  "ErrorBoundaryHandler",
  "HTTPAccessFallbackBoundary",
  "HTTPAccessFallbackErrorBoundary",
  "HandleISRError",
  "HistoryUpdater",
  "HotReload",
  "InnerLayoutRouter",
  "InnerScrollAndFocusHandler",
  "LoadingBoundary",
  "MetadataBoundary",
  "MetadataOutlet",
  "OuterLayoutRouter",
  "OutletBoundary",
  "PathnameContextProviderAdapter",
  "RedirectBoundary",
  "RedirectErrorBoundary",
  "RenderFromTemplateContext",
  "ReplaySsrOnlyErrors",
  "Root",
  "Router",
  "RuntimeStyles",
  "ScrollAndFocusHandler",
  "SegmentViewNode",
  "SegmentStateProvider",
  "ServerRoot",
  "ViewportBoundary",
]);

export function squash(text: string, max = MAX_TEXT): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function stableId(el: InspectableElement): string | null {
  return el.id && !UNSTABLE_ID.test(el.id) && PLAIN_CLASS.test(el.id) ? el.id : null;
}

function segment(el: InspectableElement): string {
  const tag = el.tagName.toLowerCase();
  const classes = [...el.classList].filter((c) => PLAIN_CLASS.test(c)).slice(0, MAX_CLASSES);
  const base = tag + classes.map((c) => `.${c}`).join("");

  const parent = el.parentElement;
  if (!parent) return base;
  const sameTag = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
  return sameTag.length > 1 ? `${base}:nth-of-type(${sameTag.indexOf(el) + 1})` : base;
}

/** A readable CSS selector from the nearest stable id (or body) down to the element. */
export function cssSelector(el: InspectableElement): string {
  const parts: string[] = [];
  let current: InspectableElement | null = el;
  while (current && parts.length < MAX_SELECTOR_DEPTH) {
    const tag = current.tagName.toLowerCase();
    if (tag === "body" || tag === "html") {
      if (parts.length === 0) parts.unshift(tag);
      break;
    }
    const id = stableId(current);
    if (id) {
      parts.unshift(`#${id}`);
      break;
    }
    parts.unshift(segment(current));
    current = current.parentElement;
  }
  return parts.join(" > ");
}

/**
 * Component names collected innermost-first from the React tree → the app's own components,
 * outermost-first, without framework internals, minified names (production) or repeats.
 */
export function cleanComponentChain(innermostFirst: readonly string[], max = DEFAULT_MAX_COMPONENTS): string[] {
  const kept: string[] = [];
  for (const name of innermostFirst) {
    // React 19 renders context providers as the context itself (`ThemeContext`): not a component.
    if (name.length < 3 || !/^[A-Z]/.test(name) || name.endsWith("Context") || FRAMEWORK_COMPONENTS.has(name)) continue;
    if (kept[kept.length - 1] === name) continue;
    kept.push(name);
    if (kept.length === max) break;
  }
  return kept.reverse();
}

/** Attributes that help locate the element in code (links, accessibility labels, test ids…). */
export function pickAttributes(el: InspectableElement): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const { name, value } of Array.from(el.attributes)) {
    if (KEPT_ATTRIBUTES.includes(name) || name.startsWith("data-") || name.startsWith("aria-")) {
      picked[name] = squash(value, MAX_ATTR + 1);
    }
  }
  return picked;
}

function pagePath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

/** The brief copied to the clipboard. */
export function describeElement(s: ElementSnapshot): string {
  const tag = s.element.tagName.toLowerCase();
  const text = squash(s.text);
  const attrs = Object.entries(pickAttributes(s.element)).map(([k, v]) => `${k}="${v}"`);
  const classes = [...s.element.classList].join(" ");

  const lines = [
    `Elemento: <${tag}>${text ? ` "${text}"` : ""}`,
    `Página: ${pagePath(s.url)} (${s.url})`,
    `Seletor: \`${cssSelector(s.element)}\``,
    s.components.length > 0 ? `Componentes React: ${s.components.join(" > ")}` : null,
    s.heading ? `Seção: "${squash(s.heading, 80)}"` : null,
    classes ? `Classes: ${classes}` : null,
    attrs.length > 0 ? `Atributos: ${attrs.join(" ")}` : null,
    s.rect
      ? `Tamanho: ${Math.round(s.rect.width)}×${Math.round(s.rect.height)} px em (${Math.round(s.rect.x)}, ${Math.round(s.rect.y)})`
      : null,
  ].filter((l): l is string => l !== null);

  const html = s.html.trim();
  const htmlBlock = html ? ["", "```html", squash(html, MAX_HTML), "```"] : [];
  return [...lines, ...htmlBlock].join("\n");
}
