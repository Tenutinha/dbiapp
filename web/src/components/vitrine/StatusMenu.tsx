"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { changeTemplateStatusAction } from "@/app/plataforma/catalogo/actions";
import type { TemplateStatus } from "@/lib/data/catalog";
import { STATUS_LABEL } from "@/lib/templates/labels";

const STATUS_HINT: Record<TemplateStatus, string> = {
  draft: "Só a plataforma vê",
  published: "Aparece no catálogo",
  archived: "Sai do catálogo; quem usa continua",
};

const STATUS_ORDER: readonly TemplateStatus[] = ["draft", "published", "archived"];

/** Dot colour per status (same palette as the badges). */
const DOT_CLASS: Record<TemplateStatus, string> = {
  draft: "bg-accent",
  published: "bg-ok",
  archived: "bg-muted",
};

const TIP_WIDTH = 236;
const TIP_HEIGHT = 168;
const GAP = 10;

interface TipPosition {
  /** Distance from the viewport top (below the icon) or bottom (above it), so the arrow always touches the icon. */
  top: number | undefined;
  bottom: number | undefined;
  left: number;
  /** Arrow's horizontal offset inside the tooltip, pointing at the icon's centre. */
  arrow: number;
  /** Tooltip sits above the icon (arrow at the bottom) or below it (arrow at the top). */
  above: boolean;
}

function placeTip(icon: DOMRect): TipPosition {
  const above = icon.top - GAP - TIP_HEIGHT >= 8;
  const centre = icon.left + icon.width / 2;
  const left = Math.max(8, Math.min(centre - TIP_WIDTH / 2, window.innerWidth - TIP_WIDTH - 8));
  return {
    top: above ? undefined : icon.bottom + GAP,
    bottom: above ? window.innerHeight - icon.top + GAP : undefined,
    left,
    arrow: Math.max(14, Math.min(centre - left, TIP_WIDTH - 14)),
    above,
  };
}

function FlagIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

interface StatusMenuProps {
  id: string;
  name: string;
  status: TemplateStatus;
}

/**
 * Card icon (next to the preview eye): a click shows a small tooltip, pointing at the icon, to change
 * the dashboard's status in place. Rendered on <body> and fixed-positioned, so neither the vitrine's scroll area nor a transformed
 * ancestor clips or misplaces it.
 */
export function StatusMenu({ id, name, status }: StatusMenuProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tip, setTip] = useState<TipPosition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  const open = (): void => {
    const r = buttonRef.current?.getBoundingClientRect();
    if (!r) return;
    setError(null);
    setTip(placeTip(r));
  };
  const close = (): void => setTip(null);

  const isOpen = tip !== null;

  // While open: follow the icon on scroll/resize (close once it leaves the screen), close on a click
  // outside or Esc. Focus goes to the current status without scrolling anything.
  useEffect(() => {
    if (!isOpen) return;
    tipRef.current?.querySelector<HTMLButtonElement>("[aria-checked=true]")?.focus({ preventScroll: true });
    const follow = (): void => {
      const r = buttonRef.current?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight) return close();
      setTip(placeTip(r));
    };
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Node;
      if (!tipRef.current?.contains(t) && !buttonRef.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        close();
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [isOpen]);

  const choose = (next: TemplateStatus): void => {
    if (next === status) return close();
    start(async () => {
      const res = await changeTemplateStatusAction(id, next);
      if (!res.ok) return setError(res.message);
      close();
      router.refresh();
    });
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (tip ? close() : open())}
        aria-haspopup="true"
        aria-expanded={tip !== null}
        aria-label={`Status de ${name}: ${STATUS_LABEL[status]}. Mudar status`}
        title={tip ? undefined : `Status: ${STATUS_LABEL[status]} — clique para mudar`}
        disabled={pending}
        className={`relative grid size-9 place-items-center rounded-full border transition disabled:cursor-wait ${
          tip ? "border-brand text-brand-2" : "border-line text-muted hover:border-brand hover:text-brand-2"
        }`}
      >
        <FlagIcon />
        <span className={`absolute right-1 top-1 size-2 rounded-full ring-2 ring-card ${DOT_CLASS[status]}`} aria-hidden />
      </button>

      {tip && createPortal(
        <div
          ref={tipRef}
          role="dialog"
          aria-label={`Mudar status de ${name}`}
          style={{ top: tip.top, bottom: tip.bottom, left: tip.left, width: TIP_WIDTH }}
          className={`fixed z-50 rounded-xl bg-text p-1.5 text-bg shadow-[0_10px_28px_-6px_rgba(0,0,0,0.45)] transition duration-150 starting:opacity-0 ${
            tip.above ? "starting:translate-y-1" : "starting:-translate-y-1"
          }`}
        >
          <span
            aria-hidden
            style={{ left: tip.arrow }}
            className={`absolute size-2.5 -translate-x-1/2 rotate-45 bg-text ${tip.above ? "-bottom-1" : "-top-1"}`}
          />
          <p className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide opacity-60">Mudar status</p>
          <div role="radiogroup" aria-label="Status">
            {STATUS_ORDER.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={s === status}
                disabled={pending}
                onClick={() => choose(s)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-bg/10 focus-visible:bg-bg/10 focus-visible:outline-none disabled:cursor-wait"
              >
                <span className={`size-2.5 shrink-0 rounded-full ${DOT_CLASS[s]}`} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className={`block text-[13px] leading-tight ${s === status ? "font-semibold" : ""}`}>{STATUS_LABEL[s]}</span>
                  <span className="block text-[11px] leading-tight opacity-60">{STATUS_HINT[s]}</span>
                </span>
                {s === status && <CheckIcon />}
              </button>
            ))}
          </div>
          {pending && <p className="px-2 pb-0.5 pt-1 text-[11px] opacity-70">Salvando…</p>}
          {error && <p role="alert" className="px-2 pb-0.5 pt-1 text-[11px] text-danger">{error}</p>}
        </div>,
        // On <body>: a transformed ancestor (the card icons use translate) would trap position:fixed.
        document.body,
      )}
    </>
  );
}
