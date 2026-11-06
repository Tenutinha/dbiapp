"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AccessError, getCurrentUser, type CurrentUser } from "@/lib/auth";
import {
  deleteUnusedTemplate,
  DuplicateTemplateError,
  insertTemplate,
  listCatalog,
  setStatus,
  TEMPLATE_STATUSES,
  updateDefinition,
} from "@/lib/data/catalog";
import { breakingChanges, checkUpdate, MAX_TEMPLATE_BYTES, parseTemplateJson } from "@/lib/templates/catalog-rules";
import { catalogReady, getCatalogEntry } from "@/lib/templates/registry";

export interface TemplateFormState {
  ok: boolean;
  message: string;
  errors?: string[];
  /** Contract changes that need explicit confirmation because organizations use the dashboard. */
  breaking?: string[];
  /** Submitted JSON, sent back so the form keeps it after an error. */
  json?: string;
}

const templateId = z.string().regex(/^[a-z0-9-]{1,60}$/);
const statusSchema = z.enum(TEMPLATE_STATUSES);

async function requirePlatformAdmin(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user.isPlatformAdmin) throw new AccessError(403, "Somente administradores da plataforma gerenciam o catálogo.");
  if (!(await catalogReady())) throw new AccessError(403, "O catálogo ainda não está pronto: aplique a migration 007.");
  return user;
}

/** Template JSON from the uploaded file, or from the textarea when no file was chosen. */
async function readSubmittedJson(formData: FormData): Promise<string> {
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_TEMPLATE_BYTES) return " ".repeat(MAX_TEMPLATE_BYTES + 1);
    return file.text();
  }
  return String(formData.get("json") ?? "");
}

function failure(err: unknown, json?: string): TemplateFormState {
  if (err instanceof AccessError) return { ok: false, message: err.message, json };
  console.error("[catalog] action failed", err);
  return { ok: false, message: "Algo deu errado. Tente novamente.", json };
}

function revalidateCatalog(id?: string): void {
  revalidatePath("/plataforma/catalogo");
  if (id) revalidatePath(`/plataforma/catalogo/${id}`);
  revalidatePath("/", "layout");
}

export async function registerTemplateAction(_prev: TemplateFormState, formData: FormData): Promise<TemplateFormState> {
  let json = "";
  let id: string;
  try {
    const user = await requirePlatformAdmin();
    json = await readSubmittedJson(formData);
    const parsed = parseTemplateJson(json);
    if (!parsed.ok) return { ok: false, message: "O template tem problemas:", errors: parsed.errors, json };
    const status = statusSchema.parse(formData.get("status") ?? "draft");
    await insertTemplate(parsed.template, status, user.id);
    console.info(`[catalog] template registered: ${parsed.template.id} v${parsed.template.version} (${status})`);
    id = parsed.template.id;
  } catch (err) {
    if (err instanceof DuplicateTemplateError) {
      return { ok: false, message: `Já existe um dashboard com o id "${err.message}". Abra-o no catálogo para atualizar.`, json };
    }
    return failure(err, json);
  }
  revalidateCatalog(id);
  redirect(`/plataforma/catalogo/${id}`);
}

export async function updateTemplateAction(_prev: TemplateFormState, formData: FormData): Promise<TemplateFormState> {
  let json = "";
  try {
    await requirePlatformAdmin();
    const id = templateId.parse(formData.get("id"));
    json = await readSubmittedJson(formData);
    const current = await getCatalogEntry(id);
    if (!current) return { ok: false, message: "Dashboard não encontrado.", json };
    if (current.builtIn) return { ok: false, message: "Dashboards embutidos são atualizados pelo código (web/templates).", json };

    const parsed = parseTemplateJson(json);
    if (!parsed.ok) return { ok: false, message: "O template tem problemas:", errors: parsed.errors, json };
    const blocked = checkUpdate(current.template, parsed.template);
    if (blocked) return { ok: false, message: blocked, json };

    const usage = (await listCatalog()).find((r) => r.id === id)?.usage ?? 0;
    const breaking = usage > 0 ? breakingChanges(current.template, parsed.template) : [];
    if (breaking.length > 0 && formData.get("confirmBreaking") !== "on") {
      return {
        ok: false,
        message: `${usage} dashboard(s) ativo(s) usam este template. Estas mudanças exigem que as organizações reenviem os dados:`,
        breaking,
        json,
      };
    }
    await updateDefinition(parsed.template);
    console.info(`[catalog] template updated: ${id} v${parsed.template.version}${breaking.length ? " (breaking)" : ""}`);
    revalidateCatalog(id);
    return { ok: true, message: `Atualizado para a versão ${parsed.template.version}.` };
  } catch (err) {
    return failure(err, json);
  }
}

export async function setTemplateStatusAction(formData: FormData): Promise<void> {
  await requirePlatformAdmin();
  const id = templateId.parse(formData.get("id"));
  const status = statusSchema.parse(formData.get("status"));
  await setStatus(id, status);
  console.info(`[catalog] template ${id} → ${status}`);
  revalidateCatalog(id);
}

export async function deleteTemplateAction(formData: FormData): Promise<void> {
  await requirePlatformAdmin();
  const id = templateId.parse(formData.get("id"));
  const deleted = await deleteUnusedTemplate(id);
  if (!deleted) throw new AccessError(403, "Este dashboard está em uso ou é embutido — arquive em vez de excluir.");
  console.info(`[catalog] template deleted: ${id}`);
  revalidateCatalog();
  redirect("/plataforma/catalogo");
}
