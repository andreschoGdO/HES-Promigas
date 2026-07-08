'use client';

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { DashReport } from './dash-report-data';

const ACCENT   = '#07c5a8';
const DARK     = '#1f2937';
const TEXT     = '#0f172a';
const MUTED    = '#6b7280';
const BORDER   = '#e5e7eb';
const HEAD_BG  = '#f3f4f6';

const fmtInt = (n: number) => n.toLocaleString('es-CO');
const fmt1   = (n: number) => n.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtCOP = (n: number) => `$${fmtInt(n)}M COP`;

/** Mapea la marca del componente al kit final que ve el cliente. */
function kitLabel(m: string): string {
  if (m === 'Livoltek') return 'Kit Livoltek + Livoltek';
  if (m === 'DEYE' || m === 'Deye' || m === 'Deye HV') return 'Kit Deye + Deye';
  if (m === 'Pylontech') return 'Kit Deye + Pylontech';
  return m;
}

/** Dibuja un ícono de sol vectorial (rayos + disco) — logo de Sunny. */
function drawSunLogo(doc: jsPDF, cx: number, cy: number, radius: number, color: string = ACCENT) {
  doc.setFillColor(color);
  doc.setDrawColor(color);
  doc.setLineWidth(radius * 0.18);
  // Disco central
  doc.circle(cx, cy, radius * 0.55, 'F');
  // 8 rayos
  const rayInner = radius * 0.75;
  const rayOuter = radius * 1.15;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const x1 = cx + Math.cos(a) * rayInner;
    const y1 = cy + Math.sin(a) * rayInner;
    const x2 = cx + Math.cos(a) * rayOuter;
    const y2 = cy + Math.sin(a) * rayOuter;
    doc.line(x1, y1, x2, y2);
  }
  doc.setLineWidth(0.2); // reset
}

/** Encabezado uniforme para cada slide. */
function drawHeader(doc: jsPDF, section: string, title: string) {
  const w = doc.internal.pageSize.getWidth();
  // sección (accent)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(ACCENT);
  doc.text(section.toUpperCase(), 20, 20);
  // título grande
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(TEXT);
  doc.text(title, 20, 32);
  // logo sol arriba a la derecha
  drawSunLogo(doc, w - 25, 22, 6);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(TEXT);
  doc.text('SUNNY', w - 34, 24, { align: 'right' });
}

function drawFooter(doc: jsPDF, note: string) {
  const h = doc.internal.pageSize.getHeight();
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(MUTED);
  doc.text(note, 20, h - 10);
}

/** Fila de "stat cards" horizontal. Devuelve la Y siguiente. */
function drawStatRow(
  doc: jsPDF,
  y: number,
  cards: Array<{ label: string; value: string; hint: string }>,
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const marginX = 20;
  const gap = 8;
  const totalW = pageW - marginX * 2;
  const cardW = (totalW - gap * (cards.length - 1)) / cards.length;
  const cardH = 26;
  cards.forEach((c, i) => {
    const x = marginX + i * (cardW + gap);
    doc.setDrawColor(BORDER);
    doc.setFillColor('#ffffff');
    doc.roundedRect(x, y, cardW, cardH, 3, 3, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(MUTED);
    doc.text(c.label.toUpperCase(), x + 5, y + 6);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(TEXT);
    doc.text(c.value, x + 5, y + 16);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(ACCENT);
    doc.text(c.hint, x + 5, y + 22);
  });
  return y + cardH + 6;
}

function tableHeaderStyles() {
  return {
    fillColor: DARK,
    textColor: '#ffffff',
    fontStyle: 'bold' as const,
    fontSize: 8.5,
  };
}

/**
 * Slide con las 3 tablas (Marca | Zona | Constructor) — layout de 2 columnas.
 * Se usa una vez para el acumulado global y otra para la semana.
 */
function drawDetalleSlide(
  doc: jsPDF,
  section: string,
  title: string,
  marcas: Array<{ marca: string; casas: number; kwp: number; kwh: number }>,
  zonas: Array<{ zona: string; casas: number; capex: string }>,
  constructores: Array<{ constructor: string; asignadas: number; instaladas: number }>,
) {
  doc.addPage();
  drawHeader(doc, section, title);
  const pageW = doc.internal.pageSize.getWidth();
  const y = 44;
  const colW = (pageW - 20 * 2 - 8) / 2;
  autoTable(doc, {
    startY: y,
    head: [['Kit', 'Casas', 'kWp', 'kWh']],
    body: marcas.map((m) => [kitLabel(m.marca), fmtInt(m.casas), fmt1(m.kwp), fmtInt(m.kwh)]),
    headStyles: tableHeaderStyles(),
    bodyStyles: { fontSize: 9, textColor: TEXT },
    alternateRowStyles: { fillColor: HEAD_BG },
    margin: { left: 20, right: pageW - 20 - colW },
    theme: 'grid',
    styles: { lineColor: BORDER, lineWidth: 0.1 },
  });
  autoTable(doc, {
    startY: y,
    head: [['Zona', 'Casas', 'CAPEX (COP)']],
    body: zonas.map((z) => [z.zona, fmtInt(z.casas), z.capex]),
    headStyles: tableHeaderStyles(),
    bodyStyles: { fontSize: 9, textColor: TEXT },
    alternateRowStyles: { fillColor: HEAD_BG },
    margin: { left: 20 + colW + 8, right: 20 },
    theme: 'grid',
    styles: { lineColor: BORDER, lineWidth: 0.1 },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const y2 = (doc as any).lastAutoTable.finalY + 10;
  autoTable(doc, {
    startY: y2,
    head: [['Constructor', 'Asignadas', 'Instaladas']],
    body: constructores.map((c) => [c.constructor, fmtInt(c.asignadas), fmtInt(c.instaladas)]),
    headStyles: tableHeaderStyles(),
    bodyStyles: { fontSize: 9, textColor: TEXT },
    alternateRowStyles: { fillColor: HEAD_BG },
    margin: { left: 20 + colW + 8, right: 20 },
    theme: 'grid',
    styles: { lineColor: BORDER, lineWidth: 0.1 },
  });
}

export function generateDashPDF(r: DashReport): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // ─── SLIDE 1: PORTADA ───
  // Logo sol arriba izq + wordmark
  drawSunLogo(doc, 30, 25, 8);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(TEXT);
  doc.text('SUNNY', 42, 27);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(ACCENT);
  doc.text('CONSTRUCCIÓN · SEGUIMIENTO SEMANAL', 20, pageH / 2 - 12);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(34);
  doc.setTextColor(TEXT);
  doc.text('Weekly Construcción', 20, pageH / 2 + 2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(14);
  doc.setTextColor(MUTED);
  doc.text('Sistemas Solares + BESS residenciales', 20, pageH / 2 + 14);
  doc.setFontSize(10);
  doc.setTextColor(MUTED);
  doc.text(`Semana del ${r.periodo.desde} al ${r.periodo.hasta} · ${r.periodo.anio}`, 20, pageH - 20);
  // línea accent decorativa
  doc.setDrawColor(ACCENT);
  doc.setLineWidth(0.8);
  doc.line(20, pageH / 2 - 20, 80, pageH / 2 - 20);
  doc.setLineWidth(0.2);

  // ─── SLIDE 2: AVANCE GLOBAL ───
  doc.addPage();
  drawHeader(doc, 'Avance global', 'Total instalado hasta la fecha');
  let y = 44;
  y = drawStatRow(doc, y, [
    { label: 'Casas instaladas (acum.)', value: fmtInt(r.global.casasAcum), hint: 'desde inicio de operación' },
    { label: 'kWp solar (acum.)',        value: `${fmt1(r.global.kwpAcum)} kWp`, hint: 'instalados a la fecha' },
    { label: 'kWh batería (acum.)',      value: `${fmtInt(r.global.kwhAcum)} kWh`, hint: 'instalados a la fecha' },
  ]);
  y = drawStatRow(doc, y, [
    { label: 'CAPEX ejecutado (acum.)', value: fmtCOP(r.global.capexAcumM), hint: 'desde inicio de operación' },
    { label: 'Avance vs. meta anual',   value: `${r.global.avancePct}%`,     hint: `${r.global.casasAcum} de ${r.global.metaCasas} casas meta` },
  ]);
  autoTable(doc, {
    startY: y,
    head: [['Mes', 'Casas', 'kWp', 'kWh', 'CAPEX']],
    body: r.global.porMes.map((m) => [m.mes, fmtInt(m.casas), fmt1(m.kwp), fmtInt(m.kwh), `$${fmtInt(m.capexM)}M`]),
    headStyles: tableHeaderStyles(),
    bodyStyles: { fontSize: 8.5, textColor: TEXT },
    alternateRowStyles: { fillColor: HEAD_BG },
    margin: { left: 20, right: 20 },
    theme: 'grid',
    styles: { lineColor: BORDER, lineWidth: 0.1 },
  });
  drawFooter(doc, '* Detalle mensual con instalación acumulada y CAPEX ejecutado.');

  // ─── SLIDE 2b: AVANCE GLOBAL — RENTABILIDAD USD/Wp ───
  if (r.global.usdWpBySolucion?.length > 0) {
    doc.addPage();
    drawHeader(doc, 'Avance global', 'Rentabilidad · USD/Wp por solución');
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(MUTED);
    doc.text('TRM operativa: 3.901,29 COP/USD', 20, 44);
    doc.setFont('helvetica', 'normal');
    y = 52;
    y = drawStatRow(doc, y, r.global.usdWpBySolucion.map((s) => ({
      label: s.solucion,
      value: `$${fmt1(s.usdWpPromedio)} USD/Wp`,
      hint: `${s.casas} casa${s.casas === 1 ? '' : 's'}`,
    })));
    if (r.global.capexVentaAcumM > 0) {
      y = drawStatRow(doc, y, [
        { label: 'CAPEX venta acumulado', value: `$${fmtInt(r.global.capexVentaAcumM)}M COP`, hint: `${r.global.casasAcum} casas · ${fmt1(r.global.kwpAcum)} kWp` },
      ]);
    }
    drawFooter(doc, '* Promedio ponderado por kWp. Valores del CSV de cierre (respetando la TRM del momento contable).');
  }

  // ─── SLIDE 3: DETALLE GLOBAL POR KIT, ZONA Y CONSTRUCTOR ───
  const dg = r.detalleGlobal ?? r.detalle;
  drawDetalleSlide(doc, 'Avance global', 'Detalle por kit, zona y constructor',
    dg.marcas, dg.zonas, dg.constructores);
  drawFooter(doc, '* Detalle acumulado: incluye todas las casas ya instaladas desde inicio de operación.');

  // ─── SLIDE 4: WEEKLY CONSTRUCCIÓN (unificado — semana + planeación próxima semana) ───
  doc.addPage();
  drawHeader(doc, 'Weekly', 'Construcción');
  y = 44;
  y = drawStatRow(doc, y, [
    { label: 'Instaladas esta semana', value: fmtInt(r.semana.casasInstaladas), hint: 'ya operativas' },
    { label: 'En curso',               value: fmtInt(r.semana.porIniciar),      hint: 'alistamiento o instalación' },
    { label: 'Próxima semana',         value: fmtInt(r.planeacion.casasAsignadas), hint: 'en gestión + planeadas' },
  ]);
  y = drawStatRow(doc, y, [
    { label: 'kWp solar instalados',    value: `${fmt1(r.semana.kwpSemana)} kWp`, hint: 'esta semana' },
    { label: 'kWh batería instalados', value: `${fmtInt(r.semana.kwhSemana)} kWh`, hint: 'esta semana' },
    { label: 'CAPEX ejecutado',        value: fmtCOP(r.semana.capexSemanaM),      hint: 'acumulado semana' },
  ]);
  // Distribución próxima semana (planeación)
  if (r.planeacion.distribucion.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [['Próxima semana — Zona', 'Constructor', 'Casas', 'Kit', 'Fecha']],
      body: r.planeacion.distribucion.map((p) => [p.zona, p.constructor, fmtInt(p.casas), kitLabel(p.marca), p.fecha]),
      headStyles: tableHeaderStyles(),
      bodyStyles: { fontSize: 9, textColor: TEXT },
      alternateRowStyles: { fillColor: HEAD_BG },
      margin: { left: 20, right: 20 },
      theme: 'grid',
      styles: { lineColor: BORDER, lineWidth: 0.1 },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 6;
  }
  // Motivos de stand by (si hay)
  if (r.semana.motivos.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [['Motivo (stand by)', 'Casas', 'Acción en curso']],
      body: r.semana.motivos.map((m) => [m.motivo, fmtInt(m.casas), m.accion]),
      headStyles: tableHeaderStyles(),
      bodyStyles: { fontSize: 9, textColor: TEXT },
      alternateRowStyles: { fillColor: HEAD_BG },
      margin: { left: 20, right: 20 },
      theme: 'grid',
      styles: { lineColor: BORDER, lineWidth: 0.1 },
    });
  }
  drawFooter(doc, '* Semana actual + planeación próxima semana en un solo panel.');

  // ─── SLIDE 5: DETALLE SEMANAL POR KIT, ZONA Y CONSTRUCTOR ───
  drawDetalleSlide(doc, 'Weekly', 'Detalle por kit, zona y constructor',
    r.detalle.marcas, r.detalle.zonas, r.detalle.constructores);
  drawFooter(doc, '* Detalle de la ventana seleccionada. Si no hay instalaciones, esta sección queda vacía.');

  // ─── SLIDE 7: LEGALIZACIONES ───
  doc.addPage();
  drawHeader(doc, 'Legalizaciones', 'Trámites para venta de excedentes (AGPE)');
  doc.setFontSize(10);
  doc.setTextColor(MUTED);
  doc.text('Seguimiento personalizado a las casas en proceso de legalización ante el operador de red para habilitar la venta de excedentes de energía.', 20, 44);
  y = 54;
  y = drawStatRow(doc, y, [
    { label: 'Casas en trámite',      value: fmtInt(r.legalizaciones.tramite),    hint: 'esta semana' },
    { label: 'Aprobadas',             value: fmtInt(r.legalizaciones.aprobadas),  hint: 'habilitadas para excedentes' },
    { label: 'En revisión / radicadas', value: fmtInt(r.legalizaciones.enRevision), hint: 'con el operador de red' },
  ]);
  autoTable(doc, {
    startY: y,
    head: [['Cliente / Casa', 'Zona', 'Operador de red', 'Estado del trámite', 'Fecha estimada']],
    body: r.legalizaciones.detalle.map((l) => [l.casa, l.zona, l.operador, l.estado, l.fecha]),
    headStyles: tableHeaderStyles(),
    bodyStyles: { fontSize: 9, textColor: TEXT },
    alternateRowStyles: { fillColor: HEAD_BG },
    margin: { left: 20, right: 20 },
    theme: 'grid',
    styles: { lineColor: BORDER, lineWidth: 0.1 },
  });
  drawFooter(doc, '* Reemplace "Casa 1, 2, 3..." por el identificador real del cliente o dirección.');

  // ─── SLIDE 6: POSTVENTA (desde inventario / in_repair) ───
  doc.addPage();
  drawHeader(doc, 'Postventa', 'Equipos en garantía / RMA (desde inventario)');
  y = 44;
  y = drawStatRow(doc, y, [
    { label: 'Casos abiertos',       value: fmtInt(r.postventa.abiertos),       hint: 'items en reparación' },
    { label: 'En RMA / proveedor',   value: fmtInt(r.postventa.enTransito),     hint: 'items fuera de bodega' },
    { label: 'Resueltos (30d)',       value: fmtInt(r.postventa.resueltosSitio), hint: 'movimientos repair_end' },
  ]);
  if (r.postventa.detalle.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [['Marca', 'Equipo', 'Falla / notas', 'Estado', 'Ubicación']],
      body: r.postventa.detalle.map((g) => [g.marca, g.equipo, g.falla, g.estado, g.retorno]),
      headStyles: tableHeaderStyles(),
      bodyStyles: { fontSize: 9, textColor: TEXT },
      alternateRowStyles: { fillColor: HEAD_BG },
      margin: { left: 20, right: 20 },
      theme: 'grid',
      styles: { lineColor: BORDER, lineWidth: 0.1 },
    });
  } else {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(10);
    doc.setTextColor(MUTED);
    doc.text('Sin equipos en garantía actualmente.', 20, y + 10);
  }
  drawFooter(doc, '* Los tickets se gestionan por equipo desde /inventario (status in_repair / rma).');

  // ─── SLIDE 7: LOGÍSTICA — STOCK POR BODEGA + KITS ARMABLES ───
  doc.addPage();
  drawHeader(doc, 'Logística', 'Stock por bodega + kits armables');
  y = 44;
  // Stock por bodega: 3 tablas lado a lado (o global si no viene por bodega)
  const bodegas = r.logistica.stockPorBodega ?? [];
  if (bodegas.length > 0) {
    // Union de marcas para que las 3 tablas tengan las mismas filas
    const marcasUnion = Array.from(new Set(bodegas.flatMap((b) => b.stock.map((s) => s.marca)))).sort();
    const numBodegas = bodegas.length;
    const bodColW = (pageW - 20 * 2 - 8 * (numBodegas - 1)) / numBodegas;
    bodegas.forEach((b, i) => {
      const xLeft = 20 + i * (bodColW + 8);
      const stockMap = new Map(b.stock.map((s) => [s.marca, s] as const));
      const rows = marcasUnion.map((marca) => {
        const s = stockMap.get(marca) ?? { marca, paneles: 0, inversores: 0, baterias: 0, estructuras: 0, cobertura: 0 };
        return [s.marca, fmtInt(s.paneles), fmtInt(s.inversores), fmtInt(s.baterias)];
      });
      autoTable(doc, {
        startY: y,
        head: [[b.warehouseName, 'Pan.', 'Inv.', 'Bat.']],
        body: rows,
        headStyles: tableHeaderStyles(),
        bodyStyles: { fontSize: 8, textColor: TEXT },
        alternateRowStyles: { fillColor: HEAD_BG },
        margin: { left: xLeft, right: pageW - xLeft - bodColW },
        theme: 'grid',
        styles: { lineColor: BORDER, lineWidth: 0.1 },
      });
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 8;
  } else {
    autoTable(doc, {
      startY: y,
      head: [['Marca', 'Paneles', 'Inversores', 'Baterías', 'Estructuras']],
      body: r.logistica.stock.map((s) => [s.marca, fmtInt(s.paneles), fmtInt(s.inversores), fmtInt(s.baterias), fmtInt(s.estructuras)]),
      headStyles: tableHeaderStyles(),
      bodyStyles: { fontSize: 9, textColor: TEXT },
      alternateRowStyles: { fillColor: HEAD_BG },
      margin: { left: 20, right: 20 },
      theme: 'grid',
      styles: { lineColor: BORDER, lineWidth: 0.1 },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 8;
  }

  // Kits armables por bodega — tabla resumen
  if ((r.logistica.kitsPorBodega ?? []).length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(MUTED);
    doc.text('KITS SOLARES ARMABLES POR BODEGA — SIMULACIÓN', 20, y);
    y += 4;
    autoTable(doc, {
      startY: y,
      head: [['Bodega', 'Prioridad', 'Total', 'T2', 'T3', 'T4']],
      body: r.logistica.kitsPorBodega.map((k) => [
        k.warehouseName,
        `T2 ${Math.round(k.priority.T2 * 100)}% · T3 ${Math.round(k.priority.T3 * 100)}% · T4 ${Math.round(k.priority.T4 * 100)}%`,
        String(k.totalKits),
        String(k.byTipo.T2),
        String(k.byTipo.T3),
        String(k.byTipo.T4),
      ]),
      headStyles: tableHeaderStyles(),
      bodyStyles: { fontSize: 8.5, textColor: TEXT },
      alternateRowStyles: { fillColor: HEAD_BG },
      margin: { left: 20, right: 20 },
      theme: 'grid',
      styles: { lineColor: BORDER, lineWidth: 0.1 },
    });
  }
  drawFooter(doc, '* Simulación con stock actual respetando las prioridades por ciudad. Los equipos no se reutilizan entre kits.');

  // ─── SLIDE 9: GRACIAS ───
  doc.addPage();
  drawSunLogo(doc, pageW / 2, pageH / 2 - 20, 14);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(48);
  doc.setTextColor(TEXT);
  doc.text('Gracias', pageW / 2, pageH / 2 + 10, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(ACCENT);
  doc.text('Sunny · Avance Semanal de Construcción', pageW / 2, pageH / 2 + 22, { align: 'center' });

  doc.save(`Sunny_Avance_Construccion_${r.periodo.anio}.pdf`);
}
