import { describe, expect, it } from "vitest";
import {
  brandingKey, datasetKey, isIssuedUploadKey, isOrgLogoKey, isValidKey, orgFolder, StorageKeyError, uploadKey,
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

describe("key builders", () => {
  it("builds dataset, upload and branding keys inside the org folder", () => {
    expect(datasetKey("acme", INSTANCE, 3, "fato_vendas")).toMatch(
      new RegExp(`^orgs/acme/datasets/${INSTANCE}/v3/fato_vendas\\.[0-9a-f]{8}\\.parquet$`),
    );
    expect(uploadKey("acme", INSTANCE, "csv")).toMatch(new RegExp(`^orgs/acme/uploads/${INSTANCE}/[0-9a-f-]{36}\\.csv$`));
    expect(brandingKey("acme", OTHER, "png")).toBe(`orgs/acme/branding/${OTHER}.png`);
  });

  it("produces valid storage keys", () => {
    expect(isValidKey(datasetKey("acme", INSTANCE, 1, "t"))).toBe(true);
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
