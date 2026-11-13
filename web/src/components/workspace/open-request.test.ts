import { describe, expect, it } from "vitest";
import { onOpenRequest, requestOpen, takeOpenRequest, type OpenRequest } from "./open-request";

const request: OpenRequest = { id: "a", name: "Vendas", announce: true };

describe("open request", () => {
  it("is refused when no dashboard on screen can take it, and nothing is left waiting", () => {
    expect(requestOpen(request)).toBe(false);
    expect(takeOpenRequest()).toBeNull();
  });

  it("is handed to the dashboard on screen, once", () => {
    const taken: Array<OpenRequest | null> = [];
    const stop = onOpenRequest(() => taken.push(takeOpenRequest()));
    expect(requestOpen(request)).toBe(true);
    expect(taken).toEqual([request]);
    expect(takeOpenRequest()).toBeNull();
    stop();
  });

  it("is refused again after the dashboard on screen goes away", () => {
    const stop = onOpenRequest(() => undefined);
    stop();
    expect(requestOpen(request)).toBe(false);
  });
});
