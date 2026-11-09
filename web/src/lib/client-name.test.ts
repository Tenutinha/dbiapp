import { describe, expect, it } from "vitest";
import { clientNameSchema } from "./client-name";

describe("clientNameSchema", () => {
  it("trims and accepts a normal name", () => {
    expect(clientNameSchema.parse("  Unimed Araguaia  ")).toBe("Unimed Araguaia");
  });

  it("collapses repeated spaces", () => {
    expect(clientNameSchema.parse("Padaria   São   José")).toBe("Padaria São José");
  });

  it("rejects too short or too long names with a friendly message", () => {
    expect(clientNameSchema.safeParse("A").error?.issues[0]?.message).toBe("Informe o nome do cliente.");
    expect(clientNameSchema.safeParse("x".repeat(81)).success).toBe(false);
  });
});
