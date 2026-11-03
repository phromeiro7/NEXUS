import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom não implementa showModal/close de <dialog>: stub mínimo (open + evento close).
if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
    // Como o navegador, move o foco para dentro do diálogo; assim, devolvê-lo só acontece
    // se o código da aplicação o fizer (o stub de close() não restaura nada).
    this.querySelector<HTMLElement>("button, [href], input, select, textarea, [tabindex]")?.focus();
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}

afterEach(() => cleanup());
