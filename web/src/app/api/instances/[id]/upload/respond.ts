import { NextResponse } from "next/server";
import { z } from "zod";
import { AccessError } from "@/lib/auth";
import { UserFacingError } from "@/lib/services/datasets";

export interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export function fail(status: number, error: string): NextResponse<Envelope<never>> {
  return NextResponse.json({ success: false, error }, { status });
}

/** Maps known errors to friendly responses; logs and hides everything else. */
export function handleError(err: unknown, where: string): NextResponse<Envelope<never>> {
  if (err instanceof AccessError) return fail(err.status, err.message);
  if (err instanceof UserFacingError) return fail(400, err.message);
  if (err instanceof z.ZodError) {
    // Which field and rule failed (never the values): without this a 400 leaves no trace in the logs.
    console.warn(`[${where}] invalid request`, err.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.code} ${i.message}`));
    return fail(400, "Requisição inválida.");
  }
  console.error(`[${where}] unexpected error`, err);
  return fail(500, "Falha ao processar o arquivo.");
}

export const instanceParams = z.object({ id: z.string().uuid() });
export const tableName = z.string().regex(/^[a-z_][a-z0-9_]*$/);
export const fileName = z.string().min(1).max(255);
