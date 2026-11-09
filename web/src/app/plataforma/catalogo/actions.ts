"use server";

import { revalidatePath } from "next/cache";
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
  type TemplateStatus,
} from "@/lib/data/catalog";
import type { Template } from "@/lib/templates/schema";
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
  if (id) revalidatePath(`/plataforma/catalogo/${id}`);
  revalidatePath("/", "layout");
}

export async function registerTemplateAction(_prev: TemplateFormState, formData: FormData): Promise<TemplateFormState> {
  let json = "";
  try {
    const user = await requirePlatformAdmin();
    json = await readSubmittedJson(formData);
    const parsed = parseTemplateJson(json);
    if (!parsed.ok) return { ok: false, message: "O dashboard tem problemas:", errors: parsed.errors, json };
    const status = statusSchema.parse(formData.get("status") ?? "draft");
    await insertTemplate(parsed.template, status, user.id);
    console.info(`[catalog] template registered: ${parsed.template.id} v${parsed.template.version} (${status})`);
    revalidateCatalog(parsed.template.id);
    return { ok: true, message: `Dashboard "${parsed.template.name}" cadastrado.` };
  } catch (err) {
    if (err instanceof DuplicateTemplateError) {
      return { ok: false, message: `Já existe um dashboard com o id "${err.message}". Edite o existente pela vitrine.`, json };
    }
    return failure(err, json);
  }
}

/** What the edit form needs to open an existing dashboard. */
export type TemplateForEdit =
  | { ok: true; template: Template; builtIn: boolean; status: TemplateStatus; usage: number }
  | { ok: false; message: string };

export async function loadTemplateForEditAction(rawId: string): Promise<TemplateForEdit> {
  try {
    await requirePlatformAdmin();
    const id = templateId.parse(rawId);
    const entry = await getCatalogEntry(id);
    if (!entry) return { ok: false, message: "Dashboard não encontrado." };
    const usage = (await listCatalog()).find((r) => r.id === id)?.usage ?? 0;
    return { ok: true, template: entry.template, builtIn: entry.builtIn, status: entry.status, usage };
  } catch (err) {
    if (err instanceof AccessError) return { ok: false, message: err.message };
    if (err instanceof z.ZodError) return { ok: false, message: "Identificador inválido." };
    console.error("[catalog] load for edit failed", err);
    return { ok: false, message: "Não foi possível abrir o dashboard." };
  }
}

export async function updateTemplateAction(_prev: TemplateFormState, formData: FormData): Promise<TemplateFormState> {
  let json = "";
  try {
    await requirePlatformAdmin();
    const id = templateId.parse(formData.get("id"));
    json = await readSubmittedJson(formData);
    const current = await getCatalogEntry(id);
    if (!current) return { ok: false, message: "Dashboard não encontrado.", json };

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

/** Result of the status/deletion actions called from the vitrine modal (no redirect, the modal shows it). */
export interface CatalogActionResult {
  ok: boolean;
  message: string;
}

function actionFailure(err: unknown): CatalogActionResult {
  if (err instanceof AccessError) return { ok: false, message: err.message };
  if (err instanceof z.ZodError) return { ok: false, message: "Pedido inválido." };
  console.error("[catalog] action failed", err);
  return { ok: false, message: "Algo deu errado. Tente novamente." };
}

const STATUS_DONE: Record<TemplateStatus, string> = {
  draft: "Voltou para rascunho.",
  published: "Publicado: as organizações já veem no catálogo.",
  archived: "Arquivado: saiu do catálogo.",
};

export async function changeTemplateStatusAction(rawId: string, rawStatus: string): Promise<CatalogActionResult> {
  try {
    await requirePlatformAdmin();
    const id = templateId.parse(rawId);
    const status = statusSchema.parse(rawStatus);
    if (!(await getCatalogEntry(id))) return { ok: false, message: "Dashboard não encontrado." };
    await setStatus(id, status);
    console.info(`[catalog] template ${id} → ${status}`);
    revalidateCatalog(id);
    return { ok: true, message: STATUS_DONE[status] };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function removeTemplateAction(rawId: string): Promise<CatalogActionResult> {
  try {
    await requirePlatformAdmin();
    const id = templateId.parse(rawId);
    if (!(await deleteUnusedTemplate(id))) {
      return { ok: false, message: "Este dashboard está em uso ou é embutido — arquive em vez de excluir." };
    }
    console.info(`[catalog] template deleted: ${id}`);
    revalidateCatalog();
    return { ok: true, message: "Dashboard excluído." };
  } catch (err) {
    return actionFailure(err);
  }
}
