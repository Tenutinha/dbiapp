import { describe, expect, it } from "vitest";
import { cameraError, classifyCodes, decodeSize } from "./scan";

// Chave fictícia de NFC-e (PR, modelo 65) com dígito verificador válido — a mesma de nfce.test.ts.
const KEY = "41261112345678000190650010000123451000123456";
const NFCE_QR = `http://www.fazenda.pr.gov.br/nfce/qrcode?p=${KEY}|2|1|1|ABCDEF0123`;

describe("leitor de QR Code ao vivo", () => {
  it("reduz o quadro do vídeo sem aumentar quadros pequenos", () => {
    expect(decodeSize(1920, 1080)).toEqual({ width: 800, height: 450 });
    expect(decodeSize(1080, 1920)).toEqual({ width: 450, height: 800 });
    expect(decodeSize(640, 480)).toEqual({ width: 640, height: 480 });
    expect(decodeSize(0, 0)).toEqual({ width: 1, height: 1 });
  });

  it("reconhece o QR Code da NFC-e, mesmo junto de outros códigos", () => {
    expect(classifyCodes([` ${NFCE_QR} `])).toEqual({ kind: "nfce", qr: NFCE_QR });
    expect(classifyCodes(["00020126580014br.gov.bcb.pix", NFCE_QR])).toEqual({ kind: "nfce", qr: NFCE_QR });
  });

  it("outro QR Code não dispara a consulta; sem código, nada a dizer", () => {
    expect(classifyCodes(["00020126580014br.gov.bcb.pix"])).toEqual({ kind: "other" });
    expect(classifyCodes([`https://golpe.com/qrcode?p=${KEY}|2|1|1|X`])).toEqual({ kind: "other" });
    expect(classifyCodes([])).toBeNull();
  });

  it("explica cada falha ao abrir a câmera", () => {
    const named = (name: string): Error => Object.assign(new Error("x"), { name });
    expect(cameraError(named("NotAllowedError"))).toMatch(/negado/);
    expect(cameraError(named("NotFoundError"))).toMatch(/Não encontrei/);
    expect(cameraError(named("NotReadableError"))).toMatch(/em uso/);
    expect(cameraError("?")).toMatch(/Não consegui abrir/);
  });
});
