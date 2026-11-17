import { describe, expect, it } from "vitest";
import { scorecardLines, SPARK, sparkOf, statusOf, type ScorecardItem, type ScorecardVisual } from "./scorecard-lines";

const item = (over: Partial<ScorecardItem>): ScorecardItem => ({ measure: "m", ...over });

describe("statusOf", () => {
  it("compares with the reference, on the side the indicator is better on", () => {
    expect(statusOf(item({ target: 1, better: "higher" }), 1.3)).toEqual({ label: "Acima da referência", tone: "ok" });
    expect(statusOf(item({ target: 1, better: "higher" }), 0.8)).toEqual({ label: "Abaixo da referência", tone: "danger" });
    expect(statusOf(item({ target: 0.5, better: "lower" }), 0.94)).toEqual({ label: "Acima da referência", tone: "danger" });
    expect(statusOf(item({ target: 0.5, better: "lower" }), 0.3)).toEqual({ label: "Abaixo da referência", tone: "ok" });
    expect(statusOf(item({ target: 1, better: "higher" }), 1)).toEqual({ label: "Na referência", tone: "ok" });
    expect(statusOf(item({ target: 1 }), 2)).toEqual({ label: "Acima da referência", tone: "neutral" });
  });

  it("without a reference, tells positive from negative when a side is better, and nothing otherwise", () => {
    expect(statusOf(item({ better: "higher" }), 10)).toEqual({ label: "Positivo", tone: "ok" });
    expect(statusOf(item({ better: "higher" }), -10)).toEqual({ label: "Negativo", tone: "danger" });
    expect(statusOf(item({ better: "higher" }), 0)).toBeNull();
    expect(statusOf(item({}), 10)).toBeNull();
    expect(statusOf(item({ target: 1, better: "higher" }), null)).toBeNull();
  });
});

describe("scorecardLines", () => {
  const visual = {
    id: "sc", type: "scorecard", title: "t", span: 12, field: "mes", limit: 36,
    items: [{ measure: "liquidez", target: 1, better: "higher" }, { measure: "divida", better: "lower" }, { measure: "receita" }],
  } as ScorecardVisual;
  // As the query gives them: the latest month first.
  const rows = [
    { mes: "2025-03", liquidez: 0.9, divida: 0.4, receita: "300" },
    { mes: "2025-02", liquidez: 1.2, divida: 0.5, receita: null },
    { mes: "2025-01", liquidez: 1.1, divida: 0.6, receita: 100 },
  ];

  it("puts the months in order and reads the latest value, the change and where it stands", () => {
    const { periods, lines } = scorecardLines(visual, rows);
    expect(periods).toEqual(["2025-01", "2025-02", "2025-03"]);
    expect(lines[0]).toMatchObject({ series: [1.1, 1.2, 0.9], current: 0.9, previous: 1.2, changeTone: "danger", status: { label: "Abaixo da referência", tone: "danger" } });
    expect(lines[0].change).toBeCloseTo(-0.3);
    // Falling is good for the one that is better lower; without a reference and positive, it reads "Positivo" against it.
    expect(lines[1]).toMatchObject({ current: 0.4, changeTone: "ok", status: { label: "Positivo", tone: "danger" } });
    // A missing month leaves a gap and no change to tell.
    expect(lines[2]).toMatchObject({ series: [100, null, 300], current: 300, previous: null, change: null, changeTone: "neutral", status: null });
  });

  it("stands on one month alone, and on none", () => {
    expect(scorecardLines(visual, rows.slice(0, 1)).lines[0]).toMatchObject({ current: 0.9, previous: null, change: null });
    expect(scorecardLines(visual, []).lines[0]).toMatchObject({ series: [], current: null, status: null });
  });
});

describe("sparkOf", () => {
  it("draws the line inside its box, the highest value on top, with a gap where a value is missing", () => {
    const spark = sparkOf([0, 10, null, 5], 5);
    expect(spark.path).toBe(`M${SPARK.pad.toFixed(1)},${(SPARK.height - SPARK.pad).toFixed(1)}L45.0,${SPARK.pad.toFixed(1)}M${(SPARK.width - SPARK.pad).toFixed(1)},15.0`);
    expect(spark.last).toEqual({ x: SPARK.width - SPARK.pad, y: 15 });
    expect(spark.guide).toBe(15);
  });

  it("leaves the guide out when the reference is outside what the line covers, and draws a flat line in the middle", () => {
    expect(sparkOf([2, 3], 1).guide).toBeNull();
    expect(sparkOf([4, 4, 4], 4)).toMatchObject({ guide: null, last: { y: SPARK.height / 2 } });
    expect(sparkOf([null, null], 0)).toEqual({ path: "", last: null, guide: null });
  });
});
