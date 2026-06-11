'use client';

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { findSchema, type VisitField, type VisitTypeSchema, type VisitType } from './visit-schemas';

export interface VisitPDFData {
  id: string;
  visit_type: VisitType;
  casa: string | null;
  technician_name: string | null;
  technician_email: string | null;
  contratista: string | null;
  visit_date: string;
  visit_time: string | null;
  status: string;
  form_data: Record<string, unknown>;
  notes: string | null;
  lat: number | null;
  lng: number | null;
  created_at: string;
}

export interface VisitPhoto {
  id: string;
  url: string | null;
  filename: string | null;
  description: string | null;
}

const ACCENT = '#07c5a8';
const TEXT = '#0f172a';
const MUTED = '#94a3b8';
const BORDER = '#e7eae9';
const BG_HEAD = '#f3f4f6';

const formatCell = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  return String(v);
};

const fetchImageAsBase64 = async (url: string): Promise<string | null> => {
  try {
    const r = await fetch(url);
    if (!r.ok) {
      console.error(`[PDF] fetch foto fallo (${r.status})`, url);
      return null;
    }
    const blob = await r.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => { console.error('[PDF] FileReader fallo'); resolve(null); };
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.error('[PDF] fetchImageAsBase64 error:', e, url);
    return null;
  }
};

const detectImageFormat = (dataUri: string): 'PNG' | 'JPEG' | 'WEBP' => {
  if (dataUri.startsWith('data:image/png')) return 'PNG';
  if (dataUri.startsWith('data:image/webp')) return 'WEBP';
  return 'JPEG';
};

// Dibuja el header (logo Sunny + datos visita) en la página actual
const drawHeader = (doc: jsPDF, schema: VisitTypeSchema, visit: VisitPDFData) => {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 12;

  // Logo "Sunny" tipográfico — sin emojis, con sol minimalista
  // Círculo (sol)
  doc.setFillColor(ACCENT);
  doc.circle(margin + 6, 18, 4, 'F');
  // Rayos
  doc.setDrawColor(ACCENT);
  doc.setLineWidth(1.2);
  const cx = margin + 6, cy = 18;
  for (let i = 0; i < 8; i++) {
    const ang = (i * Math.PI) / 4;
    const x1 = cx + Math.cos(ang) * 5.5;
    const y1 = cy + Math.sin(ang) * 5.5;
    const x2 = cx + Math.cos(ang) * 7.5;
    const y2 = cy + Math.sin(ang) * 7.5;
    doc.line(x1, y1, x2, y2);
  }
  // Texto Sunny
  doc.setTextColor(ACCENT);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text('Sunny', margin + 16, 22);
  doc.setTextColor(MUTED);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text('Powered by PROMIGAS', margin + 16, 26);

  // Caja de fecha/código/aprobado (derecha)
  const boxX = pageWidth - margin - 60;
  const boxY = 10;
  const boxW = 60;
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.3);
  doc.rect(boxX, boxY, boxW, 8);
  doc.setFontSize(8);
  doc.setTextColor(TEXT);
  doc.text(`Fecha : ${visit.visit_date}`, boxX + 2, boxY + 5.5);

  doc.rect(boxX, boxY + 8, boxW, 6);
  doc.text(schema.formCode, boxX + 2, boxY + 12);

  doc.rect(boxX, boxY + 14, boxW / 2, 6);
  doc.rect(boxX + boxW / 2, boxY + 14, boxW / 2, 6);
  doc.setFontSize(7);
  const aprobado = String(visit.form_data?.aprobado ?? '').toLowerCase();
  doc.text('Aprobado', boxX + 2, boxY + 18);
  doc.text('No Aprobado', boxX + boxW / 2 + 2, boxY + 18);
  // Marcar con check si aplica
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  if (aprobado === 'aprobado') doc.text('X', boxX + boxW / 2 - 5, boxY + 18.5);
  else if (aprobado === 'no aprobado') doc.text('X', boxX + boxW - 5, boxY + 18.5);
  doc.setFont('helvetica', 'normal');

  return 36; // y position after header
};

// Dibuja un título de sección (banda gris con texto centrado)
const drawSectionTitle = (doc: jsPDF, y: number, title: string): number => {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 12;
  doc.setFillColor(BG_HEAD);
  doc.setDrawColor(BORDER);
  doc.rect(margin, y, pageWidth - margin * 2, 6, 'FD');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(TEXT);
  doc.text(title, pageWidth / 2, y + 4.2, { align: 'center' });
  return y + 6;
};

// Convierte un campo (key/label/value) en filas estilizadas para autotable
const fieldToRow = (field: VisitField, formData: Record<string, unknown>): [string, string] => {
  const raw = formData[field.key];
  const value = formatCell(raw);
  const labelWithUnit = field.unit ? `${field.label} (${field.unit})` : field.label;
  return [labelWithUnit, value];
};

// Tabla genérica de fields (label | value) usando autotable
const drawFieldsTable = (doc: jsPDF, startY: number, fields: VisitField[], formData: Record<string, unknown>, opts?: { columns?: 1 | 2 }) => {
  const columns = opts?.columns ?? 2;
  if (columns === 2) {
    const rows: string[][] = [];
    for (let i = 0; i < fields.length; i += 2) {
      const a = fieldToRow(fields[i], formData);
      const b = fields[i + 1] ? fieldToRow(fields[i + 1], formData) : ['', ''];
      rows.push([a[0], a[1], b[0], b[1]]);
    }
    autoTable(doc, {
      startY,
      body: rows,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 1.5, lineColor: BORDER, lineWidth: 0.2, textColor: TEXT },
      columnStyles: {
        0: { fontStyle: 'normal', fillColor: '#fafafa', cellWidth: 48 },
        1: { cellWidth: 'auto' },
        2: { fontStyle: 'normal', fillColor: '#fafafa', cellWidth: 48 },
        3: { cellWidth: 'auto' },
      },
      margin: { left: 12, right: 12 },
    });
  } else {
    const rows = fields.map((f) => fieldToRow(f, formData));
    autoTable(doc, {
      startY,
      body: rows,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 1.5, lineColor: BORDER, lineWidth: 0.2, textColor: TEXT },
      columnStyles: {
        0: { fontStyle: 'normal', fillColor: '#fafafa', cellWidth: 70 },
        1: { cellWidth: 'auto' },
      },
      margin: { left: 12, right: 12 },
    });
  }
  // @ts-expect-error — jspdf-autotable extiende doc
  return doc.lastAutoTable.finalY;
};

// Genera y descarga el PDF de la visita
export async function generateVisitPDF(visit: VisitPDFData, photos: VisitPhoto[]) {
  const schema = findSchema(visit.visit_type);
  if (!schema) throw new Error(`Schema no encontrado para ${visit.visit_type}`);

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;

  // Header inicial
  let y = drawHeader(doc, schema, visit);

  // Línea de ubicación GPS con enlace clickeable a Google Maps (si hay coords)
  if (visit.lat !== null && visit.lng !== null) {
    const lat = visit.lat.toFixed(5);
    const lng = visit.lng.toFixed(5);
    const mapsUrl = `https://www.google.com/maps?q=${visit.lat},${visit.lng}`;
    const lineY = y + 3;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');

    // 1) Etiqueta
    doc.setTextColor(MUTED);
    const labelText = 'Ubicación GPS:';
    doc.text(labelText, margin, lineY);
    let cursorX = margin + doc.getTextWidth(labelText) + 2;

    // 2) Coordenadas
    doc.setTextColor(TEXT);
    const coordsText = `${lat}, ${lng}`;
    doc.text(coordsText, cursorX, lineY);
    cursorX += doc.getTextWidth(coordsText) + 4;

    // 3) Separador
    doc.setTextColor(MUTED);
    doc.text('|', cursorX, lineY);
    cursorX += doc.getTextWidth('|') + 4;

    // 4) Link clickeable
    doc.setTextColor(ACCENT);
    doc.setFont('helvetica', 'bold');
    doc.textWithLink('Ver en Google Maps', cursorX, lineY, { url: mapsUrl });
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(TEXT);
    y += 7;
  }

  // Cada sección del schema → título + tabla
  for (const sec of schema.sections) {
    // Saltar la sección de "Registro fotográfico" (las fotos van aparte)
    if (sec.title.toLowerCase().includes('registro fotográfico') || sec.title.toLowerCase().includes('observaciones') || sec.title.toLowerCase().includes('aprobación')) continue;

    // Si no cabe el título + 1 fila → nueva página
    if (y > pageHeight - 40) {
      doc.addPage();
      y = drawHeader(doc, schema, visit);
    }

    y = drawSectionTitle(doc, y, sec.title);

    // Decidir 1 o 2 columnas según cantidad de fields
    const cols: 1 | 2 = sec.fields.length > 4 ? 2 : 1;
    y = drawFieldsTable(doc, y, sec.fields, visit.form_data, { columns: cols });
    y += 2;
  }

  // Sección observaciones (caja grande con texto libre)
  const obsSection = schema.sections.find((s) => s.title.toLowerCase().includes('observaciones'));
  if (obsSection) {
    if (y > pageHeight - 50) { doc.addPage(); y = drawHeader(doc, schema, visit); }
    y = drawSectionTitle(doc, y, obsSection.title);
    const obsText = String(visit.form_data?.observaciones ?? visit.notes ?? '');
    const obsLines = doc.splitTextToSize(obsText || '—', doc.internal.pageSize.getWidth() - margin * 2 - 4);
    const boxHeight = Math.max(14, obsLines.length * 4 + 4);
    doc.setDrawColor(BORDER);
    doc.rect(margin, y, doc.internal.pageSize.getWidth() - margin * 2, boxHeight);
    doc.setFontSize(8);
    doc.setTextColor(TEXT);
    doc.text(obsLines, margin + 2, y + 5);
    y += boxHeight + 3;
  }

  // Quien realiza la visita + contratista (footer firma)
  const tecnico = String(visit.form_data?.quien_realiza_visita ?? visit.technician_name ?? '');
  const contratistaStr = visit.contratista ?? '';
  if (y > pageHeight - 24) { doc.addPage(); y = drawHeader(doc, schema, visit); }
  doc.setFontSize(8);
  doc.setTextColor(MUTED);
  doc.text('Quien realiza la visita:', doc.internal.pageSize.getWidth() - margin - 70, y + 5);
  doc.setTextColor(TEXT);
  doc.setFont('helvetica', 'bold');
  doc.text(tecnico || '—', doc.internal.pageSize.getWidth() - margin - 70, y + 10);
  if (contratistaStr) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(MUTED);
    doc.text('Contratista:', doc.internal.pageSize.getWidth() - margin - 70, y + 15);
    doc.setTextColor(TEXT);
    doc.setFont('helvetica', 'bold');
    doc.text(contratistaStr, doc.internal.pageSize.getWidth() - margin - 70, y + 20);
  }
  doc.setFont('helvetica', 'normal');

  // ───── Página(s) de fotos ─────
  if (photos.length > 0) {
    doc.addPage();
    let py = drawHeader(doc, schema, visit);
    py = drawSectionTitle(doc, py, 'V. Registro fotográfico');

    const pageW = doc.internal.pageSize.getWidth();
    const cellW = (pageW - margin * 2 - 6) / 3;       // 3 columnas
    const cellH = 50;                                  // altura foto
    const labelH = 5;
    let col = 0;
    let rowY = py + 2;

    let renderedCount = 0;
    let failedCount = 0;
    for (const photo of photos) {
      if (!photo.url) { failedCount++; continue; }
      if (rowY + cellH + labelH > pageHeight - margin) {
        doc.addPage();
        rowY = drawHeader(doc, schema, visit);
        rowY = drawSectionTitle(doc, rowY, 'V. Registro fotográfico (cont.)');
        rowY += 2;
        col = 0;
      }
      const x = margin + col * (cellW + 3);
      const dataUri = await fetchImageAsBase64(photo.url);
      let painted = false;
      if (dataUri) {
        try {
          const fmt = detectImageFormat(dataUri);
          doc.addImage(dataUri, fmt, x, rowY, cellW, cellH, undefined, 'FAST');
          painted = true;
        } catch (e) {
          console.error('[PDF] addImage fallo:', e, photo.filename);
        }
      }
      if (painted) renderedCount++; else failedCount++;
      // Caption
      doc.setFontSize(7);
      doc.setTextColor(MUTED);
      const caption = photo.description || photo.filename || '';
      doc.text(caption.slice(0, 40), x + cellW / 2, rowY + cellH + 3.5, { align: 'center' });
      doc.setDrawColor(BORDER);
      doc.rect(x, rowY, cellW, cellH);

      col++;
      if (col >= 3) {
        col = 0;
        rowY += cellH + labelH + 3;
      }
    }
    if (failedCount > 0) {
      console.warn(`[PDF] ${renderedCount} foto(s) renderizadas, ${failedCount} sin renderizar (URL inválida o formato no soportado).`);
    }
  }

  // Numerar páginas
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(MUTED);
    doc.text(`Página ${i} de ${total}  ·  ${schema.label}  ·  ${visit.casa ?? ''}`, doc.internal.pageSize.getWidth() / 2, pageHeight - 6, { align: 'center' });
  }

  // Filename: ACTA-{tipo}-{casa}-{fecha}.pdf
  const safeCasa = (visit.casa ?? 'sin-casa').replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `Acta-${schema.shortLabel.replace(/\s+/g, '_')}-${safeCasa}-${visit.visit_date}.pdf`;
  doc.save(filename);
}

/**
 * Versión "build only" — devuelve el Blob y el filename sugerido sin disparar
 * descarga. Útil para empaquetar múltiples actas en un .zip.
 */
export async function buildVisitPDFBlob(visit: VisitPDFData, photos: VisitPhoto[]): Promise<{ blob: Blob; filename: string }> {
  // Reusar la lógica de generateVisitPDF, pero produciendo Blob en vez de doc.save.
  // jsPDF expone .output('blob') para esto.
  const schema = findSchema(visit.visit_type);
  if (!schema) throw new Error(`Schema no encontrado para ${visit.visit_type}`);

  // Hack mínimo: monkey-patch temporal de doc.save para capturar el blob.
  // (Evita duplicar 170 líneas de drawing). Restauramos al terminar.
  // jsPDF.prototype.save tiene overloads incompatibles entre sí; el cast a
  // unknown→Function es la vía menos invasiva sin tocar la API pública.
  const proto = jsPDF.prototype as unknown as { save: (filename: string) => jsPDF };
  const originalSave = proto.save;
  let capturedBlob: Blob | null = null;
  let capturedName = 'acta.pdf';
  proto.save = function (this: jsPDF, filename: string) {
    capturedBlob = this.output('blob') as Blob;
    capturedName = filename;
    return this;
  };
  try {
    await generateVisitPDF(visit, photos);
  } finally {
    proto.save = originalSave;
  }
  if (!capturedBlob) throw new Error('No se generó el PDF');
  return { blob: capturedBlob, filename: capturedName };
}
