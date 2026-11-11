import { describe, expect, it } from "vitest";
import { appManifest, orgAppName, orgManifestHref } from "./pwa";

describe("aplicativo instalável", () => {
  it("leva o nome da organização", () => {
    expect(orgAppName("Controle")).toBe("DBI-Controle");
    expect(orgAppName("  Mapa  da\nVotação ")).toBe("DBI-Mapa da Votação");
    expect(orgAppName("")).toBe("DBI");
    expect(orgAppName("x".repeat(200))).toHaveLength("DBI-".length + 60);
  });

  it("o manifesto da organização abre nela; o geral, na raiz", () => {
    expect(appManifest({ slug: "controle", name: "Controle" })).toMatchObject({
      id: "/controle", name: "DBI-Controle", short_name: "DBI-Controle", start_url: "/controle", scope: "/",
    });
    expect(appManifest()).toMatchObject({ id: "/", name: "DBI", start_url: "/" });
  });

  it("o endereço do manifesto carrega o nome", () => {
    expect(orgManifestHref("mapa-da-votacao", "Mapa da Votação")).toBe("/mapa-da-votacao/app.webmanifest?nome=Mapa%20da%20Vota%C3%A7%C3%A3o");
  });
});
