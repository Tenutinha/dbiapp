/**
 * Shown the moment a link is clicked, while the next page loads on the server (opening an
 * organization or a dashboard reads the database before anything can be shown).
 */
export default function Loading() {
  return (
    <main
      className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center gap-3 px-4 text-center"
      role="status"
      aria-live="polite"
    >
      <span
        className="h-8 w-8 animate-spin rounded-full border-2 border-muted/30 border-t-brand"
        aria-hidden="true"
      />
      <p className="text-sm text-muted">Carregando…</p>
    </main>
  );
}
