"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { joinPath, parentOf, type ExplorerMeta } from "@/lib/storage-explorer";
import { explorerApi, type BatchResult, type ExplorerFolder, type ExplorerItem, type FileInsight } from "./api";
import { forgetFolders, loadFolder, loadInsights, loadMeta, peekFolder, peekInsights } from "./cache";

export interface Notice {
  tone: "ok" | "error";
  text: string;
}

function batchNotice(verb: string, res: BatchResult): Notice {
  if (res.failed.length === 0) return { tone: "ok", text: `${res.done.length} ${res.done.length === 1 ? "item" : "itens"} ${verb}.` };
  const first = res.failed[0];
  return { tone: "error", text: `${res.done.length} ${verb}; ${res.failed.length} não: ${first.path.split("/").pop()} — ${first.error}` };
}

/** Navigation (with back/forward history), listing, Windows-like selection and the organizing actions. */
export function useExplorer(org: string, initialFolder: string, onFolderChange?: (folder: string) => void) {
  const [folder, setFolder] = useState(initialFolder);
  const [back, setBack] = useState<string[]>([]);
  const [forward, setForward] = useState<string[]>([]);
  const [data, setData] = useState<ExplorerFolder | null>(() => peekFolder(org, initialFolder) ?? null);
  const [meta, setMeta] = useState<ExplorerMeta | null>(null);
  /** What each file of the open folder is (layout, ready or needs treatment), by path. */
  const [insights, setInsights] = useState<Record<string, FileInsight> | null>(() => peekInsights(org, initialFolder) ?? null);
  const [analyzing, setAnalyzing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);

  // Clients and file uses: once per organization (cached for every explorer on the page).
  useEffect(() => {
    let live = true;
    loadMeta(org).then((m) => live && setMeta(m), () => undefined);
    return () => {
      live = false;
    };
  }, [org]);

  // The analysis comes apart from the listing (it may read files the first time): files show first.
  useEffect(() => {
    let live = true;
    setInsights(peekInsights(org, folder) ?? null);
    setAnalyzing(true);
    loadInsights(org, folder).then(
      (d) => {
        if (!live) return;
        setInsights(d);
        setAnalyzing(false);
      },
      () => live && setAnalyzing(false),
    );
    return () => {
      live = false;
    };
  }, [org, folder, version]);

  // The folder shows at once from the cache (if seen before) and is refreshed behind.
  useEffect(() => {
    let live = true;
    const cached = peekFolder(org, folder);
    if (cached) setData(cached);
    setLoading(true);
    loadFolder(org, folder).then(
      (d) => {
        if (!live) return;
        setData(d);
        setError(null);
        setLoading(false);
      },
      (err: Error) => {
        if (!live) return;
        setError(err.message);
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
  }, [org, folder, version]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), notice.tone === "ok" ? 3500 : 8000);
    return () => clearTimeout(t);
  }, [notice]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  /** After a change: the open folder (and others touched) are listed again, the tree too. */
  const changed = useCallback((others: string[] = []) => {
    forgetFolders(org, [folder, ...others]);
    reload();
  }, [org, folder, reload]);

  const go = useCallback((path: string, history: "push" | "back" | "forward" = "push") => {
    if (path === folder) return;
    if (history === "push") {
      setBack((b) => [...b, folder]);
      setForward([]);
    }
    setFolder(path);
    setSelected(new Set());
    anchor.current = null;
    setRenaming(null);
    onFolderChange?.(path);
  }, [folder, onFolderChange]);

  const goBack = useCallback(() => {
    const prev = back[back.length - 1];
    if (prev === undefined) return;
    setBack(back.slice(0, -1));
    setForward((f) => [folder, ...f]);
    go(prev, "back");
  }, [back, folder, go]);

  const goForward = useCallback(() => {
    const next = forward[0];
    if (next === undefined) return;
    setForward(forward.slice(1));
    setBack((b) => [...b, folder]);
    go(next, "forward");
  }, [forward, folder, go]);

  const goUp = useCallback(() => folder !== "" && go(parentOf(folder)), [folder, go]);

  /** Click / Ctrl+click / Shift+click over the items in their shown order. */
  const select = useCallback((item: ExplorerItem, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, order: ExplorerItem[]) => {
    setSelected((s) => {
      if (e.shiftKey && anchor.current) {
        const a = order.findIndex((i) => i.path === anchor.current);
        const b = order.findIndex((i) => i.path === item.path);
        if (a >= 0 && b >= 0) return new Set(order.slice(Math.min(a, b), Math.max(a, b) + 1).map((i) => i.path));
      }
      anchor.current = item.path;
      if (e.ctrlKey || e.metaKey) {
        const next = new Set(s);
        if (next.has(item.path)) next.delete(item.path);
        else next.add(item.path);
        return next;
      }
      return new Set([item.path]);
    });
  }, []);

  const markFresh = useCallback((paths: string[]) => {
    setFresh((f) => new Set([...f, ...paths]));
    setTimeout(() => setFresh((f) => new Set([...f].filter((p) => !paths.includes(p)))), 6000);
  }, []);

  const run = useCallback(async (work: () => Promise<Notice | null>) => {
    setBusy(true);
    try {
      const n = await work();
      if (n) setNotice(n);
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "Algo deu errado." });
    } finally {
      setBusy(false);
      changed();
    }
  }, [changed]);

  const actions = {
    rename: (item: ExplorerItem, name: string | null) => {
      setRenaming(null);
      if (name === null || name.trim() === "" || name === item.name) return;
      void run(async () => {
        const res = await explorerApi.rename(org, item.path, name);
        setSelected(new Set([res.path]));
        markFresh([res.path]);
        return null;
      });
    },
    newFolder: () => {
      const taken = new Set((data?.entries ?? []).map((i) => i.name));
      let name = "Nova-pasta";
      for (let i = 2; taken.has(name); i += 1) name = `Nova-pasta-${i}`;
      void run(async () => {
        const res = await explorerApi.mkdir(org, folder, name);
        setSelected(new Set([res.path]));
        setRenaming(res.path);
        return null;
      });
    },
    move: (paths: string[], target: string) =>
      run(async () => {
        const res = await explorerApi.move(org, paths, target);
        forgetFolders(org, [target, ...paths]);
        setSelected(new Set());
        return batchNotice(res.done.length === 1 ? "movido" : "movidos", res);
      }),
    remove: (paths: string[]) =>
      run(async () => {
        const res = await explorerApi.remove(org, paths);
        setSelected(new Set());
        return batchNotice(res.done.length === 1 ? "excluído" : "excluídos", res);
      }),
  };

  // A burst of uploads refreshes the listing once, shortly after the last one lands.
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stored = useCallback((target: string, name: string) => {
    markFresh([joinPath(target, name)]);
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(reload, 400);
  }, [markFresh, reload]);

  return {
    folder, data, meta, insights, analyzing, loading, error, version, busy, notice, setNotice, changed,
    canBack: back.length > 0, canForward: forward.length > 0,
    go, goBack, goForward, goUp, reload,
    selected, setSelected, select, fresh, renaming, setRenaming, actions, stored,
  };
}
