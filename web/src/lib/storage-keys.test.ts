import { describe, expect, it } from "vitest";
import { isSameFiscalDocument } from "./storage-analysis";
import {
  brandingKey, clientFolder, dashboardFolder, datasetKey, fiscalFolder, fiscalNamedKey, fiscalPeriodFolder, isDatasetKey, isIssuedFiscalUploadKey, isIssuedUploadKey,
  isOrgLogoKey, isUserAvatarKey, isValidKey, orgFolder, spaceFolder, StorageKeyError, storableFileName, uploadKey, userAvatarKey,
} from "./storage-keys";

const INSTANCE = "3f9a2c1b-7d2e-4c1a-9b0f-1e2d3c4b5a69";
const OTHER = "a81c44e0-1111-4222-8333-944455556666";

describe("orgFolder", () => {
  it("puts each organization under orgs/<slug>/", () => {
    expect(orgFolder("acme")).toBe("orgs/acme/");
    expect(orgFolder("padaria-sol-2")).toBe("orgs/padaria-sol-2/");
  });

  it.each(["", "Acme", "acme/x", "../x", "-acme", "acme-", "a b", "acme.."])("rejects slug %j", (slug) => {
    expect(() => orgFolder(slug)).toThrow(StorageKeyError);
  });
});

describe("client and space folders", () => {
  it("gives each client a folder inside the organization's", () => {
    expect(clientFolder("acme", "loja-norte")).toBe("orgs/acme/clientes/loja-norte/");
    expect(spaceFolder("acme", "loja-norte")).toBe("orgs/acme/clientes/loja-norte/");
    expect(spaceFolder("acme", null)).toBe("orgs/acme/");
    expect(() => clientFolder("acme", "../x")).toThrow(StorageKeyError);
  });

  it("keeps raw fiscal files inside the space, by company and month", () => {
    const folder = fiscalFolder("acme", "loja-norte", "nfe");
    expect(folder).toBe("orgs/acme/clientes/loja-norte/fiscal/nfe/");
    expect(fiscalFolder("acme", null, "ecd")).toBe("orgs/acme/fiscal/ecd/");
    expect(fiscalPeriodFolder(folder, "11222333000181", "2025-02")).toBe("orgs/acme/clientes/loja-norte/fiscal/nfe/11222333000181/2025-02/");
  });

  it("accepts only fiscal raw uploads it issued", () => {
    expect(isIssuedFiscalUploadKey(`orgs/acme/uploads/${INSTANCE}/${OTHER}.xml`, "acme", INSTANCE)).toBe(true);
    expect(isIssuedFiscalUploadKey(`orgs/acme/uploads/${INSTANCE}/${OTHER}.csv`, "acme", INSTANCE)).toBe(false);
  });
});

describe("storableFileName", () => {
  it("keeps a safe, accent-free name with an allowed extension", () => {
    expect(storableFileName("Notas Março 2025.XML")).toBe("Notas-Marco-2025.xml");
    expect(storableFileName("SPED-EFD (1).txt")).toBe("SPED-EFD-1.txt");
    expect(storableFileName("../../etc/passwd.csv")).toBe("etc-passwd.csv");
  });

  it.each(["programa.exe", "sem-extensao", ".csv", "script.js"])("refuses %j", (name) => {
    expect(storableFileName(name)).toBeNull();
  });
});

describe("key builders", () => {
  it("builds dataset, upload and branding keys inside the org folder", () => {
    expect(datasetKey("acme", null, INSTANCE, "nfe", 3, "fato_vendas")).toMatch(
      new RegExp(`^orgs/acme/dashboards/nfe-3f9a2c1b/v3/fato_vendas\\.[0-9a-f]{8}\\.parquet$`),
    );
    expect(datasetKey("acme", "cliente-1", INSTANCE, "nfe", 3, "fato_vendas")).toMatch(
      new RegExp(`^orgs/acme/clientes/cliente-1/dashboards/nfe-3f9a2c1b/v3/fato_vendas\\.[0-9a-f]{8}\\.parquet$`),
    );
    expect(uploadKey("acme", INSTANCE, "csv")).toMatch(new RegExp(`^orgs/acme/uploads/${INSTANCE}/[0-9a-f-]{36}\\.csv$`));
    expect(brandingKey("acme", OTHER, "png")).toBe(`orgs/acme/branding/${OTHER}.png`);
  });

  it("produces valid storage keys", () => {
    expect(isValidKey(datasetKey("acme", "cliente-1", INSTANCE, "nfe", 1, "t"))).toBe(true);
    expect(() => datasetKey("acme", null, "../x", "nfe", 1, "t")).toThrow();
    expect(isValidKey(uploadKey("acme", INSTANCE, "parquet"))).toBe(true);
    expect(isValidKey(brandingKey("acme", OTHER, "svg"))).toBe(true);
  });
});

describe("isValidKey", () => {
  it("still accepts keys in the previous layout", () => {
    expect(isValidKey(`datasets/org/${INSTANCE}/v1/t.ab12cd34.parquet`)).toBe(true);
    expect(isValidKey(`incoming/${INSTANCE}/${OTHER}.csv`)).toBe(true);
    expect(isValidKey(`branding/org/${OTHER}.png`)).toBe(true);
  });

  it.each(["orgs/acme/../x", "orgs//x", "/etc/passwd", "secrets/gcs-key.json", "orgs/acme/a b"])("rejects %j", (key) => {
    expect(isValidKey(key)).toBe(false);
  });
});

describe("isIssuedUploadKey", () => {
  const key = `orgs/acme/uploads/${INSTANCE}/${OTHER}.csv`;

  it("accepts an upload key for the same org and dashboard", () => {
    expect(isIssuedUploadKey(key, "acme", INSTANCE)).toBe(true);
  });

  it("rejects keys from another org, dashboard or shape", () => {
    expect(isIssuedUploadKey(key, "other", INSTANCE)).toBe(false);
    expect(isIssuedUploadKey(key, "acme", OTHER)).toBe(false);
    expect(isIssuedUploadKey(`orgs/acme/uploads/${INSTANCE}/${OTHER}.exe`, "acme", INSTANCE)).toBe(false);
    expect(isIssuedUploadKey(`orgs/acme/uploads/${INSTANCE}/x/${OTHER}.csv`, "acme", INSTANCE)).toBe(false);
    expect(isIssuedUploadKey(`incoming/${INSTANCE}/${OTHER}.csv`, "acme", INSTANCE)).toBe(false);
  });
});

describe("isDatasetKey", () => {
  it("accepts the keys the app writes for that table of that version", () => {
    expect(isDatasetKey(datasetKey("acme", "c1", INSTANCE, "nfe", 3, "nfe_itens"), "acme", "c1", INSTANCE, "nfe", 3, "nfe_itens")).toBe(true);
    expect(isDatasetKey(datasetKey("acme", null, INSTANCE, "nfe", 3, "nfe_itens"), "acme", null, INSTANCE, "nfe", 3, "nfe_itens")).toBe(true);
  });

  it("names the dashboard's folder by its model and the start of its id", () => {
    expect(dashboardFolder("acme", "c1", INSTANCE, "efd-contribuicoes")).toBe("orgs/acme/clientes/c1/dashboards/efd-contribuicoes-3f9a2c1b/");
    expect(() => dashboardFolder("acme", "c1", INSTANCE, "../x")).toThrow(StorageKeyError);
  });

  it("still accepts drafts written in the folder named by the whole id", () => {
    const former = `orgs/acme/clientes/c1/dashboards/${INSTANCE}/v3/nfe_itens.1a2b3c4d.parquet`;
    expect(isDatasetKey(former, "acme", "c1", INSTANCE, "nfe", 3, "nfe_itens")).toBe(true);
    expect(isDatasetKey(former, "acme", "c1", OTHER, "nfe", 3, "nfe_itens")).toBe(false);
  });

  it("still accepts drafts written in the former datasets/ folder", () => {
    expect(isDatasetKey(`orgs/acme/datasets/${INSTANCE}/v3/nfe_itens.1a2b3c4d.parquet`, "acme", "c1", INSTANCE, "nfe", 3, "nfe_itens")).toBe(true);
  });

  it("rejects another org, client, dashboard, version, table or shape", () => {
    const key = `orgs/acme/clientes/c1/dashboards/nfe-3f9a2c1b/v3/nfe_itens.1a2b3c4d.parquet`;
    expect(isDatasetKey(key, "acme", "c1", INSTANCE, "nfe", 3, "nfe_itens")).toBe(true);
    expect(isDatasetKey(key, "other", "c1", INSTANCE, "nfe", 3, "nfe_itens")).toBe(false);
    expect(isDatasetKey(key, "acme", "c2", INSTANCE, "nfe", 3, "nfe_itens")).toBe(false);
    expect(isDatasetKey(key, "acme", "c1", OTHER, "nfe", 3, "nfe_itens")).toBe(false);
    expect(isDatasetKey(key, "acme", "c1", INSTANCE, "nfe", 4, "nfe_itens")).toBe(false);
    expect(isDatasetKey(key, "acme", "c1", INSTANCE, "nfe", 3, "nfe")).toBe(false);
    expect(isDatasetKey(`${key}\nx`, "acme", "c1", INSTANCE, "nfe", 3, "nfe_itens")).toBe(false);
    expect(isDatasetKey(`orgs/acme/datasets/${INSTANCE}/v3/nfe_itens.../x.parquet`, "acme", null, INSTANCE, "nfe", 3, "nfe_itens")).toBe(false);
    expect(isDatasetKey(`orgs/acme/uploads/${INSTANCE}/${OTHER}.parquet`, "acme", null, INSTANCE, "nfe", 3, "nfe_itens")).toBe(false);
  });
});

describe("isOrgLogoKey", () => {
  const org = { id: "org-id-1", slug: "acme" };

  it("recognizes the org's logos in both layouts", () => {
    expect(isOrgLogoKey(`orgs/acme/branding/${OTHER}.png`, org)).toBe(true);
    expect(isOrgLogoKey(`branding/org-id-1/${OTHER}.png`, org)).toBe(true);
  });

  it("rejects other orgs' logos", () => {
    expect(isOrgLogoKey(`orgs/acme-2/branding/${OTHER}.png`, org)).toBe(false);
    expect(isOrgLogoKey(`branding/org-id-2/${OTHER}.png`, org)).toBe(false);
  });
});

describe("user avatars", () => {
  it("live in the user's own folder and are valid keys", () => {
    const key = userAvatarKey(INSTANCE, OTHER, "png");
    expect(key).toBe(`users/${INSTANCE}/avatar/${OTHER}.png`);
    expect(isValidKey(key)).toBe(true);
    expect(isUserAvatarKey(key, INSTANCE)).toBe(true);
  });

  it("never belong to someone else, and refuse a non-uuid user id", () => {
    expect(isUserAvatarKey(`users/${OTHER}/avatar/${INSTANCE}.png`, INSTANCE)).toBe(false);
    expect(() => userAvatarKey("../x", OTHER, "png")).toThrow(StorageKeyError);
  });
});

describe("fiscal files keep their own name", () => {
  const folder = "orgs/davos/clientes/martinello/fiscal/efd-contribuicoes/";
  const period = fiscalPeriodFolder(folder, "32951535000134", "2019-01");

  it("files the original name in the standard period folder", () => {
    const name = "PISCOFINS_20190101_20190131_32951535000134_Original_20190306115124_25E8943EB18A9E1F3.txt";
    expect(fiscalNamedKey(period, name, new Set())).toBe(`${period}${name}`);
    expect(isValidKey(fiscalNamedKey(period, name, new Set()))).toBe(true);
  });

  it("cleans only what a key cannot hold, and never overwrites another document", () => {
    expect(fiscalNamedKey(period, "Nota fiscal março.xml", new Set())).toBe(`${period}Nota-fiscal-marco.xml`);
    expect(fiscalNamedKey(period, "nota.xml", new Set(["nota.xml", "nota-2.xml"]))).toBe(`${period}nota-3.xml`);
  });

  it("recognizes the same document: any older SPED of the period, a NF-e by its key, former names", () => {
    expect(isSameFiscalDocument("PISCOFINS_retificadora.txt", "efd-contribuicoes", "txt")).toBe(true);
    expect(isSameFiscalDocument("planilha.xml", "efd-contribuicoes", "txt")).toBe(false);
    const chave = "3".repeat(44);
    expect(isSameFiscalDocument(`${chave}-nfe.xml`, chave, "xml")).toBe(true);
    expect(isSameFiscalDocument(`${"4".repeat(44)}-nfe.xml`, chave, "xml")).toBe(false);
    expect(isSameFiscalDocument(`${chave}.1a2b3c4d.xml`, chave, "xml")).toBe(true);
    expect(isSameFiscalDocument("efd-contribuicoes.1a2b3c4d.txt", "efd-contribuicoes", "txt")).toBe(true);
  });

  it("rejects an invalid company or period", () => {
    expect(() => fiscalPeriodFolder(folder, "123", "2019-01")).toThrow(StorageKeyError);
    expect(() => fiscalPeriodFolder(folder, "32951535000134", "2019-13")).toThrow(StorageKeyError);
  });
});
