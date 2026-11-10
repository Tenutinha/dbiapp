import { describe, expect, it } from "vitest";
import { ARRIVAL_GRACE_MS, PUSH_DISTANCE, PUSH_IDLE_MS, PUSH_START, pushOnWheel, pushProgress, type PushState } from "./overscroll";

/** Feeds wheel events at the page end, `gap` ms apart, starting after the arrival grace. */
function push(deltas: readonly number[], gap = 50): { state: PushState; opened: boolean } {
  let { state } = pushOnWheel(PUSH_START, { atEnd: true, deltaY: 0, now: 0 });
  let opened = false;
  deltas.forEach((deltaY, i) => {
    const r = pushOnWheel(state, { atEnd: true, deltaY, now: ARRIVAL_GRACE_MS + i * gap });
    state = r.state;
    opened = opened || r.open;
  });
  return { state, opened };
}

describe("pushOnWheel", () => {
  it("ignores scrolling while the page is not at its end", () => {
    const r = pushOnWheel({ pushed: 200, arrivedAt: 0, lastAt: 900 }, { atEnd: false, deltaY: 100, now: 1000 });
    expect(r).toEqual({ state: PUSH_START, open: false });
  });

  it("ignores the tail of the scroll that reached the end", () => {
    const arrived = pushOnWheel(PUSH_START, { atEnd: true, deltaY: 120, now: 1000 });
    expect(arrived.state.pushed).toBe(0);
    const tail = pushOnWheel(arrived.state, { atEnd: true, deltaY: 500, now: 1000 + ARRIVAL_GRACE_MS - 1 });
    expect(tail).toMatchObject({ state: { pushed: 0 }, open: false });
  });

  it("opens the next dashboard after a sustained push", () => {
    expect(push([100, 100]).opened).toBe(false);
    expect(push([100, 100, 100, 100]).opened).toBe(true);
  });

  it("starts over after a pause or when the reader scrolls back up", () => {
    expect(push([150, 150, 150], PUSH_IDLE_MS + 1).opened).toBe(false);
    expect(push([150, 150, -10, 150]).opened).toBe(false);
  });

  it("reports the progress of the push", () => {
    expect(pushProgress(push([PUSH_DISTANCE / 2]).state)).toBe(0.5);
    expect(pushProgress(push([PUSH_DISTANCE * 3]).state)).toBe(1);
  });
});
