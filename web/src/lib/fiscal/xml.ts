/**
 * Minimal XML reader for NF-e documents: elements, attributes and text, no DTD/entities beyond the
 * five predefined ones. Enough for the regular, machine-generated NF-e layout. Pure: no I/O.
 */

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e.startsWith("#x")) return String.fromCodePoint(Number.parseInt(e.slice(2), 16));
    if (e.startsWith("#")) return String.fromCodePoint(Number.parseInt(e.slice(1), 10));
    return ENTITIES[e];
  });
}

/** Local name without namespace prefix ("nfe:infNFe" → "infNFe"). */
const local = (name: string): string => name.slice(name.indexOf(":") + 1);

export function parseXml(source: string): XmlNode {
  const root: XmlNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  const tag = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<\/\s*([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let last = 0;
  for (let m = tag.exec(source); m; m = tag.exec(source)) {
    const top = stack[stack.length - 1];
    const between = source.slice(last, m.index);
    if (between.trim() !== "") top.text += decode(between);
    last = tag.lastIndex;
    if (m[1] !== undefined) {
      top.text += m[1];
    } else if (m[2] !== undefined) {
      if (stack.length > 1 && local(top.name) === local(m[2])) stack.pop();
    } else if (m[3] !== undefined) {
      const attrs: Record<string, string> = {};
      for (const a of (m[4] ?? "").matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        attrs[local(a[1])] = decode(a[2] ?? a[3] ?? "");
      }
      const node: XmlNode = { name: local(m[3]), attrs, children: [], text: "" };
      top.children.push(node);
      if (m[5] !== "/") stack.push(node);
    }
  }
  return root;
}

/** First descendant (depth-first) with that name. */
export function find(node: XmlNode | undefined, name: string): XmlNode | undefined {
  if (!node) return undefined;
  for (const c of node.children) {
    if (c.name === name) return c;
    const deep = find(c, name);
    if (deep) return deep;
  }
  return undefined;
}

/** Direct children with that name. */
export function childrenNamed(node: XmlNode | undefined, name: string): XmlNode[] {
  return node ? node.children.filter((c) => c.name === name) : [];
}

/** Trimmed text of the first descendant with that name; empty → null. */
export function textOf(node: XmlNode | undefined, name: string): string | null {
  const t = find(node, name)?.text.trim() ?? "";
  return t === "" ? null : t;
}
