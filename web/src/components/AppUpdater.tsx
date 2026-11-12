"use client";

import { useEffect, useRef } from "react";
import { decideUpdate, DEV_VERSION, parseVersionResponse, shouldCheckNow, VERSION_ENDPOINT } from "@/lib/app-version";

/** Per tab: the version this tab already reloaded for (see decideUpdate). */
const ATTEMPT_KEY = "dbi-versao-recarregada";
/** Open modal, typing in a field, or the uploads panel on screen: a reload now would lose work. */
const OPEN_DIALOG = "dialog[open]";
const OPEN_POPOVER = "[popover]:popover-open";
const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

interface AppUpdaterProps {
  /** Version this screen was rendered with (resolveAppVersion on the server). */
  version: string;
}

function hasOpenPopover(): boolean {
  try {
    return document.querySelector(OPEN_POPOVER) !== null;
  } catch {
    // Browsers without the Popover API reject the selector — and cannot have an open popover either.
    return false;
  }
}

function isBusy(): boolean {
  const focused = document.activeElement;
  const typing = focused instanceof HTMLElement && (EDITABLE_TAGS.has(focused.tagName) || focused.isContentEditable);
  return typing || document.querySelector(OPEN_DIALOG) !== null || hasOpenPopover();
}

// Storage can be blocked (private mode); the guard against reload loops then simply does not apply.
function readAttempt(): string | null {
  try {
    return sessionStorage.getItem(ATTEMPT_KEY);
  } catch {
    return null;
  }
}

function rememberAttempt(version: string): boolean {
  try {
    sessionStorage.setItem(ATTEMPT_KEY, version);
    return true;
  } catch {
    return false;
  }
}

async function fetchPublishedVersion(): Promise<string | null> {
  try {
    const response = await fetch(VERSION_ENDPOINT, { cache: "no-store" });
    return response.ok ? parseVersionResponse(await response.json()) : null;
  } catch {
    // Coming back from the background without network is routine; the next return checks again.
    return null;
  }
}

/**
 * Brings the newest DBI when the app returns to the foreground. A phone keeps the installed app (or a
 * tab) alive for days and shows the old screen again on reopening; here that moment asks the server
 * which version is published and reloads when it changed — unless the person is in the middle of
 * something, in which case it tries again on the next return.
 */
export function AppUpdater({ version }: AppUpdaterProps) {
  const lastCheckAt = useRef<number | null>(null);

  useEffect(() => {
    if (version === DEV_VERSION) return;

    const check = async (): Promise<void> => {
      if (document.visibilityState !== "visible" || !shouldCheckNow(lastCheckAt.current, Date.now())) return;
      lastCheckAt.current = Date.now();
      const latest = await fetchPublishedVersion();
      const decision = decideUpdate({ current: version, latest, attempted: readAttempt(), busy: isBusy() });
      if (decision === "wait") lastCheckAt.current = null;
      // Without somewhere to remember the attempt, a reload could repeat forever: better stay as is.
      if (decision === "reload" && latest && rememberAttempt(latest)) window.location.reload();
    };
    const onReturn = (): void => void check();

    document.addEventListener("visibilitychange", onReturn);
    // Restored from the back/forward cache: no visibility change happens, but the screen is just as old.
    window.addEventListener("pageshow", onReturn);
    return () => {
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("pageshow", onReturn);
    };
  }, [version]);

  return null;
}
