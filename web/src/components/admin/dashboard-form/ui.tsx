"use client";

/** Small building blocks shared by the dashboard registration steps. */

export const INPUT = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-brand";
export const MONO = `${INPUT} font-mono text-xs`;

interface FieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}

export function Field({ label, hint, children, className = "" }: FieldProps) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 text-xs text-muted ${className}`}>
      <span className="font-medium text-text/90">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
  readOnly?: boolean;
  ariaLabel?: string;
}

export function TextInput({ value, onChange, placeholder, mono, readOnly, ariaLabel }: TextInputProps) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      readOnly={readOnly}
      aria-label={ariaLabel}
      className={`${mono ? MONO : INPUT} ${readOnly ? "opacity-60" : ""}`}
    />
  );
}

interface NumberInputProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  ariaLabel?: string;
}

export function NumberInput({ value, onChange, min, max, ariaLabel }: NumberInputProps) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      aria-label={ariaLabel}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, Math.round(n))));
      }}
      className={INPUT}
    />
  );
}

interface TextAreaProps {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  mono?: boolean;
  ariaLabel?: string;
}

export function TextArea({ value, onChange, rows = 3, placeholder, mono, ariaLabel }: TextAreaProps) {
  return (
    <textarea
      value={value}
      rows={rows}
      placeholder={placeholder}
      aria-label={ariaLabel}
      spellCheck={!mono}
      onChange={(e) => onChange(e.target.value)}
      className={mono ? MONO : INPUT}
    />
  );
}

export interface Option {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  options: readonly Option[];
  onChange: (value: string) => void;
  /** Label of the empty choice; omit to force a value. */
  empty?: string;
  ariaLabel?: string;
}

export function Select({ value, options, onChange, empty, ariaLabel }: SelectProps) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel} className={INPUT}>
      {empty !== undefined && <option value="">{empty}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

interface ChipsProps {
  selected: readonly string[];
  options: readonly Option[];
  onChange: (selected: string[]) => void;
  emptyText?: string;
}

/** Multiple choice as toggle chips; keeps the order in which items were picked. */
export function Chips({ selected, options, onChange, emptyText = "Nada para escolher ainda." }: ChipsProps) {
  if (options.length === 0) return <p className="text-[11px] text-muted">{emptyText}</p>;
  const toggle = (v: string): void =>
    onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v]);
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(o.value)}
            className={`rounded-md border px-2 py-0.5 text-xs transition ${
              on ? "border-brand bg-brand/15 text-text" : "border-line text-muted hover:border-brand/60"
            }`}
          >
            {on && <span className="mr-1 tabular-nums text-brand-2">{selected.indexOf(o.value) + 1}</span>}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

export function Checkbox({ checked, onChange, label }: CheckboxProps) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

interface ItemCardProps {
  title: React.ReactNode;
  index: number;
  count: number;
  onMove: (to: number) => void;
  onRemove: () => void;
  removeLabel: string;
  children: React.ReactNode;
}

/** A list item with move up/down and remove buttons in its header. */
export function ItemCard({ title, index, count, onMove, onRemove, removeLabel, children }: ItemCardProps) {
  const btn = "grid size-7 place-items-center rounded-md text-muted hover:bg-line/40 hover:text-text disabled:opacity-30";
  return (
    <div className="rounded-xl border border-line bg-bg/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0 truncate text-sm font-semibold">{title}</div>
        <div className="flex shrink-0 gap-0.5">
          <button type="button" className={btn} disabled={index === 0} onClick={() => onMove(index - 1)} aria-label="Mover para cima">↑</button>
          <button type="button" className={btn} disabled={index === count - 1} onClick={() => onMove(index + 1)} aria-label="Mover para baixo">↓</button>
          <button type="button" className={`${btn} hover:text-danger`} onClick={onRemove} aria-label={removeLabel}>×</button>
        </div>
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

interface AddButtonProps {
  onClick: () => void;
  children: React.ReactNode;
}

export function AddButton({ onClick, children }: AddButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-dashed border-line px-3 py-2 text-sm text-muted transition hover:border-brand/60 hover:text-text"
    >
      + {children}
    </button>
  );
}

interface StepIntroProps {
  title: string;
  children: React.ReactNode;
}

export function StepIntro({ title, children }: StepIntroProps) {
  return (
    <div className="mb-4">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-0.5 text-xs text-muted">{children}</p>
    </div>
  );
}
