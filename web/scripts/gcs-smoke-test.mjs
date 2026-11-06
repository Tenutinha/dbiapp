// Smoke test do bucket GCS: upload, download, PUT por URL assinada, remoção.
// Uso: node --env-file=.env.local scripts/gcs-smoke-test.mjs
import { randomUUID } from "node:crypto";
import { Storage } from "@google-cloud/storage";

const bucketName = process.env.GCS_BUCKET;
if (!bucketName) throw new Error("GCS_BUCKET não definido");
const bucket = new Storage({ projectId: process.env.GCS_PROJECT_ID }).bucket(bucketName);
const folder = `orgs/smoke-${randomUUID().slice(0, 8)}/`;
const base = `${folder}uploads/${randomUUID()}`;
const step = (msg) => console.log(`✔ ${msg}`);

// Pasta da organização: objeto vazio terminado em "/" (o mesmo que o Console cria).
const createFolder = () =>
  bucket.file(folder).save("", { resumable: false, preconditionOpts: { ifGenerationMatch: 0 } })
    .catch((e) => { if (e.code !== 412) throw e; });
await createFolder();
await createFolder();
const [folderExists] = await bucket.file(folder).exists();
if (!folderExists) throw new Error("pasta da organização não foi criada");
step(`pasta ${folder} criada (e criar de novo não dá erro)`);

const a = bucket.file(`${base}/a.txt`);
await a.save(Buffer.from("ola dbi"), { contentType: "text/plain", resumable: false, preconditionOpts: { ifGenerationMatch: 0 } });
step("upload pelo servidor");

const [buf] = await a.download();
if (buf.toString() !== "ola dbi") throw new Error("conteúdo baixado diferente");
step("download");

const overwrite = await a
  .save(Buffer.from("x"), { resumable: false, preconditionOpts: { ifGenerationMatch: 0 } })
  .then(() => "sobrescreveu", () => "bloqueado");
if (overwrite !== "bloqueado") throw new Error("upload sobrescreveu objeto existente");
step("sobrescrita bloqueada");

const b = bucket.file(`${base}/b.parquet`);
const [url] = await b.getSignedUrl({ version: "v4", action: "write", expires: Date.now() + 15 * 60 * 1000 });
const put = await fetch(url, {
  method: "PUT",
  headers: { "Content-Type": "application/octet-stream", "x-upsert": "false" },
  body: new Uint8Array([1, 2, 3]),
});
if (!put.ok) throw new Error(`PUT assinado falhou: ${put.status} ${await put.text()}`);
const [exists] = await b.exists();
if (!exists) throw new Error("objeto enviado por URL assinada não existe");
step("upload por URL assinada (fluxo do navegador)");

const anon = await fetch(`https://storage.googleapis.com/${bucketName}/${base}/a.txt`);
if (anon.ok) throw new Error("bucket está público!");
step(`acesso anônimo negado (${anon.status})`);

await Promise.all([a.delete(), b.delete(), bucket.file(folder).delete()]);
step("remoção");
console.log("Tudo certo.");
