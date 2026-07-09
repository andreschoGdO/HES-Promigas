"use client";
import { supabase } from '@/lib/supabase';
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { toPng } from 'html-to-image';
import { Filter, RefreshCw, Download, Activity, Play, BookOpen, ChevronDown, ChevronUp, BarChart3, Cpu, AlertTriangle, AlertCircle, Bell, Info } from 'lucide-react';
import { VARIABLES, findVariable, type VariableMeta } from '@/lib/variables-dict';
import { NarFullView } from '@/components/NarFullView';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Brush,
  PieChart, Pie, Cell,
} from 'recharts';
import { classifyDevice } from '@/lib/classify-device';

type Tab = 'cierres' | 'nar';
type TypeFilter = 'all' | 'meter' | 'inverter' | 'gateway' | 'other';

interface DeviceOption {
  id: string;
  metrum_id: string;
  name: string;
  type: string | null;
  client: string | null;
  casa: string | null;
  cliente_id: string | null;
  location: string | null;
  city: string | null;
  marca: string | null;
  modelo: string | null;
  potencia_kw: number | null;
  is_active: boolean | null;
  last_seen_at: string | null;
}

interface ClosureRow {
  id: string;
  device_id: string;
  record_date: string;
  energy_active_imported_wh: number | null;
  energy_active_exported_wh: number | null;
  energy_reactive_imported_varh: number | null;
  energy_reactive_exported_varh: number | null;
  devices: {
    name: string;
    type: string;
    casa: string | null;
    client: string | null;
    location: string | null;
    city: string | null;
    potencia_kw: number | null;
    metrum_id: string;
  } | null;
}

// MÃ©tricas calculadas por casa por dÃ­a (Cierre Diario)
interface CasaDayMetrics {
  casa: string;
  date: string;
  generacion_wh: number | null;     // Î”CenergyAE inverter (Wh)
  importacion_wh: number | null;    // Î”CenergyAI red meter (Wh)
  excedentes_wh: number | null;     // Î”CenergyAE red meter (Wh)
  demanda_wh: number;               // Gen + Imp - Exc (Wh)
  gen_dem_pct: number | null;       // %
  exc_gen_pct: number | null;       // %
  imp_dem_pct: number | null;       // %
  yield_real: number | null;        // kWh/kWp
  desempeno_pct: number | null;     // % vs 4.5 kWh/kWp/dÃ­a (Cali ref)
  potencia_kw: number | null;       // suma de inverter capacity
  inverterMetrumId: string | null;
  redMeterMetrumId: string | null;
}

const YIELD_TEORICO_REF = 4.5; // kWh/kWp/dÃ­a â€” referencia Cali / Valle del Cauca

const fmtEnergy = (wh: number | null, unit = 'Wh') => {
  if (wh === null || wh === undefined) return 'â€”';
  if (Math.abs(wh) >= 1_000_000) return `${(wh / 1_000_000).toFixed(2)} M${unit}`;
  if (Math.abs(wh) >= 1_000) return `${(wh / 1_000).toFixed(2)} k${unit}`;
  return `${wh.toFixed(2)} ${unit}`;
};

const fmtPct = (v: number | null) => v === null || !Number.isFinite(v) ? 'â€”' : `${v.toFixed(1)}%`;
const fmtNum = (v: number | null, decimals = 2) => v === null || !Number.isFinite(v) ? 'â€”' : v.toFixed(decimals);

// Convierte filas a CSV y dispara descarga en el browser
const downloadCSV = (filename: string, headers: string[], rows: (string | number | null | undefined)[][]) => {
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))];
  const blob = new Blob(['ï»¿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// Calcula deltas (today - yesterday) por dispositivo y agrega por casa+fecha
const computeCasaMetrics = (closures: ClosureRow[]): CasaDayMetrics[] => {
  // 1. Agrupar por device y ordenar por fecha
  const byDevice = new Map<string, ClosureRow[]>();
  for (const c of closures) {
    if (!c.devices?.casa) continue;
    if (!byDevice.has(c.device_id)) byDevice.set(c.device_id, []);
    byDevice.get(c.device_id)!.push(c);
  }
  for (const arr of byDevice.values()) arr.sort((a, b) => a.record_date.localeCompare(b.record_date));

  // 2. Acumulador por casa|date
  type Agg = {
    casa: string;
    date: string;
    inv_eae: number | null;   // generaciÃ³n
    red_eai: number | null;   // importaciÃ³n
    red_eae: number | null;   // excedentes
    potencia_kw: number | null;
    inverterMetrumId: string | null;
    redMeterMetrumId: string | null;
  };
  const byKey = new Map<string, Agg>();
  const ensure = (casa: string, date: string): Agg => {
    const k = `${casa}|${date}`;
    let a = byKey.get(k);
    if (!a) {
      a = { casa, date, inv_eae: null, red_eai: null, red_eae: null, potencia_kw: null, inverterMetrumId: null, redMeterMetrumId: null };
      byKey.set(k, a);
    }
    return a;
  };

  for (const rows of byDevice.values()) {
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const prev = rows[i - 1];
      const dev = r.devices;
      if (!dev?.casa) continue;
      const eaiDelta = r.energy_active_imported_wh !== null && prev.energy_active_imported_wh !== null
        ? r.energy_active_imported_wh - prev.energy_active_imported_wh : null;
      const eaeDelta = r.energy_active_exported_wh !== null && prev.energy_active_exported_wh !== null
        ? r.energy_active_exported_wh - prev.energy_active_exported_wh : null;
      const agg = ensure(dev.casa, r.record_date);
      const t = (dev.type ?? '').toLowerCase();
      if (t === 'inverter' || t === 'inversor') {
        agg.inv_eae = (agg.inv_eae ?? 0) + (eaeDelta ?? 0);
        agg.potencia_kw = (agg.potencia_kw ?? 0) + (dev.potencia_kw ?? 0);
        agg.inverterMetrumId = dev.metrum_id;
      } else if (t === 'red') {
        agg.red_eai = (agg.red_eai ?? 0) + (eaiDelta ?? 0);
        agg.red_eae = (agg.red_eae ?? 0) + (eaeDelta ?? 0);
        agg.redMeterMetrumId = dev.metrum_id;
      }
    }
  }

  // 3. Finalizar cÃ¡lculos derivados
  const out: CasaDayMetrics[] = [];
  for (const a of byKey.values()) {
    const gen = a.inv_eae;
    const imp = a.red_eai;
    const exc = a.red_eae;
    const dem = (gen ?? 0) + (imp ?? 0) - (exc ?? 0);
    const yieldReal = gen !== null && a.potencia_kw && a.potencia_kw > 0
      ? (gen / 1000) / a.potencia_kw : null;
    out.push({
      casa: a.casa,
      date: a.date,
      generacion_wh: gen,
      importacion_wh: imp,
      excedentes_wh: exc,
      demanda_wh: dem,
      gen_dem_pct: gen !== null && dem > 0 ? (gen / dem) * 100 : null,
      exc_gen_pct: exc !== null && gen !== null && gen > 0 ? (exc / gen) * 100 : null,
      imp_dem_pct: imp !== null && dem > 0 ? (imp / dem) * 100 : null,
      yield_real: yieldReal,
      desempeno_pct: yieldReal !== null ? (yieldReal / YIELD_TEORICO_REF) * 100 : null,
      potencia_kw: a.potencia_kw,
      inverterMetrumId: a.inverterMetrumId,
      redMeterMetrumId: a.redMeterMetrumId,
    });
  }
  // ordenar por fecha desc, casa asc
  out.sort((a, b) => b.date.localeCompare(a.date) || a.casa.localeCompare(b.casa));
  return out;
};

const toLocalIso = (d: Date) => {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
};

const weekAgo = () => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
const today = () => new Date();
const dateStr = (d: Date) => d.toISOString().slice(0, 10);

// Etiqueta corta para los chips del selector. Identifica quÃ© tipo de equipo
// es (Medidor RED / Medidor SOLAR / Inversor marca / Pulsar) ademÃ¡s del nombre,
// para que cuando una casa tiene varios equipos del mismo tipo nominal el
// usuario distinga cuÃ¡l estÃ¡ eligiendo.
// â”€â”€â”€ Keys calculadas (virtuales) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Estas keys NO existen en Metrum; se computan en el frontend a partir de las
// keys reales que sÃ­ trae el inversor. Aparecen en la lista de "Keys disponibles"
// solo si TODAS las dependencias existen para ese device especÃ­fico.
// Las descripciones (quÃ© son, cÃ³mo se calculan, limitaciones) viven en
// `variables-dict.ts` â€” aquÃ­ solo definimos las dependencias y la fÃ³rmula.
interface ComputeContext {
  ts: number;
  hourLocal: number;   // 0-23, hora local Colombia (UTC-5)
  isDaylight: boolean; // 06:00â€“18:00 COT
  precomputed?: unknown;
}
interface DerivedKeyMeta {
  // Keys que deben estar en el catÃ¡logo del device para que la derivada aparezca.
  deps: string[];
  // Subset de `deps` que deben estar presentes en CADA row para computar el valor.
  // Default: igual que `deps`. Para derivadas que solo usan precompute (ej. envelope)
  // y no necesitan dep en la row actual, pasar [].
  perRowDeps?: string[];
  // Paso opcional que recibe TODA la serie del device antes del loop por row.
  // Ãštil para agregados (P95 por hora-del-dÃ­a, baselines, etc.).
  precompute?: (rows: Array<{ ts: number; vals: Record<string, number | null> }>) => unknown;
  compute: (vals: Record<string, number>, ctx?: ComputeContext) => number | null;
  appliesToInverter: boolean;
  // Si se setea, la derivada solo aparece en inversores de esa marca.
  // (Default: aparece en cualquier marca si las deps existen.)
  brand?: 'Livoltek' | 'DEYE';
}

// Helper: P95 por hora-del-dÃ­a (COT) sobre los samples disponibles del rango visible.
// Devuelve array indexado por hora local (0-23). Si una hora no tiene samples, null.
function envelopeByHour(
  rows: Array<{ ts: number; vals: Record<string, number | null> }>,
  depKey: string,
): Array<number | null> {
  const byHour: number[][] = Array.from({ length: 24 }, () => []);
  for (const r of rows) {
    const v = r.vals[depKey];
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    const d = new Date(r.ts - 5 * 3600 * 1000); // COT = UTC-5
    byHour[d.getUTCHours()].push(v);
  }
  return byHour.map((arr) => {
    if (arr.length === 0) return null;
    if (arr.length === 1) return arr[0];
    arr.sort((a, b) => a - b);
    const idx = Math.min(arr.length - 1, Math.floor(arr.length * 0.95));
    return arr[idx];
  });
}

const DERIVED_KEYS: Record<string, DerivedKeyMeta> = {
  // Envolvente DC ajustada por irradiancia: P95(DC, hora) Ã— GHI_actual / P95(GHI, hora).
  // El factor "GHI_actual / P95(GHI)" representa quÃ© tan despejado estÃ¡ el cielo HOY
  // a esa hora vs los dÃ­as mÃ¡s limpios histÃ³ricos. Multiplicando el P95 de DC por ese
  // ratio, el envelope se ajusta a la nubosidad real y deja solo gap por sombra,
  // suciedad, falla o curtailment. Si no hay GHI (no city, API caÃ­do), cae al P95 puro.
  envelope_dc_LIV: {
    deps: ['powerAEgdc_LV'],
    perRowDeps: [],
    precompute: (rows) => {
      // Calcula 3 cosas:
      //   p95dc[h]  = P95 de powerAEgdc_LV por hora
      //   p95ghi[h] = P95 de ghi_w_m2 por hora (si estÃ¡ disponible en vals)
      //   ghiByTs   = mapa tsâ†’ghi del rango visible (para lookup en compute)
      const byHourDc: number[][] = Array.from({ length: 24 }, () => []);
      const byHourGhi: number[][] = Array.from({ length: 24 }, () => []);
      const ghiByTs = new Map<number, number>();
      for (const r of rows) {
        const dc = r.vals.powerAEgdc_LV;
        const ghi = r.vals.ghi_w_m2;
        const d = new Date(r.ts - 5 * 3600 * 1000);
        const h = d.getUTCHours();
        if (dc !== null && dc !== undefined && Number.isFinite(dc)) byHourDc[h].push(dc);
        if (ghi !== null && ghi !== undefined && Number.isFinite(ghi)) {
          byHourGhi[h].push(ghi);
          ghiByTs.set(r.ts, ghi);
        }
      }
      const p95 = (arr: number[]): number | null => {
        if (arr.length === 0) return null;
        if (arr.length === 1) return arr[0];
        const s = [...arr].sort((a, b) => a - b);
        return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
      };
      return {
        p95dc:  byHourDc.map(p95),
        p95ghi: byHourGhi.map(p95),
        ghiByTs,
      };
    },
    compute: (_v, ctx) => {
      if (!ctx) return null;
      const pc = ctx.precomputed as { p95dc: Array<number | null>; p95ghi: Array<number | null>; ghiByTs: Map<number, number> } | undefined;
      if (!pc) return null;
      const baseDc = pc.p95dc[ctx.hourLocal];
      if (baseDc === null || baseDc === undefined) return null;
      // Si tenemos GHI real para este ts + P95(GHI) vÃ¡lido â†’ ajustar
      const ghiNow = pc.ghiByTs.get(ctx.ts);
      const ghiP95 = pc.p95ghi[ctx.hourLocal];
      if (ghiNow !== undefined && ghiP95 !== null && ghiP95 !== undefined && ghiP95 > 0) {
        return baseDc * (ghiNow / ghiP95);
      }
      // Fallback: P95 puro (comportamiento legacy)
      return baseDc;
    },
    appliesToInverter: true,
    brand: 'Livoltek',
  },
  // Curtailment DC instantÃ¡neo: max(0, envelope_ajustado âˆ’ real) cuando hay saturaciÃ³n
  // (baterÃ­a â‰¥95% AND no exportando AND de dÃ­a). En momentos normales = 0.
  // Usa el MISMO envelope ajustado por irradiancia para mayor precisiÃ³n.
  curtailment_dc_LIV: {
    deps: ['powerAEgdc_LV', 'BattSOC', 'ExportGrid_LV'],
    precompute: (rows) => {
      const byHourDc: number[][] = Array.from({ length: 24 }, () => []);
      const byHourGhi: number[][] = Array.from({ length: 24 }, () => []);
      const ghiByTs = new Map<number, number>();
      for (const r of rows) {
        const dc = r.vals.powerAEgdc_LV;
        const ghi = r.vals.ghi_w_m2;
        const d = new Date(r.ts - 5 * 3600 * 1000);
        const h = d.getUTCHours();
        if (dc !== null && dc !== undefined && Number.isFinite(dc)) byHourDc[h].push(dc);
        if (ghi !== null && ghi !== undefined && Number.isFinite(ghi)) {
          byHourGhi[h].push(ghi);
          ghiByTs.set(r.ts, ghi);
        }
      }
      const p95 = (arr: number[]): number | null => {
        if (arr.length === 0) return null;
        if (arr.length === 1) return arr[0];
        const s = [...arr].sort((a, b) => a - b);
        return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
      };
      return { p95dc: byHourDc.map(p95), p95ghi: byHourGhi.map(p95), ghiByTs };
    },
    compute: (v, ctx) => {
      if (!ctx) return 0;
      const pc = ctx.precomputed as { p95dc: Array<number | null>; p95ghi: Array<number | null>; ghiByTs: Map<number, number> } | undefined;
      if (!pc) return 0;
      let baseDc = pc.p95dc[ctx.hourLocal];
      if (baseDc === null || baseDc === undefined) return 0;
      const ghiNow = pc.ghiByTs.get(ctx.ts);
      const ghiP95 = pc.p95ghi[ctx.hourLocal];
      if (ghiNow !== undefined && ghiP95 !== null && ghiP95 !== undefined && ghiP95 > 0) {
        baseDc = baseDc * (ghiNow / ghiP95);
      }
      const saturated = v.BattSOC >= 95 && Math.abs(v.ExportGrid_LV) < 100 && ctx.isDaylight;
      if (!saturated) return 0;
      return Math.max(0, baseDc - v.powerAEgdc_LV);
    },
    appliesToInverter: true,
    brand: 'Livoltek',
  },
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Curtailment ACUMULADO en kWh: integra trapezoidal el curtailment_W
  // de cada muestra. Curva monotonamente creciente en el rango. Misma
  // lÃ³gica que el cron NAR (src/lib/curtailment.ts).
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  curtailment_kwh_LIV: {
    deps: ['powerAEgdc_LV', 'BattSOC', 'ExportGrid_LV'],
    perRowDeps: [],
    precompute: (rows) => {
      const byHourDc: number[][] = Array.from({ length: 24 }, () => []);
      const byHourGhi: number[][] = Array.from({ length: 24 }, () => []);
      const ghiByTs = new Map<number, number>();
      for (const r of rows) {
        const dc = r.vals.powerAEgdc_LV;
        const ghi = r.vals.ghi_w_m2;
        const d = new Date(r.ts - 5 * 3600 * 1000);
        const h = d.getUTCHours();
        if (dc !== null && dc !== undefined && Number.isFinite(dc)) byHourDc[h].push(dc);
        if (ghi !== null && ghi !== undefined && Number.isFinite(ghi)) {
          byHourGhi[h].push(ghi);
          ghiByTs.set(r.ts, ghi);
        }
      }
      const p95 = (arr: number[]): number | null => {
        if (arr.length === 0) return null;
        if (arr.length === 1) return arr[0];
        const s = [...arr].sort((a, b) => a - b);
        return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
      };
      const p95dc = byHourDc.map(p95);
      const p95ghi = byHourGhi.map(p95);

      // Integrar acumulado por timestamp ordenado
      const sorted = [...rows].sort((a, b) => a.ts - b.ts);
      const cumByTs = new Map<number, number>();
      let cumKwh = 0;
      for (let i = 0; i < sorted.length; i++) {
        const r = sorted[i];
        const dc = r.vals.powerAEgdc_LV;
        const battSoc = r.vals.BattSOC;
        const exp = r.vals.ExportGrid_LV;
        if (dc !== null && dc !== undefined && Number.isFinite(dc)
            && battSoc !== null && battSoc !== undefined && Number.isFinite(battSoc)
            && exp !== null && exp !== undefined && Number.isFinite(exp)) {
          const d = new Date(r.ts - 5 * 3600 * 1000);
          const h = d.getUTCHours();
          const isDaylight = h >= 6 && h < 18;
          const saturated = Number(battSoc) >= 95 && Math.abs(Number(exp)) < 100 && isDaylight;
          if (saturated) {
            let baseDc = p95dc[h];
            if (baseDc !== null && baseDc !== undefined) {
              const ghiNow = ghiByTs.get(r.ts);
              const ghiP95 = p95ghi[h];
              if (ghiNow !== undefined && ghiP95 !== null && ghiP95 !== undefined && ghiP95 > 0) {
                baseDc = baseDc * (ghiNow / ghiP95);
              }
              const curtW = Math.max(0, baseDc - Number(dc));
              if (curtW > 0) {
                const nextTs = sorted[i + 1]?.ts ?? r.ts;
                const dtMs = Math.min(nextTs - r.ts, 15 * 60 * 1000);
                if (dtMs > 0) {
                  // W Ã— s = J â†’ /3.6M = kWh
                  cumKwh += (curtW * (dtMs / 1000)) / 3_600_000;
                }
              }
            }
          }
        }
        cumByTs.set(r.ts, cumKwh);
      }
      return cumByTs;
    },
    compute: (_v, ctx) => {
      if (!ctx) return 0;
      const m = ctx.precomputed as Map<number, number> | undefined;
      return m?.get(ctx.ts) ?? 0;
    },
    appliesToInverter: true,
    brand: 'Livoltek',
  },
  curtailment_kwh_DEY: {
    deps: ['powerAPg', 'BattPower', 'BattSOC', 'ExportGrid_DY'],
    perRowDeps: [],
    precompute: (rows) => {
      const byHourDc: number[][] = Array.from({ length: 24 }, () => []);
      const byHourGhi: number[][] = Array.from({ length: 24 }, () => []);
      const ghiByTs = new Map<number, number>();
      for (const r of rows) {
        const apg = r.vals.powerAPg;
        const bp = r.vals.BattPower;
        // DEYE: Pdc = AC âˆ’ BattPower (convenciÃ³n opuesta a Livoltek)
        const dcEst = (apg !== null && apg !== undefined && Number.isFinite(apg) && bp !== null && bp !== undefined && Number.isFinite(bp))
          ? Number(apg) - Number(bp)
          : null;
        const ghi = r.vals.ghi_w_m2;
        const d = new Date(r.ts - 5 * 3600 * 1000);
        const h = d.getUTCHours();
        if (dcEst !== null && Number.isFinite(dcEst)) byHourDc[h].push(dcEst);
        if (ghi !== null && ghi !== undefined && Number.isFinite(ghi)) {
          byHourGhi[h].push(ghi);
          ghiByTs.set(r.ts, ghi);
        }
      }
      const p95 = (arr: number[]): number | null => {
        if (arr.length === 0) return null;
        if (arr.length === 1) return arr[0];
        const s = [...arr].sort((a, b) => a - b);
        return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
      };
      const p95dc = byHourDc.map(p95);
      const p95ghi = byHourGhi.map(p95);

      const sorted = [...rows].sort((a, b) => a.ts - b.ts);
      const cumByTs = new Map<number, number>();
      let cumKwh = 0;
      for (let i = 0; i < sorted.length; i++) {
        const r = sorted[i];
        const apg = r.vals.powerAPg;
        const bp = r.vals.BattPower;
        const battSoc = r.vals.BattSOC;
        const exp = r.vals.ExportGrid_DY;
        if (apg !== null && apg !== undefined && Number.isFinite(apg)
            && bp !== null && bp !== undefined && Number.isFinite(bp)
            && battSoc !== null && battSoc !== undefined && Number.isFinite(battSoc)
            && exp !== null && exp !== undefined && Number.isFinite(exp)) {
          const dc = Number(apg) - Number(bp);
          const d = new Date(r.ts - 5 * 3600 * 1000);
          const h = d.getUTCHours();
          const isDaylight = h >= 6 && h < 18;
          const saturated = Number(battSoc) >= 95 && Math.abs(Number(exp)) < 100 && isDaylight;
          if (saturated) {
            let baseDc = p95dc[h];
            if (baseDc !== null && baseDc !== undefined) {
              const ghiNow = ghiByTs.get(r.ts);
              const ghiP95 = p95ghi[h];
              if (ghiNow !== undefined && ghiP95 !== null && ghiP95 !== undefined && ghiP95 > 0) {
                baseDc = baseDc * (ghiNow / ghiP95);
              }
              const curtW = Math.max(0, baseDc - dc);
              if (curtW > 0) {
                const nextTs = sorted[i + 1]?.ts ?? r.ts;
                const dtMs = Math.min(nextTs - r.ts, 15 * 60 * 1000);
                if (dtMs > 0) {
                  cumKwh += (curtW * (dtMs / 1000)) / 3_600_000;
                }
              }
            }
          }
        }
        cumByTs.set(r.ts, cumKwh);
      }
      return cumByTs;
    },
    compute: (_v, ctx) => {
      if (!ctx) return 0;
      const m = ctx.precomputed as Map<number, number> | undefined;
      return m?.get(ctx.ts) ?? 0;
    },
    appliesToInverter: true,
    brand: 'DEYE',
  },
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Variables SEPARADAS por marca (Livoltek vs DEYE)
  // Necesarias porque la convenciÃ³n de signo de BattPower puede diferir
  // entre marcas. Estas usan el signo `+` (convenciÃ³n estÃ¡ndar internacional:
  // BattPower > 0 = carga, BattPower < 0 = descarga). En Livoltek se puede
  // comparar Pdc_LIV vs powerAEgdc_LV para verificar empÃ­ricamente.
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  Pdc_LIV: {
    deps: ['powerAPg', 'BattPower'],
    compute: (v) => (v.powerAPg ?? 0) + (v.BattPower ?? 0),
    appliesToInverter: true,
    brand: 'Livoltek',
  },
  Pdc_DEY: {
    deps: ['powerAPg', 'BattPower'],
    // DEYE usa convenciÃ³n OPUESTA a Livoltek (verificado en Casa 74): + descarga, âˆ’ carga.
    compute: (v) => (v.powerAPg ?? 0) - (v.BattPower ?? 0),
    appliesToInverter: true,
    brand: 'DEYE',
  },
  // Envolvente DC estimada para Livoltek (usando Pdc_LIV como base)
  envelope_dc_LIV_est: {
    deps: ['powerAPg', 'BattPower'],
    perRowDeps: [],
    precompute: (rows) => {
      const byHourDc: number[][] = Array.from({ length: 24 }, () => []);
      const byHourGhi: number[][] = Array.from({ length: 24 }, () => []);
      const ghiByTs = new Map<number, number>();
      for (const r of rows) {
        const apg = r.vals.powerAPg;
        const bp = r.vals.BattPower;
        const dcEst = (apg !== null && apg !== undefined && Number.isFinite(apg) && bp !== null && bp !== undefined && Number.isFinite(bp))
          ? Number(apg) + Number(bp)
          : null;
        const ghi = r.vals.ghi_w_m2;
        const d = new Date(r.ts - 5 * 3600 * 1000);
        const h = d.getUTCHours();
        if (dcEst !== null && Number.isFinite(dcEst)) byHourDc[h].push(dcEst);
        if (ghi !== null && ghi !== undefined && Number.isFinite(ghi)) {
          byHourGhi[h].push(ghi);
          ghiByTs.set(r.ts, ghi);
        }
      }
      const p95 = (arr: number[]): number | null => {
        if (arr.length === 0) return null;
        if (arr.length === 1) return arr[0];
        const s = [...arr].sort((a, b) => a - b);
        return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
      };
      return { p95dc: byHourDc.map(p95), p95ghi: byHourGhi.map(p95), ghiByTs };
    },
    compute: (_v, ctx) => {
      if (!ctx) return null;
      const pc = ctx.precomputed as { p95dc: Array<number | null>; p95ghi: Array<number | null>; ghiByTs: Map<number, number> } | undefined;
      if (!pc) return null;
      const baseDc = pc.p95dc[ctx.hourLocal];
      if (baseDc === null || baseDc === undefined) return null;
      const ghiNow = pc.ghiByTs.get(ctx.ts);
      const ghiP95 = pc.p95ghi[ctx.hourLocal];
      if (ghiNow !== undefined && ghiP95 !== null && ghiP95 !== undefined && ghiP95 > 0) {
        return baseDc * (ghiNow / ghiP95);
      }
      return baseDc;
    },
    appliesToInverter: true,
    brand: 'Livoltek',
  },
  // Envolvente DC para DEYE (Ãºnica opciÃ³n, no hay powerAEgdc_LV).
  // DEYE convenciÃ³n: + descarga, âˆ’ carga â†’ Pdc = AC âˆ’ BattPower.
  envelope_dc_DEY: {
    deps: ['powerAPg', 'BattPower'],
    perRowDeps: [],
    precompute: (rows) => {
      const byHourDc: number[][] = Array.from({ length: 24 }, () => []);
      const byHourGhi: number[][] = Array.from({ length: 24 }, () => []);
      const ghiByTs = new Map<number, number>();
      for (const r of rows) {
        const apg = r.vals.powerAPg;
        const bp = r.vals.BattPower;
        const dcEst = (apg !== null && apg !== undefined && Number.isFinite(apg) && bp !== null && bp !== undefined && Number.isFinite(bp))
          ? Number(apg) - Number(bp)
          : null;
        const ghi = r.vals.ghi_w_m2;
        const d = new Date(r.ts - 5 * 3600 * 1000);
        const h = d.getUTCHours();
        if (dcEst !== null && Number.isFinite(dcEst)) byHourDc[h].push(dcEst);
        if (ghi !== null && ghi !== undefined && Number.isFinite(ghi)) {
          byHourGhi[h].push(ghi);
          ghiByTs.set(r.ts, ghi);
        }
      }
      const p95 = (arr: number[]): number | null => {
        if (arr.length === 0) return null;
        if (arr.length === 1) return arr[0];
        const s = [...arr].sort((a, b) => a - b);
        return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
      };
      return { p95dc: byHourDc.map(p95), p95ghi: byHourGhi.map(p95), ghiByTs };
    },
    compute: (_v, ctx) => {
      if (!ctx) return null;
      const pc = ctx.precomputed as { p95dc: Array<number | null>; p95ghi: Array<number | null>; ghiByTs: Map<number, number> } | undefined;
      if (!pc) return null;
      const baseDc = pc.p95dc[ctx.hourLocal];
      if (baseDc === null || baseDc === undefined) return null;
      const ghiNow = pc.ghiByTs.get(ctx.ts);
      const ghiP95 = pc.p95ghi[ctx.hourLocal];
      if (ghiNow !== undefined && ghiP95 !== null && ghiP95 !== undefined && ghiP95 > 0) {
        return baseDc * (ghiNow / ghiP95);
      }
      return baseDc;
    },
    appliesToInverter: true,
    brand: 'DEYE',
  },
  // Curtailment para DEYE (DEYE no tiene curtailment_dc_LIV porque no expone
  // powerAEgdc_LV; usa Pdc_DEY como aproximaciÃ³n del DC real)
  curtailment_dc_DEY: {
    deps: ['powerAPg', 'BattPower', 'BattSOC', 'ExportGrid_DY'],
    precompute: (rows) => {
      // Mismo bucle que envelope_dc_DEY (DEYE: Pdc = AC âˆ’ BattPower)
      const byHourDc: number[][] = Array.from({ length: 24 }, () => []);
      const byHourGhi: number[][] = Array.from({ length: 24 }, () => []);
      const ghiByTs = new Map<number, number>();
      for (const r of rows) {
        const apg = r.vals.powerAPg;
        const bp = r.vals.BattPower;
        const dcEst = (apg !== null && apg !== undefined && Number.isFinite(apg) && bp !== null && bp !== undefined && Number.isFinite(bp))
          ? Number(apg) - Number(bp)
          : null;
        const ghi = r.vals.ghi_w_m2;
        const d = new Date(r.ts - 5 * 3600 * 1000);
        const h = d.getUTCHours();
        if (dcEst !== null && Number.isFinite(dcEst)) byHourDc[h].push(dcEst);
        if (ghi !== null && ghi !== undefined && Number.isFinite(ghi)) {
          byHourGhi[h].push(ghi);
          ghiByTs.set(r.ts, ghi);
        }
      }
      const p95 = (arr: number[]): number | null => {
        if (arr.length === 0) return null;
        if (arr.length === 1) return arr[0];
        const s = [...arr].sort((a, b) => a - b);
        return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
      };
      return { p95dc: byHourDc.map(p95), p95ghi: byHourGhi.map(p95), ghiByTs };
    },
    compute: (v, ctx) => {
      if (!ctx) return 0;
      const pc = ctx.precomputed as { p95dc: Array<number | null>; p95ghi: Array<number | null>; ghiByTs: Map<number, number> } | undefined;
      if (!pc) return 0;
      let baseDc = pc.p95dc[ctx.hourLocal];
      if (baseDc === null || baseDc === undefined) return 0;
      const ghiNow = pc.ghiByTs.get(ctx.ts);
      const ghiP95 = pc.p95ghi[ctx.hourLocal];
      if (ghiNow !== undefined && ghiP95 !== null && ghiP95 !== undefined && ghiP95 > 0) {
        baseDc = baseDc * (ghiNow / ghiP95);
      }
      const saturated = v.BattSOC >= 95 && Math.abs(v.ExportGrid_DY) < 100 && ctx.isDaylight;
      if (!saturated) return 0;
      const dcEst = v.powerAPg - v.BattPower;
      return Math.max(0, baseDc - dcEst);
    },
    appliesToInverter: true,
    brand: 'DEYE',
  },

  // Sacrificio AC por reactiva: cuando |Q| > 200 var, mide la activa perdida
  // contra el envelope de P. Solo Livoltek (DEYE no expone reactiva).
  sacrificio_ac_LIV: {
    deps: ['powerAEg', 'powerREg_LV'],
    precompute: (rows) => envelopeByHour(rows, 'powerAEg'),
    compute: (v, ctx) => {
      if (Math.abs(v.powerREg_LV) < 200) return 0;
      if (!ctx) return 0;
      const env = ctx.precomputed as Array<number | null> | undefined;
      const envH = env?.[ctx.hourLocal];
      if (envH === null || envH === undefined) return 0;
      return Math.max(0, envH - v.powerAEg);
    },
    appliesToInverter: true,
    brand: 'Livoltek',
  },
};
const isDerivedKey = (k: string): boolean => Object.prototype.hasOwnProperty.call(DERIVED_KEYS, k);
const DERIVED_KEY_LIST = Object.keys(DERIVED_KEYS);

const deviceLabel = (d: DeviceOption) => {
  const t = (d.type ?? '').toLowerCase();
  let tag = '';
  if (t === 'red')       tag = 'Medidor RED';
  else if (t === 'solar') tag = 'Medidor SOLAR';
  else if (t === 'inverter') tag = `Inversor ${d.marca ?? ''}`.trim();
  else if (t === 'pulsar' || t === 'gateway') tag = 'Pulsar';
  const parts = tag ? [tag, d.name] : [d.name];
  if (d.client) parts.push(`(${d.client})`);
  return parts.join(' Â· ');
};

const distinct = <T,>(arr: T[]): T[] => Array.from(new Set(arr));

const locationKey = (d: { location: string | null; city: string | null }) =>
  `${d.location ?? ''}|${d.city ?? ''}`;

const locationLabel = (d: { location: string | null; city: string | null }): string => {
  const parts = [d.location, d.city].filter(Boolean) as string[];
  return parts.length > 0 ? parts.join(' â€” ') : '';
};

const filterByType = (devices: DeviceOption[], typeFilter: TypeFilter): DeviceOption[] => {
  if (typeFilter === 'all') return devices;
  return devices.filter((d) => classifyDevice(d) === typeFilter);
};

type Agg = 'NONE' | 'AVG' | 'MIN' | 'MAX' | 'SUM' | 'COUNT';
interface IntervalPreset { label: string; ms: number | null; }
const PRESETS: IntervalPreset[] = [
  { label: '15 min', ms: 15 * 60 * 1000 },
  { label: '1 hora', ms: 60 * 60 * 1000 },
  { label: '1 dÃ­a', ms: 24 * 60 * 60 * 1000 },
];
const COLORS = ['#07c5a8', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#10b981', '#ec4899', '#0ea5e9'];

const ONLINE_COLOR = '#22c55e';
const OFFLINE_COLOR = '#cbd5e1';

interface Slice { label: string; value: number; color: string; }

function SliceDonut({ slices, total }: { slices: Slice[]; total: number }) {
  const data = total === 0 ? [{ name: 'empty', value: 1, color: 'var(--border)' }] : slices.filter((s) => s.value > 0).map((s) => ({ name: s.label, value: s.value, color: s.color }));
  return (
    <div style={{ position: 'relative', width: 86, height: 86, flexShrink: 0 }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie data={data} innerRadius={28} outerRadius={40} startAngle={90} endAngle={-270} dataKey="value" stroke="none" isAnimationActive={false}>
            {data.map((d, i) => <Cell key={i} fill={d.color} />)}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        <span style={{ fontSize: '0.55rem', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Total</span>
        <span style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>{total}</span>
      </div>
    </div>
  );
}

/** Visualizador del diccionario de variables (columna â†” key Metrum + descripciÃ³n) */
// ClasificaciÃ³n de variables para filtros del diccionario.
// equipo: en quÃ© equipo "vive" la variable; marca: especÃ­fica de una marca o agnÃ³stica.
type DictEquipo = 'medidor' | 'inversor' | 'bateria' | 'casa' | 'atributo';
type DictMarca = 'Livoltek' | 'DEYE' | 'ambas';

const _METER_KEYS = new Set(['CenergyAI', 'CenergyAE', 'CenergyRI', 'CenergyRE', 'energyAI', 'energyRI', 'currentA', 'currentB', 'currentC', 'powerAI', 'powerRI']);
const _BATTERY_KEYS = new Set(['Pbat', 'Pcharge', 'Pdischarge', 'Vbat', 'Ibat', 'Tbat', 'BattCycles', 'BattPower', 'BattCur', 'BattVolt', 'BattSOC', 'BattSOH', 'BattTemp', 'BattSn', 'TLBattSOC']);
const _BATTERY_PREFIX = ['Batt'];
const _CASA_KEYS = new Set(['generacion_wh', 'importacion_wh', 'excedentes_wh', 'demanda_wh', 'gen_dem_pct', 'exc_gen_pct', 'imp_dem_pct', 'yield_real', 'desempeno_pct', 'imax_a', 'potencia_kw']);
const _ATTR_KEYS = new Set(['spcus', 'gateway', 'mettype', 'active', 'zone', 'city', 'dept', 'latDev', 'lonDev', 'invbrand', 'invmodel', 'invcap', 'invarray', 'invtype']);

// Keys compartidas entre medidor e inversor (mismo nombre en Metrum, distinto device fÃ­sico)
const _SHARED_METER_INVERTER = new Set(['currentA', 'currentB', 'currentC', 'CenergyAE', 'CenergyAI', 'CenergyRI', 'CenergyRE', 'frequency']);

function classifyVariable(v: VariableMeta): { equipos: DictEquipo[]; marca: DictMarca } {
  const k = v.key;
  // Marca por sufijo
  let marca: DictMarca = 'ambas';
  if (k.endsWith('_LV')) marca = 'Livoltek';
  else if (k.endsWith('_DY')) marca = 'DEYE';

  // Equipo (puede ser mÃºltiple para keys compartidas)
  if (_BATTERY_KEYS.has(k) || _BATTERY_PREFIX.some((p) => k.startsWith(p))) return { equipos: ['bateria'], marca };
  if (_SHARED_METER_INVERTER.has(k)) return { equipos: ['medidor', 'inversor'], marca };
  if (_METER_KEYS.has(k)) return { equipos: ['medidor'], marca };
  if (_CASA_KEYS.has(k)) return { equipos: ['casa'], marca };
  if (_ATTR_KEYS.has(k)) return { equipos: ['atributo'], marca };
  // Resto = inversor (powerAEg, voltGridA, energyED, etc. + keys especulativas + Pdc_estimado)
  return { equipos: ['inversor'], marca };
}

const EQUIPO_META: Record<DictEquipo, { label: string; color: string }> = {
  medidor:   { label: 'Medidor',   color: '#3b82f6' },
  inversor:  { label: 'Inversor',  color: '#8b5cf6' },
  bateria:   { label: 'BaterÃ­a',   color: '#10b981' },
  casa:      { label: 'Casa (agregado)', color: '#f59e0b' },
  atributo:  { label: 'Atributo',  color: '#64748b' },
};
const MARCA_META: Record<DictMarca, { label: string; color: string }> = {
  Livoltek: { label: 'Livoltek', color: '#0ea5e9' },
  DEYE:     { label: 'DEYE',     color: '#ec4899' },
  ambas:    { label: 'GenÃ©rica', color: '#94a3b8' },
};

function VariablesDictionary({ keys: _keys, title = 'Diccionario de variables' }: { keys?: string[]; title?: string }) {
  const [open, setOpen] = useState(false);
  const [filterEquipo, setFilterEquipo] = useState<DictEquipo | 'all'>('all');
  const [filterMarca, setFilterMarca] = useState<DictMarca | 'all'>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 10;

  // Anotar todas las variables con su clasificaciÃ³n
  const annotated = useMemo(() => VARIABLES.map((v) => ({ ...v, ...classifyVariable(v) })), []);

  // Aplicar filtros
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return annotated.filter((v) => {
      if (filterEquipo !== 'all' && !v.equipos.includes(filterEquipo)) return false;
      if (filterMarca !== 'all' && v.marca !== filterMarca) return false;
      if (q) {
        const hit = v.key.toLowerCase().includes(q) || v.label.toLowerCase().includes(q) || v.description.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [annotated, filterEquipo, filterMarca, search]);

  // Reset page on filter change
  useEffect(() => { setPage(0); }, [filterEquipo, filterMarca, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  return (
    <div className="glass-panel" style={{ padding: 0 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-primary)' }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.9rem', fontWeight: 600 }}>
          <BookOpen size={16} style={{ color: 'var(--accent)' }} />
          {title} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({annotated.length} variables)</span>
        </span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {/* Filtros */}
          <div style={{ padding: '12px 18px', display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start', borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
            <div>
              <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4 }}>Tipo de equipo</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <button onClick={() => setFilterEquipo('all')} className={`chip ${filterEquipo === 'all' ? 'active' : ''}`} style={{ fontSize: '0.7rem', padding: '2px 8px' }}>Todos</button>
                {(Object.keys(EQUIPO_META) as DictEquipo[]).map((e) => (
                  <button key={e} onClick={() => setFilterEquipo(e)} className={`chip ${filterEquipo === e ? 'active' : ''}`}
                    style={{ fontSize: '0.7rem', padding: '2px 8px', borderLeft: `3px solid ${EQUIPO_META[e].color}` }}>
                    {EQUIPO_META[e].label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4 }}>Marca</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <button onClick={() => setFilterMarca('all')} className={`chip ${filterMarca === 'all' ? 'active' : ''}`} style={{ fontSize: '0.7rem', padding: '2px 8px' }}>Todas</button>
                {(Object.keys(MARCA_META) as DictMarca[]).map((m) => (
                  <button key={m} onClick={() => setFilterMarca(m)} className={`chip ${filterMarca === m ? 'active' : ''}`}
                    style={{ fontSize: '0.7rem', padding: '2px 8px', borderLeft: `3px solid ${MARCA_META[m].color}` }}>
                    {MARCA_META[m].label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ flex: '1 1 200px', minWidth: 180 }}>
              <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4 }}>Buscar</div>
              <input
                type="text"
                placeholder="key, label o descripciÃ³nâ€¦"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ fontSize: '0.78rem', padding: '4px 8px' }}
              />
            </div>
          </div>

          {/* Tabla con paginaciÃ³n */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '0.78rem' }}>
              <thead style={{ background: 'var(--bg-elevated)' }}>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ padding: '8px 14px' }}>Equipo</th>
                  <th style={{ padding: '8px 14px' }}>Marca</th>
                  <th style={{ padding: '8px 14px' }}>Columna / UI</th>
                  <th style={{ padding: '8px 14px' }}>Key Metrum</th>
                  <th style={{ padding: '8px 14px' }}>Unidad</th>
                  <th style={{ padding: '8px 14px' }}>CategorÃ­a</th>
                  <th style={{ padding: '8px 14px' }}>DescripciÃ³n</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr><td colSpan={7} style={{ padding: 18, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>Ninguna variable coincide con los filtros</td></tr>
                ) : visible.map((v) => (
                  <tr key={v.key} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 14px' }}>
                      <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                        {v.equipos.map((e) => (
                          <span key={e} style={{ fontSize: '0.66rem', padding: '1px 6px', borderRadius: 8, background: EQUIPO_META[e].color + '20', color: EQUIPO_META[e].color, fontWeight: 600 }}>
                            {EQUIPO_META[e].label}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td style={{ padding: '6px 14px' }}>
                      <span style={{ fontSize: '0.66rem', padding: '1px 6px', borderRadius: 8, background: MARCA_META[v.marca].color + '20', color: MARCA_META[v.marca].color, fontWeight: 600 }}>
                        {MARCA_META[v.marca].label}
                      </span>
                    </td>
                    <td style={{ padding: '6px 14px', fontWeight: 600 }}>{v.label}</td>
                    <td style={{ padding: '6px 14px', fontFamily: 'ui-monospace, monospace', fontSize: '0.72rem', color: 'var(--accent)' }}>{v.key}</td>
                    <td style={{ padding: '6px 14px', color: 'var(--text-secondary)' }}>{v.unit || 'â€”'}</td>
                    <td style={{ padding: '6px 14px', color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{v.category}</td>
                    <td style={{ padding: '6px 14px', color: 'var(--text-secondary)', fontSize: '0.74rem', maxWidth: 480, whiteSpace: 'pre-wrap' }}>{v.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Paginador */}
          {filtered.length > 0 && (
            <div style={{ padding: '10px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', background: 'var(--bg-elevated)', flexWrap: 'wrap', gap: 8 }}>
              <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                Mostrando {currentPage * PAGE_SIZE + 1}-{Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} de {filtered.length} variables
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => setPage(Math.max(0, currentPage - 1))}
                  disabled={currentPage === 0}
                  className="chip"
                  style={{ fontSize: '0.74rem', padding: '4px 10px', opacity: currentPage === 0 ? 0.4 : 1 }}>
                  â† Anterior
                </button>
                <span style={{ alignSelf: 'center', fontSize: '0.74rem', color: 'var(--text-secondary)', padding: '0 6px' }}>
                  PÃ¡gina {currentPage + 1} / {totalPages}
                </span>
                <button
                  onClick={() => setPage(Math.min(totalPages - 1, currentPage + 1))}
                  disabled={currentPage >= totalPages - 1}
                  className="chip"
                  style={{ fontSize: '0.74rem', padding: '4px 10px', opacity: currentPage >= totalPages - 1 ? 0.4 : 1 }}>
                  Siguiente â†’
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BreakdownCard({ title, slices }: { title: string; slices: Slice[] }) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  return (
    <div className="glass-panel" style={{ padding: '16px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total {total}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <SliceDonut slices={slices} total={total} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, minWidth: 0 }}>
          {slices.length === 0 ? (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Sin dispositivos</span>
          ) : slices.map((s) => (
            <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.color }} /> {s.label}
              </span>
              <strong>{s.value}</strong>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Detecta marca del inversor: usa la columna `marca` cuando existe, fallback a name/modelo
const inverterBrand = (d: { type?: string | null; name?: string | null; marca?: string | null; modelo?: string | null }): string => {
  if (d.marca && d.marca.trim()) {
    const m = d.marca.trim();
    // Normalizar a forma capitalizada estÃ¡ndar
    if (/deye/i.test(m)) return 'DEYE';
    if (/livoltek/i.test(m)) return 'Livoltek';
    if (/huawei/i.test(m)) return 'Huawei';
    if (/sungrow/i.test(m)) return 'Sungrow';
    if (/growatt/i.test(m)) return 'Growatt';
    return m.charAt(0).toUpperCase() + m.slice(1).toLowerCase();
  }
  const blob = `${d.type ?? ''} ${d.modelo ?? ''} ${d.name ?? ''}`.toLowerCase();
  if (/livoltek|^hp\d|hp315|hp\d+k/i.test(blob)) return 'Livoltek';
  if (/deye|sun-\d|sg0/i.test(blob)) return 'DEYE';
  if (/huawei/i.test(blob)) return 'Huawei';
  if (/sungrow/i.test(blob)) return 'Sungrow';
  if (/growatt/i.test(blob)) return 'Growatt';
  return 'Otra';
};

const BRAND_COLORS: Record<string, string> = {
  Livoltek: '#07c5a8',
  DEYE: '#3b82f6',
  Huawei: '#ef4444',
  Sungrow: '#f59e0b',
  Growatt: '#8b5cf6',
  Otra: '#94a3b8',
};

export default function DashboardPage() {
  const [tab, setTab] = useState<Tab>('cierres');
  const [devices, setDevices] = useState<DeviceOption[]>([]);

  const loadDevices = async () => {
    const { data, error } = await supabase
      .from('devices')
      .select('id, metrum_id, name, type, client, casa, cliente_id, location, city, marca, modelo, potencia_kw, is_active, last_seen_at')
      .order('client', { ascending: true })
      .order('name', { ascending: true });
    if (error) {
      console.error('Error fetching devices', error);
      return;
    }
    setDevices((data ?? []) as DeviceOption[]);
  };

  // Breakdown medidores: solar vs red
  const meterSlices = useMemo<Slice[]>(() => {
    let solar = 0, red = 0, otros = 0;
    for (const d of devices) {
      if (classifyDevice(d) !== 'meter') continue;
      const t = (d.type ?? '').toLowerCase();
      if (t === 'solar') solar++;
      else if (t === 'red') red++;
      else otros++;
    }
    const out: Slice[] = [];
    if (solar > 0) out.push({ label: 'Solar', value: solar, color: '#f59e0b' });
    if (red > 0)   out.push({ label: 'Red',   value: red,   color: '#3b82f6' });
    if (otros > 0) out.push({ label: 'Otros', value: otros, color: '#94a3b8' });
    return out;
  }, [devices]);

  // Inversores: solo total (sin desglose online/offline)
  const inverterSlices = useMemo<Slice[]>(() => {
    let total = 0;
    for (const d of devices) {
      if (classifyDevice(d) === 'inverter') total++;
    }
    return total > 0 ? [{ label: 'Inversores', value: total, color: '#07c5a8' }] : [];
  }, [devices]);

  // MÃ³dems: En LÃ­nea / Sin ConexiÃ³n via is_active
  const gatewaySlices = useMemo<Slice[]>(() => {
    let online = 0, offline = 0;
    for (const d of devices) {
      if (classifyDevice(d) !== 'gateway') continue;
      if (d.is_active === false) offline++;
      else online++;
    }
    const out: Slice[] = [];
    if (online > 0)  out.push({ label: 'En LÃ­nea',     value: online,  color: ONLINE_COLOR });
    if (offline > 0) out.push({ label: 'Sin ConexiÃ³n', value: offline, color: OFFLINE_COLOR });
    return out;
  }, [devices]);

  useEffect(() => {
    loadDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const TAB_META: Record<Tab, { label: string; color: string; Icon: typeof BarChart3; description: string }> = {
    cierres:  { label: 'Vista Granular',         color: '#07c5a8', Icon: Activity,       description: 'Series de tiempo de Metrum por dispositivo. Multi-select de casas, zoom interactivo y tabla diaria/puntos.' },
    nar:      { label: 'NAR',                    color: '#ef4444', Icon: Bell,            description: 'Notificaciones, Alertas y Recomendaciones de la flota. Incluye anÃ¡lisis de Reactiva CREG.' },
  };
  const meta = TAB_META[tab];

  const totalDevices = devices.length;
  const gatewayTotal = gatewaySlices.reduce((s, x) => s + x.value, 0);
  const gatewayOnline = gatewaySlices.find((s) => s.label === 'En LÃ­nea')?.value ?? 0;

  return (
    <>
      {/* HEADER */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <BarChart3 size={24} style={{ color: 'var(--accent)' }} />
          <h1 style={{ margin: 0 }}>Dashboard</h1>
        </div>
        <p style={{ color: 'var(--text-secondary)', marginTop: 4, fontSize: '0.88rem' }}>
          OperaciÃ³n diaria del portafolio de 28 instalaciones solares. {totalDevices} dispositivos sincronizados desde Metrum
          {gatewayTotal > 0 && <> Â· <strong style={{ color: '#10b981' }}>{gatewayOnline}/{gatewayTotal}</strong> mÃ³dems en lÃ­nea</>}.
        </p>
      </div>

      {/* Estado de flota â€” 3 cards en grid coherente */}
      <div className="fleet-grid" style={{ marginBottom: 20 }}>
        <BreakdownCard title="MÃ³dems" slices={gatewaySlices} />
        <BreakdownCard title="Medidores" slices={meterSlices} />
        <BreakdownCard title="Inversores" slices={inverterSlices} />
        <style jsx>{`
          .fleet-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
          @media (max-width: 900px) { .fleet-grid { grid-template-columns: 1fr; } }
        `}</style>
      </div>

      {/* TABS â€” primary navigation con color por intenciÃ³n */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {(Object.keys(TAB_META) as Tab[]).map((k) => {
          const m = TAB_META[k];
          return (
            <button key={k} onClick={() => setTab(k)} className={`chip ${tab === k ? 'active' : ''}`}
              style={{ fontSize: '0.85rem', padding: '10px 14px', borderLeft: `4px solid ${m.color}`, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <m.Icon size={14} /> {m.label}
            </button>
          );
        })}
      </div>

      {/* Strip de identidad del tab activo */}
      <div className="glass-panel" style={{ padding: 16, borderLeft: `4px solid ${meta.color}`, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <meta.Icon size={26} style={{ color: meta.color, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{meta.label}</h2>
            <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>{meta.description}</p>
          </div>
        </div>
      </div>

      {tab === 'cierres' && <CierresGranularTab devices={devices} />}
      {tab === 'nar' && <NarTab />}
    </>
  );
}


/* ---------------- TAB: Cierres + Granular (Unificado) ---------------- */

type SubTab = 'cierre' | 'granular';

function CierresGranularTab({ devices }: { devices: DeviceOption[] }) {
  const [subTab, setSubTab] = useState<SubTab>('cierre');
  // --- Filtros compartidos ---
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [selectedLocation, setSelectedLocation] = useState<string>('');
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [deviceSearch, setDeviceSearch] = useState<string>('');
  const [startDate, setStartDate] = useState<string>(dateStr(weekAgo()));
  const [endDate, setEndDate] = useState<string>(dateStr(today()));

  // --- Estado Cierre Diario ---
  const [closureRows, setClosureRows] = useState<ClosureRow[]>([]);
  const [casaMetricsPrecomputed, setCasaMetricsPrecomputed] = useState<CasaDayMetrics[] | null>(null);
  const [closureLoading, setClosureLoading] = useState(true);
  const [closureError, setClosureError] = useState<string | null>(null);
  // Corriente mÃ¡xima por casa|date: undefined=no cargada, 'loading', number=A, null=sin datos
  const [maxCurrents, setMaxCurrents] = useState<Record<string, number | null | 'loading'>>({});

  // --- Estado Granular ---
  // Keys por device â€” cada equipo expone sus propias keys (un meter rojo tiene
  // voltageA/currentA/powerAI; un inversor tiene CenergyAE/SOC/etc.)
  const [keysByDevice, setKeysByDevice] = useState<Record<string, string[]>>({});
  const [selectedKeysByDevice, setSelectedKeysByDevice] = useState<Record<string, Set<string>>>({});
  const [keysLoading, setKeysLoading] = useState(false);
  const [keysError, setKeysError] = useState<string | null>(null);
  const [intervalLabel, setIntervalLabel] = useState<string>('1 hora');
  const [agg, setAgg] = useState<Agg>('AVG');
  // Multi-device: el usuario puede graficar varios devices a la vez en la secciÃ³n granular
  const [granularDeviceIds, setGranularDeviceIds] = useState<Set<string>>(new Set());

  // â”€â”€ Vistas guardadas (compartidas entre usuarios) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  interface GranularViewConfig {
    devices: string[];
    keysByDevice: Record<string, string[]>;
    intervalLabel: string;
    agg: Agg;
    typeFilter: TypeFilter;
    selectedLocation: string;
    startDate?: string;
    endDate?: string;
    chartsState?: Array<{ id: string; title: string; seriesIncluded: 'all' | string[]; yMin?: number; yMax?: number; yLabel?: string }>;
  }
  interface SavedView {
    id: string;
    name: string;
    created_at: string;
    created_by?: string;
    config: GranularViewConfig;
  }
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [savedViewsLoading, setSavedViewsLoading] = useState(false);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);

  useEffect(() => {
    setSavedViewsLoading(true);
    fetch('/api/settings/granular-views')
      .then((r) => r.json())
      .then((j) => setSavedViews(Array.isArray(j.views) ? j.views : []))
      .catch(() => {})
      .finally(() => setSavedViewsLoading(false));
  }, []);

  const persistViews = async (next: SavedView[]) => {
    setSavedViews(next);
    try {
      await fetch('/api/settings/granular-views', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ views: next }),
      });
    } catch { /* fire-and-forget; el estado local ya estÃ¡ actualizado */ }
  };
  // Para diccionario y stats agregados de keys disponibles (union de todos los devices seleccionados)
  const allKeys = useMemo<string[]>(() => {
    const s = new Set<string>();
    for (const ks of Object.values(keysByDevice)) for (const k of ks) s.add(k);
    return Array.from(s).sort();
  }, [keysByDevice]);
  // Helper combinado: Â¿hay alguna key seleccionada en cualquier device?
  const totalSelectedKeysCount = useMemo(
    () => Object.values(selectedKeysByDevice).reduce((sum, s) => sum + s.size, 0),
    [selectedKeysByDevice],
  );
  // granData ahora se indexa por deviceId â†’ key â†’ puntos
  const [granData, setGranData] = useState<Record<string, Record<string, { ts: number; value: string | number }[]>>>({});
  // Irradiancia solar por ciudad â€” alimentada por /api/solar/irradiance (Open-Meteo).
  // Key: ciudad normalizada â†’ Map<dateHourKey, ghi_w_m2>
  // dateHourKey = `YYYY-MM-DD|HH` en hora local Colombia (UTC-5).
  const [cityGhi, setCityGhi] = useState<Map<string, Map<string, number>>>(new Map());
  // Daily curtailment kWh de NAR por casa â€” alimenta curtailment_kwh_LIV/DEY en granular.
  // Key: nombre de casa â†’ Map<YYYY-MM-DD, kWh_acumulado_hasta_ese_dÃ­a>
  const [casaCurtailmentCumByDay, setCasaCurtailmentCumByDay] = useState<Map<string, Map<string, number>>>(new Map());
  const [granLoading, setGranLoading] = useState(false);
  const [granError, setGranError] = useState<string | null>(null);
  const [showDataTable, setShowDataTable] = useState(false);
  const [dataTableMode, setDataTableMode] = useState<'puntos' | 'diario'>('diario');

  const filteredDevices = useMemo(() => {
    let list = filterByType(devices, typeFilter);
    if (selectedLocation) list = list.filter((d) => locationKey(d) === selectedLocation);
    return list;
  }, [devices, typeFilter, selectedLocation]);

  const locationOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of devices) {
      const k = locationKey(d);
      const label = locationLabel(d);
      if (!label || map.has(k)) continue;
      map.set(k, label);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [devices]);

  // Reset device if no longer in filtered list
  useEffect(() => {
    if (selectedDevice && !filteredDevices.some((d) => d.id === selectedDevice)) {
      setSelectedDevice('');
    }
  }, [filteredDevices, selectedDevice]);

  const selectedMetrumId = useMemo(() => {
    return filteredDevices.find((d) => d.id === selectedDevice)?.metrum_id ?? '';
  }, [filteredDevices, selectedDevice]);

  // --- Fetch Cierre ---
  // 1Â° intento: leer daily_casa_metrics (pre-computada por /api/cron/sync, incluye imax)
  // Fallback: calcular en vivo desde daily_energy_closures
  const fetchClosures = async () => {
    setClosureLoading(true);
    setClosureError(null);
    try {
      // Intentar tabla pre-computada
      let pre = supabase
        .from('daily_casa_metrics')
        .select('casa, record_date, generacion_wh, importacion_wh, excedentes_wh, demanda_wh, gen_dem_pct, exc_gen_pct, imp_dem_pct, yield_real, desempeno_pct, potencia_kw, imax_a')
        .order('record_date', { ascending: false });
      if (startDate) pre = pre.gte('record_date', startDate);
      if (endDate) pre = pre.lte('record_date', endDate);
      const preRes = await pre;
      if (!preRes.error && preRes.data && preRes.data.length > 0) {
        // Filtrar por casa si hay device/location seleccionado
        const allowedCasas = new Set(filteredDevices.map((d) => d.casa).filter(Boolean) as string[]);
        const filtered = (selectedLocation || typeFilter !== 'all' || selectedDevice)
          ? preRes.data.filter((r) => allowedCasas.has(r.casa))
          : preRes.data;
        const mapped: CasaDayMetrics[] = filtered.map((r) => ({
          casa: r.casa,
          date: r.record_date,
          generacion_wh: r.generacion_wh,
          importacion_wh: r.importacion_wh,
          excedentes_wh: r.excedentes_wh,
          demanda_wh: r.demanda_wh ?? 0,
          gen_dem_pct: r.gen_dem_pct,
          exc_gen_pct: r.exc_gen_pct,
          imp_dem_pct: r.imp_dem_pct,
          yield_real: r.yield_real,
          desempeno_pct: r.desempeno_pct,
          potencia_kw: r.potencia_kw,
          inverterMetrumId: null,
          redMeterMetrumId: null,
        }));
        setCasaMetricsPrecomputed(mapped);
        // Pre-llenar maxCurrents con valores pre-computados
        const mc: Record<string, number | null> = {};
        for (const r of filtered) {
          if (r.imax_a !== null && r.imax_a !== undefined) {
            mc[`${r.casa}|${r.record_date}`] = Number(r.imax_a);
          }
        }
        setMaxCurrents((prev) => ({ ...mc, ...prev }));
        setClosureRows([]);
        return;
      }

      // Fallback: calcular en vivo desde daily_energy_closures
      setCasaMetricsPrecomputed(null);
      const baselineStart = startDate
        ? dateStr(new Date(new Date(startDate + 'T00:00:00').getTime() - 86400000))
        : '';
      let query = supabase
        .from('daily_energy_closures')
        .select('id, device_id, record_date, energy_active_imported_wh, energy_active_exported_wh, energy_reactive_imported_varh, energy_reactive_exported_varh, devices(name, type, casa, client, location, city, potencia_kw, metrum_id)')
        .order('record_date', { ascending: true })
        .limit(5000);
      if (selectedDevice) {
        query = query.eq('device_id', selectedDevice);
      } else {
        const ids = filteredDevices.map((d) => d.id);
        if (ids.length > 0 && (typeFilter !== 'all' || selectedLocation)) {
          query = query.in('device_id', ids);
        }
      }
      if (baselineStart) query = query.gte('record_date', baselineStart);
      if (endDate) query = query.lte('record_date', endDate);
      const { data, error } = await query;
      if (error) throw error;
      setClosureRows((data ?? []) as unknown as ClosureRow[]);
    } catch (e) {
      setClosureError(e instanceof Error ? e.message : 'Error');
    } finally {
      setClosureLoading(false);
    }
  };

  // MÃ©tricas calculadas por casa+dÃ­a (usa pre-computada si estÃ¡ disponible, sino calcula en vivo)
  const casaMetrics = useMemo<CasaDayMetrics[]>(() => {
    if (casaMetricsPrecomputed) return casaMetricsPrecomputed;
    const all = computeCasaMetrics(closureRows);
    return all.filter((m) => (!startDate || m.date >= startDate) && (!endDate || m.date <= endDate));
  }, [casaMetricsPrecomputed, closureRows, startDate, endDate]);

  // Fetch corriente mÃ¡xima on-demand para una fila casa+dÃ­a (max de inversor y red meter)
  const fetchMaxCurrent = async (m: CasaDayMetrics) => {
    const key = `${m.casa}|${m.date}`;
    if (maxCurrents[key] === 'loading') return;
    setMaxCurrents((prev) => ({ ...prev, [key]: 'loading' }));
    try {
      const startTs = new Date(m.date + 'T00:00:00').getTime();
      const endTs = new Date(m.date + 'T23:59:59').getTime();
      const targets = [m.inverterMetrumId, m.redMeterMetrumId].filter(Boolean) as string[];
      if (targets.length === 0) {
        setMaxCurrents((prev) => ({ ...prev, [key]: null }));
        return;
      }
      const results = await Promise.all(targets.map(async (mid) => {
        const params = new URLSearchParams({
          metrumId: mid,
          keys: 'currentA,currentB,currentC',
          startTs: String(startTs),
          endTs: String(endTs),
          agg: 'MAX',
          interval: String(24 * 60 * 60 * 1000),
        });
        const res = await fetch(`/api/metrum/timeseries?${params.toString()}`);
        const json = await res.json();
        if (!res.ok || !json.ok) return null;
        const data = json.raw ?? {};
        let max = 0;
        for (const arr of Object.values(data)) {
          for (const pt of arr as Array<{ value: string | number }>) {
            const v = Number(pt.value);
            if (Number.isFinite(v) && v > max) max = v;
          }
        }
        return max > 0 ? max : null;
      }));
      const valid = results.filter((r): r is number => r !== null && Number.isFinite(r));
      const finalMax = valid.length > 0 ? Math.max(...valid) : null;
      setMaxCurrents((prev) => ({ ...prev, [key]: finalMax }));
    } catch {
      setMaxCurrents((prev) => ({ ...prev, [key]: null }));
    }
  };

  // --- Fetch Granular (multi-device) ---
  // Cuando el usuario cambia selectedDevice (en el dropdown), lo agregamos automÃ¡ticamente
  // a granularDeviceIds para que la primera selecciÃ³n no requiera doble click.
  useEffect(() => {
    if (selectedDevice && !granularDeviceIds.has(selectedDevice)) {
      setGranularDeviceIds((prev) => new Set(prev).add(selectedDevice));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDevice]);

  const fetchGranular = async () => {
    if (granularDeviceIds.size === 0 || totalSelectedKeysCount === 0) return;
    setGranLoading(true);
    setGranError(null);
    setGranData({});
    try {
      const startTs = new Date(startDate + 'T00:00:00').getTime();
      const endTs = new Date(endDate + 'T23:59:59').getTime();
      if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || startTs >= endTs) {
        throw new Error('Rango invÃ¡lido');
      }
      let preset = PRESETS.find((p) => p.label === intervalLabel) ?? PRESETS[1] /* 1 hora fallback */;

      // Metrum/ThingsBoard rechaza con 400 si (rango / interval) excede ~700 buckets.
      // Auto-ajustar: si el intervalo elegido excede el cap, promovemos al siguiente
      // (15min â†’ 1h â†’ 1d) y avisamos al usuario.
      const METRUM_BUCKET_CAP = 600; // margen de seguridad bajo los 700 reales
      let promoted = false;
      while (preset.ms !== null && (endTs - startTs) / preset.ms > METRUM_BUCKET_CAP) {
        const idx = PRESETS.findIndex((p) => p.label === preset.label);
        if (idx === -1 || idx >= PRESETS.length - 1) break;
        preset = PRESETS[idx + 1];
        promoted = true;
      }
      if (promoted) {
        setGranError(`Rango muy largo para ${intervalLabel} (Metrum solo acepta ~${METRUM_BUCKET_CAP} buckets por consulta). Se cambiÃ³ automÃ¡ticamente a ${preset.label}. Para ver ${intervalLabel} reduce el rango de fechas.`);
        setIntervalLabel(preset.label);
      }

      const next: Record<string, Record<string, { ts: number; value: string | number }[]>> = {};
      const fetchErrors: string[] = [];
      // Fetch en paralelo: cada device pide SU propia lista de keys (selectedKeysByDevice)
      await Promise.all(Array.from(granularDeviceIds).map(async (devId) => {
        const dev = devices.find((d) => d.id === devId);
        if (!dev) return;
        const devKeys = selectedKeysByDevice[devId];
        if (!devKeys || devKeys.size === 0) return; // este device no tiene keys seleccionadas, skip
        // Expandir keys derivadas a sus dependencias antes de pedir a Metrum
        // (las keys virtuales como Ppv_estimado se calculan despuÃ©s en chartData).
        const toFetch = new Set<string>();
        for (const k of devKeys) {
          if (isDerivedKey(k)) DERIVED_KEYS[k].deps.forEach((d) => toFetch.add(d));
          else toFetch.add(k);
        }
        if (toFetch.size === 0) return;
        const params = new URLSearchParams({
          metrumId: dev.metrum_id,
          keys: Array.from(toFetch).join(','),
          startTs: String(startTs),
          endTs: String(endTs),
          agg: preset.ms === null ? 'NONE' : agg,
        });
        if (preset.ms !== null) params.set('interval', String(preset.ms));
        const res = await fetch(`/api/metrum/timeseries?${params.toString()}`);
        const json = await res.json();
        if (!res.ok || !json.ok) {
          const errMsg = json.error ?? `HTTP ${res.status}`;
          console.error('granular fetch fail for', dev.name, errMsg);
          fetchErrors.push(`${dev.name}: ${errMsg}`);
          return;
        }
        next[devId] = json.raw ?? {};
      }));
      setGranData(next);
      if (fetchErrors.length > 0 && !promoted) {
        setGranError(`Metrum rechazÃ³ ${fetchErrors.length} consultas. Posibles causas: rango muy largo para el intervalo, key sin datos, o problemas de la API. Detalle: ${fetchErrors[0]}`);
      }

      // Fetch irradiancia solar por ciudad â€” usado por envelope_dc_LIV ajustado.
      // Solo dispara si al menos un device seleccionado tiene city y alguna key
      // derivada que la necesite (envelope_dc_LIV, envelope_dc_estimado_LV o curtailment_dc_LIV).
      const citiesNeeded = new Set<string>();
      for (const devId of granularDeviceIds) {
        const devKeys = selectedKeysByDevice[devId];
        if (!devKeys) continue;
        const needsIrradiance = Array.from(devKeys).some((k) => k === 'envelope_dc_LIV' || k === 'envelope_dc_estimado_LV' || k === 'curtailment_dc_LIV');
        if (!needsIrradiance) continue;
        const dev = devices.find((d) => d.id === devId);
        if (dev?.city) citiesNeeded.add(dev.city);
      }
      if (citiesNeeded.size > 0) {
        const ghiMap = new Map<string, Map<string, number>>();
        await Promise.all(Array.from(citiesNeeded).map(async (city) => {
          try {
            // Pedimos tambiÃ©n 30 dÃ­as extra atrÃ¡s para tener buena muestra del P95(GHI)
            const fromExtended = new Date(new Date(startDate).getTime() - 30 * 86400000).toISOString().slice(0, 10);
            const r = await fetch(`/api/solar/irradiance?city=${encodeURIComponent(city)}&from=${fromExtended}&to=${endDate}`);
            if (!r.ok) return;
            const j = await r.json();
            type GhiRow = { date: string; hour: number; ghi_w_m2: number };
            const dayHourGhi = new Map<string, number>();
            for (const row of ((j.data ?? []) as GhiRow[])) {
              dayHourGhi.set(`${row.date}|${row.hour}`, row.ghi_w_m2);
            }
            ghiMap.set(city, dayHourGhi);
          } catch {
            // Si el API falla, dejamos el envelope en modo P95 legacy.
          }
        }));
        setCityGhi(ghiMap);
      } else {
        setCityGhi(new Map());
      }

      // Fetch daily curtailment de NAR si hay alguna curtailment_kwh_* seleccionada.
      // Granular usa estos valores PRE-CALCULADOS (del backend NAR) en vez de
      // re-calcular, para garantizar consistencia exacta con el ranking NAR.
      const needsNarCurtailment = Object.values(selectedKeysByDevice).some((s) =>
        Array.from(s).some((k) => k.startsWith('curtailment_kwh_')),
      );
      if (needsNarCurtailment) {
        try {
          const r = await fetch(`/api/nar/curtailment?from=${startDate}&to=${endDate}&detailed=1`);
          if (r.ok) {
            const j = await r.json();
            type DailyRow = { casa: string; record_date: string; curtailment_kwh: number };
            const daily = (j.daily ?? []) as DailyRow[];
            // Build acumulado por casa: para cada dÃ­a, suma kWh de ese dÃ­a + todos los anteriores
            const byCasa = new Map<string, Array<{ date: string; kwh: number }>>();
            for (const d of daily) {
              if (!byCasa.has(d.casa)) byCasa.set(d.casa, []);
              byCasa.get(d.casa)!.push({ date: d.record_date, kwh: d.curtailment_kwh });
            }
            const cumMap = new Map<string, Map<string, number>>();
            for (const [casa, rows] of byCasa.entries()) {
              rows.sort((a, b) => a.date.localeCompare(b.date));
              let cum = 0;
              const inner = new Map<string, number>();
              for (const r of rows) {
                cum += r.kwh;
                inner.set(r.date, cum);
              }
              cumMap.set(casa, inner);
            }
            setCasaCurtailmentCumByDay(cumMap);
          }
        } catch {
          // Si falla, granular cae al cÃ³mputo local (puede diferir un poco de NAR).
        }
      } else {
        setCasaCurtailmentCumByDay(new Map());
      }
    } catch (e) {
      setGranError(e instanceof Error ? e.message : 'Error');
    } finally {
      setGranLoading(false);
    }
  };

  const toggleGranularDevice = (devId: string) => {
    setGranularDeviceIds((prev) => {
      const next = new Set(prev);
      if (next.has(devId)) next.delete(devId); else next.add(devId);
      return next;
    });
  };

  // Auto-fetch closures on shared filter change
  useEffect(() => {
    fetchClosures();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDevice, typeFilter, selectedLocation, startDate, endDate]);

  // Load granular keys cuando cambia la selecciÃ³n de devices.
  // Trae las keys solo para los devices que aÃºn no tenemos cacheados, y elimina
  // del cache los que ya no estÃ¡n seleccionados. Cada device pide sus keys
  // especÃ­ficas (un meter rojo y un inversor exponen variables muy distintas).
  useEffect(() => {
    const currentIds = Array.from(granularDeviceIds);
    // Limpiar cache de devices que ya no estÃ¡n seleccionados
    setKeysByDevice((prev) => {
      const next: Record<string, string[]> = {};
      for (const id of currentIds) if (prev[id]) next[id] = prev[id];
      return next;
    });
    setSelectedKeysByDevice((prev) => {
      const next: Record<string, Set<string>> = {};
      for (const id of currentIds) if (prev[id]) next[id] = prev[id];
      return next;
    });

    // Cargar keys para devices nuevos en la selecciÃ³n
    const missing = currentIds.filter((id) => !keysByDevice[id]);
    if (missing.length === 0) return;
    setKeysLoading(true);
    setKeysError(null);
    Promise.all(missing.map(async (devId) => {
      const dev = devices.find((d) => d.id === devId);
      if (!dev) return { devId, keys: [] as string[] };
      try {
        const r = await fetch(`/api/metrum/keys?metrumId=${encodeURIComponent(dev.metrum_id)}`);
        const json = await r.json();
        if (!json.ok) return { devId, keys: [] as string[], err: json.error };
        return { devId, keys: (json.keys ?? []) as string[] };
      } catch (e) {
        return { devId, keys: [] as string[], err: e instanceof Error ? e.message : 'Error' };
      }
    })).then((results) => {
      setKeysByDevice((prev) => {
        const next = { ...prev };
        for (const r of results) next[r.devId] = r.keys;
        return next;
      });
      // Seed: para cada device nuevo, pre-seleccionar las 2 primeras keys
      setSelectedKeysByDevice((prev) => {
        const next = { ...prev };
        for (const r of results) {
          if (!next[r.devId]) next[r.devId] = new Set(r.keys.slice(0, 2));
        }
        return next;
      });
      const failed = results.filter((r) => 'err' in r);
      if (failed.length > 0) setKeysError(`Algunas keys no cargaron: ${failed.map((f) => (f as { err: string }).err).join(', ')}`);
    }).finally(() => setKeysLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granularDeviceIds, devices]);

  const toggleDeviceKey = (devId: string, k: string) => {
    setSelectedKeysByDevice((prev) => {
      const cur = prev[devId] ?? new Set();
      const next = new Set(cur);
      if (next.has(k)) next.delete(k); else next.add(k);
      return { ...prev, [devId]: next };
    });
  };

  // Granular chart data (puntos crudos como vienen del fetch, ahora multi-device)
  // Series compuesta = `${deviceShortName} Â· ${key}` para distinguir varias casas en una sola grÃ¡fica
  const granularDevicesMeta = useMemo(() => {
    return Array.from(granularDeviceIds)
      .map((id) => devices.find((d) => d.id === id))
      .filter((d): d is NonNullable<typeof d> => Boolean(d));
  }, [granularDeviceIds, devices]);

  // Construye una etiqueta corta que identifica el equipo dentro de la casa:
  //   - Medidor red â†’ "Medidor RED"
  //   - Medidor solar â†’ "Medidor SOLAR"
  //   - Inversor â†’ "Inv <marca> <Ãºltimos 6 del serial>" (ej. "Inv LIVOLTEK 290023")
  //   - Pulsar (gateway) â†’ "Pulsar"
  //   - Otro â†’ device.name como fallback
  const formatDeviceTag = (dev: DeviceOption): string => {
    const t = (dev.type ?? '').toLowerCase();
    if (t === 'red') return 'Medidor RED';
    if (t === 'solar') return 'Medidor SOLAR';
    if (t === 'inverter') {
      const marca = dev.marca ?? 'Inversor';
      const tail = (dev.name ?? '').slice(-6);
      return `Inv ${marca}${tail ? ' ' + tail : ''}`;
    }
    if (t === 'pulsar' || t === 'gateway') return 'Pulsar';
    return dev.name ?? 'Equipo';
  };

  const seriesKeys = useMemo(() => {
    const out: Array<{ key: string; label: string; deviceId: string; baseKey: string }> = [];
    for (const dev of granularDevicesMeta) {
      const casa = dev.casa ?? dev.name ?? 'â€”';
      const tag = formatDeviceTag(dev);
      const devLabel = `${casa} Â· ${tag}`;
      const devKeys = selectedKeysByDevice[dev.id];
      if (!devKeys) continue;
      for (const k of devKeys) {
        out.push({ key: `${dev.id}__${k}`, label: `${devLabel} Â· ${k}`, deviceId: dev.id, baseKey: k });
      }
    }
    return out;
  }, [granularDevicesMeta, selectedKeysByDevice]);

  // â”€â”€ Multi-grÃ¡fica: el usuario puede partir las series seleccionadas
  // en N grÃ¡ficas, cada una con su propio Y axis (min/max/label).
  // GrÃ¡fica 1 por default muestra TODAS las series (comportamiento previo);
  // las grÃ¡ficas extras arrancan vacÃ­as y el usuario asigna series con checkboxes.
  interface ChartConfig {
    id: string;
    title: string;
    seriesIncluded: 'all' | Set<string>; // 'all' = todas las series globales (default chart 1)
    yMin?: number;
    yMax?: number;
    yLabel?: string;
  }
  const [charts, setCharts] = useState<ChartConfig[]>([
    { id: 'chart-1', title: 'GrÃ¡fica 1', seriesIncluded: 'all' },
  ]);

  // Refs por chart id para exportar a PNG cada grÃ¡fica individual
  const chartRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const downloadChartPng = async (chartId: string, title: string) => {
    const node = chartRefs.current[chartId];
    if (!node) return;
    try {
      const dataUrl = await toPng(node, { backgroundColor: '#ffffff', pixelRatio: 2 });
      const a = document.createElement('a');
      a.href = dataUrl;
      const safeName = title.replace(/[^\w\d\-_. ]+/g, '').trim().replace(/\s+/g, '_') || 'grafica';
      a.download = `${safeName}_${dateStr(today())}.png`;
      a.click();
    } catch (err) {
      console.error('PNG export error', err);
      alert('No se pudo exportar a PNG: ' + (err instanceof Error ? err.message : 'Error'));
    }
  };

  const downloadDailyTableCsv = () => {
    if (!dailyData || dailyData.length === 0) return;
    const headers = ['DÃ­a', ...seriesKeys.map((s) => s.label)];
    const rows = dailyData.map((d) => {
      const cells: (string | number)[] = [d.dia];
      for (const s of seriesKeys) {
        const cnt = d.count[s.key] ?? 0;
        const avg = cnt > 0 ? d.sum[s.key] / cnt : null;
        cells.push(avg === null ? '' : avg.toFixed(2));
      }
      return cells;
    });
    const escape = (v: unknown): string => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))];
    const blob = new Blob(['ï»¿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `granular_tabla_${startDate}_${endDate}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const addChart = () => {
    setCharts((cur) => [
      ...cur,
      { id: `chart-${Date.now()}`, title: `GrÃ¡fica ${cur.length + 1}`, seriesIncluded: new Set<string>() },
    ]);
  };
  const removeChart = (id: string) => {
    setCharts((cur) => (cur.length <= 1 ? cur : cur.filter((c) => c.id !== id)));
  };
  const updateChart = (id: string, patch: Partial<ChartConfig>) => {
    setCharts((cur) => cur.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };
  const toggleSeriesInChart = (chartId: string, seriesKey: string) => {
    setCharts((cur) => cur.map((c) => {
      if (c.id !== chartId) return c;
      const set = c.seriesIncluded === 'all'
        ? new Set(seriesKeys.map((s) => s.key))
        : new Set(c.seriesIncluded);
      if (set.has(seriesKey)) set.delete(seriesKey); else set.add(seriesKey);
      return { ...c, seriesIncluded: set };
    }));
  };
  const chartSeriesFor = (c: ChartConfig) => {
    if (c.seriesIncluded === 'all') return seriesKeys;
    return seriesKeys.filter((s) => (c.seriesIncluded as Set<string>).has(s.key));
  };

  const chartData = useMemo(() => {
    const byTs = new Map<number, Record<string, number | null>>();
    // 1) Volcar todas las keys crudas que vinieron de Metrum
    for (const [devId, byKey] of Object.entries(granData)) {
      for (const [key, points] of Object.entries(byKey)) {
        const seriesKey = `${devId}__${key}`;
        for (const p of points) {
          const num = Number(p.value);
          const row = byTs.get(p.ts) ?? {};
          row[seriesKey] = Number.isFinite(num) ? num : null;
          byTs.set(p.ts, row);
        }
      }
    }
    // 2) Calcular keys derivadas (virtuales) por device, donde el usuario las pidiÃ³
    //    y todas las deps existen en granData. Se inyectan al mismo row del timestamp.
    //    Si la derivada define `precompute`, se ejecuta primero con toda la serie
    //    del device (Ãºtil para envolventes P95 por hora-del-dÃ­a, baselines, etc.).
    for (const [devId, selectedSet] of Object.entries(selectedKeysByDevice)) {
      // Mapa GHI por (date|hour) para este device â€” solo si su city estÃ¡ en cityGhi.
      const dev = devices.find((d) => d.id === devId);
      const ghiForDevice = dev?.city ? cityGhi.get(dev.city) : null;
      for (const k of selectedSet) {
        if (!isDerivedKey(k)) continue;
        const seriesKey = `${devId}__${k}`;

        // Caso especial: curtailment_kwh_* usa los valores PRE-CALCULADOS del
        // backend NAR (daily_curtailment_by_house). Esto garantiza que granular
        // y el ranking NAR coincidan exactamente â€” los dos lados leen la misma
        // fuente. La curva se construye desde los daily totals: para cada ts
        // se busca el acumulado del dÃ­a correspondiente.
        if ((k === 'curtailment_kwh_LIV' || k === 'curtailment_kwh_DEY') && dev?.casa) {
          const dailyCum = casaCurtailmentCumByDay.get(dev.casa);
          // Construir lookup de "Ãºltimo dÃ­a con cum â‰¤ ts" para rellenar timestamps
          // entre los dÃ­as persistidos en NAR (NAR guarda 1 valor por dÃ­a, granular
          // muestra puntos cada 15 min).
          const sortedDays = dailyCum ? Array.from(dailyCum.keys()).sort() : [];
          for (const [ts, row] of byTs) {
            if (!dailyCum || sortedDays.length === 0) {
              row[seriesKey] = 0;
              continue;
            }
            const d = new Date(ts - 5 * 3600 * 1000);
            const dateLocal = d.toISOString().slice(0, 10);
            // Buscar el dÃ­a mÃ¡s reciente <= dateLocal
            let cum = 0;
            for (const day of sortedDays) {
              if (day > dateLocal) break;
              cum = dailyCum.get(day) ?? cum;
            }
            row[seriesKey] = cum;
          }
          continue; // saltar el compute normal
        }

        const meta = DERIVED_KEYS[k];
        const perRowDeps = meta.perRowDeps ?? meta.deps;

        let precomputed: unknown = undefined;
        if (meta.precompute) {
          const seriesRows: Array<{ ts: number; vals: Record<string, number | null> }> = [];
          for (const [ts, row] of byTs) {
            const vals: Record<string, number | null> = {};
            for (const dep of meta.deps) vals[dep] = (row[`${devId}__${dep}`] ?? null) as number | null;
            // Inyectar ghi_w_m2 si el device tiene city con GHI cacheado.
            // Lookup por (date_local, hour_local) â€” Open-Meteo nos da datos por hora COT.
            if (ghiForDevice) {
              const d = new Date(ts - 5 * 3600 * 1000);
              const dateLocal = d.toISOString().slice(0, 10);
              const hourLocal = d.getUTCHours();
              const ghi = ghiForDevice.get(`${dateLocal}|${hourLocal}`);
              if (ghi !== undefined) vals.ghi_w_m2 = ghi;
            }
            seriesRows.push({ ts, vals });
          }
          precomputed = meta.precompute(seriesRows);
        }

        for (const [ts, row] of byTs) {
          const vals: Record<string, number> = {};
          let allPresent = true;
          for (const dep of perRowDeps) {
            const v = row[`${devId}__${dep}`];
            if (v === null || v === undefined || !Number.isFinite(v)) { allPresent = false; break; }
            vals[dep] = v;
          }
          if (!allPresent) { row[seriesKey] = null; continue; }
          const d = new Date(ts - 5 * 3600 * 1000); // COT = UTC-5
          const hourLocal = d.getUTCHours();
          const ctx: ComputeContext = {
            ts,
            hourLocal,
            isDaylight: hourLocal >= 6 && hourLocal < 18,
            precomputed,
          };
          row[seriesKey] = meta.compute(vals, ctx);
        }
      }
    }
    return Array.from(byTs.entries()).map(([ts, vals]) => ({ ts, ...vals })).sort((a, b) => a.ts - b.ts);
  }, [granData, selectedKeysByDevice, cityGhi, devices, casaCurtailmentCumByDay]);

  // AgregaciÃ³n diaria (min/avg/max) por device+key
  const dailyData = useMemo(() => {
    const dayKey = (ts: number): string => {
      const d = new Date(ts - 5 * 3600 * 1000);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    };
    interface Agg { count: Record<string, number>; sum: Record<string, number>; min: Record<string, number>; max: Record<string, number>; }
    const byDay = new Map<string, Agg>();
    for (const [devId, byKey] of Object.entries(granData)) {
      for (const [key, points] of Object.entries(byKey)) {
        const seriesKey = `${devId}__${key}`;
        for (const p of points) {
          const num = Number(p.value);
          if (!Number.isFinite(num)) continue;
          const d = dayKey(p.ts);
          let g = byDay.get(d);
          if (!g) { g = { count: {}, sum: {}, min: {}, max: {} }; byDay.set(d, g); }
          g.count[seriesKey] = (g.count[seriesKey] ?? 0) + 1;
          g.sum[seriesKey] = (g.sum[seriesKey] ?? 0) + num;
          g.min[seriesKey] = g.min[seriesKey] === undefined ? num : Math.min(g.min[seriesKey], num);
          g.max[seriesKey] = g.max[seriesKey] === undefined ? num : Math.max(g.max[seriesKey], num);
        }
      }
    }
    return Array.from(byDay.entries())
      .map(([dia, g]) => ({ dia, ...g }))
      .sort((a, b) => a.dia.localeCompare(b.dia));
  }, [granData]);

  return (
    <>
      {/* ===== FILTROS UNIFICADOS ===== */}
      <div className="glass-panel">
        <div className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Filter size={18} style={{ color: 'var(--text-secondary)' }} />
            <h2 className="card-title">Filtros</h2>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: '20px', alignItems: 'end', marginBottom: '16px' }}>
          <div>
            <label className="input-label" style={{ display: 'block', marginBottom: '8px' }}>Tipo de equipo</label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {([
                { id: 'all' as const, label: `Todos (${devices.length})` },
                { id: 'meter' as const, label: `Medidores (${devices.filter((d) => classifyDevice(d) === 'meter').length})` },
                { id: 'inverter' as const, label: `Inversores (${devices.filter((d) => classifyDevice(d) === 'inverter').length})` },
              ]).map((t) => (
                <button key={t.id} className={`chip ${typeFilter === t.id ? 'active' : ''}`} onClick={() => setTypeFilter(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label">UbicaciÃ³n / Ciudad</label>
            <select value={selectedLocation} onChange={(e) => setSelectedLocation(e.target.value)}>
              <option value="">Todas ({locationOptions.length})</option>
              {locationOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', alignItems: 'end', marginBottom: 14 }}>
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label">Desde</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label">Hasta</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>

        {/* Selector multi-device con buscador. Click para aÃ±adir/quitar. */}
        <div className="input-group" style={{ marginBottom: 0 }}>
          <label className="input-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span>Dispositivos ({granularDeviceIds.size} seleccionados)</span>
            {granularDeviceIds.size > 0 && (
              <button onClick={() => { setGranularDeviceIds(new Set()); setSelectedDevice(''); }}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '0.72rem', cursor: 'pointer', textDecoration: 'underline' }}>
                Limpiar selecciÃ³n
              </button>
            )}
          </label>
          {(() => {
            const q = deviceSearch.trim().toLowerCase();
            const searched = q
              ? filteredDevices.filter((d) => {
                  const fields = [d.name, d.casa, d.client, d.location, d.city, d.marca, d.modelo, d.type].filter(Boolean).join(' ').toLowerCase();
                  return fields.includes(q);
                })
              : filteredDevices;
            return (
              <>
                <div style={{ position: 'relative', marginBottom: 6 }}>
                  <Filter size={12} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input type="text" value={deviceSearch} onChange={(e) => setDeviceSearch(e.target.value)}
                    placeholder="Buscar por nombre, casa, ciudad, marca, modeloâ€¦"
                    style={{ width: '100%', paddingLeft: 30, fontSize: '0.8rem' }} />
                  {deviceSearch && (
                    <button onClick={() => setDeviceSearch('')} title="Limpiar"
                      style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1rem', padding: '2px 6px', lineHeight: 1 }}>
                      Ã—
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 200, overflowY: 'auto', padding: 6, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-surface)' }}>
                  {filteredDevices.length === 0 ? (
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', padding: 4 }}>Ajusta los filtros de tipo o ubicaciÃ³n para ver dispositivos</span>
                  ) : searched.length === 0 ? (
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', padding: 4 }}>Sin resultados para &quot;{deviceSearch}&quot; entre {filteredDevices.length} dispositivos</span>
                  ) : searched.map((d) => {
                    const active = granularDeviceIds.has(d.id);
                    return (
                      <button
                        key={d.id}
                        onClick={() => {
                          toggleGranularDevice(d.id);
                          setSelectedDevice(active ? '' : d.id);
                        }}
                        className={`chip ${active ? 'active' : ''}`}
                        style={{ fontSize: '0.74rem' }}
                        title={d.name}
                      >
                        {deviceLabel(d)}
                      </button>
                    );
                  })}
                </div>
                {deviceSearch && searched.length > 0 && (
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
                    {searched.length} de {filteredDevices.length} dispositivos coinciden con &quot;{deviceSearch}&quot;
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </div>

      {/* Cierre Diario eliminado por peticiÃ³n del usuario â€” se conserva la lÃ³gica
          pero no se renderiza (el bloque queda gated en `false`). Se puede
          rehabilitar cambiando false â†’ true si se necesita volver a verla. */}
      {false && (
      <>
      <VariablesDictionary
        title="Diccionario â€” columnas del Cierre Diario"
        keys={['generacion_wh', 'importacion_wh', 'excedentes_wh', 'demanda_wh', 'gen_dem_pct', 'exc_gen_pct', 'imp_dem_pct', 'yield_real', 'desempeno_pct', 'potencia_kw', 'imax_a']}
      />
      <div className="glass-panel" style={{ padding: 0 }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div>
            <h2 className="card-title">Cierre Diario por Casa</h2>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Yield teÃ³rico ref.: {YIELD_TEORICO_REF} kWh/kWp/dÃ­a (Cali) Â· {casaMetrics.length} filas
            </span>
          </div>
          <button
            className="secondary-btn"
            onClick={() => {
              const headers = ['Fecha', 'Casa', 'GeneraciÃ³n (Wh)', 'ImportaciÃ³n (Wh)', 'Excedentes (Wh)', 'Demanda DÃ­a (Wh)', 'Gen/Dem (%)', 'Exc/Gen (%)', 'Imp/Dem (%)', 'Yield Real (kWh/kWp)', 'DesempeÃ±o (%)', 'ImÃ¡x (A)'];
              const rows = casaMetrics.map((m) => {
                const ic = maxCurrents[`${m.casa}|${m.date}`];
                return [m.date, m.casa, m.generacion_wh, m.importacion_wh, m.excedentes_wh, m.demanda_wh, m.gen_dem_pct?.toFixed(2), m.exc_gen_pct?.toFixed(2), m.imp_dem_pct?.toFixed(2), m.yield_real?.toFixed(3), m.desempeno_pct?.toFixed(2), typeof ic === 'number' ? ic.toFixed(2) : null];
              });
              downloadCSV(`cierre-diario-${startDate}_${endDate}.csv`, headers, rows);
            }}
            disabled={casaMetrics.length === 0}
            style={{ fontSize: '0.8rem' }}
          >
            <Download size={14} /> CSV
          </button>
        </div>
        {closureError && <div className="alert-error" style={{ margin: '12px 20px' }}>{closureError}</div>}
        <div className="table-container" style={{ border: 'none', overflowX: 'auto' }}>
          <table style={{ fontSize: '0.78rem', minWidth: 1100 }}>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Casa</th>
                <th title="GeneraciÃ³n = Î”CenergyAE del inversor">GeneraciÃ³n</th>
                <th title="ImportaciÃ³n de red = Î”CenergyAI del medidor rojo">ImportaciÃ³n</th>
                <th title="Excedentes a red = Î”CenergyAE del medidor rojo">Excedentes</th>
                <th title="Demanda DÃ­a = GeneraciÃ³n + ImportaciÃ³n âˆ’ Excedentes">Demanda DÃ­a</th>
                <th title="GeneraciÃ³n / Demanda">Gen/Dem</th>
                <th title="Excedentes / GeneraciÃ³n">Exc/Gen</th>
                <th title="ImportaciÃ³n / Demanda">Imp/Dem</th>
                <th title="Yield Real = GeneraciÃ³n / Potencia instalada (kWh/kWp)">Yield Real</th>
                <th title={`DesempeÃ±o (PR) = Yield Real / ${YIELD_TEORICO_REF} Ã— 100`}>DesempeÃ±o</th>
                <th title="Corriente MÃ¡xima del dÃ­a (MAX inversor + red meter)">ImÃ¡x</th>
              </tr>
            </thead>
            <tbody>
              {closureLoading ? (
                <tr><td colSpan={12} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>Cargando...</td></tr>
              ) : casaMetrics.length === 0 ? (
                <tr><td colSpan={12} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>Sin registros para los filtros seleccionados.</td></tr>
              ) : (
                casaMetrics.map((m) => {
                  const key = `${m.casa}|${m.date}`;
                  const ic = maxCurrents[key];
                  return (
                    <tr key={key}>
                      <td>{m.date}</td>
                      <td style={{ fontWeight: 600 }}>{m.casa}</td>
                      <td style={{ textAlign: 'right' }}>{fmtEnergy(m.generacion_wh)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtEnergy(m.importacion_wh)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtEnergy(m.excedentes_wh)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtEnergy(m.demanda_wh)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtPct(m.gen_dem_pct)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtPct(m.exc_gen_pct)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtPct(m.imp_dem_pct)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtNum(m.yield_real)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtPct(m.desempeno_pct)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {ic === 'loading' ? (
                          <span style={{ color: 'var(--text-muted)' }}>...</span>
                        ) : ic === null ? (
                          <span style={{ color: 'var(--text-muted)' }}>â€”</span>
                        ) : typeof ic === 'number' ? (
                          `${ic.toFixed(1)} A`
                        ) : (
                          <button
                            onClick={() => fetchMaxCurrent(m)}
                            style={{ fontSize: '0.7rem', padding: '2px 8px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-elevated)', cursor: 'pointer', color: 'var(--text-secondary)' }}
                          >
                            Cargar
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}

      {/* ===== SECCIÃ“N: GRANULAR (Ãºnica vista ahora) ===== */}
      {true && (
      <>
      {allKeys.length > 0 && <VariablesDictionary title="Diccionario â€” keys de Metrum disponibles" keys={allKeys} />}
      <div className="glass-panel">
        <div className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Activity size={18} style={{ color: 'var(--text-secondary)' }} />
            <h2 className="card-title">Vista Granular {!selectedMetrumId && <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 400 }}>â€” selecciona un dispositivo arriba</span>}</h2>
          </div>
          <button
            className="primary-btn"
            onClick={fetchGranular}
            disabled={granLoading || granularDeviceIds.size === 0 || totalSelectedKeysCount === 0}
          >
            <Play size={14} /> {granLoading ? 'Cargando...' : 'Consultar'}
          </button>
        </div>

        {/* Panel de Vistas guardadas â€” global para todo el equipo */}
        <div style={{ padding: '8px 10px', background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border)', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Vistas guardadas</span>
            {savedViewsLoading ? (
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>cargandoâ€¦</span>
            ) : savedViews.length === 0 ? (
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Sin vistas guardadas â€” crea la primera con &quot;Guardar vista actual&quot;</span>
            ) : (
              savedViews.map((v) => (
                <span key={v.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                  <button
                    onClick={() => {
                      // APLICAR la vista guardada al estado actual
                      setTypeFilter(v.config.typeFilter);
                      setSelectedLocation(v.config.selectedLocation);
                      setGranularDeviceIds(new Set(v.config.devices));
                      setSelectedKeysByDevice(Object.fromEntries(Object.entries(v.config.keysByDevice).map(([devId, keys]) => [devId, new Set(keys)])));
                      setIntervalLabel(v.config.intervalLabel);
                      setAgg(v.config.agg);
                      if (v.config.startDate) setStartDate(v.config.startDate);
                      if (v.config.endDate) setEndDate(v.config.endDate);
                      if (v.config.chartsState) {
                        setCharts(v.config.chartsState.map((c) => ({
                          id: c.id, title: c.title,
                          seriesIncluded: c.seriesIncluded === 'all' ? 'all' : new Set(c.seriesIncluded),
                          yMin: c.yMin, yMax: c.yMax, yLabel: c.yLabel,
                        })));
                      }
                      setActiveViewId(v.id);
                    }}
                    className={`chip ${activeViewId === v.id ? 'active' : ''}`}
                    style={{ fontSize: '0.74rem', padding: '4px 10px' }}
                    title={`Aplicar vista &quot;${v.name}&quot; (creada ${new Date(v.created_at).toLocaleDateString('es-CO')}${v.created_by ? ' por ' + v.created_by : ''})`}
                  >
                    {v.name}
                  </button>
                  <button
                    onClick={() => {
                      if (!confirm(`Â¿Eliminar la vista &quot;${v.name}&quot;? Se borra para todos los usuarios.`)) return;
                      void persistViews(savedViews.filter((x) => x.id !== v.id));
                      if (activeViewId === v.id) setActiveViewId(null);
                    }}
                    title="Eliminar vista"
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '0 4px', lineHeight: 1 }}
                  >
                    Ã—
                  </button>
                </span>
              ))
            )}
            <button
              onClick={() => {
                const name = prompt('Nombre para esta vista (ej. "Casa 42 â€” voltajes diarios"):');
                if (!name || !name.trim()) return;
                const newView: SavedView = {
                  id: `view-${Date.now()}`,
                  name: name.trim(),
                  created_at: new Date().toISOString(),
                  config: {
                    devices: Array.from(granularDeviceIds),
                    keysByDevice: Object.fromEntries(Object.entries(selectedKeysByDevice).map(([devId, set]) => [devId, Array.from(set)])),
                    intervalLabel,
                    agg,
                    typeFilter,
                    selectedLocation,
                    startDate, endDate,
                    chartsState: charts.map((c) => ({
                      id: c.id, title: c.title,
                      seriesIncluded: c.seriesIncluded === 'all' ? 'all' : Array.from(c.seriesIncluded),
                      yMin: c.yMin, yMax: c.yMax, yLabel: c.yLabel,
                    })),
                  },
                };
                void persistViews([...savedViews, newView]);
                setActiveViewId(newView.id);
              }}
              disabled={granularDeviceIds.size === 0 || totalSelectedKeysCount === 0}
              className="secondary-btn"
              style={{ marginLeft: 'auto', fontSize: '0.74rem', padding: '4px 10px' }}
              title={granularDeviceIds.size === 0 || totalSelectedKeysCount === 0 ? 'Selecciona devices y keys antes de guardar' : 'Guardar la configuraciÃ³n actual como vista reutilizable'}
            >
              + Guardar vista actual
            </button>
          </div>
        </div>

        {granularDeviceIds.size > 0 && (
          <>
            <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <label className="input-label" style={{ display: 'block', marginBottom: '8px' }}>Intervalo</label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {PRESETS.map((p) => (
                    <button
                      key={p.label}
                      onClick={() => setIntervalLabel(p.label)}
                      className={`chip ${intervalLabel === p.label ? 'active' : ''}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Keys disponibles AGRUPADAS POR DEVICE â€” cada equipo expone sus propias variables */}
            <div style={{ marginBottom: '16px' }}>
              <label className="input-label" style={{ display: 'block', marginBottom: '8px' }}>
                Keys disponibles por dispositivo {totalSelectedKeysCount > 0 && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({totalSelectedKeysCount} seleccionadas en total)</span>}
              </label>
              {keysLoading && <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Cargando keys...</p>}
              {keysError && <div className="alert-error">{keysError}</div>}
              {granularDevicesMeta.length === 0 && !keysLoading && (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Selecciona uno o mÃ¡s dispositivos arriba para ver sus keys.</p>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {granularDevicesMeta.map((dev) => {
                  const rawKeys = keysByDevice[dev.id] ?? [];
                  const rawKeySet = new Set(rawKeys);
                  // Inyectar keys derivadas que aplican a este device si todas sus deps existen
                  const isInv = (dev.type ?? '').toLowerCase() === 'inverter';
                  const devMarca = (dev.marca ?? '').toLowerCase();
                  const derivedAvailable = DERIVED_KEY_LIST.filter((dk) => {
                    const meta = DERIVED_KEYS[dk];
                    if (meta.appliesToInverter && !isInv) return false;
                    // Filtro por marca: si la derivada es especÃ­fica a una marca
                    // (Livoltek o DEYE), solo se muestra si la marca del device coincide.
                    if (meta.brand && !devMarca.includes(meta.brand.toLowerCase())) return false;
                    return meta.deps.every((d) => rawKeySet.has(d));
                  });
                  const devKeys = [...derivedAvailable, ...rawKeys];
                  const devSelected = selectedKeysByDevice[dev.id] ?? new Set<string>();
                  const devLabel = deviceLabel(dev);
                  return (
                    <div key={dev.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, background: 'var(--bg-surface)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6, gap: 8, flexWrap: 'wrap' }}>
                        <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>
                          {devLabel}
                          <span style={{ marginLeft: 6, color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.74rem' }}>
                            ({devKeys.length} keys Â· {devSelected.size} seleccionadas)
                          </span>
                        </div>
                        {devKeys.length > 0 && (
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={() => setSelectedKeysByDevice((p) => ({ ...p, [dev.id]: new Set(devKeys) }))}
                              style={{ background: 'transparent', border: 'none', color: 'var(--accent)', fontSize: '0.72rem', cursor: 'pointer', textDecoration: 'underline' }}>
                              Todas
                            </button>
                            <button onClick={() => setSelectedKeysByDevice((p) => ({ ...p, [dev.id]: new Set() }))}
                              style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '0.72rem', cursor: 'pointer', textDecoration: 'underline' }}>
                              Ninguna
                            </button>
                          </div>
                        )}
                      </div>
                      {devKeys.length === 0 ? (
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', fontStyle: 'italic', margin: 0 }}>
                          {keysLoading ? 'Cargandoâ€¦' : 'Este dispositivo no expone keys de timeseries.'}
                        </p>
                      ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, maxHeight: 140, overflowY: 'auto' }}>
                          {devKeys.map((k) => {
                            const derived = isDerivedKey(k);
                            return (
                              <button key={k} onClick={() => toggleDeviceKey(dev.id, k)}
                                className={`chip ${devSelected.has(k) ? 'active' : ''}`}
                                title={derived ? 'Key calculada (estimaciÃ³n, no mediciÃ³n directa)' : undefined}
                                style={{
                                  fontSize: '0.72rem',
                                  fontStyle: derived ? 'italic' : undefined,
                                  borderLeft: derived ? '3px solid #f59e0b' : undefined,
                                }}>
                                {derived ? `Æ’ ${k}` : k}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {granError && <div className="alert-error">{granError}</div>}

            {/* DiagnÃ³stico: cuÃ¡ntos puntos llegaron tras el Ãºltimo Consultar */}
            {!granLoading && Object.keys(granData).length > 0 && (
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginBottom: 8 }}>
                {chartData.length === 0 ? (
                  <span style={{ color: '#ef4444' }}>
                    âš  Se recibiÃ³ respuesta de Metrum pero los datos no se pudieron interpretar (0 puntos en el chart). Revisa la consola del navegador (F12).
                  </span>
                ) : (
                  <>
                    <strong>{chartData.length}</strong> puntos Ã— {seriesKeys.length} serie{seriesKeys.length === 1 ? '' : 's'} cargados ({intervalLabel} agregado por AVG).
                  </>
                )}
              </div>
            )}

            {/* Nota informativa cuando se muestra curtailment_kwh: la curva en granular
                ahora viene de los valores PRE-CALCULADOS de NAR (un valor por dÃ­a
                escalonado). Coincide al 100% con el ranking NAR. */}
            {chartData.length > 0 && Object.values(selectedKeysByDevice).some((s) => Array.from(s).some((k) => k.startsWith('curtailment_kwh_'))) && (
              <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid #10b981', borderRadius: 8, padding: '8px 14px', marginTop: 10, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                â„¹ï¸ <strong>curtailment_kwh</strong> usa los daily totales de NAR (mismo nÃºmero que ves en el ranking). La curva sube en escalones porque NAR persiste 1 valor por dÃ­a.
              </div>
            )}

            {chartData.length > 0 && (
              <>
                {charts.map((cfg, chartIdx) => {
                  const series = chartSeriesFor(cfg);
                  const isFirst = chartIdx === 0;
                  return (
                    <div key={cfg.id} ref={(el) => { chartRefs.current[cfg.id] = el; }} className="glass-panel" style={{ padding: 12, marginBottom: 12 }}>
                      {/* Header de la grÃ¡fica: tÃ­tulo editable, controles Y axis, botÃ³n eliminar */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                        <input
                          value={cfg.title}
                          onChange={(e) => updateChart(cfg.id, { title: e.target.value })}
                          style={{ fontWeight: 700, fontSize: '0.92rem', maxWidth: 220, padding: '4px 8px' }}
                        />
                        <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                          {series.length} serie{series.length === 1 ? '' : 's'}
                        </span>
                        <button
                          onClick={() => downloadChartPng(cfg.id, cfg.title)}
                          title="Descargar esta grÃ¡fica como PNG"
                          style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.72rem', padding: '3px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          disabled={series.length === 0}
                        >
                          <Download size={11} /> PNG
                        </button>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto', flexWrap: 'wrap' }}>
                          <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            Y min:
                            <input type="number" placeholder="auto"
                              value={cfg.yMin ?? ''}
                              onChange={(e) => updateChart(cfg.id, { yMin: e.target.value === '' ? undefined : Number(e.target.value) })}
                              style={{ width: 70, marginLeft: 4, padding: '3px 6px', fontSize: '0.75rem' }} />
                          </label>
                          <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            Y max:
                            <input type="number" placeholder="auto"
                              value={cfg.yMax ?? ''}
                              onChange={(e) => updateChart(cfg.id, { yMax: e.target.value === '' ? undefined : Number(e.target.value) })}
                              style={{ width: 70, marginLeft: 4, padding: '3px 6px', fontSize: '0.75rem' }} />
                          </label>
                          <input type="text" placeholder="Etiqueta Y (opcional)"
                            value={cfg.yLabel ?? ''}
                            onChange={(e) => updateChart(cfg.id, { yLabel: e.target.value || undefined })}
                            style={{ width: 130, padding: '3px 6px', fontSize: '0.75rem' }} />
                          {!isFirst && (
                            <button onClick={() => removeChart(cfg.id)}
                              title="Eliminar grÃ¡fica"
                              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: '1rem', padding: '0 6px' }}>
                              Ã—
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Selector de series â€” click en un chip prende/apaga esa serie en esta grÃ¡fica */}
                      {seriesKeys.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8, padding: '6px 8px', background: 'var(--bg-elevated)', borderRadius: 6, alignItems: 'center' }}>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginRight: 4 }}>Series:</span>
                          <button
                            onClick={() => updateChart(cfg.id, { seriesIncluded: 'all' })}
                            className={`chip ${cfg.seriesIncluded === 'all' ? 'active' : ''}`}
                            style={{ fontSize: '0.68rem', padding: '2px 8px' }}
                            title="Mostrar todas las series seleccionadas en esta grÃ¡fica"
                          >
                            Todas
                          </button>
                          <button
                            onClick={() => updateChart(cfg.id, { seriesIncluded: new Set<string>() })}
                            className="chip"
                            style={{ fontSize: '0.68rem', padding: '2px 8px' }}
                            title="Ocultar todas"
                          >
                            Ninguna
                          </button>
                          <span style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 4px' }} />
                          {seriesKeys.map((s, i) => {
                            const included = cfg.seriesIncluded === 'all' || (cfg.seriesIncluded as Set<string>).has(s.key);
                            return (
                              <button key={s.key}
                                onClick={() => toggleSeriesInChart(cfg.id, s.key)}
                                className={`chip ${included ? 'active' : ''}`}
                                style={{ fontSize: '0.68rem', padding: '2px 8px', borderLeft: `3px solid ${COLORS[i % COLORS.length]}` }}>
                                {s.label}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Chart */}
                      {series.length === 0 ? (
                        <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', background: 'var(--bg-elevated)', borderRadius: 6 }}>
                          Sin series asignadas a esta grÃ¡fica
                        </div>
                      ) : (
                        <div style={{ width: '100%', height: 320 }}>
                          <ResponsiveContainer>
                            <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                              <CartesianGrid stroke="rgba(0,0,0,0.06)" />
                              <XAxis
                                dataKey="ts" type="number" domain={['dataMin', 'dataMax']} scale="time"
                                tickFormatter={(v) => new Date(v).toLocaleString('es-CO', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                stroke="var(--text-muted)" fontSize={11}
                              />
                              <YAxis
                                stroke="var(--text-muted)" fontSize={11}
                                domain={[cfg.yMin ?? 'auto', cfg.yMax ?? 'auto']}
                                label={(() => {
                                  // Etiqueta del eje Y: prioridad al texto custom, sino unidad inferida de las series
                                  if (cfg.yLabel) return { value: cfg.yLabel, angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: 'var(--text-muted)' } };
                                  const units = Array.from(new Set(series.map((s) => findVariable(s.baseKey)?.unit).filter((u): u is string => !!u)));
                                  if (units.length === 0) return undefined;
                                  const autoLabel = units.length === 1 ? units[0] : units.join(' / ');
                                  return { value: autoLabel, angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: 'var(--text-muted)' } };
                                })()}
                              />
                              <Tooltip
                                labelFormatter={(v) => new Date(Number(v)).toLocaleString('es-CO')}
                                contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: '0.78rem' }}
                              />
                              <Legend wrapperStyle={{ fontSize: '0.78rem', cursor: 'pointer' }} />
                              {series.map((s) => {
                                const colorIdx = seriesKeys.findIndex((x) => x.key === s.key);
                                return (
                                  <Line key={s.key} type="monotone" dataKey={s.key} name={s.label}
                                    stroke={COLORS[(colorIdx >= 0 ? colorIdx : 0) % COLORS.length]}
                                    dot={{ r: 2.5, strokeWidth: 0, fill: COLORS[(colorIdx >= 0 ? colorIdx : 0) % COLORS.length] }}
                                    activeDot={{ r: 5, stroke: 'white', strokeWidth: 2 }}
                                    strokeWidth={2} connectNulls isAnimationActive={false} />
                                );
                              })}
                              <Brush dataKey="ts" height={28} stroke="#07c5a8" fill="rgba(7,197,168,0.08)"
                                travellerWidth={10}
                                tickFormatter={(v) => new Date(v).toLocaleDateString('es-CO', { month: 'short', day: '2-digit' })} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* BotÃ³n para agregar mÃ¡s grÃ¡ficas */}
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
                  <button onClick={addChart} className="secondary-btn" style={{ fontSize: '0.82rem' }}>
                    + Nueva grÃ¡fica
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, flexWrap: 'wrap', gap: 10 }}>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                    {chartData.length} puntos Â· {dailyData.length} dÃ­a{dailyData.length === 1 ? '' : 's'} Â· Hover sobre el chart para ver valores Â· arrastra los bordes del mini-eje inferior para zoom
                  </div>
                  <div style={{ display: 'inline-flex', gap: 6 }}>
                    <button onClick={() => setShowDataTable((v) => !v)} className="secondary-btn" style={{ fontSize: '0.74rem', padding: '6px 10px' }}>
                      {showDataTable ? 'Ocultar tabla' : 'Ver tabla de datos'}
                    </button>
                    {showDataTable && (
                      <div style={{ display: 'inline-flex', background: 'var(--bg-elevated)', borderRadius: 6, padding: 2, border: '1px solid var(--border)' }}>
                        <button onClick={() => setDataTableMode('diario')} style={{
                          padding: '5px 10px', fontSize: '0.74rem', fontWeight: 600, borderRadius: 4, border: 'none', cursor: 'pointer',
                          background: dataTableMode === 'diario' ? 'var(--bg-surface)' : 'transparent',
                          color: dataTableMode === 'diario' ? 'var(--text-primary)' : 'var(--text-muted)',
                        }}>Por dÃ­a</button>
                        <button onClick={() => setDataTableMode('puntos')} style={{
                          padding: '5px 10px', fontSize: '0.74rem', fontWeight: 600, borderRadius: 4, border: 'none', cursor: 'pointer',
                          background: dataTableMode === 'puntos' ? 'var(--bg-surface)' : 'transparent',
                          color: dataTableMode === 'puntos' ? 'var(--text-primary)' : 'var(--text-muted)',
                        }}>Puntos</button>
                      </div>
                    )}
                  </div>
                </div>

                {showDataTable && dataTableMode === 'diario' && dailyData.length > 0 && (
                  <div className="glass-panel" style={{ padding: 0, marginTop: 12, overflow: 'hidden' }}>
                    <div style={{ padding: '8px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
                      <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>
                        Promedio diario por serie Â· {dailyData.length} dÃ­a{dailyData.length === 1 ? '' : 's'}
                      </span>
                      <button
                        onClick={downloadDailyTableCsv}
                        className="secondary-btn"
                        style={{ fontSize: '0.74rem', padding: '4px 10px' }}
                        title="Descargar la tabla como CSV (abre en Excel)"
                      >
                        <Download size={12} /> CSV
                      </button>
                    </div>
                    <div style={{ overflowX: 'auto', maxHeight: 380 }}>
                      <table style={{ width: '100%', fontSize: '0.78rem' }}>
                        <thead>
                          <tr>
                            <th style={{ position: 'sticky', top: 0, background: 'var(--bg-elevated)', textAlign: 'left' }}>DÃ­a</th>
                            {seriesKeys.map((s) => (
                              <th key={s.key} style={{ position: 'sticky', top: 0, background: 'var(--bg-elevated)', textAlign: 'right', borderLeft: '1px solid var(--border)' }}>
                                {s.label}
                                <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.04em' }}>promedio</div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {dailyData.map((d) => (
                            <tr key={d.dia}>
                              <td style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{d.dia}</td>
                              {seriesKeys.map((s) => {
                                const cnt = d.count[s.key] ?? 0;
                                const avg = cnt > 0 ? d.sum[s.key] / cnt : null;
                                const fmt = (n: number | null) => n === null ? 'â€”' : n.toLocaleString('es-CO', { maximumFractionDigits: 2 });
                                return (
                                  <td key={s.key} style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 600, borderLeft: '1px solid var(--border)' }}>
                                    {fmt(avg)}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {showDataTable && dataTableMode === 'puntos' && (
                  <div className="glass-panel" style={{ padding: 0, marginTop: 12, overflow: 'hidden' }}>
                    <div style={{ overflowX: 'auto', maxHeight: 380 }}>
                      <table style={{ width: '100%', fontSize: '0.78rem' }}>
                        <thead>
                          <tr>
                            <th style={{ position: 'sticky', top: 0, background: 'var(--bg-elevated)', textAlign: 'left' }}>Fecha / Hora</th>
                            {seriesKeys.map((s) => (
                              <th key={s.key} style={{ position: 'sticky', top: 0, background: 'var(--bg-elevated)', textAlign: 'right', fontSize: '0.7rem' }}>{s.label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {chartData.map((row) => {
                            const r = row as Record<string, number | null>;
                            return (
                              <tr key={r.ts as number}>
                                <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.74rem' }}>
                                  {new Date(r.ts as number).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}
                                </td>
                                {seriesKeys.map((s) => (
                                  <td key={s.key} style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>
                                    {r[s.key] === null || r[s.key] === undefined ? 'â€”' : Number(r[s.key]).toLocaleString('es-CO', { maximumFractionDigits: 3 })}
                                  </td>
                                ))}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
      </>
      )}
    </>
  );
}

/* ---------------- TAB: Consumos por Casa ---------------- */

interface HouseRow { id: string; casa: string; cliente_id: string; location: string | null; city: string | null; }

interface ConsumptionRow {
  id: string;
  house_id: string;
  dia_consumo: string;
  fecha_telemetria: string;
  // meter solar
  lectura_eai_meter_solar: number | null; eai_meter_solar: number | null;
  lectura_eae_meter_solar: number | null; eae_meter_solar: number | null;
  lectura_eri_meter_solar: number | null; eri_meter_solar: number | null;
  lectura_ere_meter_solar: number | null; ere_meter_solar: number | null;
  meter_solar_estado: string | null;
  // meter red
  lectura_eai_meter_red: number | null; eai_meter_red: number | null;
  lectura_eae_meter_red: number | null; eae_meter_red: number | null;
  lectura_eri_meter_red: number | null; eri_meter_red: number | null;
  lectura_ere_meter_red: number | null; ere_meter_red: number | null;
  meter_red_estado: string | null;
  usa_phs: boolean | null;
  // inverter
  generacion_solar_inverter: number | null;
  consumo_cliente_inverter: number | null;
  energia_importada_inverter: number | null;
  energia_exportada_inverter: number | null;
  inverter_estado: string | null;
  // battery
  energia_entregada_bateria: number | null;
  estado_salud_bateria: number | null;
  tiempo_entrega_bateria: number | null;
  // derivadas
  consumo_solar: number | null;
  gen_solar_total: number | null;
  ptc_autosuficiencia: number | null;
  client_houses: { casa: string; cliente_id: string } | null;
}

// DefiniciÃ³n de columnas tal como el Excel "Lecturas y consumos mayo"
type Col = { key: keyof ConsumptionRow; label: string; group: string; format?: 'num' | 'pct' | 'int' | 'bool' | 'txt' };
const COLS: Col[] = [
  { key: 'dia_consumo',     label: 'dia_consumo',     group: 'IdentificaciÃ³n', format: 'txt' },
  { key: 'fecha_telemetria', label: 'fecha_telemetria', group: 'IdentificaciÃ³n', format: 'txt' },

  { key: 'lectura_eai_meter_solar', label: 'lectura_EAI_meter_solar', group: 'Meter Solar', format: 'num' },
  { key: 'eai_meter_solar',         label: 'EAI_meter_solar',         group: 'Meter Solar', format: 'num' },
  { key: 'lectura_eae_meter_solar', label: 'lectura_EAE_meter_solar', group: 'Meter Solar', format: 'num' },
  { key: 'eae_meter_solar',         label: 'EAE_meter_solar',         group: 'Meter Solar', format: 'num' },
  { key: 'lectura_eri_meter_solar', label: 'lectura_ERI_meter_solar', group: 'Meter Solar', format: 'num' },
  { key: 'eri_meter_solar',         label: 'ERI_meter_solar',         group: 'Meter Solar', format: 'num' },
  { key: 'lectura_ere_meter_solar', label: 'lectura_ERE_meter_solar', group: 'Meter Solar', format: 'num' },
  { key: 'ere_meter_solar',         label: 'ERE_meter_solar',         group: 'Meter Solar', format: 'num' },
  { key: 'meter_solar_estado',      label: 'meter_solar_estado',      group: 'Meter Solar', format: 'txt' },

  { key: 'lectura_eai_meter_red', label: 'lectura_EAI_meter_red', group: 'Meter Red', format: 'num' },
  { key: 'eai_meter_red',         label: 'EAI_meter_red',         group: 'Meter Red', format: 'num' },
  { key: 'lectura_eae_meter_red', label: 'lectura_EAE_meter_red', group: 'Meter Red', format: 'num' },
  { key: 'eae_meter_red',         label: 'EAE_meter_red',         group: 'Meter Red', format: 'num' },
  { key: 'lectura_eri_meter_red', label: 'lectura_ERI_meter_red', group: 'Meter Red', format: 'num' },
  { key: 'eri_meter_red',         label: 'ERI_meter_red',         group: 'Meter Red', format: 'num' },
  { key: 'lectura_ere_meter_red', label: 'lectura_ERE_meter_red', group: 'Meter Red', format: 'num' },
  { key: 'ere_meter_red',         label: 'ERE_meter_red',         group: 'Meter Red', format: 'num' },
  { key: 'meter_red_estado',      label: 'meter_red_estado',      group: 'Meter Red', format: 'txt' },
  { key: 'usa_phs',               label: '_usa_phS',              group: 'Meter Red', format: 'bool' },

  { key: 'generacion_solar_inverter',    label: 'generacion_solar_inverter',    group: 'Inverter', format: 'num' },
  { key: 'consumo_cliente_inverter',     label: 'consumo_cliente_inverter',     group: 'Inverter', format: 'num' },
  { key: 'energia_importada_inverter',   label: 'energia_importada_inverter',   group: 'Inverter', format: 'num' },
  { key: 'energia_exportada_inverter',   label: 'energia_exportada_inverter',   group: 'Inverter', format: 'num' },
  { key: 'inverter_estado',              label: 'inverter_estado',              group: 'Inverter', format: 'txt' },

  { key: 'energia_entregada_bateria', label: 'energia_entregada_bateria', group: 'Battery', format: 'num' },
  { key: 'estado_salud_bateria',      label: 'estado_salud_bateria',      group: 'Battery', format: 'num' },
  { key: 'tiempo_entrega_bateria',    label: 'tiempo_entrega_bateria',    group: 'Battery', format: 'int' },

  { key: 'consumo_solar',        label: 'consumo_solar',        group: 'Derivadas', format: 'num' },
  { key: 'gen_solar_total',      label: 'gen_solar_total',      group: 'Derivadas', format: 'num' },
  { key: 'ptc_autosuficiencia',  label: 'ptc_autosuficiencia',  group: 'Derivadas', format: 'pct' },
];

const GROUP_COLORS: Record<string, string> = {
  'IdentificaciÃ³n': 'var(--bg-elevated)',
  'Meter Solar':    'rgba(245, 158, 11, 0.08)',
  'Meter Red':      'rgba(59, 130, 246, 0.08)',
  'Inverter':       'rgba(7, 197, 168, 0.08)',
  'Battery':        'rgba(139, 92, 246, 0.08)',
  'Derivadas':      'rgba(16, 185, 129, 0.08)',
};

const fmtCell = (v: unknown, format?: Col['format']): string => {
  if (v === null || v === undefined) return 'â€”';
  if (format === 'bool') return v ? 'true' : 'false';
  if (format === 'txt') return String(v);
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (format === 'pct') return (n * 100).toFixed(2) + '%';
  if (format === 'int') return n.toFixed(0);
  return n.toLocaleString('es-CO');
};

// Variables numÃ©ricas del daily_consumption para graficar (excluye txt/bool)
const NUMERIC_COLS = COLS.filter((c) => c.format !== 'txt' && c.format !== 'bool');

const SERIES_COLORS = ['#07c5a8', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#10b981', '#ec4899', '#0ea5e9', '#a855f7', '#14b8a6'];

function ConsumosTab() {
  const [subTab, setSubTab] = useState<'tabla' | 'graficas'>('tabla');
  const [houses, setHouses] = useState<HouseRow[]>([]);
  const [selectedHouse, setSelectedHouse] = useState<string>('');
  const [startDate, setStartDate] = useState<string>(dateStr(weekAgo()));
  const [endDate, setEndDate] = useState<string>(dateStr(today()));
  const [rows, setRows] = useState<ConsumptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Para GrÃ¡ficas: multi-select casas + multi-select variables
  const [chartCasas, setChartCasas] = useState<Set<string>>(new Set());
  const [chartVars, setChartVars] = useState<Set<string>>(new Set(['generacion_solar_inverter']));
  const [chartRows, setChartRows] = useState<ConsumptionRow[]>([]);
  const [chartLoading, setChartLoading] = useState(false);

  const loadHouses = async () => {
    const { data, error } = await supabase
      .from('client_houses')
      .select('id, casa, cliente_id, location, city')
      .order('casa', { ascending: true });
    if (error) { console.error(error); return; }
    setHouses((data ?? []) as HouseRow[]);
  };

  useEffect(() => { loadHouses(); }, []);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('daily_consumption')
        .select('*, client_houses(casa, cliente_id)')
        .order('dia_consumo', { ascending: false })
        .limit(500);
      if (selectedHouse) query = query.eq('house_id', selectedHouse);
      if (startDate) query = query.gte('dia_consumo', startDate);
      if (endDate) query = query.lte('dia_consumo', endDate);
      const { data, error } = await query;
      if (error) throw error;
      const filtered = (data ?? []).filter((r: ConsumptionRow) =>
        r.lectura_eai_meter_solar !== null ||
        r.lectura_eai_meter_red !== null ||
        r.generacion_solar_inverter !== null,
      );
      setRows(filtered as unknown as ConsumptionRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); /* eslint-disable-next-line */ }, [selectedHouse, startDate, endDate]);

  // Cargar chartRows independientemente (ignora selectedHouse, usa chartCasas)
  const fetchChartData = async () => {
    if (chartCasas.size === 0 || chartVars.size === 0) { setChartRows([]); return; }
    setChartLoading(true);
    try {
      let q = supabase
        .from('daily_consumption')
        .select('*, client_houses(casa, cliente_id)')
        .order('dia_consumo', { ascending: true })
        .limit(2000);
      const ids = houses.filter((h) => chartCasas.has(h.casa)).map((h) => h.id);
      if (ids.length > 0) q = q.in('house_id', ids);
      if (startDate) q = q.gte('dia_consumo', startDate);
      if (endDate) q = q.lte('dia_consumo', endDate);
      const { data } = await q;
      setChartRows((data ?? []) as unknown as ConsumptionRow[]);
    } finally {
      setChartLoading(false);
    }
  };

  useEffect(() => { if (subTab === 'graficas') fetchChartData(); /* eslint-disable-next-line */ }, [subTab, chartCasas, chartVars, startDate, endDate, houses.length]);

  // Group headers
  const groups: Array<{ name: string; span: number }> = [];
  let prev = '';
  for (const c of COLS) {
    if (c.group !== prev) { groups.push({ name: c.group, span: 1 }); prev = c.group; }
    else { groups[groups.length - 1].span++; }
  }

  // Construir chartData: [{ dia_consumo, 'Casa 2 Â· eai_meter_solar': 123, ... }]
  const chartSeries = useMemo(() => {
    const series: Array<{ key: string; casa: string; variable: string; label: string }> = [];
    for (const casa of chartCasas) {
      for (const v of chartVars) {
        const meta = COLS.find((c) => c.key === v);
        series.push({ key: `${casa}__${v}`, casa, variable: v, label: `${casa} Â· ${meta?.label ?? v}` });
      }
    }
    return series;
  }, [chartCasas, chartVars]);

  const chartData = useMemo(() => {
    const byDate = new Map<string, Record<string, number | string | null>>();
    for (const r of chartRows) {
      const casa = r.client_houses?.casa;
      if (!casa || !chartCasas.has(casa)) continue;
      const d = r.dia_consumo;
      if (!byDate.has(d)) byDate.set(d, { dia_consumo: d });
      const row = byDate.get(d)!;
      for (const v of chartVars) {
        const val = r[v as keyof ConsumptionRow];
        row[`${casa}__${v}`] = typeof val === 'number' ? val : null;
      }
    }
    return Array.from(byDate.values()).sort((a, b) => String(a.dia_consumo).localeCompare(String(b.dia_consumo)));
  }, [chartRows, chartCasas, chartVars]);

  return (
    <>
      {/* â”€â”€â”€â”€â”€ Filtros compartidos â”€â”€â”€â”€â”€ */}
      <div className="glass-panel">
        <div className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Filter size={18} style={{ color: 'var(--text-secondary)' }} />
            <h2 className="card-title">Filtros</h2>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '14px', alignItems: 'end' }}>
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label">Casa / Cliente (solo aplica a la Tabla)</label>
            <select value={selectedHouse} onChange={(e) => setSelectedHouse(e.target.value)}>
              <option value="">Todas las casas ({houses.length})</option>
              {houses.map((h) => (
                <option key={h.id} value={h.id}>{h.casa}{h.location ? ` â€” ${h.location}` : ''}{h.city ? ` (${h.city})` : ''}</option>
              ))}
            </select>
          </div>
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label">Desde</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label">Hasta</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>
      </div>

      {error && <div className="alert-error">{error}</div>}

      {/* Sub-tabs */}
      <div className="tabs">
        <button onClick={() => setSubTab('tabla')} className={`tab ${subTab === 'tabla' ? 'active' : ''}`}>Tabla</button>
        <button onClick={() => setSubTab('graficas')} className={`tab ${subTab === 'graficas' ? 'active' : ''}`}>GrÃ¡ficas</button>
      </div>

      {/* â•â•â•â•â•â•â• SUB-TAB: TABLA â•â•â•â•â•â•â• */}
      {subTab === 'tabla' && (
        <>
          {!loading && rows.length === 0 && (
            <div className="alert-warning" style={{ fontSize: '0.85rem' }}>
              <strong>Sin consumo cargado.</strong> Usa <em>Sincronizar Metrum</em> en el header para traer la telemetrÃ­a diaria.
            </div>
          )}

          {rows.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', color: 'var(--text-muted)', flexWrap: 'wrap', gap: 8 }}>
              <span>{rows.length} filas Â· scroll horizontal para ver todas las columnas</span>
              <button
                className="secondary-btn"
                onClick={() => {
                  const headers = ['casa', 'cliente_id', ...COLS.map((c) => c.label)];
                  const csvRows = rows.map((r) => [
                    r.client_houses?.casa ?? '',
                    r.client_houses?.cliente_id ?? '',
                    ...COLS.map((c) => {
                      const v = r[c.key];
                      if (v === null || v === undefined) return '';
                      if (c.format === 'bool') return v ? 'true' : 'false';
                      return v as string | number;
                    }),
                  ]);
                  downloadCSV(`consumo-por-dispositivo-${startDate}_${endDate}.csv`, headers, csvRows);
                }}
                style={{ fontSize: '0.8rem' }}
              >
                <Download size={14} /> CSV
              </button>
            </div>
          )}

          <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 280px)', minHeight: 500 }}>
              <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: '0.78rem', width: 'max-content' }}>
                <thead>
                  <tr>
                    <th style={{ position: 'sticky', top: 0, left: 0, zIndex: 30, background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)', borderRight: '2px solid var(--border)', minWidth: 120 }}>Casa</th>
                    <th style={{ position: 'sticky', top: 0, zIndex: 20, background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)', borderRight: '2px solid var(--border)' }}>cliente_id</th>
                    {groups.map((g) => (
                      <th key={g.name} colSpan={g.span}
                        style={{ position: 'sticky', top: 0, zIndex: 20, background: GROUP_COLORS[g.name], textAlign: 'center', borderLeft: '1px solid var(--border)', borderBottom: '1px solid var(--border)', fontWeight: 700, letterSpacing: '0.04em' }}>
                        {g.name}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    <th style={{ position: 'sticky', top: 32, left: 0, zIndex: 30, background: 'var(--bg-elevated)', borderRight: '2px solid var(--border)', borderBottom: '1px solid var(--border)' }}>&nbsp;</th>
                    <th style={{ position: 'sticky', top: 32, zIndex: 20, background: 'var(--bg-elevated)', borderRight: '2px solid var(--border)', borderBottom: '1px solid var(--border)' }}>&nbsp;</th>
                    {COLS.map((c, i) => (
                      <th key={c.key as string}
                        style={{ position: 'sticky', top: 32, zIndex: 20, background: GROUP_COLORS[c.group], whiteSpace: 'nowrap', fontSize: '0.7rem', borderLeft: i === 0 || COLS[i - 1].group !== c.group ? '1px solid var(--border)' : 'none', borderBottom: '1px solid var(--border)', padding: '6px 10px' }}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={COLS.length + 2} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>Cargando...</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={COLS.length + 2} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>â€”</td></tr>
                  ) : (
                    rows.map((r) => (
                      <tr key={r.id}>
                        <td style={{ position: 'sticky', left: 0, zIndex: 10, background: 'var(--bg-surface)', fontWeight: 600, borderRight: '2px solid var(--border)', borderBottom: '1px solid var(--border)', padding: '6px 10px', minWidth: 120 }}>
                          {r.client_houses?.casa ?? 'â€”'}
                        </td>
                        <td style={{ background: 'var(--bg-surface)', fontFamily: 'ui-monospace, monospace', fontSize: '0.7rem', color: 'var(--text-muted)', borderRight: '2px solid var(--border)', borderBottom: '1px solid var(--border)', padding: '6px 10px' }}>
                          {r.client_houses?.cliente_id?.slice(0, 12) ?? 'â€”'}â€¦
                        </td>
                        {COLS.map((c, i) => (
                          <td key={c.key as string}
                            style={{ whiteSpace: 'nowrap', textAlign: c.format === 'txt' || c.format === 'bool' ? 'left' : 'right', borderLeft: i === 0 || COLS[i - 1].group !== c.group ? '1px solid var(--border)' : 'none', borderBottom: '1px solid var(--border)', padding: '6px 10px' }}>
                            {fmtCell(r[c.key], c.format)}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* â•â•â•â•â•â•â• SUB-TAB: GRÃFICAS â•â•â•â•â•â•â• */}
      {subTab === 'graficas' && (
        <>
          <div className="glass-panel">
            <div style={{ marginBottom: 14 }}>
              <label className="input-label" style={{ display: 'block', marginBottom: 8 }}>
                Casas a comparar <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({chartCasas.size} seleccionadas â€” mÃ¡x 6 recomendado)</span>
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 100, overflowY: 'auto' }}>
                {houses.map((h) => (
                  <button key={h.id}
                    onClick={() => {
                      setChartCasas((prev) => {
                        const next = new Set(prev);
                        if (next.has(h.casa)) next.delete(h.casa); else next.add(h.casa);
                        return next;
                      });
                    }}
                    className={`chip ${chartCasas.has(h.casa) ? 'active' : ''}`}
                    style={{ fontSize: '0.75rem' }}>
                    {h.casa}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="input-label" style={{ display: 'block', marginBottom: 8 }}>
                Variables a graficar <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({chartVars.size} seleccionada{chartVars.size !== 1 ? 's' : ''})</span>
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 110, overflowY: 'auto' }}>
                {NUMERIC_COLS.map((c) => (
                  <button key={c.key as string}
                    onClick={() => {
                      setChartVars((prev) => {
                        const next = new Set(prev);
                        if (next.has(c.key as string)) next.delete(c.key as string); else next.add(c.key as string);
                        return next;
                      });
                    }}
                    className={`chip ${chartVars.has(c.key as string) ? 'active' : ''}`}
                    style={{ fontSize: '0.7rem', borderLeft: `3px solid ${GROUP_COLORS[c.group]?.replace('0.08', '0.6') ?? 'var(--accent)'}` }}
                    title={`Grupo: ${c.group}`}>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="glass-panel">
            {chartCasas.size === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                Selecciona al menos una <strong>casa</strong> arriba para empezar.
              </div>
            ) : chartVars.size === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                Selecciona al menos una <strong>variable</strong> arriba.
              </div>
            ) : chartLoading ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Cargando datos...</div>
            ) : chartData.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Sin datos para las casas y variables seleccionadas en el rango.</div>
            ) : (
              <>
                <div style={{ marginBottom: 10, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {chartSeries.length} serie{chartSeries.length !== 1 ? 's' : ''} Â· {chartData.length} dÃ­as
                </div>
                <div style={{ width: '100%', height: 500 }}>
                  <ResponsiveContainer>
                    <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 20, left: 20 }}>
                      <CartesianGrid stroke="rgba(0,0,0,0.06)" />
                      <XAxis dataKey="dia_consumo" stroke="var(--text-muted)" fontSize={11} angle={-30} textAnchor="end" height={60} />
                      <YAxis stroke="var(--text-muted)" fontSize={11} />
                      <Tooltip contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: '0.78rem' }} />
                      <Legend wrapperStyle={{ fontSize: '0.72rem' }} />
                      {chartSeries.map((s, i) => (
                        <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={SERIES_COLORS[i % SERIES_COLORS.length]} strokeWidth={2} dot={{ r: 2 }} connectNulls />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}

/* ---------------- TAB: NAR (Ranking por casa) ---------------- */

function NarTab() {
  return <NarFullView hideTopHeader />;
}
