import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="font-mono text-sm text-brand">404</p>
      <h1 className="text-2xl font-extrabold">Não encontrado</h1>
      <p className="text-sm text-muted">O dashboard não existe, você não tem acesso, ou o link expirou / foi revogado.</p>
      <Link href="/" className="btn btn-ghost">Voltar ao início</Link>
    </main>
  );
}
