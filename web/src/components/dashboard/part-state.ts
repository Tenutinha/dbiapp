/** What one part of a live dashboard holds: the body it shows and what it is waiting for. */
export interface PartState<B> {
  /** The selection `body` was computed for (null: nothing loaded yet). */
  loaded: string | null;
  body: B;
  /** The selection being asked for now. */
  loading: string | null;
  /** The selection whose request failed (the reader may try again). */
  failed: string | null;
}

/**
 * The selection a part should ask for now, or null when there is nothing to ask: it already shows it, it is
 * already asking for it, the request for it failed (until the reader tries again), or the part is nowhere
 * near the screen (it asks when the reader gets there). Pure.
 */
export function nextLoad<B>(state: PartState<B>, search: string, near: boolean): string | null {
  if (!near) return null;
  if (state.loaded === search || state.loading === search || state.failed === search) return null;
  return search;
}
