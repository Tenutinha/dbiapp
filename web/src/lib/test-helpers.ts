import { readFileSync } from "node:fs";
import path from "node:path";
import { templateSchema, type Template } from "./templates/schema";

/** Loads a shipped template synchronously for tests. */
export function loadTemplate(id: string): Template {
  const file = path.join(process.cwd(), "templates", id, "template.json");
  return templateSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}
