import { describe, expect, it } from "vitest";
import { organizeBatches } from "./organize-batches";

const move = (path: string, to: string) => ({ path, to });

describe("organizeBatches", () => {
  it("returns no batch when nothing is chosen", () => {
    expect(organizeBatches([move("a", "x")], new Set(), 2)).toEqual([]);
  });

  it("only sends chosen paths", () => {
    expect(organizeBatches([move("a", "x"), move("b", "x")], new Set(["b"]), 10)).toEqual([["b"]]);
  });

  it("splits into batches of about the given size", () => {
    const moves = ["a", "b", "c", "d", "e"].map((p) => move(p, `to-${p}`));
    const batches = organizeBatches(moves, new Set(moves.map((m) => m.path)), 2);
    expect(batches).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  });

  it("never splits files going to the same destination folder (copies of one document)", () => {
    const moves = [move("a", "x"), move("b", "y"), move("c", "y"), move("d", "y"), move("e", "z")];
    const batches = organizeBatches(moves, new Set(moves.map((m) => m.path)), 2);
    expect(batches).toEqual([["a", "b", "c", "d"], ["e"]]);
    for (const dest of ["x", "y", "z"]) {
      const holding = batches.filter((b) => b.some((p) => moves.find((m) => m.path === p)?.to === dest));
      expect(holding).toHaveLength(1);
    }
  });

  it("keeps a destination group together even when it is bigger than the batch size", () => {
    const moves = [move("a", "x"), move("b", "x"), move("c", "x"), move("d", "y")];
    expect(organizeBatches(moves, new Set(["a", "b", "c", "d"]), 2)).toEqual([["a", "b", "c"], ["d"]]);
  });
});
