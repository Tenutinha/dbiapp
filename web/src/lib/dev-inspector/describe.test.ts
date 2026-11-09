import { describe, expect, it } from "vitest";
import {
  cleanComponentChain,
  cssSelector,
  describeElement,
  pickAttributes,
  squash,
  type InspectableElement,
} from "./describe";

interface FakeSpec {
  tag: string;
  id?: string;
  classes?: string[];
  attrs?: Record<string, string>;
  children?: FakeSpec[];
}

/** Builds a tiny element tree with just the surface the describer reads. */
function build(spec: FakeSpec, parent: InspectableElement | null = null): InspectableElement {
  const attrs = spec.attrs ?? {};
  const children: InspectableElement[] = [];
  const el: InspectableElement = {
    tagName: spec.tag.toUpperCase(),
    id: spec.id ?? "",
    classList: spec.classes ?? [],
    attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
    parentElement: parent,
    children,
  };
  children.push(...(spec.children ?? []).map((c) => build(c, el)));
  return el;
}

const find = (root: InspectableElement, path: number[]): InspectableElement =>
  path.reduce((el, i) => el.children[i], root);

describe("cssSelector", () => {
  const body = build({
    tag: "body",
    children: [
      {
        tag: "main",
        classes: ["mx-auto", "flex"],
        children: [
          { tag: "p", classes: ["text-sm"] },
          { tag: "p", classes: ["md:text-lg", "w-[10px]", "card"] },
          { tag: "section", id: "resumo", children: [{ tag: "a", classes: ["btn", "btn-primary"] }] },
        ],
      },
    ],
  });

  it("walks up to body with nth-of-type only where siblings share the tag", () => {
    expect(cssSelector(find(body, [0, 1]))).toBe("main.mx-auto.flex > p.card:nth-of-type(2)");
  });

  it("stops at a stable id", () => {
    expect(cssSelector(find(body, [0, 2, 0]))).toBe("#resumo > a.btn.btn-primary");
  });

  it("drops classes CSS cannot select without escaping (Tailwind variants, arbitrary values)", () => {
    expect(cssSelector(find(body, [0, 1]))).not.toContain("md:");
    expect(cssSelector(find(body, [0, 1]))).not.toContain("[");
  });

  it("ignores React-generated ids", () => {
    const tree = build({ tag: "body", children: [{ tag: "div", id: ":r1:", classes: ["card"] }] });
    expect(cssSelector(tree.children[0])).toBe("div.card");
  });

  it("returns body for body itself", () => {
    expect(cssSelector(body)).toBe("body");
  });
});

describe("cleanComponentChain", () => {
  it("keeps app components outermost-first, without framework internals, minified names or repeats", () => {
    const innermostFirst = [
      "MainHeader",
      "MainHeader",
      "Workspace",
      "a",
      "InnerLayoutRouter",
      "LayoutRouterContext",
      "SpaceHome",
      "AppRouter",
    ];
    expect(cleanComponentChain(innermostFirst)).toEqual(["SpaceHome", "Workspace", "MainHeader"]);
  });

  it("caps the chain at the innermost components", () => {
    const names = ["C1x", "C2x", "C3x", "C4x", "C5x", "C6x", "C7x", "C8x", "C9x"];
    expect(cleanComponentChain(names, 3)).toEqual(["C3x", "C2x", "C1x"]);
  });
});

describe("pickAttributes", () => {
  it("keeps attributes that identify the element and truncates long values", () => {
    const el = build({
      tag: "a",
      attrs: { href: "/mapa/catalogo", class: "btn", style: "color:red", "data-id": "x".repeat(200), "aria-label": "Abrir" },
    });
    const picked = pickAttributes(el);
    expect(Object.keys(picked)).toEqual(["href", "data-id", "aria-label"]);
    expect(picked["data-id"].length).toBeLessThanOrEqual(81);
  });
});

describe("squash", () => {
  it("collapses whitespace and truncates with an ellipsis", () => {
    expect(squash("  a \n\n b  ")).toBe("a b");
    expect(squash("abcdef", 4)).toBe("abc…");
  });
});

describe("describeElement", () => {
  it("produces a markdown brief an agent can act on", () => {
    const body = build({
      tag: "body",
      children: [{ tag: "a", classes: ["btn", "btn-primary"], attrs: { href: "/mapa/catalogo", class: "btn btn-primary" } }],
    });
    const text = describeElement({
      element: body.children[0],
      url: "http://localhost:3020/mapa",
      text: "  Adicionar\n dashboard ",
      components: ["SpaceHome", "Workspace"],
      heading: "Mapa da Votação",
      rect: { x: 20.4, y: 400, width: 160, height: 40.6 },
      html: '<a href="/mapa/catalogo" class="btn btn-primary">Adicionar dashboard</a>',
    });

    expect(text).toContain('Elemento: <a> "Adicionar dashboard"');
    expect(text).toContain("Página: /mapa (http://localhost:3020/mapa)");
    expect(text).toContain("Seletor: `a.btn.btn-primary`");
    expect(text).toContain("Componentes React: SpaceHome > Workspace");
    expect(text).toContain('Seção: "Mapa da Votação"');
    expect(text).toContain('href="/mapa/catalogo"');
    expect(text).toContain("160×41 px em (20, 400)");
    expect(text).toContain("```html\n<a href=");
  });

  it("omits lines it has nothing for", () => {
    const el = build({ tag: "div" });
    const text = describeElement({ element: el, url: "https://dbi.app.br/", text: "", components: [], heading: null, rect: null, html: "" });
    expect(text).not.toContain("Componentes React");
    expect(text).not.toContain("Seção");
    expect(text).not.toContain("```html");
    expect(text).toContain("Elemento: <div>");
  });
});
