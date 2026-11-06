"use client";

import { emptyTable, moveAt, removeAt, removeTable, replaceAt, toSnakeId, uniqueId } from "@/lib/templates/draft";
import { COLUMN_TYPES, type Template, type TemplateColumn, type TemplateTable } from "@/lib/templates/schema";
import { AddButton, Checkbox, Field, ItemCard, Select, StepIntro, TextInput, INPUT } from "./ui";

interface StepProps {
  template: Template;
  onChange: (t: Template) => void;
}

const TYPE_LABEL: Record<TemplateColumn["type"], string> = {
  integer: "inteiro",
  decimal: "decimal",
  text: "texto",
  date: "data",
  timestamp: "data e hora",
  boolean: "sim/não",
};
const TYPE_OPTIONS = COLUMN_TYPES.map((c) => ({ value: c, label: TYPE_LABEL[c] }));
const KIND_OPTIONS = [
  { value: "fact", label: "Fato — os registros (vendas, votos…)" },
  { value: "dimension", label: "Dimensão — cadastro (produto, município…)" },
];

/** Renames a table everywhere it is referenced. */
function renameTable(t: Template, from: string, to: string): Template {
  const swap = (name: string): string => (name === from ? to : name);
  return {
    ...t,
    tables: t.tables.map((tb) => (tb.name === from ? { ...tb, name: to } : tb)),
    relationships: t.relationships.map((r) => ({
      from: { ...r.from, table: swap(r.from.table) },
      to: { ...r.to, table: swap(r.to.table) },
    })),
  };
}

/** Renames a column of `table` everywhere it is referenced (key, sort, relationships). */
function renameColumn(t: Template, table: string, from: string, to: string): Template {
  const swap = (tb: string, col: string): string => (tb === table && col === from ? to : col);
  return {
    ...t,
    tables: t.tables.map((tb) =>
      tb.name !== table
        ? tb
        : {
            ...tb,
            key: tb.key === from ? to : tb.key,
            sortBy: tb.sortBy === from ? to : tb.sortBy,
            columns: tb.columns.map((c) => (c.name === from ? { ...c, name: to } : c)),
          },
    ),
    relationships: t.relationships.map((r) => ({
      from: { ...r.from, column: swap(r.from.table, r.from.column) },
      to: { ...r.to, column: swap(r.to.table, r.to.column) },
    })),
  };
}

export function FilesStep({ template: t, onChange }: StepProps) {
  const setTable = (i: number, table: TemplateTable): void => onChange({ ...t, tables: replaceAt(t.tables, i, table) });
  const addTable = (): void => {
    const name = uniqueId("dim_nova", t.tables.map((tb) => tb.name));
    onChange({ ...t, tables: [...t.tables, emptyTable(name, t.tables.some((tb) => tb.kind === "fact") ? "dimension" : "fact")] });
  };

  return (
    <div className="flex flex-col gap-4">
      <StepIntro title="Arquivos e layout">
        Cada arquivo é um CSV ou Parquet que a organização vai subir. Defina as colunas na ordem e no tipo esperados.
        Precisa de exatamente um arquivo de fato; as dimensões se ligam a ele.
      </StepIntro>
      {t.tables.map((table, i) => (
        <ItemCard
          key={i}
          index={i}
          count={t.tables.length}
          title={<span className="font-mono">{table.name || "(sem nome)"}</span>}
          onMove={(to) => onChange({ ...t, tables: moveAt(t.tables, i, to) })}
          onRemove={() => onChange(removeTable(t, table.name))}
          removeLabel={`Remover o arquivo ${table.name}`}
        >
          <TableEditor table={table} template={t} onTemplate={onChange} onTable={(tb) => setTable(i, tb)} />
        </ItemCard>
      ))}
      <AddButton onClick={addTable}>Adicionar arquivo</AddButton>
      <Relationships template={t} onChange={onChange} />
    </div>
  );
}

interface TableEditorProps {
  table: TemplateTable;
  template: Template;
  onTable: (tb: TemplateTable) => void;
  onTemplate: (t: Template) => void;
}

function TableEditor({ table, template, onTable, onTemplate }: TableEditorProps) {
  const columnOptions = table.columns.map((c) => ({ value: c.name, label: c.name }));
  const setColumn = (i: number, col: TemplateColumn): void => onTable({ ...table, columns: replaceAt(table.columns, i, col) });

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome do arquivo" hint="snake_case, sem extensão: fato_vendas, dim_produto">
          <TextInput
            value={table.name}
            mono
            onChange={(v) => onTemplate(renameTable(template, table.name, toSnakeId(v) || v.toLowerCase()))}
          />
        </Field>
        <Field label="Tipo">
          <Select value={table.kind} options={KIND_OPTIONS} onChange={(kind) => onTable({ ...table, kind: kind as TemplateTable["kind"] })} />
        </Field>
        <Field label="Descrição" className="sm:col-span-2">
          <TextInput value={table.description} onChange={(description) => onTable({ ...table, description })} placeholder="Uma linha por item vendido" />
        </Field>
        {table.kind === "dimension" && (
          <Field label="Chave" hint="Coluna única que identifica cada linha.">
            <Select value={table.key ?? ""} empty="—" options={columnOptions} onChange={(key) => onTable({ ...table, key: key || undefined })} />
          </Field>
        )}
        <Field label="Ordenar por" hint="Opcional; acelera filtros nessa coluna.">
          <Select value={table.sortBy ?? ""} empty="—" options={columnOptions} onChange={(s) => onTable({ ...table, sortBy: s || undefined })} />
        </Field>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-xs">
          <thead>
            <tr className="text-left text-muted">
              <th className="py-1 pr-2 font-medium">Coluna</th>
              <th className="py-1 pr-2 font-medium">Tipo</th>
              <th className="py-1 pr-2 font-medium">Obrigatória</th>
              <th className="py-1 pr-2 font-medium">Descrição</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {table.columns.map((col, i) => (
              <tr key={i}>
                <td className="py-1 pr-2">
                  <input
                    value={col.name}
                    aria-label="Nome da coluna"
                    onChange={(e) => onTemplate(renameColumn(template, table.name, col.name, toSnakeId(e.target.value) || e.target.value.toLowerCase()))}
                    className={`${INPUT} font-mono text-xs`}
                  />
                </td>
                <td className="py-1 pr-2">
                  <Select value={col.type} options={TYPE_OPTIONS} ariaLabel="Tipo da coluna" onChange={(type) => setColumn(i, { ...col, type: type as TemplateColumn["type"] })} />
                </td>
                <td className="py-1 pr-2">
                  <Checkbox checked={col.required} onChange={(required) => setColumn(i, { ...col, required })} label="sim" />
                </td>
                <td className="py-1 pr-2">
                  <input
                    value={col.description ?? ""}
                    aria-label="Descrição da coluna"
                    onChange={(e) => setColumn(i, { ...col, description: e.target.value || undefined })}
                    className={INPUT}
                  />
                </td>
                <td className="py-1 text-right">
                  <button
                    type="button"
                    className="rounded px-2 text-muted hover:text-danger disabled:opacity-30"
                    disabled={table.columns.length === 1}
                    aria-label={`Remover coluna ${col.name}`}
                    onClick={() => onTable({ ...table, columns: removeAt(table.columns, i) })}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AddButton
        onClick={() =>
          onTable({
            ...table,
            columns: [...table.columns, { name: uniqueId("coluna", table.columns.map((c) => c.name)), type: "text", required: true }],
          })
        }
      >
        Adicionar coluna
      </AddButton>
    </>
  );
}

function Relationships({ template: t, onChange }: StepProps) {
  const fact = t.tables.find((tb) => tb.kind === "fact");
  const dims = t.tables.filter((tb) => tb.kind === "dimension");
  if (!fact || dims.length === 0) return null;

  const factCols = fact.columns.map((c) => ({ value: c.name, label: c.name }));
  const linkOf = (dim: TemplateTable) => t.relationships.find((r) => r.from.table === fact.name && r.to.table === dim.name);
  const setLink = (dim: TemplateTable, column: string): void => {
    const others = t.relationships.filter((r) => !(r.from.table === fact.name && r.to.table === dim.name));
    const link = column && dim.key ? [{ from: { table: fact.name, column }, to: { table: dim.name, column: dim.key } }] : [];
    onChange({ ...t, relationships: [...others, ...link] });
  };

  return (
    <div className="rounded-xl border border-line p-3">
      <p className="text-sm font-semibold">Ligações</p>
      <p className="mb-3 text-xs text-muted">Qual coluna de <code className="font-mono">{fact.name}</code> aponta para a chave de cada dimensão.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {dims.map((dim) => (
          <Field key={dim.name} label={`${dim.name}.${dim.key ?? "(defina a chave)"}`}>
            <Select value={linkOf(dim)?.from.column ?? ""} empty="— sem ligação" options={factCols} onChange={(c) => setLink(dim, c)} />
          </Field>
        ))}
      </div>
    </div>
  );
}
