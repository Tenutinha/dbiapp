/**
 * Organiza a pasta do Mapa da Votação no bucket (orgs/mapa-da-votacao/) — regras em organizar-destino.ts.
 *
 *   npm run mapadavotacao:organizar                     plano (não move nada): resumo + plano.json
 *   npm run mapadavotacao:organizar -- aplicar          move tudo, menos as fotos
 *   npm run mapadavotacao:organizar -- aplicar fotos    move só midia/fotos (600 mil+ arquivos)
 *
 * Mover = copiar dentro do Google (os dados não passam por esta máquina), conferir o hash e só então apagar
 * a origem. Cópias idênticas indo para o mesmo destino viram uma só; diferentes vão para
 * arquivo-morto/duplicados/. Rodar de novo retoma de onde parou.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Storage, type Bucket, type File } from "@google-cloud/storage";
import { destinoDe, destinoDuplicado } from "./organizar-destino";

const BUCKET = "dbi-app-br-arquivos";
const ORG = "orgs/mapa-da-votacao/";
const KEY_FILE = path.join(process.cwd(), "secrets", "gcs-key.json");
const SAIDA = path.join(process.cwd(), "sample-data", "organizar-mapa");
const FOTOS = `${ORG}acervo/fotos/`;
const CONCORRENCIA = 32;

interface Movimento { de: string; para: string; bytes: number; hash: string; acao: "mover" | "duplicado-igual" }

const hashDe = (f: File): string => String(f.metadata.md5Hash ?? f.metadata.crc32c ?? "");
const rel = (key: string): string => key.slice(ORG.length);

async function* listar(bucket: Bucket, prefix: string): AsyncGenerator<File[]> {
  let pageToken: string | undefined;
  do {
    const [files, next] = await bucket.getFiles({ prefix, autoPaginate: false, maxResults: 1000, pageToken });
    yield files;
    pageToken = (next as { pageToken?: string } | null)?.pageToken;
  } while (pageToken);
}

async function pastasDe(bucket: Bucket, prefix: string): Promise<string[]> {
  const [, , resp] = await bucket.getFiles({ prefix, delimiter: "/", autoPaginate: false, maxResults: 1000 });
  return ((resp as { prefixes?: string[] } | undefined)?.prefixes) ?? [];
}

/** Tudo o que deve mudar de lugar, menos as fotos (que são movidas em fluxo, página a página). */
async function planejar(bucket: Bucket): Promise<Movimento[]> {
  const prefixos = [...(await pastasDe(bucket, `${ORG}acervo/`)).filter((p) => p !== FOTOS), `${ORG}preparado/`];
  const itens: { de: string; para: string; bytes: number; hash: string }[] = [];
  const soltos = (await bucket.getFiles({ prefix: `${ORG}acervo/`, delimiter: "/", autoPaginate: false }))[0];
  for (const f of soltos) {
    const para = destinoDe(rel(f.name));
    if (para) itens.push({ de: f.name, para: ORG + para, bytes: Number(f.metadata.size ?? 0), hash: hashDe(f) });
  }
  for (const prefixo of prefixos) {
    for await (const pagina of listar(bucket, prefixo)) {
      for (const f of pagina) {
        const para = destinoDe(rel(f.name));
        if (para) itens.push({ de: f.name, para: ORG + para, bytes: Number(f.metadata.size ?? 0), hash: hashDe(f) });
      }
    }
  }
  // Colisões: o primeiro (em ordem) fica com o destino; iguais a ele viram duplicado; diferentes vão à parte.
  itens.sort((a, b) => a.de.localeCompare(b.de));
  const vencedor = new Map<string, { hash: string }>();
  return itens.map((i): Movimento => {
    const ja = vencedor.get(i.para);
    if (!ja) {
      vencedor.set(i.para, { hash: i.hash });
      return { ...i, acao: "mover" };
    }
    if (ja.hash && ja.hash === i.hash) return { ...i, acao: "duplicado-igual" };
    return { ...i, para: ORG + destinoDuplicado(rel(i.de)), acao: "mover" };
  });
}

function resumo(movs: readonly Movimento[]): void {
  const grupos = new Map<string, { n: number; gb: number }>();
  for (const m of movs) {
    const r = rel(m.para).split("/");
    const k = m.acao === "duplicado-igual" ? "(duplicado idêntico — só apaga)" : r.slice(0, r[0] === "brutos" ? 3 : 2).join("/");
    const g = grupos.get(k) ?? { n: 0, gb: 0 };
    g.n += 1;
    g.gb += m.bytes / 1e9;
    grupos.set(k, g);
  }
  console.log(`${movs.length} arquivos a mover (sem contar as fotos):`);
  for (const [k, g] of [...grupos].sort()) console.log(`  ${k.padEnd(48)} ${String(g.n).padStart(5)}  ${g.gb.toFixed(2).padStart(7)} GB`);
  const mortos = movs.filter((m) => rel(m.para).startsWith("arquivo-morto/acervo/") || rel(m.para).startsWith("arquivo-morto/duplicados/"));
  if (mortos.length) {
    console.log("Sem regra (vão para arquivo-morto):");
    for (const m of mortos.slice(0, 40)) console.log(`  ${rel(m.de)}`);
  }
}

/** Move um arquivo com segurança; idempotente (se o destino já tem o mesmo conteúdo, só apaga a origem). */
async function mover(bucket: Bucket, m: Movimento): Promise<"movido" | "ja-estava" | "sem-origem"> {
  const origem = bucket.file(m.de);
  const [existeOrigem] = await origem.exists();
  if (!existeOrigem) return "sem-origem";
  const destino = bucket.file(m.para);
  if (m.acao !== "duplicado-igual") {
    const [existeDestino] = await destino.exists();
    if (existeDestino) {
      const [meta] = await destino.getMetadata();
      if (String(meta.md5Hash ?? meta.crc32c ?? "") !== m.hash) {
        throw new Error(`destino já existe com outro conteúdo: ${m.para}`);
      }
    } else {
      await origem.copy(destino);
      const [meta] = await destino.getMetadata();
      if (String(meta.md5Hash ?? meta.crc32c ?? "") !== m.hash) throw new Error(`cópia não confere: ${m.para}`);
    }
  } else {
    // Só apaga a cópia repetida depois que o arquivo idêntico estiver no destino.
    const [meta] = await destino.getMetadata().catch(() => [null]);
    if (!meta || String(meta.md5Hash ?? meta.crc32c ?? "") !== m.hash) return "sem-origem";
  }
  await origem.delete();
  return m.acao === "duplicado-igual" ? "ja-estava" : "movido";
}

async function emLotes<T>(itens: readonly T[], fn: (t: T) => Promise<unknown>, rotulo: string): Promise<number> {
  let feitos = 0;
  let erros = 0;
  let i = 0;
  const trabalhador = async (): Promise<void> => {
    while (i < itens.length) {
      const item = itens[i++];
      try {
        await fn(item);
      } catch (err) {
        erros += 1;
        console.error(`  erro: ${(err as Error).message}`);
      }
      feitos += 1;
      if (feitos % 250 === 0) console.log(`  ${rotulo}: ${feitos}/${itens.length}`);
    }
  };
  await Promise.all(Array.from({ length: CONCORRENCIA }, trabalhador));
  return erros;
}

async function moverFotos(bucket: Bucket): Promise<void> {
  let total = 0;
  let erros = 0;
  // A origem encolhe a cada página movida: sempre relista do começo até esvaziar.
  for (;;) {
    const [pagina] = await bucket.getFiles({ prefix: FOTOS, autoPaginate: false, maxResults: 1000 });
    const movs = pagina
      .map((f): Movimento | null => {
        const para = destinoDe(rel(f.name));
        return para ? { de: f.name, para: ORG + para, bytes: Number(f.metadata.size ?? 0), hash: hashDe(f), acao: "mover" } : null;
      })
      .filter((m): m is Movimento => m !== null);
    if (movs.length === 0) break;
    erros += await emLotes(movs, (m) => mover(bucket, m), "fotos");
    total += movs.length;
    console.log(`fotos movidas: ${total.toLocaleString("pt-BR")}${erros ? ` (${erros} erros)` : ""}`);
    if (erros > 100) throw new Error("erros demais ao mover fotos; parando para conferir");
  }
  console.log(`Fotos concluídas: ${total.toLocaleString("pt-BR")} arquivos.`);
}

async function main(): Promise<void> {
  if (!existsSync(KEY_FILE)) throw new Error(`Credencial não encontrada: ${KEY_FILE}`);
  const bucket = new Storage({ keyFilename: KEY_FILE }).bucket(BUCKET);
  const [modo, alvo] = process.argv.slice(2);
  if (modo === "aplicar" && alvo === "fotos") return moverFotos(bucket);

  const movs = await planejar(bucket);
  await mkdir(SAIDA, { recursive: true });
  await writeFile(path.join(SAIDA, "plano.json"), JSON.stringify(movs.map((m) => ({ ...m, de: rel(m.de), para: rel(m.para) })), null, 1));
  resumo(movs);
  if (modo !== "aplicar") {
    console.log(`\nNada foi movido. Plano completo em ${path.join(SAIDA, "plano.json")}`);
    return;
  }
  // Primeiro os destinos únicos; depois os duplicados idênticos (que dependem do destino já existir).
  const erros =
    (await emLotes(movs.filter((m) => m.acao === "mover"), (m) => mover(bucket, m), "movendo")) +
    (await emLotes(movs.filter((m) => m.acao === "duplicado-igual"), (m) => mover(bucket, m), "duplicados"));
  console.log(erros ? `Concluído com ${erros} erros (rode de novo para retomar).` : "Concluído sem erros.");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
