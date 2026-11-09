import { notFound, redirect } from "next/navigation";

/**
 * The old per-dashboard catalog page is gone: editing, status and deletion live in the vitrine's
 * modal on the home page. Old links land there, with that dashboard's modal already open.
 * (The template.json download next to this route stays.)
 */
export default async function PlatformTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-z0-9-]{1,60}$/.test(id)) notFound();
  redirect(`/?editar=${id}#vitrine`);
}
