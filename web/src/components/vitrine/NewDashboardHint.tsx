/**
 * Where the "register dashboard" button used to be: new dashboards are no longer typed into a form.
 * The platform administrator describes what is needed to Claude, and an AI agent documents the data,
 * builds the dashboard, validates it and publishes it. This only says so, on hover and on keyboard focus.
 */
export function NewDashboardHint() {
  return (
    <span className="group relative inline-flex">
      <span
        tabIndex={0}
        aria-describedby="novo-dashboard-dica"
        className="inline-flex cursor-help items-center gap-1.5 rounded-lg border border-dashed border-line px-3 py-2 text-sm font-medium text-muted outline-none transition hover:border-brand/60 hover:text-text focus-visible:border-brand focus-visible:text-text"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
          <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" />
        </svg>
        Novo dashboard
      </span>
      <span
        id="novo-dashboard-dica"
        role="tooltip"
        className="pointer-events-none invisible absolute right-0 top-full z-30 mt-2 w-72 rounded-xl border border-line bg-card p-3 text-left text-xs leading-relaxed text-text opacity-0 shadow-xl transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
      >
        <span className="mb-1 block font-semibold">Criado por agente de IA</span>
        Novos dashboards não são cadastrados por formulário. O administrador da plataforma descreve o que precisa ao
        Claude, e o agente documenta os dados, monta o dashboard, valida e publica. Aqui você edita os que já existem.
      </span>
    </span>
  );
}
