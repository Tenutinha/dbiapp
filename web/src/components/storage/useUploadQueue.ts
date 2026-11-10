"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { joinPath, safeDroppedDir } from "@/lib/storage-explorer";
import { uploadFile, type Transfer } from "./api";
import type { DroppedFile } from "./dropped";

export interface QueueItem {
  id: number;
  /** Organization whose storage receives the file. */
  org: string;
  file: File;
  /** Destination folder, relative to the organization's folder. */
  folder: string;
  status: "waiting" | "sending" | "done" | "failed" | "cancelled";
  loaded: number;
  /** Bytes per second while sending. */
  speed: number;
  /** Name it got in the folder, or the error. */
  note?: string;
}

/** Called after each file lands (e.g. an open explorer refreshes that folder). */
export type StoredListener = (org: string, folder: string, name: string) => void;

/** Files sent at the same time. */
const PARALLEL = 3;

/**
 * The app-wide upload queue: files go 3 at a time, each with its own progress and speed; failed or
 * cancelled ones can be sent again. Lives above every page, so closing the explorer never stops a send.
 */
export function useUploadQueue() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const nextId = useRef(1);
  const running = useRef(new Map<number, Transfer>());
  const listeners = useRef(new Set<StoredListener>());

  const patch = useCallback((id: number, change: Partial<QueueItem>) => {
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...change } : it)));
  }, []);

  const start = useCallback((item: QueueItem) => {
    const began = performance.now();
    patch(item.id, { status: "sending", loaded: 0, speed: 0, note: undefined });
    const transfer = uploadFile(item.org, item.folder, item.file, (loaded) => {
      const seconds = (performance.now() - began) / 1000;
      patch(item.id, { loaded, speed: seconds > 0.3 ? loaded / seconds : 0 });
    });
    running.current.set(item.id, transfer);
    void transfer.done.then((res) => {
      running.current.delete(item.id);
      if (res.name) {
        patch(item.id, { status: "done", loaded: item.file.size, note: res.name });
        for (const fn of listeners.current) fn(item.org, item.folder, res.name);
      } else {
        patch(item.id, { status: res.error === "Cancelado." ? "cancelled" : "failed", note: res.error });
      }
    });
  }, [patch]);

  // Start waiting files while there is a free slot.
  useEffect(() => {
    const free = PARALLEL - items.filter((i) => i.status === "sending").length;
    if (free <= 0) return;
    items.filter((i) => i.status === "waiting").slice(0, free).forEach(start);
  }, [items, start]);

  // Leaving the page would cut the sends in progress: the browser asks first.
  const busy = items.some((i) => i.status === "waiting" || i.status === "sending");
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent): void => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const enqueue = useCallback((org: string, files: readonly DroppedFile[], folder: string) => {
    const added = files.map((f): QueueItem => ({
      id: nextId.current++,
      org,
      file: f.file,
      // Dropped folders keep their structure, with names made safe ("Notas Julho" → "Notas-Julho").
      folder: safeDroppedDir(f.dir) ? joinPath(folder, safeDroppedDir(f.dir)) : folder,
      status: "waiting",
      loaded: 0,
      speed: 0,
    }));
    setItems((list) => [...list, ...added]);
  }, []);

  const cancel = useCallback((id: number) => {
    const transfer = running.current.get(id);
    if (transfer) transfer.abort();
    else patch(id, { status: "cancelled", note: "Cancelado." });
  }, [patch]);

  const retry = useCallback((id: number) => patch(id, { status: "waiting", loaded: 0, note: undefined }), [patch]);

  const clearFinished = useCallback(() => {
    setItems((list) => list.filter((i) => i.status === "waiting" || i.status === "sending"));
  }, []);

  const subscribe = useCallback((fn: StoredListener) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  return { items, busy, enqueue, cancel, retry, clearFinished, subscribe };
}
