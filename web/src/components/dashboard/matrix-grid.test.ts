import { describe, expect, it } from "vitest";
import { cellKey, matrixGrid, monthLabel, rowLabel, shade } from "./matrix-grid";

const point = (row: string, column: string, value: number | null) => ({ row, column, value, text: String(value ?? "—") });

describe("matrixGrid", () => {
  it("lays the lines and the months out, with the months nobody has left empty in between", () => {
    const grid = matrixGrid([point("22", "2025-03", 30), point("11", "2025-01", 10), point("11", "2025-03", 5)]);
    expect(grid.rows).toEqual(["11", "22"]);
    expect(grid.columns).toEqual(["2025-01", "2025-02", "2025-03"]);
    expect(grid.monthly).toBe(true);
    expect(grid.max).toBe(30);
    expect(grid.cells[cellKey("11", "2025-01")]).toEqual({ value: 10, text: "10" });
    expect(grid.cells[cellKey("11", "2025-02")]).toBeUndefined();
  });

  it("keeps columns that are not months as they come, in order", () => {
    const grid = matrixGrid([point("a", "Sul", 1), point("a", "Norte", null)]);
    expect(grid).toMatchObject({ columns: ["Norte", "Sul"], monthly: false, max: 1 });
    expect(matrixGrid([])).toMatchObject({ rows: [], columns: [], max: 0, monthly: false });
  });
});

describe("shade and labels", () => {
  it("draws every cell with data, the biggest strongest", () => {
    expect(shade(100, 100)).toBe(1);
    expect(shade(0, 100)).toBe(0.35);
    expect(shade(50, 100)).toBeCloseTo(0.675);
    expect(shade(null, 100)).toBe(1);
    expect(shade(5, 0)).toBe(1);
  });

  it("punctuates a CNPJ and reads a month as mm/aaaa", () => {
    expect(rowLabel("11222333000181")).toBe("11.222.333/0001-81");
    expect(rowLabel("Matriz")).toBe("Matriz");
    expect(monthLabel("2025-03")).toBe("03/2025");
    expect(monthLabel("Sul")).toBe("Sul");
  });
});
