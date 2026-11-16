import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { fiscalModelingHere, requireModelingHere } = await import("./fiscal");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("fiscal modeling", () => {
  it("is offered on a machine and refused on the hosted app", () => {
    vi.stubEnv("VERCEL", "");
    expect(fiscalModelingHere()).toBe(true);
    expect(() => requireModelingHere()).not.toThrow();

    vi.stubEnv("VERCEL", "1");
    expect(fiscalModelingHere()).toBe(false);
    expect(() => requireModelingHere()).toThrow(/só o envio/);
  });
});
