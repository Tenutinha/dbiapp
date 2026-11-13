/**
 * Atualiza o painel de autorização de guias a partir da extração guardada no armazenamento da DBI:
 *   1. baixa os Parquet da extração (pasta do cliente, ex.: Araguaia/provimento/guias) para o cache de trabalho;
 *   2. roda preparar.py (beneficiário pseudonimizado, sem dados pessoais) numa pasta temporária;
 *   3. grava as tabelas preparadas em <origem>/preparado/ no armazenamento (substitui as anteriores);
 *   4. com --carregar, chama carregar-dashboard.ts --pasta <origem>/preparado, que lê de lá e publica.
 *
 * Uso (em web/, com o .env do ambiente de destino; precisa de `uv` para o Python):
 *   node --env-file=<.env> --conditions=react-server --import tsx scripts/saude/guias/atualizar.ts \
 *     --org unimed --cliente araguaia --origem provimento/guias --cooperativa 056 --sal-arquivo <arquivo .sal> [--carregar]
 * O sal também pode vir em GUIAS_SAL. Use sempre o mesmo por cooperativa: trocar o sal muda os códigos
 * dos beneficiários e as contagens entre cargas deixam de bater.
 */
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "../../../src/lib/db";
import { storage } from "../../../src/lib/storage";
import { browsePrefix } from "../../../src/lib/storage-browse";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
/** As tabelas que preparar.py grava (o contrato do molde). */
const TABELAS = ["guias", "prestadores", "solicitantes", "locais_atendimento"] as const;

interface Args {
  org: string;
  cliente: string;
  origem: string;
  destino: string;
  cooperativa: string;
  sal: string;
  carregar: boolean;
}

async function parseArgs(argv: readonly string[]): Promise<Args> {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const org = get("--org");
  const cliente = get("--cliente");
  const origem = get("--origem")?.replace(/^\/+|\/+$/g, "");
  const cooperativa = get("--cooperativa");
  if (!org || !cliente || !origem || !cooperativa) {
    throw new Error("uso: --org <slug> --cliente <slug> --origem <pasta do cliente> --cooperativa <código> --sal-arquivo <arquivo> [--destino <pasta>] [--carregar]");
  }
  const salArquivo = get("--sal-arquivo");
  const sal = (salArquivo ? await readFile(salArquivo, "utf8") : process.env.GUIAS_SAL ?? "").trim();
  if (sal.length < 16) throw new Error("informe o sal (--sal-arquivo ou GUIAS_SAL), com 16 caracteres ou mais");
  const destino = get("--destino")?.replace(/^\/+|\/+$/g, "") ?? `${origem}/preparado`;
  return { org, cliente, origem, destino, cooperativa, sal, carregar: argv.includes("--carregar") };
}

async function main(): Promise<void> {
  const a = await parseArgs(process.argv.slice(2));
  const [cliente] = await sql<{ slug: string }[]>`
    SELECT c.slug FROM org_clients c JOIN organizations o ON o.id = c.organization_id
    WHERE o.slug = ${a.org} AND c.slug = ${a.cliente}`;
  if (!cliente) throw new Error(`cliente "${a.cliente}" não existe na organização ${a.org}`);

  // Pastas relativas à organização, como o "Arquivos" do admin as mostra dentro do cliente.
  const origem = `clientes/${a.cliente}/${a.origem}`;
  const destino = `clientes/${a.cliente}/${a.destino}`;

  // 1. A extração: os Parquet da pasta (só o primeiro nível; preparado/ fica de fora).
  const listagem = await storage.listOrgFolder(a.org, origem, 1000);
  const arquivos = listagem.files.filter((f) => f.name.toLowerCase().endsWith(".parquet"));
  if (arquivos.length === 0) throw new Error(`nenhum .parquet em ${origem}`);
  console.log(`extração: ${arquivos.length} arquivos em ${origem}`);
  const baixados: string[] = [];
  for (const f of arquivos) baixados.push(await storage.localPath(f.key));
  const pastaOrigem = path.dirname(baixados[0]);

  // 2. A preparação, numa pasta temporária (nada fica na máquina depois).
  const trabalho = await mkdtemp(path.join(tmpdir(), "dbi-guias-"));
  try {
    const preparar = path.join(AQUI, "preparar.py");
    const r = spawnSync(
      "uv",
      ["run", "-q", "--no-project", "--python", "3.11", "--with", "duckdb", "python", "-I", "-X", "utf8", preparar],
      {
        stdio: "inherit",
        env: { ...process.env, GUIAS_ORIGEM: pastaOrigem, GUIAS_PASTA: trabalho, GUIAS_COOPERATIVA: a.cooperativa, GUIAS_SAL: a.sal },
      },
    );
    if (r.status !== 0) throw new Error(`preparar.py terminou com erro (${r.error?.message ?? `código ${r.status}`})`);

    // 3. As tabelas preparadas no armazenamento, no lugar das anteriores.
    const dados = path.join(trabalho, "dados");
    const gerados = new Set(await readdir(dados));
    for (const t of TABELAS) {
      if (!gerados.has(`${t}.parquet`)) throw new Error(`preparar.py não gerou ${t}.parquet`);
      const bytes = new Uint8Array(await readFile(path.join(dados, `${t}.parquet`)));
      await storage.putBytes(`${browsePrefix(a.org, destino)}${t}.parquet`, bytes, "application/vnd.apache.parquet");
      console.log(`preparado: ${destino}/${t}.parquet (${(bytes.length / 1024 ** 2).toFixed(1)} MB)`);
    }
  } finally {
    await rm(trabalho, { recursive: true, force: true });
    // Num bucket, a cópia baixada é só cache: o original continua lá.
    if (storage.remote()) await Promise.all(baixados.map((p) => rm(p, { force: true }).catch(() => undefined)));
  }

  // 4. O painel lê a pasta preparada, pelo mesmo caminho do "Importar pasta" da tela.
  if (a.carregar) {
    const carregar = path.join(AQUI, "..", "..", "pbix", "carregar-dashboard.ts");
    const r = spawnSync(
      process.execPath,
      [...process.execArgv, carregar, "--template", path.join(AQUI, "template.json"), "--org", a.org, "--cliente", a.cliente, "--pasta", destino],
      { stdio: "inherit" },
    );
    if (r.status !== 0) throw new Error("carregar-dashboard terminou com erro");
  } else {
    console.log(`pronto. Para o painel ler a pasta: carregar-dashboard.ts --template scripts/saude/guias/template.json --org ${a.org} --cliente ${a.cliente} --pasta ${destino}`);
  }
}

main()
  .then(() => sql.end())
  .catch(async (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    await sql.end();
    process.exit(1);
  });
