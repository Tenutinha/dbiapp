/**
 * The "open this dashboard" request, handed from the summary (which stays on screen) to the dashboard
 * being left (which owns the transition — see DashboardOpener). A tiny store because the two are far apart.
 */
export interface OpenRequest {
  id: string;
  name: string;
  /** False when it is the dashboard already on screen: it reloads in place, without a skeleton. */
  announce: boolean;
}

let waiting: OpenRequest | null = null;
const takers = new Set<() => void>();

/** Registers a taker (the dashboard on screen), called whenever a request arrives. Returns the unsubscribe. */
export function onOpenRequest(run: () => void): () => void {
  takers.add(run);
  return () => {
    takers.delete(run);
  };
}

/**
 * Hands the request to the dashboard on screen. False when there is nobody to take it (a screen without
 * DashboardOpener): the caller must then open the dashboard itself, or the click would do nothing.
 */
export function requestOpen(request: OpenRequest): boolean {
  if (takers.size === 0) return false;
  waiting = request;
  takers.forEach((run) => run());
  return true;
}

/** The request waiting to be opened, taken once. */
export function takeOpenRequest(): OpenRequest | null {
  const request = waiting;
  waiting = null;
  return request;
}
