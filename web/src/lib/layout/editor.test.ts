import { describe, expect, it } from "vitest";
import {
  addSection, fromToc, moveItem, nudgeItem, nudgeSection, removeSection, renameSection, toDraft, UNGROUPED_KEY, updateItem,
  type EdGroup,
} from "./editor";

const item = (id: string) => ({ id, name: id.toUpperCase(), description: "", published: true });
const base: EdGroup[] = [
  { key: UNGROUPED_KEY, id: null, title: "", ungrouped: true, items: [item("a")] },
  { key: "s1", id: "s1", title: "Comercial", ungrouped: false, items: [item("b"), item("c")] },
  { key: "s2", id: "s2", title: "Financeiro", ungrouped: false, items: [item("d")] },
];
const order = (gs: EdGroup[]) => gs.map((g) => `${g.key}:${g.items.map((i) => i.id).join("")}`);

describe("sidebar editor ops", () => {
  it("moves an item across groups without mutating the input", () => {
    const next = moveItem(base, "b", "s2", 1);
    expect(order(next)).toEqual([`${UNGROUPED_KEY}:a`, "s1:c", "s2:db"]);
    expect(order(base)).toEqual([`${UNGROUPED_KEY}:a`, "s1:bc", "s2:d"]);
  });

  it("nudges within a group and across group edges", () => {
    expect(order(nudgeItem(base, "c", -1))).toEqual([`${UNGROUPED_KEY}:a`, "s1:cb", "s2:d"]);
    expect(order(nudgeItem(base, "b", -1))).toEqual([`${UNGROUPED_KEY}:ab`, "s1:c", "s2:d"]);
    expect(order(nudgeItem(base, "c", 1))).toEqual([`${UNGROUPED_KEY}:a`, "s1:b", "s2:cd"]);
    expect(order(nudgeItem(base, "d", 1))).toEqual(order(base));
  });

  it("removing a section keeps its dashboards (unsectioned, at the end)", () => {
    expect(order(removeSection(base, "s1"))).toEqual([`${UNGROUPED_KEY}:abc`, "s2:d"]);
    expect(order(removeSection(base, UNGROUPED_KEY))).toEqual(order(base));
  });

  it("reorders sections but never moves the unsectioned group", () => {
    expect(nudgeSection(base, "s2", -1).map((g) => g.key)).toEqual([UNGROUPED_KEY, "s2", "s1"]);
    expect(nudgeSection(base, "s1", -1).map((g) => g.key)).toEqual([UNGROUPED_KEY, "s1", "s2"]);
  });

  it("builds the server draft, with new sections as id null", () => {
    let g = addSection(base, "new-1", "RH");
    g = renameSection(g, "s1", "Vendas");
    g = updateItem(g, "a", { name: "Visão geral", description: "Resumo" });
    g = moveItem(g, "d", "new-1", 0);
    expect(toDraft(g)).toEqual({
      ungrouped: ["a"],
      sections: [
        { id: "s1", title: "Vendas", items: ["b", "c"] },
        { id: "s2", title: "Financeiro", items: [] },
        { id: null, title: "RH", items: ["d"] },
      ],
      dashboards: [
        { id: "a", name: "Visão geral", description: "Resumo" },
        { id: "b", name: "B", description: "" },
        { id: "c", name: "C", description: "" },
        { id: "d", name: "D", description: "" },
      ],
    });
  });

  it("fromToc always starts with the unsectioned group", () => {
    const groups = fromToc([{ section: { id: "s1", title: "X" }, items: [] }]);
    expect(groups.map((g) => g.key)).toEqual([UNGROUPED_KEY, "s1"]);
  });
});
