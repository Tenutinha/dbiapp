import { PAYMENT_LABEL, PAYMENT_METHODS, type PaymentMethod } from "@/lib/controle/schema";

/** 16 px text on purpose: iOS zooms the page when a focused field has smaller text. */
export const INPUT = "w-full rounded-lg border border-line bg-bg px-3 py-2.5 text-base outline-none focus:border-brand";

interface FieldProps {
  label: string;
  className?: string;
  children: React.ReactNode;
}

export function Field({ label, className = "", children }: FieldProps) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 text-xs text-muted ${className}`}>
      {label}
      {children}
    </label>
  );
}

interface PaymentPickerProps {
  value: PaymentMethod | null;
  onChange: (value: PaymentMethod | null) => void;
}

/** Payment method as tappable chips; tapping the chosen one clears it. */
export function PaymentPicker({ value, onChange }: PaymentPickerProps) {
  return (
    <div className="flex flex-col gap-1 text-xs text-muted">
      Forma de pagamento
      <div className="flex flex-wrap gap-2" role="group" aria-label="Forma de pagamento">
        {PAYMENT_METHODS.map((method) => (
          <button
            key={method}
            type="button"
            aria-pressed={value === method}
            onClick={() => onChange(value === method ? null : method)}
            className={`rounded-full border px-3 py-1.5 text-sm ${
              value === method ? "border-brand bg-brand/15 font-semibold text-text" : "border-line text-muted"
            }`}
          >
            {PAYMENT_LABEL[method]}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{message}</p>;
}
