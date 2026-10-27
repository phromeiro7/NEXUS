/** Peças de formulário compartilhadas por login, tarefas, configurações e feriados. */

export const inputClass =
  "w-full rounded border border-[var(--color-borda)] bg-[var(--color-superficie)] px-3 py-2 text-[var(--color-texto)]";

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-sm text-[var(--color-fatal)]">
      {message}
    </p>
  );
}
