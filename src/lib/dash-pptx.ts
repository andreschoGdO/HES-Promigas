'use client';

import PptxGenJS from 'pptxgenjs';
import type { DashReport } from './dash-report-data';

/**
 * Genera un archivo .pptx editable con el mismo contenido del PDF corporativo.
 * A diferencia del PDF, las tablas y KPIs son texto/tablas nativas de PowerPoint
 * — el usuario puede editar los números, colores y layouts antes de presentar.
 *
 * Aspect ratio: 16:9 (widescreen moderno)
 * Estilo: alineado al design system del Dash (light + accent teal)
 */

const ACCENT = '07C5A8';
const DARK = '1F2937';
const TEXT = '0F172A';
const MUTED = '6B7280';
const HEAD_BG = 'F3F4F6';
const CARD_BG = 'FFFFFF';

const fmtInt = (n: number) => n.toLocaleString('es-CO');
const fmt1   = (n: number) => n.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtCOP = (n: number) => `$${fmtInt(n)}M COP`;

/** Título estándar de sección (arriba a la izquierda de cada slide). */
function addSectionHeader(slide: PptxGenJS.Slide, eyebrow: string, title: string) {
  slide.addText(eyebrow.toUpperCase(), {
    x: 0.4, y: 0.3, w: 8, h: 0.3,
    fontSize: 10, bold: true, color: ACCENT, fontFace: 'Inter',
  });
  slide.addText(title, {
    x: 0.4, y: 0.6, w: 12.5, h: 0.6,
    fontSize: 24, bold: true, color: TEXT, fontFace: 'Inter',
  });
}

/** Fila de "stat cards" reutilizable. */
function addStatRow(slide: PptxGenJS.Slide, y: number, cards: Array<{ label: string; value: string; hint: string }>) {
  const marginX = 0.4;
  const gap = 0.15;
  const totalW = 13.33 - marginX * 2;
  const cardW = (totalW - gap * (cards.length - 1)) / cards.length;
  const cardH = 1.1;
  cards.forEach((c, i) => {
    const x = marginX + i * (cardW + gap);
    slide.addShape('rect', {
      x, y, w: cardW, h: cardH,
      fill: { color: CARD_BG }, line: { color: 'E7EAE9', width: 0.5 },
    });
    slide.addText(c.label.toUpperCase(), {
      x: x + 0.15, y: y + 0.1, w: cardW - 0.3, h: 0.25,
      fontSize: 8, bold: true, color: MUTED, fontFace: 'Inter',
    });
    slide.addText(c.value, {
      x: x + 0.15, y: y + 0.35, w: cardW - 0.3, h: 0.5,
      fontSize: 20, bold: true, color: TEXT, fontFace: 'Inter',
    });
    slide.addText(c.hint, {
      x: x + 0.15, y: y + 0.85, w: cardW - 0.3, h: 0.2,
      fontSize: 8, bold: true, color: ACCENT, fontFace: 'Inter',
    });
  });
}

/** Tabla estándar con encabezado oscuro y filas alternadas. */
function addTable(slide: PptxGenJS.Slide, y: number, head: string[], rows: string[][], opts?: { x?: number; w?: number }) {
  const x = opts?.x ?? 0.4;
  const w = opts?.w ?? 12.5;
  const headerRow: PptxGenJS.TableRow = head.map((h) => ({
    text: h,
    options: { fill: { color: DARK }, color: 'FFFFFF', bold: true, fontSize: 10, fontFace: 'Inter' },
  }));
  const bodyRows: PptxGenJS.TableRow[] = rows.map((row, i) => row.map((cell) => ({
    text: cell,
    options: {
      fill: { color: i % 2 === 0 ? HEAD_BG : CARD_BG },
      color: TEXT, fontSize: 9, fontFace: 'Inter',
    },
  })));
  slide.addTable([headerRow, ...bodyRows], {
    x, y, w,
    border: { type: 'solid', color: 'E7EAE9', pt: 0.5 },
    autoPage: false,
  });
}

export function generateDashPPTX(r: DashReport): void {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';   // 16:9 widescreen
  pptx.author = 'Sunny · GdO';
  pptx.title = `Sunny — Avance Construcción ${r.periodo.anio}`;

  // ─── SLIDE 1: PORTADA ───
  const s1 = pptx.addSlide();
  s1.background = { color: CARD_BG };
  s1.addText('CONSTRUCCIÓN · SEGUIMIENTO SEMANAL', {
    x: 0.5, y: 2, w: 12, h: 0.4,
    fontSize: 12, bold: true, color: ACCENT, fontFace: 'Inter',
  });
  s1.addText('Weekly Construcción', {
    x: 0.5, y: 2.5, w: 12, h: 1.2,
    fontSize: 44, bold: true, color: TEXT, fontFace: 'Inter',
  });
  s1.addText('Sistemas Solares + BESS residenciales', {
    x: 0.5, y: 3.8, w: 12, h: 0.5,
    fontSize: 16, color: MUTED, fontFace: 'Inter',
  });
  s1.addText(`Semana del ${r.periodo.desde} al ${r.periodo.hasta} · ${r.periodo.anio}`, {
    x: 0.5, y: 6.5, w: 12, h: 0.4,
    fontSize: 12, color: MUTED, fontFace: 'Inter',
  });

  // ─── SLIDE 2: AVANCE GLOBAL ───
  const s2 = pptx.addSlide();
  addSectionHeader(s2, 'Avance global', 'Total instalado hasta la fecha');
  addStatRow(s2, 1.4, [
    { label: 'Casas instaladas (acum.)', value: fmtInt(r.global.casasAcum), hint: 'desde inicio de operación' },
    { label: 'kWp solar (acum.)',        value: `${fmt1(r.global.kwpAcum)} kWp`, hint: 'instalados a la fecha' },
    { label: 'kWh batería (acum.)',      value: `${fmtInt(r.global.kwhAcum)} kWh`, hint: 'instalados a la fecha' },
  ]);
  addStatRow(s2, 2.7, [
    { label: 'CAPEX ejecutado (acum.)', value: fmtCOP(r.global.capexAcumM), hint: 'desde inicio de operación' },
    { label: 'Avance vs. meta anual',   value: `${r.global.avancePct}%`,     hint: `${r.global.casasAcum} de ${r.global.metaCasas} casas meta` },
  ]);
  addTable(s2, 4.1,
    ['Mes', 'Casas', 'kWp', 'kWh', 'CAPEX'],
    r.global.porMes.map((m) => [m.mes, fmtInt(m.casas), fmt1(m.kwp), fmtInt(m.kwh), `$${fmtInt(m.capexM)}M`]),
  );
  // USD/Wp por solución
  if (r.global.usdWpBySolucion?.length > 0) {
    addStatRow(s2, 6.5, r.global.usdWpBySolucion.map((s) => ({
      label: s.solucion,
      value: `$${fmt1(s.usdWpPromedio)} /Wp`,
      hint: `${s.casas} casas`,
    })));
  }

  // ─── SLIDE 3: CONSTRUCCIÓN (semanal + planeación) ───
  const s3 = pptx.addSlide();
  addSectionHeader(s3, 'Construcción', 'Operación semanal y proyección');
  addStatRow(s3, 1.4, [
    { label: 'Instaladas esta semana', value: fmtInt(r.semana.casasInstaladas), hint: 'ya operativas' },
    { label: 'En curso',                value: fmtInt(r.semana.porIniciar),      hint: 'alistamiento o instalación' },
    { label: 'Próxima semana',          value: fmtInt(r.planeacion.casasAsignadas), hint: 'en gestión + planeadas' },
  ]);
  addStatRow(s3, 2.7, [
    { label: 'kWp instalados',    value: `${fmt1(r.semana.kwpSemana)} kWp`, hint: 'esta semana' },
    { label: 'kWh batería',        value: `${fmtInt(r.semana.kwhSemana)} kWh`, hint: 'esta semana' },
    { label: 'CAPEX ejecutado',    value: fmtCOP(r.semana.capexSemanaM), hint: 'acumulado semana' },
  ]);
  if (r.planeacion.distribucion.length > 0) {
    addTable(s3, 4.1,
      ['Zona', 'Constructor', 'Casas', 'Marca', 'Fecha'],
      r.planeacion.distribucion.map((p) => [p.zona, p.constructor, fmtInt(p.casas), p.marca, p.fecha]),
    );
  }

  // ─── SLIDE 4: LEGALIZACIONES ───
  const s4 = pptx.addSlide();
  addSectionHeader(s4, 'Legalizaciones', 'Trámites AGPE ante operador de red');
  addStatRow(s4, 1.4, [
    { label: 'Casas en trámite',      value: fmtInt(r.legalizaciones.tramite),   hint: 'esta semana' },
    { label: 'Aprobadas',             value: fmtInt(r.legalizaciones.aprobadas), hint: 'habilitadas para excedentes' },
    { label: 'En revisión / radicadas', value: fmtInt(r.legalizaciones.enRevision), hint: 'con el operador de red' },
  ]);
  if (r.legalizaciones.detalle.length > 0) {
    addTable(s4, 2.9,
      ['Cliente / Casa', 'Zona', 'Operador', 'Estado', 'Fecha'],
      r.legalizaciones.detalle.map((l) => [l.casa, l.zona, l.operador, l.estado, l.fecha]),
    );
  }

  // ─── SLIDE 5: POSTVENTA ───
  const s5 = pptx.addSlide();
  addSectionHeader(s5, 'Postventa', 'Garantías: equipos y retorno a bodega');
  addStatRow(s5, 1.4, [
    { label: 'Casos abiertos',       value: fmtInt(r.postventa.abiertos),       hint: 'en garantía esta semana' },
    { label: 'Equipos en tránsito',  value: fmtInt(r.postventa.enTransito),     hint: 'recolección programada' },
    { label: 'Resueltos en sitio',   value: fmtInt(r.postventa.resueltosSitio), hint: 'sin retorno a bodega' },
  ]);
  if (r.postventa.detalle.length > 0) {
    addTable(s5, 2.9,
      ['Marca', 'Equipo', 'Falla', 'Estado', 'Retorno'],
      r.postventa.detalle.map((g) => [g.marca, g.equipo, g.falla, g.estado, g.retorno]),
    );
  }

  // ─── SLIDE 6: LOGÍSTICA ───
  const s6 = pptx.addSlide();
  addSectionHeader(s6, 'Logística', 'Estado de inventario en bodega');
  // Tabla stock
  addTable(s6, 1.4,
    ['Marca', 'Paneles', 'Inversores', 'Baterías', 'Estructuras'],
    r.logistica.stock.map((s) => [s.marca, fmtInt(s.paneles), fmtInt(s.inversores), fmtInt(s.baterias), fmtInt(s.estructuras)]),
    { x: 0.4, w: 6 },
  );
  // Tabla alertas
  addTable(s6, 1.4,
    ['Componente', 'Nivel'],
    r.logistica.alertas.map((a) => [a.componente, a.nivel]),
    { x: 6.9, w: 6 },
  );
  // Kits por bodega (reemplaza la gráfica de cobertura)
  if ((r.logistica.kitsPorBodega ?? []).length > 0) {
    s6.addText('KITS SOLARES ARMABLES — SIMULACIÓN', {
      x: 0.4, y: 4.4, w: 12.5, h: 0.3,
      fontSize: 10, bold: true, color: MUTED, fontFace: 'Inter',
    });
    addStatRow(s6, 4.8, r.logistica.kitsPorBodega.map((k) => ({
      label: k.warehouseName,
      value: `${k.totalKits} kits`,
      hint: `T2: ${k.byTipo.T2} · T3: ${k.byTipo.T3} · T4: ${k.byTipo.T4}`,
    })));
  }

  // ─── SLIDE 7: CIERRE ───
  const s7 = pptx.addSlide();
  s7.background = { color: CARD_BG };
  s7.addText('Gracias', {
    x: 0.5, y: 3, w: 12, h: 1.5,
    fontSize: 60, bold: true, color: TEXT, fontFace: 'Inter',
    align: 'center',
  });
  s7.addText('Sunny · Avance Semanal de Construcción', {
    x: 0.5, y: 4.5, w: 12, h: 0.5,
    fontSize: 14, bold: true, color: ACCENT, fontFace: 'Inter',
    align: 'center',
  });

  pptx.writeFile({ fileName: `Sunny_Avance_Construccion_${r.periodo.anio}.pptx` });
}
