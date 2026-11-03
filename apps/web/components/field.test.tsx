import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FieldError, inputClass } from "./field";

describe("FieldError", () => {
  it("sem mensagem não renderiza nada", () => {
    const { container } = render(<FieldError id="x" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("com mensagem renderiza um alerta com o id para aria-describedby", () => {
    render(<FieldError id="x-erro" message="Obrigatório" />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Obrigatório");
    expect(alert).toHaveAttribute("id", "x-erro");
  });
});

describe("inputClass", () => {
  it("usa os tokens de cor, sem cores fixas", () => {
    expect(inputClass).toContain("var(--color-borda)");
    expect(inputClass).not.toMatch(/#[0-9a-f]{3,6}/i);
  });
});
