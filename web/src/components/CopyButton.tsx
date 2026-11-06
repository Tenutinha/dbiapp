"use client";

import { useState } from "react";

export function CopyButton({ path }: { path: string }) {
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(new URL(path, window.location.origin).toString());
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
    setTimeout(() => setCopied("idle"), 1600);
  }

  return (
    <button type="button" onClick={copy} className="btn btn-ghost px-3 py-1.5 text-xs">
      {copied === "ok" ? "Copiado!" : copied === "fail" ? "Copie manualmente" : "Copiar link"}
    </button>
  );
}
