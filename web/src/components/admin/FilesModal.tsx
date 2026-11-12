"use client";

import { useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { FileExplorer } from "@/components/storage/FileExplorer";
import { RouteModal } from "./RouteModal";

/** ?arquivos=<pasta> as the address of the open folder ("" = the organization's root). */
const PARAM = "arquivos";
/** ?escopo=clientes/<slug>: opened from a client, the explorer stays in that client's folder. */
const SCOPE = "escopo";
const CLIENT_SCOPE = /^clientes\/[a-z0-9-]{1,63}$/;

/**
 * Changes the address in the browser only (no request for the admin page): opening, browsing and closing
 * "Arquivos" are instant. Next keeps useSearchParams in sync with history.pushState/replaceState.
 */
function setFilesParam(folder: string | null, mode: "push" | "replace", scope?: string): void {
  const url = new URL(window.location.href);
  if (folder === null) {
    url.searchParams.delete(PARAM);
    url.searchParams.delete(SCOPE);
  } else {
    url.searchParams.set(PARAM, folder);
    if (scope !== undefined) {
      if (scope) url.searchParams.set(SCOPE, scope);
      else url.searchParams.delete(SCOPE);
    }
  }
  if (mode === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

interface FilesLinkProps {
  orgSlug: string;
  folder: string;
  /** A client's folder ("clientes/<slug>"): the explorer opens there and never shows other clients. */
  scope?: string;
  className?: string;
  title?: string;
  children: React.ReactNode;
}

/** Opens the explorer at a folder right away (a real link too: middle click / new tab still work). */
export function FilesLink({ orgSlug, folder, scope = "", className, title, children }: FilesLinkProps) {
  const scopeQuery = scope ? `&${SCOPE}=${encodeURIComponent(scope)}` : "";
  return (
    <a
      href={`/${orgSlug}/admin?${PARAM}=${encodeURIComponent(folder)}${scopeQuery}`}
      title={title}
      aria-label={title}
      className={className}
      data-no-progress
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        // Elsewhere (e.g. the full-page data manager) the explorer lives on the admin page: go there.
        if (window.location.pathname !== `/${orgSlug}/admin`) return;
        e.preventDefault();
        setFilesParam(folder, "push", scope);
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
export function FilesModal({ orgSlug, orgName, clients = [] }: { orgSlug: string; orgName: string; clients?: { slug: string; name: string }[] }) {
  const params = useSearchParams();
  const folder = params.get(PARAM);
  const asked = params.get(SCOPE) ?? "";
  const scope = CLIENT_SCOPE.test(asked) ? asked : "";
  const scopeName = scope ? (clients.find((c) => `clientes/${c.slug}` === scope)?.name ?? scope.slice("clientes/".length)) : null;
  const keepInAddress = useCallback((next: string) => setFilesParam(next, "replace"), []);
  if (folder === null) return null;

  return (
    <RouteModal
      closeHref={`/${orgSlug}/admin`}
      onClosed={() => setFilesParam(null, "replace")}
      eyebrow="Armazenamento"
      title={`Arquivos · ${scopeName ?? orgName}`}
      subtitle={
        scopeName
          ? `Os arquivos de ${scopeName}. Arraste arquivos ou pastas do computador para enviar.`
          : "Tudo o que a organização guardou, por pasta e por cliente. Arraste arquivos ou pastas do computador para enviar."
      }
      width={1400}
    >
      <div className="h-[calc(100vh-13rem)]">
        <FileExplorer org={orgSlug} orgName={orgName} initialFolder={folder.replace(/^\/+|\/+$/g, "")} onFolderChange={keepInAddress} root={scope} />
      </div>
    </RouteModal>
  );
}
