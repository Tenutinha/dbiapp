import { describe, expect, it } from "vitest";
import { purchaseInput, saleInput } from "./schema";
import { joinQuery, parseStatus, STATUS_LABEL, statusQuery } from "./status";

describe("situação do lançamento", () => {
  it("o filtro da tela vem do endereço; o resto é 'todos'", () => {
    expect(parseStatus("pendente")).toBe("pendente");
    expect(parseStatus(["efetivado", "pendente"])).toBe("efetivado");
    expect(parseStatus("pago")).toBeNull();
    expect(parseStatus(undefined)).toBeNull();
  });

  it("o endereço junta período e situação", () => {
    expect(joinQuery("mes=2026-10", statusQuery("pendente"))).toBe("mes=2026-10&status=pendente");
    expect(joinQuery("", statusQuery("efetivado"))).toBe("status=efetivado");
    expect(joinQuery("dias=15", statusQuery(null))).toBe("dias=15");
    expect(joinQuery("", "")).toBe("");
  });

  it("venda e despesa falam cada uma a sua língua", () => {
    expect(STATUS_LABEL.venda.pendente).toBe("A receber");
    expect(STATUS_LABEL.despesa.efetivado).toBe("Paga");
  });

  it("a API aceita pendente, e quem não manda a situação continua efetivado", () => {
    const sale = { soldOn: "2026-11-11", totalCents: 100 };
    expect(saleInput.parse({ ...sale, status: "pendente" }).status).toBe("pendente");
    expect(saleInput.parse(sale).status).toBe("efetivado");
    expect(saleInput.safeParse({ ...sale, status: "pago" }).success).toBe(false);
    const purchase = { purchasedOn: "2026-11-11", totalCents: 100, items: [] };
    expect(purchaseInput.parse({ ...purchase, status: "pendente" }).status).toBe("pendente");
    expect(purchaseInput.parse(purchase).status).toBe("efetivado");
  });
});
