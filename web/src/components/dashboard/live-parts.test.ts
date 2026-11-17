import { describe, expect, it } from "vitest";
import { shownSelection } from "./filter-selection";
import { planBatches } from "./live-batch";
import type { FilterData, PartAnswer } from "./live-types";
import { nextLoad, type PartState } from "./part-state";

const state = (over: Partial<PartState<string | null>> = {}): PartState<string | null> => ({ loaded: null, body: null, loading: null, failed: null, ...over });

describe("nextLoad", () => {
  it("asks only when the part is on screen or about to be", () => {
    expect(nextLoad(state(), "f.ano=2024", false)).toBeNull();
    expect(nextLoad(state(), "f.ano=2024", true)).toBe("f.ano=2024");
  });

  it("asks again when the selection changes, and not for what it already shows or is asking for", () => {
    const shown = state({ loaded: "", body: "numbers" });
    expect(nextLoad(shown, "", true)).toBeNull();
    expect(nextLoad(shown, "f.ano=2024", true)).toBe("f.ano=2024");
    expect(nextLoad({ ...shown, loading: "f.ano=2024" }, "f.ano=2024", true)).toBeNull();
    // The reader changed their mind while it was asking: the new selection is asked for (the part drops the old answer).
    expect(nextLoad({ ...shown, loading: "f.ano=2024" }, "f.ano=2025", true)).toBe("f.ano=2025");
  });

  it("does not insist on a selection that failed until the reader tries again", () => {
    expect(nextLoad(state({ failed: "f.ano=2024" }), "f.ano=2024", true)).toBeNull();
    expect(nextLoad(state({ failed: null }), "f.ano=2024", true)).toBe("f.ano=2024");
    expect(nextLoad(state({ failed: "f.ano=2024" }), "f.ano=2025", true)).toBe("f.ano=2025");
  });
});

describe("planBatches", () => {
  it("sends the parts asked for together in one call per selection, each part once", () => {
    const got: string[] = [];
    const ask = (part: string, search: string) => ({ part, search, resolve: (a: PartAnswer) => void got.push(`${part}:${a.ok}`) });
    const batches = planBatches([ask("visao", "a=1"), ask("", "a=1"), ask("visao", "a=1"), ask("cfop", "a=2")]);
    expect(batches.map((b) => [b.search, b.parts])).toEqual([["a=1", ["visao", ""]], ["a=2", ["cfop"]]]);
    // Each answer goes to everyone who asked for that part.
    batches[0].requests[0].resolve({ ok: true, body: null });
    batches[0].requests[1].resolve({ ok: false });
    expect(got).toEqual(["visao:true", "visao:true", ":false"]);
    expect(planBatches([])).toEqual([]);
  });
});

describe("shownSelection", () => {
  const data: FilterData = {
    filters: [
      { fieldId: "ano", label: "Ano", values: ["2023", "2024"], selected: [], single: false },
      { fieldId: "cargo", label: "Cargo", values: ["A", "B"], selected: ["A"], single: true },
    ],
    cross: [{ visualId: "d_grupo", fieldId: "grupo", values: ["Sul"], label: "Grupo", visualTitle: "Por grupo" }],
  };

  it("shows what the address says is chosen over the options it had", () => {
    const shown = shownSelection(data, new URLSearchParams("f.ano=2024&f.ano=2023&x.d_grupo.grupo=Sul&x.d_grupo.grupo=Norte"));
    expect(shown.filters[0].selected).toEqual(["2024", "2023"]);
    expect(shown.filters[0].values).toEqual(["2023", "2024"]);
    expect(shown.cross[0].values).toEqual(["Sul", "Norte"]);
  });

  it("keeps what the server settled for a single-choice filter until the address names one", () => {
    expect(shownSelection(data, new URLSearchParams("")).filters[1].selected).toEqual(["A"]);
    expect(shownSelection(data, new URLSearchParams("f.cargo=B")).filters[1].selected).toEqual(["B"]);
  });

  it("drops at once a filter or a picked item the address no longer holds", () => {
    const chosen: FilterData = { ...data, filters: [{ ...data.filters[0], selected: ["2024"] }] };
    const shown = shownSelection(chosen, new URLSearchParams(""));
    expect(shown.filters[0].selected).toEqual([]);
    expect(shown.cross).toEqual([]);
  });
});
