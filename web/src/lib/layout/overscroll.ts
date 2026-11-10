/**
 * "Keep scrolling to open the next dashboard": how much the reader has pushed past the end of the page.
 * Pure, so the thresholds are unit-tested; the component only feeds it wheel events.
 */

/** Wheel distance (px) past the end that opens the next dashboard. */
export const PUSH_DISTANCE = 320;
/** Wheel events right after reaching the end are the tail of the scroll that got there, not a push. */
export const ARRIVAL_GRACE_MS = 500;
/** A pause this long between wheel events starts the push over. */
export const PUSH_IDLE_MS = 450;

export interface PushState {
  /** Distance pushed so far, 0 to PUSH_DISTANCE. */
  pushed: number;
  /** When the page end was reached (ms), or null while it is not at the end. */
  arrivedAt: number | null;
  /** Time of the last wheel event seen at the end. */
  lastAt: number;
}

export const PUSH_START: PushState = { pushed: 0, arrivedAt: null, lastAt: 0 };

export interface WheelInput {
  atEnd: boolean;
  deltaY: number;
  now: number;
}

export function pushOnWheel(state: PushState, input: WheelInput): { state: PushState; open: boolean } {
  if (!input.atEnd) return { state: PUSH_START, open: false };
  const arrivedAt = state.arrivedAt ?? input.now;
  const still: PushState = { pushed: 0, arrivedAt, lastAt: input.now };
  // Scrolling back up, or still inside the tail of the scroll that reached the end: nothing pushed.
  if (input.deltaY <= 0 || input.now - arrivedAt < ARRIVAL_GRACE_MS) return { state: still, open: false };
  const base = input.now - state.lastAt > PUSH_IDLE_MS ? 0 : state.pushed;
  const pushed = Math.min(base + input.deltaY, PUSH_DISTANCE);
  return { state: { pushed, arrivedAt, lastAt: input.now }, open: pushed >= PUSH_DISTANCE };
}

/** Share of the push done, 0 to 1 (the progress line over the invitation). */
export const pushProgress = (state: PushState): number => state.pushed / PUSH_DISTANCE;
