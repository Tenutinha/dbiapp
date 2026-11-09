"use client";

import { useRouter } from "next/navigation";
import type { TocGroup } from "@/lib/layout/toc";
import { SidebarEditor } from "@/components/workspace/SidebarEditor";

interface SummaryEditorPanelProps {
  orgSlug: string;
  clientSlug: string | null;
  toc: TocGroup[];
  /** Admin page without ?sumario — where "Concluir"/"Cancelar" (and a successful save) go back to. */
  closeHref: string;
}

/**
 * The sidebar summary editor (sections and dashboards order of one space), hosted in the admin's
 * centered modal. Uses the sidebar's paper/ink colours so it looks like the panel it edits.
 */
export function SummaryEditorPanel({ orgSlug, clientSlug, toc, closeHref }: SummaryEditorPanelProps) {
  const router = useRouter();
  return (
    <div className="rounded-xl bg-paper p-5 text-ink">
      <SidebarEditor
        orgSlug={orgSlug}
        clientSlug={clientSlug}
        toc={toc}
        onDone={() => router.replace(closeHref, { scroll: false })}
      />
    </div>
  );
}
