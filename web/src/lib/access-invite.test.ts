import { describe, expect, it } from "vitest";
import { grantMessage, resendMessage } from "./access-invite";

describe("grantMessage", () => {
  it("says only that access was granted when no invitation was asked", () => {
    expect(grantMessage("ana@x.com", null)).toEqual({ ok: true, message: "Acesso concedido a ana@x.com." });
  });
  it("tells the invitation went out", () => {
    const r = grantMessage("ana@x.com", "sent");
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/convite enviado para ana@x.com/);
  });
  it("keeps the access but flags an e-mail that did not go out", () => {
    for (const outcome of ["unavailable", "rate_limited", "failed"] as const) {
      const r = grantMessage("ana@x.com", outcome);
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/^Acesso concedido a ana@x.com, mas o convite não foi enviado/);
    }
    expect(grantMessage("ana@x.com", "rate_limited").message).toMatch(/alguns minutos/);
  });
});

describe("resendMessage", () => {
  it("confirms or explains", () => {
    expect(resendMessage("ana@x.com", "sent")).toEqual({ ok: true, message: "Convite reenviado para ana@x.com." });
    expect(resendMessage("ana@x.com", "unavailable").ok).toBe(false);
  });
});
