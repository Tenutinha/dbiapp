import { beforeEach, describe, expect, it } from "vitest";
import type { Row } from "../duck/engine";
import { cachedRows, clearResultCache, resultCacheSize } from "./result-cache";

const rowsOf = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ i }));

/** A query that counts how many times it really ran. */
function counted(rows: Row[]): { run: () => Promise<Row[]>; runs: () => number } {
  let runs = 0;
  return {
    run: async () => {
      runs += 1;
      return rows;
    },
    runs: () => runs,
  };
}

beforeEach(clearResultCache);

describe("cachedRows", () => {
  it("runs a query once and answers the next request from what it kept", async () => {
    const q = counted([{ total: 10 }]);
    expect(await cachedRows("SELECT 1", ["a"], q.run)).toEqual([{ total: 10 }]);
    expect(await cachedRows("SELECT 1", ["a"], q.run)).toEqual([{ total: 10 }]);
    expect(q.runs()).toBe(1);
  });

  it("tells queries apart by their text and by their parameters", async () => {
    const q = counted([{ total: 10 }]);
    await cachedRows("SELECT 1", ["a"], q.run);
    await cachedRows("SELECT 1", ["b"], q.run);
    await cachedRows("SELECT 2", ["a"], q.run);
    // A parameter is never mistaken for part of the text, nor two parameters for one.
    await cachedRows("SELECT 1", ["a", "b"], q.run);
    await cachedRows("SELECT 1", ["a\u0001b"], q.run);
    expect(q.runs()).toBe(5);
  });

  it("makes two requests that ask at the same time wait for a single run", async () => {
    let release: (rows: Row[]) => void = () => undefined;
    let runs = 0;
    const run = (): Promise<Row[]> => {
      runs += 1;
      return new Promise((resolve) => {
        release = resolve;
      });
    };
    const first = cachedRows("SELECT slow", [], run);
    const second = cachedRows("SELECT slow", [], run);
    release([{ v: 1 }]);
    expect(await Promise.all([first, second])).toEqual([[{ v: 1 }], [{ v: 1 }]]);
    expect(runs).toBe(1);
  });

  it("hands each request rows of its own", async () => {
    const q = counted([{ total: 10 }]);
    const first = await cachedRows("SELECT 1", [], q.run);
    first[0].total = 99;
    first.push({ total: 1 });
    expect(await cachedRows("SELECT 1", [], q.run)).toEqual([{ total: 10 }]);
  });

  it("never keeps a failure: the next request tries again", async () => {
    let runs = 0;
    const run = async (): Promise<Row[]> => {
      runs += 1;
      if (runs === 1) throw new Error("bucket hiccup");
      return [{ ok: true }];
    };
    await expect(cachedRows("SELECT 1", [], run)).rejects.toThrow("bucket hiccup");
    expect(resultCacheSize()).toEqual({ entries: 0, rows: 0 });
    expect(await cachedRows("SELECT 1", [], run)).toEqual([{ ok: true }]);
    expect(runs).toBe(2);
  });

  it("does not keep a long listing", async () => {
    const q = counted(rowsOf(5_001));
    expect(await cachedRows("SELECT many", [], q.run)).toHaveLength(5_001);
    await cachedRows("SELECT many", [], q.run);
    expect(q.runs()).toBe(2);
    expect(resultCacheSize()).toEqual({ entries: 0, rows: 0 });
  });

  it("lets go of the results used longest ago when it holds too many rows", async () => {
    // 40 results of 5 000 rows are more than it keeps: the first ones go, the last ones stay.
    for (let i = 0; i < 40; i++) await cachedRows(`SELECT ${i}`, [], async () => rowsOf(5_000));
    expect(resultCacheSize().rows).toBeLessThanOrEqual(150_000);
    const again = counted(rowsOf(5_000));
    await cachedRows("SELECT 39", [], again.run);
    expect(again.runs()).toBe(0);
    await cachedRows("SELECT 0", [], again.run);
    expect(again.runs()).toBe(1);
  });
});
