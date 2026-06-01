/**
 * Convierte filas a CSV con escape correcto y dispara descarga en el navegador.
 * Usa BOM UTF-8 para que Excel abra acentos bien.
 */

const escape = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  const s = String(v);
  // Si contiene coma, comillas o salto de línea, envolver en comillas y escapar
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

export function rowsToCSV(headers: string[], rows: Array<Array<unknown>>): string {
  const lines: string[] = [];
  lines.push(headers.map(escape).join(','));
  for (const row of rows) lines.push(row.map(escape).join(','));
  return lines.join('\r\n');
}

export function downloadCSV(filename: string, headers: string[], rows: Array<Array<unknown>>): void {
  const csv = rowsToCSV(headers, rows);
  // BOM UTF-8 para Excel
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Helper para formatear fechas de archivo */
export function fileDateRange(from: string, to: string): string {
  return `${from}_${to}`;
}
