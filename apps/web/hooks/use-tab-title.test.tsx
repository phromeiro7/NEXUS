import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useTabTitle } from "./use-tab-title";

beforeEach(() => {
  document.title = "Original";
});

describe("useTabTitle", () => {
  it("prefixa a contagem de pendências", () => {
    renderHook(() => useTabTitle(3));
    expect(document.title).toBe("(3) Assistente Jurídico");
  });

  it("sem prefixo quando zero", () => {
    renderHook(() => useTabTitle(0));
    expect(document.title).toBe("Assistente Jurídico");
  });

  it("atualiza quando a contagem muda e restaura ao desmontar", () => {
    const { rerender, unmount } = renderHook(({ n }) => useTabTitle(n), { initialProps: { n: 2 } });
    expect(document.title).toBe("(2) Assistente Jurídico");
    rerender({ n: 0 });
    expect(document.title).toBe("Assistente Jurídico");
    unmount();
    expect(document.title).toBe("Original");
  });
});
