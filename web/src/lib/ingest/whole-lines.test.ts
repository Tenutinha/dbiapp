import { describe, expect, it } from "vitest";
import { wholeLines } from "./whole-lines";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const text = (data: Uint8Array | null): string | null => (data ? new TextDecoder().decode(data) : null);

describe("wholeLines", () => {
  it("drops the line that was cut in the middle", () => {
    expect(text(wholeLines(bytes("a;b\n1;2\n3;")))).toBe("a;b\n1;2\n");
  });

  it("keeps a piece that already ends at a line break", () => {
    expect(text(wholeLines(bytes("a;b\r\n1;2\r\n")))).toBe("a;b\r\n1;2\r\n");
  });

  it("is null without a header and at least one whole row", () => {
    expect(wholeLines(bytes("a;b\n1;"))).toBeNull();
    expect(wholeLines(bytes("a;b"))).toBeNull();
    expect(wholeLines(bytes(""))).toBeNull();
  });
});
