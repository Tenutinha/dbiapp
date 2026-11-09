import { z } from "zod";

/** A client's display name — same rule when creating and when renaming (the address never changes). */
export const clientNameSchema = z
  .string()
  .transform((s) => s.trim().replace(/\s+/g, " "))
  .pipe(z.string().min(2, "Informe o nome do cliente.").max(80, "Nome longo demais (até 80 caracteres)."));
