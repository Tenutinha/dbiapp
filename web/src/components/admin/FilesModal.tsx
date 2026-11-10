"use client";

import { useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { FileExplorer } from "@/components/storage/FileExplorer";
import { RouteModal } from "./RouteModal";

/** ?arquivos=<pasta> as the address of the open folder ("" = the organization's root). */
const PARAM = "arquivos";

/**
 * Changes the address in the browser only (no request for the admin page): opening, browsing and closing
 * "Arquivos" are instant. Next keeps useSearchParams in sync with history.pushState/replaceState.
 */
function setFilesParam(folder: string | null, mode: "push" | "replace"): void {
  const url = new URL(window.location.href);
  if (folder === null) url.searchParams.delete(PARAM);
  else url.searchParams.set(PARAM, folder);
  if (mode === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

interface FilesLinkProps {
  orgSlug: string;
  folder: string;
  className?: string;
  title?: string;
  children: React.ReactNode;
}

/** Opens the explorer at a folder right away (a real link too: middle click / new tab still work). */
export function FilesLink({ orgSlug, folder, className, title, children }: FilesLinkProps) {
  return (
    <a
      href={`/${orgSlug}/admin?${PARAM}=${encodeURIComponent(folder)}`}
      title={title}
      aria-label={title}
      className={className}
      data-no-progress
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        // Elsewhere (e.g. the full-page data manager) the explorer lives on the admin page: go there.
        if (window.location.pathname !== `/${orgSlug}/admin`) return;
        e.preventDefault();
        setFilesParam(folder, "push");
      }}
    >
      {children}
    </a>
  );
}

/**
 * "Arquivos": every file of the organization's storage in a desktop-like explorer, over the admin table.
 * Mounted once on the admin page and shown while the address has ?arquivos= (so a link reopens the folder).
 */
export function FilesModal({ orgSlug, orgName }: { orgSlug: string; orgName: string }) {
  const params = useSearchParams();
  const folder = params.get(PARAM);
  const keepInAddress = useCallback((next: string) => setFilesParam(next, "replace"), []);
  if (folder === null) return null;

  return (
    <RouteModal
      closeHref={`/${orgSlug}/admin`}
      onClosed={() => setFilesParam(null, "replace")}
      eyebrow="Armazenamento"
      title={`Arquivos · ${orgName}`}
      subtitle="Tudo o que a organização guardou, por pasta e por cliente. Arraste arquivos ou pastas do computador para enviar."
      width={1400}
    >
      <div className="h-[calc(100vh-13rem)]">
        <FileExplorer org={orgSlug} orgName={orgName} initialFolder={folder.replace(/^\/+|\/+$/g, "")} onFolderChange={keepInAddress} />
      </div>
    </RouteModal>
  );
}
