"use client";

import qrcode from "qrcode-generator";
import { useMemo } from "react";

/** Folga ao redor, em módulos: o padrão do QR pede 4 para leitores o reconhecerem. */
const QUIET_ZONE_MODULES = 4;

/** Opacidade do QR quando não está valendo (expirado, negado etc.). */
const DIMMED_OPACITY = 0.28;
const BACKGROUND_COLOR = "#eef1ec";
const MODULE_COLOR = "#142d3a";

/** Nível de correção de erros "M" (~15%): bom equilíbrio entre densidade e tolerância a falhas. */
const ERROR_CORRECTION_LEVEL = "M";
/** Versão 0 = a menor que comporte o texto. */
const AUTO_TYPE_NUMBER = 0;

/**
 * QR code em SVG, gerado no navegador (`qrcode-generator`, sem dependências). O texto nunca sai do aparelho:
 * nada de serviço externo de QR, porque o link leva o código do pedido de login.
 */
export function QrCode({ value, label, dimmed = false }: { value: string; label: string; dimmed?: boolean }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(AUTO_TYPE_NUMBER, ERROR_CORRECTION_LEVEL);
    qr.addData(value);
    qr.make();
    const moduleCount = qr.getModuleCount();
    let pathData = "";
    for (let row = 0; row < moduleCount; row += 1) {
      let column = 0;
      while (column < moduleCount) {
        if (!qr.isDark(row, column)) {
          column += 1;
          continue;
        }
        // Junta módulos escuros vizinhos da mesma linha num só retângulo: SVG bem menor.
        let runEnd = column;
        while (runEnd < moduleCount && qr.isDark(row, runEnd)) runEnd += 1;
        const runLength = runEnd - column;
        pathData += `M${column + QUIET_ZONE_MODULES} ${row + QUIET_ZONE_MODULES}h${runLength}v1h-${runLength}z`;
        column = runEnd;
      }
    }
    return { size: moduleCount + QUIET_ZONE_MODULES * 2, path: pathData };
  }, [value]);

  return (
    <svg
      className="nx-qr-svg"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      style={{ opacity: dimmed ? DIMMED_OPACITY : 1 }}
    >
      <rect width={size} height={size} fill={BACKGROUND_COLOR} />
      <path d={path} fill={MODULE_COLOR} />
    </svg>
  );
}
