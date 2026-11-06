"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveLayoutAction } from "@/app/[org]/space-actions";
import {
  addSection, fromToc, moveItem, nudgeItem, nudgeSection, removeSection, renameSection, toDraft, updateItem,
  type EdGroup, type EdItem,
} from "@/lib/layout/editor";
import type { TocGroup } from "@/lib/layout/toc";

interface SidebarEditorProps {
  orgSlug: string;
  clientSlug: string | null;
  toc: TocGroup[];
  onDone: () => void;
}

const FIELD = "w-full rounded-md border border-paper-line bg-ink/5 px-2 py-1 text-[14px] text-ink placeholder:text-ink-muted outline-none focus:border-ink";
const ICON_BTN = "grid size-6 place-items-center rounded text-ink-muted hover:bg-ink/10 hover:text-ink disabled:opacity-30";

export function SidebarEditor({ orgSlug, clientSlug, toc, onDone }: SidebarEditorProps) {
  const router = useRouter();
  const [groups, setGroups] = useState<EdGroup[]>(() => fromToc(toc));
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const save = (): void =>
    startSaving(async () => {
      setError(null);
      const res = await saveLayoutAction(orgSlug, clientSlug, toDraft(groups));
      if (!res.ok) {
        setError(res.message ?? "Não foi possível salvar.");
        return;
      }
      router.refresh();
      onDone();
    });

  const drop = (toKey: string, toIndex: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const id = e.dataTransfer.getData("text/plain") || dragging;
    if (id) setGroups((g) => moveItem(g, id, toKey, toIndex));
    setDragging(null);
  };
  const allowDrop = (e: React.DragEvent): void => e.preventDefault();

  const renderItem = (group: EdGroup, item: EdItem, index: number) => (
    <li
      key={item.id}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", item.id);
        setDragging(item.id);
      }}
      onDragEnd={() => setDragging(null)}
      onDragOver={allowDrop}
      onDrop={drop(group.key, index)}
      className={`rounded-md border bg-ink/5 px-2 py-1.5 ${dragging === item.id ? "opacity-40" : ""} border-paper-line`}
    >
      <div className="flex items-center gap-1.5">
        <span className="cursor-grab select-none text-ink-muted" aria-hidden title="Arraste para mover">⋮⋮</span>
        <input
          aria-label="Título do dashboard"
          value={item.name}
          maxLength={120}
          onChange={(e) => setGroups((g) => updateItem(g, item.id, { name: e.target.value }))}
          className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none focus:underline"
        />
        <button type="button" className={ICON_BTN} aria-label="Subir" onClick={() => setGroups((g) => nudgeItem(g, item.id, -1))}>↑</button>
        <button type="button" className={ICON_BTN} aria-label="Descer" onClick={() => setGroups((g) => nudgeItem(g, item.id, 1))}>↓</button>
        <button
          type="button"
          className={ICON_BTN}
          aria-label="Editar subtítulo"
          aria-expanded={expanded === item.id}
          onClick={() => setExpanded((x) => (x === item.id ? null : item.id))}
        >
          ✎
        </button>
      </div>
      {expanded === item.id && (
        <textarea
          aria-label="Subtítulo do dashboard"
          value={item.description}
          maxLength={280}
          rows={3}
          placeholder="Subtítulo exibido abaixo do título"
          onChange={(e) => setGroups((g) => updateItem(g, item.id, { description: e.target.value }))}
          className={`${FIELD} mt-1.5 resize-none text-[13px]`}
        />
      )}
    </li>
  );

  return (
    <div className="flex flex-col gap-5 pb-2">
      <p className="text-[13px] text-ink-muted">Arraste para reordenar ou mover entre seções. Clique no título para renomear.</p>

      {groups.map((group, gi) => (
        <section key={group.key} onDragOver={allowDrop} onDrop={drop(group.key, group.items.length)}>
          {group.ungrouped ? (
            <p className="mb-2 text-[12px] uppercase tracking-wide text-ink-muted">Sem seção</p>
          ) : (
            <div className="mb-2 flex items-center gap-1">
              <input
                aria-label="Título da seção"
                value={group.title}
                maxLength={80}
                onChange={(e) => setGroups((g) => renameSection(g, group.key, e.target.value))}
                className={`${FIELD} font-medium`}
              />
              <button type="button" className={ICON_BTN} aria-label="Subir seção" disabled={gi <= 1}
                onClick={() => setGroups((g) => nudgeSection(g, group.key, -1))}>↑</button>
              <button type="button" className={ICON_BTN} aria-label="Descer seção" disabled={gi === groups.length - 1}
                onClick={() => setGroups((g) => nudgeSection(g, group.key, 1))}>↓</button>
              <button type="button" className={`${ICON_BTN} hover:text-red-700`} aria-label="Remover seção" title="Remover seção (os dashboards ficam)"
                onClick={() => setGroups((g) => removeSection(g, group.key))}>×</button>
            </div>
          )}
          <ul className="flex min-h-10 flex-col gap-1.5 rounded-md border border-dashed border-transparent p-0.5 data-[empty=true]:border-paper-line"
            data-empty={group.items.length === 0}>
            {group.items.map((item, i) => renderItem(group, item, i))}
            {group.items.length === 0 && <li className="px-2 py-2 text-[12px] text-ink-muted">Solte um dashboard aqui</li>}
          </ul>
        </section>
      ))}

      <button
        type="button"
        onClick={() => setGroups((g) => addSection(g, `new-${crypto.randomUUID()}`))}
        className="self-start text-[14px] text-ink underline-offset-4 hover:underline"
      >
        + Nova seção
      </button>

      {error && <p role="alert" className="text-[13px] text-red-700">{error}</p>}

      <div className="sticky bottom-0 -mx-5 flex gap-2 border-t border-paper-line bg-paper px-5 py-3">
        <button type="button" onClick={save} disabled={saving}
          className="flex-1 rounded-lg bg-ink px-3 py-2 text-sm font-medium text-paper disabled:opacity-50">
          {saving ? "Salvando…" : "Salvar"}
        </button>
        <button type="button" onClick={onDone} disabled={saving}
          className="rounded-lg border border-paper-line px-3 py-2 text-sm text-ink hover:bg-ink/10">
          Cancelar
        </button>
      </div>
    </div>
  );
}
