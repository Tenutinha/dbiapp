"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { chooseField } from "@/lib/templates/field-choice";
import { useBusySignal } from "./busy";

interface FieldPickerProps {
  visualId: string;
  /** The field the table groups by now. */
  current: string;
  options: readonly { id: string; label: string }[];
}

/**
 * The dimension a table groups by, swapped by the reader (Power BI's field parameter): one button per
 * field, the one in use highlighted. The choice goes to the URL, so the page recalculates as for a filter.
 */
export function FieldPicker({ visualId, current, options }: FieldPickerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  useBusySignal(pending);

  const pick = (fieldId: string): void => {
    if (fieldId === current) return;
    const query = chooseField(new URLSearchParams(params.toString()), visualId, fieldId).toString();
    start(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  };

  return (
    <div role="radiogroup" aria-label="Agrupar a tabela por" className="flex flex-wrap gap-1">
      {options.map((o) => {
        const on = o.id === current;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => pick(o.id)}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition ${
              on ? "border-brand bg-brand text-on-brand" : "border-line text-muted hover:border-text/30 hover:text-text"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
