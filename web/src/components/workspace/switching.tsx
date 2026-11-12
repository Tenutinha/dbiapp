"use client";

import { useLinkStatus } from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useState, useTransition } from "react";
import { DashboardSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { selectDashboardAction } from "./view-actions";

/**
 * "Another dashboard is on its way": raised the moment the reader asks for it (a click in the summary,
 * the block at the end of the page, or scrolling past it) and read by DashboardSwitch, which shows the
 * skeleton of the coming dashboard right away instead of leaving the current one on screen until the
 * server answers. A tiny store because the places that ask and the place that shows are far apart.
 */
let coming: string[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Announces the dashboard being opened (by name) for as long as `pending` holds. */
export function useSwitchSignal(pending: boolean, name: string): void {
  useEffect(() => {
    if (!pending) return;
    coming = [...coming, name];
    emit();
    return () => {
      const at = coming.lastIndexOf(name);
      coming = coming.filter((_, i) => i !== at);
      emit();
    };
  }, [pending, name]);
}

interface OpenRequest {
  id: string;
  name: string;
  /** False when it is the dashboard already on screen: it reloads in place, without a skeleton. */
  announce: boolean;
}

let openRequest: OpenRequest | null = null;
const openListeners = new Set<() => void>();

/**
 * Runs the "open this dashboard" action for the summary (signed-in screen). It lives inside the
 * dashboard being left, on purpose: the transition is then owned by a component that goes away together
 * with the old page, as with the block at the end of the page, and the screen goes from the current
 * dashboard to the coming one's skeleton and then to its data. Owned by the sidebar instead (which
 * stays), the same action left the screen empty for a moment between the two.
 */
export function DashboardOpener() {
  const router = useRouter();
  const [pending, startOpening] = useTransition();
  const [current, setCurrent] = useState<OpenRequest | null>(null);
  useSwitchSignal(pending && current !== null && current.announce, current?.name ?? "");

  useEffect(() => {
    const run = (): void => {
      const request = openRequest;
      if (!request) return;
      openRequest = null;
      setCurrent(request);
      startOpening(async () => {
        const target = await selectDashboardAction(request.id);
        // After the await, the navigation must join the transition again to keep it pending.
        if (target !== null) startOpening(() => router.push(target));
      });
    };
    openListeners.add(run);
    return () => {
      openListeners.delete(run);
    };
  }, [router]);

  return null;
}

/** For the summary: asks the dashboard on screen (DashboardOpener) to open another one. */
export function useOpenDashboard(name: string, announce = true): { pending: boolean; open: (id: string) => void } {
  const coming = useComing();
  const open = (id: string): void => {
    openRequest = { id, name, announce };
    openListeners.forEach((listener) => listener());
  };
  return { pending: announce && coming === name, open };
}

/**
 * Name of the dashboard on its way, or null. Showing it is urgent (the skeleton must answer the click);
 * dropping it is not: it goes as a transition, so it lands together with the navigation that brings the
 * new dashboard instead of cutting in front of it and leaving the screen empty in between.
 */
function useComing(): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    const sync = (): void => {
      const next = coming.at(-1) ?? null;
      if (next !== null) setName(next);
      else startTransition(() => setName(null));
    };
    sync();
    return subscribe(sync);
  }, []);
  return name;
}

/** Inside a <Link> to another dashboard (public link): announces it while the navigation is pending. */
export function LinkSwitchSignal({ name }: { name: string }) {
  const { pending } = useLinkStatus();
  useSwitchSignal(pending, name);
  return null;
}

const BLOCK = "animate-pulse rounded-lg bg-text/10";

/**
 * Wraps the dashboard on screen. While another one is on its way, the current page gives way at once to
 * the coming dashboard's title over a skeleton; the page itself stays mounted (hidden), because the
 * component that asked for the change lives in it and must see the change through.
 */
export function DashboardSwitch({ children }: { children: React.ReactNode }) {
  const name = useComing();

  useEffect(() => {
    if (name !== null) window.scrollTo({ top: 0 });
  }, [name]);

  return (
    <>
      {name !== null && (
        <div className="dash-enter">
          <header className="pb-6 pt-6 lg:pt-8">
            <div className="border-b border-line pb-4">
              <div className={`${BLOCK} h-4 w-48`} />
            </div>
            <h1 className="mt-5 font-serif text-[clamp(2rem,3.6vw,3rem)] font-normal leading-[1.05] tracking-[-0.02em]">{name}</h1>
          </header>
          <DashboardSkeleton />
        </div>
      )}
      <div hidden={name !== null}>{children}</div>
    </>
  );
}
