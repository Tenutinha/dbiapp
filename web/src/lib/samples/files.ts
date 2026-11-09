/**
 * Sample Parquet files of a template, generated on first use and kept under `<root>/samples`.
 * The folder name is a hash of the generating SQL, so a changed template, recipe or month gets new
 * files and the old ones are dropped.
 */
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readdir, rename, rm } from "node:fs/promises";
import { quotePath, toDuckPath, withConnection } from "../duck/engine";
import type { Template } from "../templates/schema";
import { buildSamplePlan, type SamplePlan } from "./plan";

export interface SampleFiles {
  /** Table name → local Parquet path. */
  files: Readonly<Record<string, string>>;
  factRows: number;
}

/** Bump when the generator changes in a way the SQL text does not show. */
const GENERATOR_VERSION = "1";
const TMP_PREFIX = "tmp-";
const inFlight = new Map<string, Promise<void>>();

/** First day of the current month (UTC): sample dates stay recent without changing every day. */
export function sampleAnchor(now: Date): string {
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `DATE '${now.getUTCFullYear()}-${month}-01'`;
}

const planHash = (plan: SamplePlan): string =>
  createHash("sha1")
    .update(GENERATOR_VERSION)
    .update(plan.tables.map((t) => `${t.name}:${t.select}`).join("\n"))
    .digest("hex")
    .slice(0, 12);

const exists = (target: string): Promise<boolean> => access(target).then(() => true, () => false);

async function generate(root: string, base: string, dir: string, plan: SamplePlan): Promise<void> {
  const tmp = `${base}/${TMP_PREFIX}${randomUUID()}`;
  await mkdir(tmp, { recursive: true });
  try {
    await withConnection(root, async (conn) => {
      for (const table of plan.tables) {
        await conn.run(`COPY (${table.select}) TO ${quotePath(`${tmp}/${table.name}.parquet`)} (FORMAT PARQUET)`);
      }
    });
    await rename(tmp, dir);
  } catch (error) {
    await rm(tmp, { recursive: true, force: true });
    // Another process finished the same folder first: its files are identical.
    if (!(await exists(dir))) throw error;
  }
}

/** Old versions of this template's samples. Failing to remove them only costs disk space. */
async function dropStale(base: string, keep: string): Promise<void> {
  const entries = await readdir(base).catch((): string[] => []);
  const stale = entries.filter((name) => name !== keep && !name.startsWith(TMP_PREFIX));
  await Promise.all(stale.map((name) => rm(`${base}/${name}`, { recursive: true, force: true }).catch(() => undefined)));
}

export async function ensureSampleFiles(root: string, template: Template, now: Date = new Date()): Promise<SampleFiles> {
  const plan = buildSamplePlan(template, sampleAnchor(now));
  const hash = planHash(plan);
  const base = `${toDuckPath(root).replace(/\/$/, "")}/samples/${template.id}`;
  const dir = `${base}/${hash}`;

  if (!(await exists(dir))) {
    const running = inFlight.get(dir) ?? generate(root, base, dir, plan).finally(() => inFlight.delete(dir));
    inFlight.set(dir, running);
    await running;
    await dropStale(base, hash);
  }
  const files = Object.fromEntries(plan.tables.map((t) => [t.name, `${dir}/${t.name}.parquet`]));
  return { files, factRows: plan.factRows };
}
