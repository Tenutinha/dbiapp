"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cssSelector, type InspectableElement } from "@/lib/dev-inspector/describe";
import { copyText, describeLiveElement, elementAt, INSPECTOR_ATTR } from "./inspector-dom";
import { useAlwaysInFront, useFrontHost } from "./useTopLayer";

/** Events swallowed while inspecting, so clicking a link or button only selects it. */
const BLOCKED_EVENTS = ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "dblclick", "auxclick", "contextmenu"];
const TOAST_MS = 2200;
const LAYER = 2147483000;

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
};

const LABEL_ROOM = 24;

/** Element name tag: above the box, else below it, else inside it (elements filling the screen). */
function labelPosition(box: Box | null): React.CSSProperties {
  if (!box || box.top > LABEL_ROOM) return { bottom: "100%", marginBottom: 4 };
  if (box.top + box.height < window.innerHeight - LABEL_ROOM) return { top: "100%", marginTop: 4 };
  return { top: Math.max(4, -box.top + 4), left: Math.max(4, -box.left + 4) };
}

const isOwnUi =(target: EventTarget | null): boolean =>
  target instanceof Element && target.closest(`[${INSPECTOR_ATTR}]`) !== null;

/**
 * Asks the server whether this user (platform admin) gets the inspector — again on every page, so
 * signing out or switching to another account in the same tab hides it.
 */
function useInspectorAccess(): boolean {
  const pathname = usePathname();
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/dev/inspector", { cache: "no-store", signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d: { enabled?: unknown }) => setEnabled(d.enabled === true))
      .catch((err: unknown) => {
        // Aborted by the next page: that one asks again. Offline: hidden, never shown by mistake.
        if (!(err instanceof DOMException && err.name === "AbortError")) setEnabled(false);
      });
    return () => ctrl.abort();
  }, [pathname]);
  return enabled;
}

/**
 * Platform-admin tool: "Inspecionar" turns the pointer into a picker; clicking an element copies its
 * id (the short selector shown in the tag) to paste to a dev agent. Shift+click copies the full
 * markdown brief (page, selector, React components, text, HTML) instead.
 *
 * Its UI stays in front of everything — open modals and popovers included (see useTopLayer).
 */
export function ElementInspector() {
  const enabled = useInspectorAccess();
  const [active, setActive] = useState(false);
  const [target, setTarget] = useState<Element | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const targetRef = useRef<Element | null>(null);
  const childTrail = useRef<Element[]>([]);
  const host = useFrontHost();
  const [layer, setLayer] = useState<HTMLDivElement | null>(null);
  useAlwaysInFront(layer);

  const select = useCallback((el: Element | null) => {
    targetRef.current = el;
    setTarget(el);
    setBox(el ? boxOf(el) : null);
  }, []);

  const stop = useCallback(() => {
    setActive(false);
    select(null);
    childTrail.current = [];
  }, [select]);

  const copyCurrent = useCallback(async (full: boolean) => {
    const el = targetRef.current;
    if (!el) return;
    const id = cssSelector(el as unknown as InspectableElement);
    const ok = await copyText(full ? describeLiveElement(el) : id);
    const copied = full ? "Descrição completa copiada." : `Id copiado: ${id}`;
    setToast(ok ? copied : "Não foi possível copiar.");
    stop();
  }, [stop]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!active) return;

    const onMove = (e: PointerEvent) => {
      const el = elementAt(e.clientX, e.clientY);
      if (el && el !== targetRef.current) {
        childTrail.current = [];
        select(el);
      }
    };
    const onBlocked = (e: Event) => {
      if (isOwnUi(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (e.type === "click") void copyCurrent((e as MouseEvent).shiftKey);
    };
    const onKey = (e: KeyboardEvent) => {
      const el = targetRef.current;
      if (e.key === "Escape") stop();
      else if (e.key === "Enter") void copyCurrent(e.shiftKey);
      else if (e.key === "ArrowUp" && el && el !== document.body && el.parentElement && el.parentElement !== document.body) {
        childTrail.current = [...childTrail.current, el];
        select(el.parentElement);
      } else if (e.key === "ArrowDown" && childTrail.current.length > 0) {
        const trail = childTrail.current;
        childTrail.current = trail.slice(0, -1);
        select(trail[trail.length - 1]);
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onViewport = () => {
      if (targetRef.current) setBox(boxOf(targetRef.current));
    };

    const root = document.documentElement;
    const previousCursor = root.style.cursor;
    root.style.cursor = "crosshair";
    document.addEventListener("pointermove", onMove, true);
    BLOCKED_EVENTS.forEach((t) => document.addEventListener(t, onBlocked, true));
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onViewport, true);
    window.addEventListener("resize", onViewport);
    return () => {
      root.style.cursor = previousCursor;
      document.removeEventListener("pointermove", onMove, true);
      BLOCKED_EVENTS.forEach((t) => document.removeEventListener(t, onBlocked, true));
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onViewport, true);
      window.removeEventListener("resize", onViewport);
    };
  }, [active, copyCurrent, select, stop]);

  if (!enabled || !host) return null;

  const label = target ? cssSelector(target as unknown as InspectableElement).split(" > ").pop() : null;
  const labelPlacement = labelPosition(box);

  return createPortal(
    <div
      ref={setLayer}
      popover="manual"
      className="m-0 size-0 overflow-visible border-0 bg-transparent p-0"
      style={{ inset: "0 auto auto 0", color: "inherit" }}
      {...{ [INSPECTOR_ATTR]: "" }}
    >
      {active && box && (
        <div
          aria-hidden="true"
          style={{
            position: "fixed",
            top: box.top,
            left: box.left,
            width: box.width,
            height: box.height,
            zIndex: LAYER,
            pointerEvents: "none",
            outline: "2px solid var(--color-brand, #7c5cff)",
            background: "color-mix(in srgb, var(--color-brand, #7c5cff) 14%, transparent)",
            borderRadius: 2,
          }}
        >
          <span
            className="font-mono"
            style={{
              position: "absolute",
              left: -2,
              ...labelPlacement,
              maxWidth: 420,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              padding: "2px 6px",
              borderRadius: 4,
              fontSize: 11,
              lineHeight: "16px",
              color: "#fff",
              background: "var(--color-brand, #7c5cff)",
            }}
          >
            {label} · {Math.round(box.width)}×{Math.round(box.height)}
          </span>
        </div>
      )}

      <div
        className="fixed bottom-16 right-3 flex flex-row-reverse items-center gap-2 rounded-xl border border-brand/40 bg-card-2/95 px-2 py-1.5 text-xs shadow-2xl backdrop-blur"
        style={{ zIndex: LAYER + 1 }}
      >
        <button
          type="button"
          onClick={() => (active ? stop() : setActive(true))}
          aria-pressed={active}
          title="Destaca o elemento sob o mouse; clique nele para copiar o id para um agente de desenvolvimento (Shift+clique copia a descrição completa)."
          className={`rounded-lg px-2 py-1 font-semibold transition ${active ? "bg-brand text-on-brand" : "text-brand hover:bg-brand/15"}`}
        >
          {active ? "Inspecionando…" : "Inspecionar"}
        </button>
        {active && <span className="text-muted">clique copia o id · Shift+clique copia tudo · ↑ pai · ↓ volta · Esc sai</span>}
      </div>

      {toast && (
        <div
          role="status"
          className="fixed bottom-28 right-3 max-w-[min(32rem,calc(100vw-1.5rem))] break-all rounded-lg border border-brand/40 bg-card-2 px-3 py-2 font-mono text-xs shadow-2xl"
          style={{ zIndex: LAYER + 1 }}
        >
          {toast}
        </div>
      )}
    </div>,
    host,
  );
}
