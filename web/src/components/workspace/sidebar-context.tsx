"use client";

import { createContext, useContext, useEffect } from "react";

/** What the sidebar shares with the page beside it (SidebarShell provides it). */
export interface SidebarState {
  /** The panel is collapsed on wide screens (the page takes the whole width). */
  collapsed: boolean;
  /** Opens the panel again. */
  expand: () => void;
  /** The space's logo, shown where the panel showed it while the panel is collapsed. */
  logoUrl: string | null;
  /** The signed-in person's avatar and menu, shown at the right of the dashboard header (null: nobody). */
  account: React.ReactNode;
  /**
   * A bar on top of the page takes over the "open the panel" button and the logo while the panel is
   * collapsed (the dashboard header): the panel then drops its own floating button and the room it kept
   * for it. Returns the release.
   */
  hostToggle: () => () => void;
}

export const SidebarContext = createContext<SidebarState | null>(null);

/** The sidebar's state, or null outside a SidebarShell. */
export function useSidebar(): SidebarState | null {
  return useContext(SidebarContext);
}

/** For the bar that hosts the toggle while mounted (see SidebarState.hostToggle). */
export function useHostSidebarToggle(sidebar: SidebarState | null): void {
  const host = sidebar?.hostToggle;
  useEffect(() => host?.(), [host]);
}
