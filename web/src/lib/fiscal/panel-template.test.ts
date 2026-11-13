import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FISCAL_PANEL_TEMPLATE } from "./panel";
import { templateSchema } from "../templates/schema";

describe("the panel's catalog entry", () => {
  it("is a valid built-in template named by the panel's id", async () => {
    const raw: unknown = JSON.parse(await readFile(path.join(process.cwd(), "templates", FISCAL_PANEL_TEMPLATE, "template.json"), "utf8"));
    const parsed = templateSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.id).toBe(FISCAL_PANEL_TEMPLATE);
  });
});
