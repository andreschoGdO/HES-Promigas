'use client';

/**
 * PDF de una Bitácora de Construcción completa: header con casa/estado +
 * un bloque por entrada (fecha, etapa, clima, descripción, pendientes,
 * fotos), en orden cronológico. Estructura distinta a visit-pdf.ts (que es
 * "un evento = un documento") porque acá es "un documento = muchas
 * entradas" — por eso vive en su propio archivo en vez de forzarlo dentro
 * del esquema de actas.
 */

import jsPDF from 'jspdf';
import { fetchImageAsBase64, detectImageFormat } from './pdf-image-utils';

const ACCENT = '#3b82f6';
const TEXT = '#0f172a';
const MUTED = '#94a3b8';
const BORDER = '#e7eae9';
const BG_HEAD = '#eff6ff';

export interface ConstructionLogPDFData {
  id: string;
  casa: string;
  contratista: string | null;
  status: 'abierta' | 'cerrada';
  opened_at: string;
  closed_at: string | null;
}

export interface ConstructionLogEntryPhotoPDF {
  url: string | null;
  filename: string | null;
  description: string | null;
}

export interface ConstructionLogEntryPDF {
  entry_date: string;
  etapa: string | null;
  clima: string | null;
  descripcion: string;
  observaciones: string | null;
  lat: number | null;
  lng: number | null;
  created_by: string | null;
  created_at: string;
  photos: ConstructionLogEntryPhotoPDF[];
}

const fmtDateLong = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
const fmtDateTime = (d: string) => new Date(d).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const drawHeader = (doc: jsPDF, log: ConstructionLogPDFData): number => {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 12;

  doc.setFillColor(ACCENT);
  doc.circle(margin + 6, 18, 4, 'F');
  doc.setDrawColor(ACCENT);
  doc.setLineWidth(1.2);
  const cx = margin + 6, cy = 18;
  for (let i = 0; i < 8; i++) {
    const ang = (i * Math.PI) / 4;
    doc.line(cx + Math.cos(ang) * 5.5, cy + Math.sin(ang) * 5.5, cx + Math.cos(ang) * 7.5, cy + Math.sin(ang) * 7.5);
  }
  doc.setTextColor(ACCENT);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text('Sunny', margin + 16, 22);
  doc.setTextColor(MUTED);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text('Powered by PROMIGAS', margin + 16, 26);

  const boxX = pageWidth - margin - 70;
  const boxW = 70;
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.3);
  doc.rect(boxX, 10, boxW, 6);
  doc.setFontSize(8);
  doc.setTextColor(TEXT);
  doc.text('Bitácora de Construcción', boxX + 2, 14.2);
  doc.rect(boxX, 16, boxW, 6);
  doc.text(`Estado: ${log.status === 'abierta' ? 'Abierta' : 'Cerrada'}`, boxX + 2, 20.2);
  doc.rect(boxX, 22, boxW, 6);
  doc.text(`Abierta: ${fmtDateTime(log.opened_at)}`, boxX + 2, 26.2);
  if (log.closed_at) {
    doc.rect(boxX, 28, boxW, 6);
    doc.text(`Cerrada: ${fmtDateTime(log.closed_at)}`, boxX + 2, 32.2);
  }

  let y = 42;
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(TEXT);
  doc.text(log.casa, margin, y);
  y += 5;
  if (log.contratista) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(MUTED);
    doc.text(`Contratista: ${log.contratista}`, margin, y);
    y += 5;
  }
  return y + 3;
};

async function buildConstructionLogPdfDoc(log: ConstructionLogPDFData, entries: ConstructionLogEntryPDF[]): Promise<{ doc: jsPDF; filename: string }> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const margin = 12;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - margin * 2;

  let y = drawHeader(doc, log);

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - margin) {
      doc.addPage();
      y = drawHeader(doc, log);
    }
  };

  if (entries.length === 0) {
    doc.setFontSize(9);
    doc.setTextColor(MUTED);
    doc.text('Esta bitácora todavía no tiene entradas.', margin, y + 4);
  }

  for (const entry of entries) {
    // Header de la entrada: banda de color + fecha + etapa/clima
    ensureSpace(16);
    doc.setFillColor(BG_HEAD);
    doc.setDrawColor(BORDER);
    doc.rect(margin, y, contentWidth, 7, 'FD');
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(TEXT);
    doc.text(fmtDateLong(entry.entry_date), margin + 2, y + 4.8);
    const tagsParts = [entry.etapa, entry.clima].filter(Boolean) as string[];
    if (tagsParts.length > 0) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(MUTED);
      doc.text(tagsParts.join(' · '), pageWidth - margin - 2, y + 4.8, { align: 'right' });
    }
    y += 7 + 3;

    // Descripción (wrap)
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(TEXT);
    const descLines: string[] = doc.splitTextToSize(entry.descripcion, contentWidth - 4);
    ensureSpace(descLines.length * 4.2 + 2);
    doc.text(descLines, margin + 2, y);
    y += descLines.length * 4.2 + 2;

    if (entry.observaciones) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(MUTED);
      ensureSpace(5);
      doc.text('Pendientes:', margin + 2, y);
      y += 4;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(TEXT);
      const obsLines: string[] = doc.splitTextToSize(entry.observaciones, contentWidth - 4);
      ensureSpace(obsLines.length * 4.2 + 2);
      doc.text(obsLines, margin + 2, y);
      y += obsLines.length * 4.2 + 2;
    }

    // Metadata: digitado por / GPS
    doc.setFontSize(7);
    doc.setTextColor(MUTED);
    const metaParts = [`Digitado ${fmtDateTime(entry.created_at)}`];
    if (entry.created_by) metaParts.push(entry.created_by);
    const metaLine = metaParts.join(' · ');
    ensureSpace(5);
    doc.text(metaLine, margin + 2, y);
    if (entry.lat !== null && entry.lng !== null) {
      const linkX = margin + 2 + doc.getTextWidth(metaLine) + 3;
      doc.setTextColor(30, 100, 200);
      doc.textWithLink('Ver ubicación', linkX, y, { url: `https://www.google.com/maps?q=${entry.lat},${entry.lng}` });
    }
    y += 6;

    // Fotos de la entrada (grid 3 columnas)
    const photosWithUrl = entry.photos.filter((p) => p.url);
    if (photosWithUrl.length > 0) {
      const cellW = (contentWidth - 6) / 3;
      const cellH = 32;
      let col = 0;
      let rowY = y;
      ensureSpace(cellH + 5);
      rowY = y;
      for (const photo of photosWithUrl) {
        if (rowY + cellH > pageHeight - margin) {
          doc.addPage();
          y = drawHeader(doc, log);
          rowY = y;
          col = 0;
        }
        const x = margin + col * (cellW + 3);
        const dataUri = await fetchImageAsBase64(photo.url!);
        if (dataUri) {
          try {
            doc.addImage(dataUri, detectImageFormat(dataUri), x, rowY, cellW, cellH, undefined, 'FAST');
          } catch (e) {
            console.error('[PDF bitácora] addImage falló:', e, photo.filename);
          }
        }
        doc.setDrawColor(BORDER);
        doc.rect(x, rowY, cellW, cellH);
        col++;
        if (col >= 3) { col = 0; rowY += cellH + 3; }
      }
      y = rowY + (col > 0 ? cellH + 3 : 0) + 2;
    }

    // Separador entre entradas
    ensureSpace(4);
    doc.setDrawColor(BORDER);
    doc.setLineWidth(0.2);
    doc.line(margin, y, pageWidth - margin, y);
    y += 5;
  }

  // Numerar páginas
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(MUTED);
    doc.text(`Página ${i} de ${total}  ·  Bitácora de Construcción  ·  ${log.casa}`, pageWidth / 2, pageHeight - 6, { align: 'center' });
  }

  const safeCasa = log.casa.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `Bitacora-${safeCasa}-${new Date().toISOString().slice(0, 10)}.pdf`;
  return { doc, filename };
}

export async function generateConstructionLogPDF(log: ConstructionLogPDFData, entries: ConstructionLogEntryPDF[]) {
  const { doc, filename } = await buildConstructionLogPdfDoc(log, entries);
  doc.save(filename);
}

/** Versión "build only" — igual patrón que buildVisitPDFBlob en visit-pdf.ts. */
export async function buildConstructionLogPDFBlob(log: ConstructionLogPDFData, entries: ConstructionLogEntryPDF[]): Promise<{ blob: Blob; filename: string }> {
  const { doc, filename } = await buildConstructionLogPdfDoc(log, entries);
  const blob = doc.output('blob') as Blob;
  return { blob, filename };
}
