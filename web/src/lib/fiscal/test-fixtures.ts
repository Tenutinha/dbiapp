/** Small synthetic fiscal files for tests (no real company data). */

const latin1 = (s: string): Uint8Array => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
const sped = (lines: string[]): Uint8Array => latin1(`${lines.join("\r\n")}\r\n`);

export const EFD_ICMS = sped([
  "|0000|018|0|01012025|31012025|AUTO PEÇAS TESTE LTDA|11222333000181||SP|123456789|3550308||||A|1|",
  "|0150|F01|FORNECEDOR UM|01058|44555666000199||987|4106902||RUA|1||CENTRO|",
  "|0200|P1|AMORTECEDOR||||00|87088000||||12,00||",
  "|C100|0|1|F01|55|00|1|123|35250144555666000199550010000001231000001234|05012025|06012025|1000,00|",
  "|C170|1|P1||2|UN|1000,00|0|0|000|2102||1000,00|12,00|120,00|",
  "|C190|000|2102|12,00|1000,00|1000,00|120,00|0,00|0,00|0,00|50,00||",
  "|C100|1|0||55|00|1|900|35250111222333000181550010000009001000009009|10012025|10012025|500,00|",
  "|C190|000|5102|18,00|300,00|300,00|54,00|0,00|0,00|0,00|0,00||",
  "|C190|060|5405|0,00|200,00|0,00|0,00|0,00|0,00|0,00|0,00||",
  "|9999|8|",
]);

export const EFD_CONTRIB = sped([
  "|0000|006|0|||01012025|31012025|AUTO PEÇAS TESTE LTDA|11222333000181|SP|3550308||00|1|",
  "|0140||AUTO PEÇAS TESTE LTDA|11222333000181|SP|123|3550308|||",
  "|0150|C01|CLIENTE UM|01058|55666777000188||||3304557||||||",
  "|0200|P1|AMORTECEDOR|||UN|00|87088000||||",
  "|A001|0|",
  "|A010|11222333000181|",
  "|A100|1|0|C01|00|1||501||10012025|10012025|600,00|1|0|600,00|9,90|600,00|45,60|0|0|24,00|",
  "|A170|1|P1|INSTALACAO|600,00|0|||01|600,00|1,65|9,90|01|600,00|7,6|45,60|||",
  "|A100|1|0|C01|02|1||502||11012025|11012025|300,00|1|0|0|0|0|0|0|0|0|",
  "|A990|6|",
  "|C010|11222333000181|2|",
  `|C100|1|0|C01|55|00|1|77|${"3".repeat(44)}|15012025|15012025|1000,00|`,
  "|C170|1|P1||2|UN|1000,00|0|0|000|5102||1000|18|180|0|0|0|0|||0|0|0|01|1000,00|1,65|||16,50|01|1000,00|7,6|||76,00||",
  "|F010|11222333000181|",
  "|F100|0|C01|P1|20012025|200,00|50|200,00|1,65|3,30|50|200,00|7,6|15,20|13|0||||",
  "|M001|0|",
  "|M200|26,40|3,30|0|23,10|0|0|23,10|0|0|0|0|23,10|",
  "|M600|121,60|15,20|0|106,40|0|0|106,40|0|0|0|0|106,40|",
  "|M990|4|",
  "|9999|19|",
]);

export const ECD = sped([
  "|0000|LECD|01012025|31122025|EMPRESA TESTE SA|11222333000181|SP||3550308||0|0|0|0||0|0||N|N|0|0|1|",
  "|I050|01012020|01|S|1|1||ATIVO|",
  "|I050|01012020|01|S|2|1.1|1|ATIVO CIRCULANTE|",
  "|I050|01012020|01|A|3|1.1.01|1.1|CAIXA|",
  "|I051||1.01.01.01.01|",
  "|I050|01012020|04|S|1|3||RESULTADO|",
  "|I050|01012020|04|A|2|3.01|3|RECEITA DE VENDAS|",
  "|I150|01012025|31012025|",
  "|I155|1.1.01||100,00|D|50,00|30,00|120,00|D|",
  "|I155|3.01||0,00|D|0,00|500,00|500,00|C|",
  "|9999|9|",
]);

export const nfeXml = (status = "100"): Uint8Array => new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${"1".repeat(44)}" versao="4.00">
<ide><mod>55</mod><serie>1</serie><nNF>321</nNF><dhEmi>2025-02-14T10:00:00-03:00</dhEmi><tpNF>1</tpNF><finNFe>1</finNFe></ide>
<emit><CNPJ>11222333000181</CNPJ><xNome>AUTO PE&#199;AS &amp; CIA</xNome><enderEmit><xMun>Sao Paulo</xMun><UF>SP</UF></enderEmit></emit>
<dest><CPF>12345678909</CPF><xNome>CONSUMIDOR</xNome><enderDest><xMun>Curitiba</xMun><UF>PR</UF></enderDest></dest>
<det nItem="1"><prod><cProd>P1</cProd><xProd>AMORTECEDOR</xProd><NCM>87088000</NCM><CFOP>6102</CFOP><uCom>UN</uCom><qCom>2.0000</qCom><vProd>300.00</vProd><vDesc>10.00</vDesc></prod>
<imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>290.00</vBC><pICMS>12.00</pICMS><vICMS>34.80</vICMS></ICMS00></ICMS>
<PIS><PISAliq><CST>01</CST><vPIS>4.79</vPIS></PISAliq></PIS><COFINS><COFINSAliq><CST>01</CST><vCOFINS>22.04</vCOFINS></COFINSAliq></COFINS></imposto></det>
<det nItem="2"><prod><cProd>P2</cProd><xProd>OLEO</xProd><NCM>27101932</NCM><CFOP>6405</CFOP><qCom>1</qCom><vProd>50.00</vProd></prod>
<imposto><ICMS><ICMSSN500><orig>0</orig><CSOSN>500</CSOSN></ICMSSN500></ICMS></imposto></det>
</infNFe></NFe><protNFe><infProt><chNFe>${"1".repeat(44)}</chNFe><cStat>${status}</cStat></infProt></protNFe></nfeProc>`);

/** One sample file per fiscal template. */
export const SAMPLE_FILES: Readonly<Record<string, Uint8Array>> = {
  "efd-icms-ipi": EFD_ICMS,
  "efd-contribuicoes": EFD_CONTRIB,
  ecd: ECD,
  nfe: nfeXml(),
};

export const asLatin1 = latin1;
