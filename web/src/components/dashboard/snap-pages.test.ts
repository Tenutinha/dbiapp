import { describe, expect, it } from "vitest";
import { currentPage, wheelMove, type PageBox } from "./snap-pages";

/** A screen 800 px tall whose pages start under a header of 100. */
const SCREEN = { top: 100, bottom: 800 };

/** Pages one below the other, by height, with the first one starting `offset` px from where pages start. */
function pages(heights: readonly number[], offset: number): PageBox[] {
  let top = SCREEN.top + offset;
  return heights.map((h) => {
    const box = { top, bottom: top + h };
    top += h;
    return box;
  });
}

describe("wheelMove", () => {
  it("takes the next page whole when the one on screen fits it", () => {
    const p = pages([700, 700, 700], 0);
    expect(wheelMove(p, SCREEN, 100)).toEqual({ kind: "turn", by: 700 });
    expect(wheelMove(pages([700, 700, 700], -700), SCREEN, 100)).toEqual({ kind: "turn", by: 700 });
    expect(wheelMove(pages([700, 700, 700], -700), SCREEN, -100)).toEqual({ kind: "turn", by: -700 });
  });

  it("scrolls inside a page taller than the screen, never past its end, and then takes the next", () => {
    const tall = pages([1000, 700], 0);
    expect(wheelMove(tall, SCREEN, 100)).toEqual({ kind: "scroll", by: 100 });
    // 40 px left to its end: the notch stops there.
    expect(wheelMove(pages([1000, 700], -260), SCREEN, 100)).toEqual({ kind: "scroll", by: 40 });
    // At its end: the next page comes whole to where pages start.
    expect(wheelMove(pages([1000, 700], -300), SCREEN, 100)).toEqual({ kind: "turn", by: 700 });
    // Up, inside it: back towards its start, never past it.
    expect(wheelMove(pages([1000, 700], -30), SCREEN, -100)).toEqual({ kind: "scroll", by: -30 });
  });

  it("lands on the end of a tall page when coming up from the one below", () => {
    // The second page on screen; the first (1000 px) is above.
    expect(wheelMove(pages([1000, 700], -1000), SCREEN, -100)).toEqual({ kind: "turn", by: -700 });
    // A page above that fits: its start.
    expect(wheelMove(pages([650, 700], -650), SCREEN, -100)).toEqual({ kind: "turn", by: -650 });
  });

  it("leaves the wheel to the browser before the first page, after the last and at their outer edges", () => {
    // The filters above the first page still on screen.
    expect(wheelMove(pages([700, 700], 80), SCREEN, 100)).toEqual({ kind: "native" });
    // Up from the first page: back to the top of the page.
    expect(wheelMove(pages([700, 700], 0), SCREEN, -100)).toEqual({ kind: "native" });
    // Down from the last page: the footer, the next dashboard.
    expect(wheelMove(pages([700, 700], -700), SCREEN, 100)).toEqual({ kind: "native" });
    // Past the last page altogether.
    expect(wheelMove(pages([700, 700], -1500), SCREEN, -100)).toEqual({ kind: "native" });
    expect(wheelMove([], SCREEN, 100)).toEqual({ kind: "native" });
    expect(wheelMove(pages([700], 0), SCREEN, 0)).toEqual({ kind: "native" });
  });
});

describe("currentPage", () => {
  it("is the last page that starts at or above where pages start", () => {
    expect(currentPage(pages([700, 700], 50), SCREEN)).toBe(-1);
    expect(currentPage(pages([700, 700], 1), SCREEN)).toBe(0);
    expect(currentPage(pages([700, 700], -690), SCREEN)).toBe(0);
    expect(currentPage(pages([700, 700], -700), SCREEN)).toBe(1);
  });
});
