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
    head: [['Marca', 'Casas', 'kWp', 'kWh']],
    body: marcas.map((m) => [m.marca, fmtInt(m.casas), fmt1(m.kwp), fmtInt(m.kwh)]),
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
  drawFooter(doc, '* Indicadores editables: actualice los valores acumulados y la serie mensual según el cierre real de cada mes.');

  // ─── SLIDE 3 (NUEVA): DETALLE GLOBAL POR MARCA, ZONA Y CONSTRUCTOR ───
  const dg = r.detalleGlobal ?? r.detalle;
  drawDetalleSlide(doc, 'Avance global', 'Detalle por marca, zona y constructor',
    dg.marcas, dg.zonas, dg.constructores);
  drawFooter(doc, '* Detalle acumulado: incluye todas las casas ya instaladas desde inicio de operación.');

  // ─── SLIDE 4: PLANEACIÓN (movido antes del avance semanal) ───
  doc.addPage();
  drawHeader(doc, 'Planeación', 'Lo asignado para ejecutar la próxima semana');
  y = 44;
  y = drawStatRow(doc, y, [
    { label: 'Casas asignadas',      value: fmtInt(r.planeacion.casasAsignadas), hint: 'para la próxima semana' },
    { label: 'kWp planificados',     value: `${fmt1(r.planeacion.kwpPlan)} kWp`, hint: 'estimado' },
    { label: 'kWh batería planif.',  value: `${fmtInt(r.planeacion.kwhPlan)} kWh`, hint: 'estimado' },
  ]);
  y = drawStatRow(doc, y, [
    { label: 'CAPEX estimado',        value: fmtCOP(r.planeacion.capexPlanM),    hint: 'próxima semana' },
    { label: 'Constructores activos', value: `${r.planeacion.constructoresActivos}`, hint: r.planeacion.constructoresLista },
    { label: 'Zonas con actividad',   value: `${r.planeacion.zonasActivas}`,     hint: r.planeacion.zonasLista },
  ]);
  autoTable(doc, {
    startY: y,
    head: [['Zona', 'Constructor', 'Casas asignadas', 'Marca predominante', 'Fecha estimada de inicio']],
    body: r.planeacion.distribucion.map((p) => [p.zona, p.constructor, fmtInt(p.casas), p.marca, p.fecha]),
    headStyles: tableHeaderStyles(),
    bodyStyles: { fontSize: 9, textColor: TEXT },
    alternateRowStyles: { fillColor: HEAD_BG },
    margin: { left: 20, right: 20 },
    theme: 'grid',
    styles: { lineColor: BORDER, lineWidth: 0.1 },
  });
  drawFooter(doc, '* Indicadores editables. Ajuste fechas, zonas y cantidades según la planificación real de la semana.');

  // ─── SLIDE 5: AVANCE SEMANAL ───
  doc.addPage();
  drawHeader(doc, 'Avance semanal', 'Resultados de construcción de esta semana');
  y = 44;
  y = drawStatRow(doc, y, [
    { label: 'Casas instaladas', value: fmtInt(r.semana.casasInstaladas), hint: `de ${r.semana.programadas} programadas` },
    { label: 'En stand by',      value: fmtInt(r.semana.standBy),          hint: 'ver motivos abajo' },
    { label: 'Por iniciar',      value: fmtInt(r.semana.porIniciar),       hint: 'ya asignadas' },
  ]);
  y = drawStatRow(doc, y, [
    { label: 'kWp solar instalados',    value: `${fmt1(r.semana.kwpSemana)} kWp`, hint: 'esta semana' },
    { label: 'kWh batería instalados', value: `${fmtInt(r.semana.kwhSemana)} kWh`, hint: 'esta semana' },
    { label: 'CAPEX ejecutado',        value: fmtCOP(r.semana.capexSemanaM),      hint: 'acumulado semana' },
  ]);
  autoTable(doc, {
    startY: y,
    head: [['Motivo', 'Casas', 'Acción en curso']],
    body: r.semana.motivos.map((m) => [m.motivo, fmtInt(m.casas), m.accion]),
    headStyles: tableHeaderStyles(),
    bodyStyles: { fontSize: 9, textColor: TEXT },
    alternateRowStyles: { fillColor: HEAD_BG },
    margin: { left: 20, right: 20 },
    theme: 'grid',
    styles: { lineColor: BORDER, lineWidth: 0.1 },
  });
  drawFooter(doc, '* Indicadores editables: actualice los valores directamente desde la vista Dash.');

  // ─── SLIDE 6: DETALLE SEMANAL POR MARCA, ZONA Y CONSTRUCTOR ───
  drawDetalleSlide(doc, 'Avance semanal', 'Detalle por marca, zona y constructor',
    r.detalle.marcas, r.detalle.zonas, r.detalle.constructores);
  drawFooter(doc, '* Tabla y gráfico nativos: edite los valores en la vista Dash y el reporte se actualiza.');

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

  // ─── SLIDE 7: POSTVENTA ───
  doc.addPage();
  drawHeader(doc, 'Postventa', 'Garantías: equipos y retorno a bodega');
  y = 44;
  y = drawStatRow(doc, y, [
    { label: 'Casos abiertos',           value: fmtInt(r.postventa.abiertos),       hint: 'en garantía esta semana' },
    { label: 'Equipos en tránsito',      value: fmtInt(r.postventa.enTransito),     hint: 'recolección programada' },
    { label: 'Resueltos en sitio',       value: fmtInt(r.postventa.resueltosSitio), hint: 'sin retorno a bodega' },
  ]);
  autoTable(doc, {
    startY: y,
    head: [['Marca', 'Equipo', 'Falla reportada', 'Estado', 'Retorno a bodega']],
    body: r.postventa.detalle.map((g) => [g.marca, g.equipo, g.falla, g.estado, g.retorno]),
    headStyles: tableHeaderStyles(),
    bodyStyles: { fontSize: 9, textColor: TEXT },
    alternateRowStyles: { fillColor: HEAD_BG },
    margin: { left: 20, right: 20 },
    theme: 'grid',
    styles: { lineColor: BORDER, lineWidth: 0.1 },
  });
  drawFooter(doc, '* Actualice estado y fechas de retorno a bodega según el seguimiento con cada fabricante.');

  // ─── SLIDE 8: LOGÍSTICA ───
  doc.addPage();
  drawHeader(doc, 'Logística', 'Estado de inventario en bodega');
  y = 44;
  const logColW = (pageW - 20 * 2 - 8) / 2;
  autoTable(doc, {
    startY: y,
    head: [['Marca', 'Paneles', 'Inversores', 'Baterías', 'Estructuras']],
    body: r.logistica.stock.map((s) => [s.marca, fmtInt(s.paneles), fmtInt(s.inversores), fmtInt(s.baterias), fmtInt(s.estructuras)]),
    headStyles: tableHeaderStyles(),
    bodyStyles: { fontSize: 9, textColor: TEXT },
    alternateRowStyles: { fillColor: HEAD_BG },
    margin: { left: 20, right: pageW - 20 - logColW },
    theme: 'grid',
    styles: { lineColor: BORDER, lineWidth: 0.1 },
  });
  autoTable(doc, {
    startY: y,
    head: [['Componente', 'Nivel']],
    body: r.logistica.alertas.map((a) => [a.componente, a.nivel]),
    headStyles: tableHeaderStyles(),
    bodyStyles: { fontSize: 9, textColor: TEXT },
    alternateRowStyles: { fillColor: HEAD_BG },
    margin: { left: 20 + logColW + 8, right: 20 },
    theme: 'grid',
    styles: { lineColor: BORDER, lineWidth: 0.1 },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const y3 = (doc as any).lastAutoTable.finalY + 10;
  // Barras cobertura estimada
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(MUTED);
  doc.text('COBERTURA ESTIMADA (SEMANAS DE INSTALACIÓN)', 20, y3);
  const barsY = y3 + 6;
  const barsAvail = pageW - 40;
  const barW = Math.min(28, (barsAvail - (r.logistica.stock.length - 1) * 8) / r.logistica.stock.length);
  const maxCov = Math.max(...r.logistica.stock.map((s) => s.cobertura), 1);
  const barMaxH = 40;
  r.logistica.stock.forEach((s, i) => {
    const x = 20 + i * (barW + 8);
    const h = (s.cobertura / maxCov) * barMaxH;
    doc.setFillColor(ACCENT);
    doc.rect(x, barsY + (barMaxH - h), barW, h, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(TEXT);
    doc.text(String(s.cobertura), x + barW / 2, barsY + (barMaxH - h) - 2, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(MUTED);
    doc.text(s.marca, x + barW / 2, barsY + barMaxH + 5, { align: 'center' });
  });
  drawFooter(doc, '* Actualice el stock semanalmente con el reporte de bodega.');

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
