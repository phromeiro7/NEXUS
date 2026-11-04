"use client";

import qrcode from "qrcode-generator";
import { useMemo } from "react";

/** Folga ao redor, em módulos: o padrão do QR pede 4 para leitores o reconhecerem. */
const QUIET = 4;

/**
 * QR code em SVG, gerado no navegador (`qrcode-generator`, sem dependências). O texto nunca sai do aparelho:
 * nada de serviço externo de QR, porque o link leva o código do pedido de login.
 */
export function QrCode({ value, label, dimmed = false }: { value: string; label: string; dimmed?: boolean }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let row = 0; row < n; row += 1) {
      let col = 0;
      while (col < n) {
        if (!qr.isDark(row, col)) {
          col += 1;
          continue;
        }
        // Junta módulos escuros vizinhos da mesma linha num só retângulo: SVG bem menor.
        let end = col;
        while (end < n && qr.isDark(row, end)) end += 1;
        d += `M${col + QUIET} ${row + QUIET}h${end - col}v1h-${end - col}z`;
        col = end;
      }
    }
    return { size: n + QUIET * 2, path: d };
  }, [value]);

  return (
    <svg
      className="nx-qr-svg"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      style={{ opacity: dimmed ? 0.28 : 1 }}
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#142d3a" />
    </svg>
  );
}
