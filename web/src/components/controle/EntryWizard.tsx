"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatMoney, parseMoney } from "@/lib/controle/money";
import {
  dayLabel, isValidDay, PAYMENT_LABEL, PAYMENT_METHODS, shiftDay, type PaymentMethod, type PurchaseInput, type SaleInput,
} from "@/lib/controle/schema";
import { call, ControleError } from "./api";
import { ErrorNote, INPUT } from "./fields";

const STEPS = ["valor", "pagamento", "data", "nome"] as const;
type Step = (typeof STEPS)[number] | "pronto";

interface Answers {
  day: string;
  totalCents: number;
  payment: PaymentMethod | null;
  /** The optional last answer: who bought (venda) or where the money went (despesa). */
  name: string | null;
}

/** What changes between a sale and an expense: the wording and what is sent to the API. */
interface Kind {
  id: string;
  askValue: string;
  missingValue: string;
  askDay: string;
  askName: string;
  namePlaceholder: string;
  saveNamed: string;
  done: (amount: string) => string;
  body: (answers: Answers) => Record<string, unknown>;
}

const KINDS: Record<"venda" | "despesa", Kind> = {
  venda: {
    id: "venda",
    askValue: "Qual o valor da venda?",
    missingValue: "Digite o valor da venda.",
    askDay: "Quando foi a venda?",
    askName: "Quer colocar o nome do cliente?",
    namePlaceholder: "Nome do cliente",
    saveNamed: "Salvar venda",
    done: (amount) => `Venda de ${amount} lançada`,
    body: (a) => {
      const sale: SaleInput = { soldOn: a.day, totalCents: a.totalCents, paymentMethod: a.payment, customerName: a.name };
      return { action: "saleSave", sale };
    },
  },
  despesa: {
    id: "despesa",
    askValue: "Qual o valor da despesa?",
    missingValue: "Digite o valor da despesa.",
    askDay: "Quando foi a despesa?",
    askName: "Quer dizer onde foi a despesa?",
    namePlaceholder: "Mercado, fornecedor, conta…",
    saveNamed: "Salvar despesa",
    done: (amount) => `Despesa de ${amount} lançada`,
    body: (a) => {
      const purchase: PurchaseInput = {
        purchasedOn: a.day, totalCents: a.totalCents, paymentMethod: a.payment, supplier: a.name,
        notes: null, receipt: null, fromReceipt: false, items: [],
      };
      return { action: "purchaseSave", purchase };
    },
  },
};

interface EntryWizardProps {
  kind: keyof typeof KINDS;
  api: string;
  today: string;
  onClose: () => void;
  /** Where the arrow of the first question leads (e.g. back to the ways of recording an expense). */
  onBack?: () => void;
}

const QUESTION = "text-xl font-bold leading-tight";
const CHOICE = "rounded-xl border border-line px-4 py-4 text-left text-base font-semibold transition hover:border-brand";

/**
 * A sale or a hand-typed expense, one question at a time: how much, how it was paid, when, and — only
 * if the person wants — who bought / where it was spent. Every answer moves to the next question; the
 * arrow goes back without losing anything.
 */
export function EntryWizard({ kind, api, today, onClose, onBack }: EntryWizardProps) {
  const copy = KINDS[kind];
  const router = useRouter();
  const [step, setStep] = useState<Step>("valor");
  const [value, setValue] = useState("");
  const [payment, setPayment] = useState<PaymentMethod | null>(null);
  const [day, setDay] = useState(today);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);

  const cents = parseMoney(value);
  const index = step === "pronto" ? STEPS.length : STEPS.indexOf(step);
  const yesterday = shiftDay(today, -1);

  // The question's own field is ready to type as soon as it shows up.
  useEffect(() => {
    fieldRef.current?.focus();
  }, [step]);

  const go = (to: Step): void => {
    setError(null);
    setStep(to);
  };

  function confirmValue(e: React.FormEvent): void {
    e.preventDefault();
    if (cents === null || cents <= 0) {
      setError(copy.missingValue);
      return;
    }
    go("pagamento");
  }

  function confirmDay(chosen: string): void {
    if (!isValidDay(chosen)) {
      setError("Escolha uma data válida.");
      return;
    }
    setDay(chosen);
    go("nome");
  }

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (cents === null) return;
    setSaving(true);
    setError(null);
    try {
      await call(api, copy.body({ day, totalCents: cents, payment, name: name.trim() || null }));
      setStep("pronto");
      router.refresh();
    } catch (err) {
      setError(err instanceof ControleError ? err.message : "Não foi possível salvar. Tente de novo.");
    } finally {
      setSaving(false);
    }
  }

  function another(): void {
    setValue("");
    setName("");
    go("valor"); // payment and day stay: entries of the same day usually come in a row
  }

  if (step === "pronto") {
    return (
      <div className="flex flex-col items-center gap-4 py-6 text-center" role="status">
        <span className="grid size-14 place-items-center rounded-full bg-ok/15 text-2xl text-ok" aria-hidden>✓</span>
        <p className={QUESTION}>{copy.done(formatMoney(cents ?? 0))}</p>
        <div className="grid w-full grid-cols-2 gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost justify-center py-3">Fechar</button>
          <button type="button" onClick={another} className="btn btn-primary justify-center py-3">Lançar outra</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        {index > 0 || onBack ? (
          <button
            type="button"
            onClick={index > 0 ? () => go(STEPS[index - 1]) : onBack}
            aria-label={index > 0 ? "Voltar à pergunta anterior" : "Voltar"}
            className="grid size-10 place-items-center rounded-lg text-xl text-muted hover:bg-text/5"
          >
            ‹
          </button>
        ) : (
          <span className="size-10" aria-hidden />
        )}
        <div className="flex flex-1 gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={index + 1} aria-label={`Pergunta ${index + 1} de ${STEPS.length}`}>
          {STEPS.map((s, i) => (
            <span key={s} className={`h-1.5 flex-1 rounded-full ${i <= index ? "bg-brand" : "bg-line"}`} />
          ))}
        </div>
        <span className="w-10 text-right text-xs tabular-nums text-muted">{index + 1}/{STEPS.length}</span>
      </div>

      {index > 0 && cents !== null && (
        <p className="text-sm text-muted">
          {formatMoney(cents)}
          {index > 1 ? ` · ${payment ? PAYMENT_LABEL[payment] : "pagamento não informado"}` : ""}
          {index > 2 ? ` · ${day === today ? "hoje" : dayLabel(day)}` : ""}
        </p>
      )}

      {step === "valor" && (
        <form onSubmit={confirmValue} className="flex flex-col gap-4" noValidate>
          <label htmlFor={`${copy.id}-valor`} className={QUESTION}>{copy.askValue}</label>
          <div className="flex items-center gap-2 rounded-xl border border-line bg-bg px-4 focus-within:border-brand">
            <span className="text-2xl font-semibold text-muted">R$</span>
            <input
              id={`${copy.id}-valor`}
              ref={fieldRef}
              inputMode="decimal"
              autoComplete="off"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="0,00"
              className="w-full bg-transparent py-4 text-3xl font-bold outline-none"
            />
          </div>
          <ErrorNote message={error} />
          <button className="btn btn-primary justify-center py-3 text-base">Continuar</button>
        </form>
      )}

      {step === "pagamento" && (
        <div className="flex flex-col gap-4">
          <p className={QUESTION}>Como foi o pagamento?</p>
          <div className="grid grid-cols-2 gap-2">
            {PAYMENT_METHODS.map((method) => (
              <button
                key={method}
                type="button"
                onClick={() => { setPayment(method); go("data"); }}
                className={`${CHOICE} ${payment === method ? "border-brand bg-brand/15" : ""}`}
              >
                {PAYMENT_LABEL[method]}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => { setPayment(null); go("data"); }} className="self-center text-sm text-muted underline underline-offset-4">
            Não informar
          </button>
        </div>
      )}

      {step === "data" && (
        <div className="flex flex-col gap-4">
          <p className={QUESTION}>{copy.askDay}</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => confirmDay(today)} className={`${CHOICE} ${day === today ? "border-brand bg-brand/15" : ""}`}>
              Hoje <span className="block text-sm font-normal text-muted">{dayLabel(today)}</span>
            </button>
            <button type="button" onClick={() => confirmDay(yesterday)} className={`${CHOICE} ${day === yesterday ? "border-brand bg-brand/15" : ""}`}>
              Ontem <span className="block text-sm font-normal text-muted">{dayLabel(yesterday)}</span>
            </button>
          </div>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Outra data
            <span className="flex gap-2">
              <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className={INPUT} />
              <button type="button" onClick={() => confirmDay(day)} className="btn btn-ghost shrink-0">Usar</button>
            </span>
          </label>
          <ErrorNote message={error} />
        </div>
      )}

      {step === "nome" && (
        <form onSubmit={save} className="flex flex-col gap-4" noValidate>
          <label htmlFor={`${copy.id}-nome`} className={QUESTION}>
            {copy.askName}
            <span className="mt-1 block text-sm font-normal text-muted">Opcional — pode salvar em branco.</span>
          </label>
          <input
            id={`${copy.id}-nome`}
            ref={fieldRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={copy.namePlaceholder}
            maxLength={120}
            autoComplete="off"
            className={INPUT}
          />
          <ErrorNote message={error} />
          <button className="btn btn-primary justify-center py-3 text-base" disabled={saving}>
            {saving ? "Salvando…" : name.trim() ? copy.saveNamed : "Salvar em branco"}
          </button>
        </form>
      )}
    </div>
  );
}
