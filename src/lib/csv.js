import { rubroDe } from "./gastos";

/* Excel en español abre bien el punto y coma; la coma le rompe las columnas
   cuando la config regional usa coma decimal. */
const SEP = ";";

const celda = (v) => {
  const s = v == null ? "" : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const COLUMNAS = [
  ["Fecha", (g) => g.fecha],
  ["Descripción", (g) => g.descripcion],
  ["Rubro", (g, alias, rubros) => rubroDe(g.rubro, rubros).nombre],
  ["Monto", (g) => g.monto],
  ["Moneda", (g) => g.moneda],
  ["Tipo de cambio", (g) => g.tc_a_base],
  ["Monto en NZD", (g) => g.monto_base],
  ["Pagó", (g, alias) => alias(g.pagador_id)],
  ["División", (g) => g.split],
  ["Le toca a cada uno", (g) => g.deuda],
];

export function gastosACSV(gastos, alias, rubros) {
  const filas = [
    COLUMNAS.map(([t]) => t).join(SEP),
    ...gastos.map((g) => COLUMNAS.map(([, f]) => celda(f(g, alias, rubros))).join(SEP)),
  ];
  // BOM para que Excel reconozca el UTF-8 y no rompa los acentos
  return "﻿" + filas.join("\r\n");
}

export function bajarCSV(nombre, contenido) {
  const blob = new Blob([contenido], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
