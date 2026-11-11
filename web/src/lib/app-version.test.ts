import { describe, expect, it } from "vitest";
import { decideUpdate, DEV_VERSION, parseVersionResponse, resolveAppVersion, shouldCheckNow, UPDATE_CHECK_INTERVAL_MS } from "./app-version";

describe("resolveAppVersion", () => {
  it("prefers the deployment id, then the commit, then the dev marker", () => {
    expect(resolveAppVersion({ VERCEL_DEPLOYMENT_ID: "dpl_1", VERCEL_GIT_COMMIT_SHA: "abc" })).toBe("dpl_1");
    expect(resolveAppVersion({ VERCEL_GIT_COMMIT_SHA: "abc" })).toBe("abc");
    expect(resolveAppVersion({})).toBe(DEV_VERSION);
  });

  it("ignores blank values", () => {
    expect(resolveAppVersion({ VERCEL_DEPLOYMENT_ID: "  ", VERCEL_GIT_COMMIT_SHA: "abc" })).toBe("abc");
    expect(resolveAppVersion({ VERCEL_DEPLOYMENT_ID: "", VERCEL_GIT_COMMIT_SHA: "" })).toBe(DEV_VERSION);
  });
});

describe("parseVersionResponse", () => {
  it("reads the version from a well-formed answer", () => {
    expect(parseVersionResponse({ version: "dpl_2" })).toBe("dpl_2");
  });

  it("rejects anything else", () => {
    [null, undefined, "dpl_2", {}, { version: "" }, { version: 3 }, { version: "x".repeat(300) }].forEach((bad) =>
      expect(parseVersionResponse(bad)).toBeNull(),
    );
  });
});

describe("decideUpdate", () => {
  const base = { current: "dpl_1", latest: "dpl_2", attempted: null, busy: false };

  it("reloads when the server runs another version", () => {
    expect(decideUpdate(base)).toBe("reload");
  });

  it("does nothing when the versions match or the answer is unusable", () => {
    expect(decideUpdate({ ...base, latest: "dpl_1" })).toBe("none");
    expect(decideUpdate({ ...base, latest: null })).toBe("none");
  });

  it("never reloads a development build, nor towards one", () => {
    expect(decideUpdate({ ...base, current: DEV_VERSION })).toBe("none");
    expect(decideUpdate({ ...base, latest: DEV_VERSION })).toBe("none");
  });

  it("does not reload twice for the same version (no reload loop)", () => {
    expect(decideUpdate({ ...base, attempted: "dpl_2" })).toBe("none");
    expect(decideUpdate({ ...base, attempted: "dpl_0" })).toBe("reload");
  });

  it("waits while the person is in the middle of something", () => {
    expect(decideUpdate({ ...base, busy: true })).toBe("wait");
  });
});

describe("shouldCheckNow", () => {
  it("checks the first time and again only after the interval", () => {
    expect(shouldCheckNow(null, 1_000)).toBe(true);
    expect(shouldCheckNow(1_000, 1_000 + UPDATE_CHECK_INTERVAL_MS - 1)).toBe(false);
    expect(shouldCheckNow(1_000, 1_000 + UPDATE_CHECK_INTERVAL_MS)).toBe(true);
  });
});
