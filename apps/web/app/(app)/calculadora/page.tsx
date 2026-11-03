import { DeadlineCalculator } from "@/components/deadline-calculator";

export default function CalculadoraPage() {
  return (
    <main className="mx-auto max-w-3xl p-4">
      <h1 className="mb-4 text-2xl font-semibold">Calculadora de prazos</h1>
      <DeadlineCalculator />
    </main>
  );
}
