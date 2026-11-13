import { useEffect, useState } from "react";

/** The open modal dialog that is last in the page (the one in front), or the page body. */
function frontHost(): HTMLElement {
  const modals = document.querySelectorAll<HTMLDialogElement>("dialog:modal");
  return modals[modals.length - 1] ?? document.body;
}

/**
 * Where floating dev UI must be rendered to stay usable: a modal <dialog> makes everything outside it
 * inert (unclickable), so while one is open the UI has to live inside it.
 */
export function useFrontHost(): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const update = (): void => setHost(frontHost());
    update();
    const watch = new MutationObserver(update);
    watch.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    return () => watch.disconnect();
  }, []);
  return host;
}

/**
 * Keeps `el` (a `popover="manual"` element) in front of everything. Modal dialogs and popovers live in the
 * browser's top layer, above any z-index, stacked in opening order — so the element is a popover too,
 * opened again whenever something else enters the top layer.
 */
export function useAlwaysInFront(el: HTMLElement | null): void {
  useEffect(() => {
    if (!el || typeof el.showPopover !== "function") return;
    const raise = (): void => {
      if (!el.isConnected) return;
      if (el.matches(":popover-open")) el.hidePopover();
      el.showPopover();
    };
    raise();
    // "toggle" does not bubble, hence the capture phase.
    const onToggle = (e: Event): void => {
      if (e.target !== el && (e as ToggleEvent).newState === "open") raise();
    };
    const watch = new MutationObserver((changes) => {
      if (changes.some((c) => c.target instanceof HTMLDialogElement && c.target.open)) raise();
    });
    document.addEventListener("toggle", onToggle, true);
    watch.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"] });
    return () => {
      document.removeEventListener("toggle", onToggle, true);
      watch.disconnect();
      if (el.isConnected && el.matches(":popover-open")) el.hidePopover();
    };
  }, [el]);
}
