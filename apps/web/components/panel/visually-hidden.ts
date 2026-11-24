import type { CSSProperties } from "react";

/** Esconde o elemento na tela mantendo-o para leitores de tela (rótulos de busca, legendas de tabela). */
export const VISUALLY_HIDDEN_STYLE: CSSProperties = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" };
