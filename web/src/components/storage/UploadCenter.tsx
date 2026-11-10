"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import type { DroppedFile } from "./dropped";
import { UploadQueue } from "./UploadQueue";
import { useUploadQueue, type StoredListener } from "./useUploadQueue";

interface UploadCenter {
  enqueue: (org: string, files: readonly DroppedFile[], folder: string) => void;
  /** Runs `fn` after each file lands; returns the unsubscribe function. */
  subscribe: (fn: StoredListener) => () => void;
}

const Ctx = createContext<UploadCenter | null>(null);

export function useUploadCenter(): UploadCenter {
  const center = useContext(Ctx);
  if (!center) throw new Error("useUploadCenter needs <UploadCenterProvider> (root layout).");
  return center;
}

/**
 * Keeps the panel on top of everything, open modals included. Native modal dialogs live in the browser's
 * top layer, above any z-index; the panel is a manual popover (also top layer) raised again whenever a
 * dialog opens, so the upload progress never hides behind one.
 */
function useAlwaysOnTop(ref: React.RefObject<HTMLElement | null>, visible: boolean): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || !visible || typeof el.showPopover !== "function") return;
    const raise = (): void => {
      if (el.matches(":popover-open")) el.hidePopover();
      el.showPopover();
    };
    raise();
    const watch = new MutationObserver((changes) => {
      if (changes.some((c) => c.target instanceof HTMLDialogElement && c.target.open)) raise();
    });
    watch.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"] });
    return () => {
      watch.disconnect();
      if (el.matches(":popover-open")) el.hidePopover();
    };
  }, [ref, visible]);
}

/** App-wide uploads: the queue and its floating panel, fixed in the corner of the screen on every page. */
export function UploadCenterProvider({ children }: { children: React.ReactNode }) {
  const queue = useUploadQueue();
  const router = useRouter();
  const panel = useRef<HTMLDivElement>(null);
  useAlwaysOnTop(panel, queue.items.length > 0);
  const value = useMemo(() => ({ enqueue: queue.enqueue, subscribe: queue.subscribe }), [queue.enqueue, queue.subscribe]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {queue.items.length > 0 && (
        <div ref={panel} popover="manual" className="m-0 inset-auto bottom-4 right-4 overflow-visible border-0 bg-transparent p-0">
          <UploadQueue
            items={queue.items}
            onCancel={queue.cancel}
            onRetry={queue.retry}
            onClear={queue.clearFinished}
            onOpenFolder={(org, folder) => router.push(`/${org}/admin?arquivos=${encodeURIComponent(folder)}`, { scroll: false })}
          />
        </div>
      )}
    </Ctx.Provider>
  );
}
