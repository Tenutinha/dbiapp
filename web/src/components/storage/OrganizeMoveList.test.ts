import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MOVE_PAGE, OrganizeMoveList } from "./OrganizeMoveList";

const movesOf = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ path: `clientes/x/f${i}.txt`, to: `clientes/x/fiscal/sped/${i}`, layout: "SPED", suggested: true, replaces: false }));

const render = (n: number) => renderToStaticMarkup(createElement(OrganizeMoveList, { moves: movesOf(n), chosen: new Set<string>(), onToggle: () => {} }));
const rows = (html: string) => html.match(/type="checkbox"/g)?.length ?? 0;

describe("OrganizeMoveList", () => {
  it("draws only the first page of a long list, with a note to scroll for more", () => {
    const html = render(1421);
    expect(rows(html)).toBe(MOVE_PAGE);
    expect(html).toContain(`Mostrando ${MOVE_PAGE} de 1421`);
  });

  it("draws a short list whole, without the note", () => {
    const html = render(7);
    expect(rows(html)).toBe(7);
    expect(html).not.toContain("Mostrando");
  });
});
