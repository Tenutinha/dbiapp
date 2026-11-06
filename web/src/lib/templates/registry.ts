/**
 * Dashboard catalog. The source of truth is the dashboard_templates table; templates shipped in
 * /templates (code-reviewed files) are synced into it as built-in entries once per process.
 * If the table does not exist yet (code deployed before the migration), the shipped files are
 * served as a published catalog so nothing breaks in between.
 */
import "server-only";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { findTemplate, listDefinitions, syncBuiltIns, type TemplateStatus } from "../data/catalog";
import { templateSchema, type Template } from "./schema";

const TEMPLATES_DIR = path.join(process.cwd(), "templates");

let builtIns: Promise<Map<string, Template>> | null = null;
let synced: Promise<boolean> | null = null;

async function loadBuiltIns(): Promise<Map<string, Template>> {
  const entries = await readdir(TEMPLATES_DIR, { withFileTypes: true });
  const templates = new Map<string, Template>();
  for (const entry of entries.filter((e) => e.isDirectory())) {
    const file = path.join(TEMPLATES_DIR, entry.name, "template.json");
    const raw: unknown = JSON.parse(await readFile(file, "utf8"));
    const parsed = templateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Invalid template ${entry.name}: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    }
    templates.set(parsed.data.id, parsed.data);
  }
  return templates;
}

function shippedTemplates(): Promise<Map<string, Template>> {
  builtIns ??= loadBuiltIns();
  return builtIns;
}

const isMissingTable = (err: unknown): boolean => (err as { code?: string }).code === "42P01";

/** True when the catalog table is usable; false when it does not exist yet. */
function ensureSynced(): Promise<boolean> {
  synced ??= (async () => {
    try {
      await syncBuiltIns([...(await shippedTemplates()).values()]);
      return true;
    } catch (err) {
      if (isMissingTable(err)) {
        console.warn("[catalog] dashboard_templates missing — serving shipped templates (run migrations)");
        return false;
      }
      throw err;
    }
  })().catch((err: unknown) => {
    synced = null; // transient failure (e.g. DB down): try again on the next request
    throw err;
  });
  return synced;
}

/** Stored definitions were validated on write; re-parse to apply defaults and guard old rows. */
function parseStored(definition: unknown, id: string): Template {
  const parsed = templateSchema.safeParse(definition);
  if (!parsed.success) throw new Error(`Stored template ${id} is invalid: ${parsed.error.issues[0]?.message}`);
  return parsed.data;
}

export interface CatalogEntry {
  template: Template;
  status: TemplateStatus;
  builtIn: boolean;
}

/** Any template by id, whatever its status (existing dashboards keep working when archived). */
export async function getCatalogEntry(id: string): Promise<CatalogEntry | null> {
  if (!(await ensureSynced())) {
    const shipped = (await shippedTemplates()).get(id);
    return shipped ? { template: shipped, status: "published", builtIn: true } : null;
  }
  const row = await findTemplate(id);
  return row ? { template: parseStored(row.definition, id), status: row.status, builtIn: row.builtIn } : null;
}

export async function getTemplate(id: string): Promise<Template | null> {
  return (await getCatalogEntry(id))?.template ?? null;
}

/** What organizations can activate: published templates only. */
export async function listTemplates(): Promise<Template[]> {
  if (!(await ensureSynced())) return [...(await shippedTemplates()).values()];
  const rows = await listDefinitions("published");
  return rows.map((d) => parseStored(d, "?"));
}

/** For the platform catalog page: makes sure built-ins are in the table before listing it. */
export async function catalogReady(): Promise<boolean> {
  return ensureSynced();
}
