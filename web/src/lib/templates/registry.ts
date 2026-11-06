/**
 * Loads and validates the dashboard templates shipped in /templates.
 * Templates are code-reviewed files, read once per process.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { templateSchema, type Template } from "./schema";

const TEMPLATES_DIR = path.join(process.cwd(), "templates");

let cache: Promise<Map<string, Template>> | null = null;

async function loadAll(): Promise<Map<string, Template>> {
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

export async function listTemplates(): Promise<Template[]> {
  cache ??= loadAll();
  return [...(await cache).values()];
}

export async function getTemplate(id: string): Promise<Template | null> {
  cache ??= loadAll();
  return (await cache).get(id) ?? null;
}
