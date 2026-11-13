import { describe, expect, it } from "vitest";
import type { TocGroup, TocItem } from "@/lib/layout/toc";
import { updatedLine } from "@/lib/layout/toc";

const item = (id: string, publishedAt: Date | null): TocItem => ({
  id, name: id, description: null, sectionId: null, position: 0, templateId: "t", published: true, publishedAt, number: 1,
});
const toc: TocGroup[] = [{ section: null, items: [item("a", new Date("2026-11-12T15:00:00Z")), item("b", null)] }];

describe("updatedLine", () => {
  it("tells when the open dashboard was updated", () => {
    expect(updatedLine(toc, "a")).toMatch(/^Atualizado em 12\/11\/2026$/);
  });

  it("is null without an open dashboard or a publication date", () => {
    expect(updatedLine(toc, null)).toBeNull();
    expect(updatedLine(toc, "b")).toBeNull();
    expect(updatedLine(toc, "x")).toBeNull();
  });
});
