"use client";
import { supabase } from '@/lib/supabase';
import React, { useEffect, useMemo, useState } from 'react';
import { Filter, RefreshCw, Download, Activity, Play, BookOpen, ChevronDown, ChevronUp, BarChart3, Cpu, AlertTriangle, AlertCircle, Bell, Info, Lightbulb } from 'lucide-react';
import { VARIABLES, findVariable, type VariableMeta } from '@/lib/variables-dict';
import { findVariableMeta, formatValue, ALERT_CATEGORIES } from '@/lib/alert-variables';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Brush,
  PieChart, Pie, Cell,
} from 'recharts';
import { classifyDevice } from '@/lib/classify-device';

type Tab = 'cierres' | 'nar' | 'control';
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

// Métricas calculadas por casa por día (Cierre Diario)
interface CasaDayMetrics {
  casa: string;
  date: string;
  generacion_wh: number | null;     // ΔCenergyAE inverter (Wh)
  importacion_wh: number | null;    // ΔCenergyAI red meter (Wh)
  excedentes_wh: number | null;     // ΔCenergyAE red meter (Wh)
  demanda_wh: number;               // Gen + Imp - Exc (Wh)
  gen_dem_pct: number | null;       // %
  exc_gen_pct: number | null;       // %
  imp_dem_pct: number | null;       // %
  yield_real: number | null;        // kWh/kWp
  desempeno_pct: number | null;     // % vs 4.5 kWh/kWp/día (Cali ref)
  potencia_kw: number | null;       // suma de inverter capacity
  inverterMetrumId: string | null;
  redMeterMetrumId: string | null;
}

const YIELD_TEORICO_REF = 4.5; // kWh/kWp/día — referencia Cali / Valle del Cauca

const fmtEnergy = (wh: number | null, unit = 'Wh') => {
  if (wh === null || wh === undefined) return '—';
  if (Math.abs(wh) >= 1_000_000) return `${(wh / 1_000_000).toFixed(2)} M${unit}`;
  if (Math.abs(wh) >= 1_000) return `${(wh / 1_000).toFixed(2)} k${unit}`;
  return `${wh.toFixed(2)} ${unit}`;
};

const fmtPct = (v: number | null) => v === null || !Number.isFinite(v) ? '—' : `${v.toFixed(1)}%`;
const fmtNum = (v: number | null, decimals = 2) => v === null || !Number.isFinite(v) ? '—' : v.toFixed(decimals);

// Convierte filas a CSV y dispara descarga en el browser
const downloadCSV = (filename: string, headers: string[], rows: (string | number | null | undefined)[][]) => {
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))];
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
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
    inv_eae: number | null;   // generación
    red_eai: number | null;   // importación
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

  // 3. Finalizar cálculos derivados
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

// Etiqueta corta para los chips del selector. Identifica qué tipo de equipo
// es (Medidor RED / Medidor SOLAR / Inversor marca / Pulsar) además del nombre,
// para que cuando una casa tiene varios equipos del mismo tipo nominal el
// usuario distinga cuál está eligiendo.
// ─── Keys calculadas (virtuales) ───────────────────────────────────────────
// Estas keys NO existen en Metrum; se computan en el frontend a partir de las
// keys reales que sí trae el inversor. Aparecen en la lista de "Keys disponibles"
// solo si TODAS las dependencias existen para ese device específico.
// Las descripciones (qué son, cómo se calculan, limitaciones) viven en
// `variables-dict.ts` — aquí solo definimos las dependencias y la fórmula.
interface DerivedKeyMeta {
  deps: string[];
  compute: (vals: Record<string, number>) => number;
  appliesToInverter: boolean;
}
const DERIVED_KEYS: Record<string, DerivedKeyMeta> = {
  Pdc_estimado: {
    deps: ['powerAPg', 'BattPower'],
    // P_dc ≈ AC out − Batt (positivo cuando descarga, negativo cuando carga).
    // No es Ppv puro porque incorpora la dinámica DC de la batería — refleja
    // el balance del bus DC del inversor, no la generación PV aislada.
    compute: (v) => (v.powerAPg ?? 0) - (v.BattPower ?? 0),
    appliesToInverter: true,
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
  return parts.join(' · ');
};

const distinct = <T,>(arr: T[]): T[] => Array.from(new Set(arr));

const locationKey = (d: { location: string | null; city: string | null }) =>
  `${d.location ?? ''}|${d.city ?? ''}`;

const locationLabel = (d: { location: string | null; city: string | null }): string => {
  const parts = [d.location, d.city].filter(Boolean) as string[];
  return parts.length > 0 ? parts.join(' — ') : '';
};

const filterByType = (devices: DeviceOption[], typeFilter: TypeFilter): DeviceOption[] => {
  if (typeFilter === 'all') return devices;
  return devices.filter((d) => classifyDevice(d) === typeFilter);
};

type Agg = 'NONE' | 'AVG' | 'MIN' | 'MAX' | 'SUM' | 'COUNT';
interface IntervalPreset { label: string; ms: number | null; }
const PRESETS: IntervalPreset[] = [
  { label: 'Crudo', ms: null },
  { label: '15 min', ms: 15 * 60 * 1000 },
  { label: '1 hora', ms: 60 * 60 * 1000 },
  { label: '1 día', ms: 24 * 60 * 60 * 1000 },
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

/** Visualizador del diccionario de variables (columna ↔ key Metrum + descripción) */
// Clasificación de variables para filtros del diccionario.
// equipo: en qué equipo "vive" la variable; marca: específica de una marca o agnóstica.
type DictEquipo = 'medidor' | 'inversor' | 'bateria' | 'casa' | 'atributo';
type DictMarca = 'Livoltek' | 'DEYE' | 'ambas';

const _METER_KEYS = new Set(['CenergyAI', 'CenergyAE', 'CenergyRI', 'CenergyRE', 'energyAI', 'energyRI', 'currentA', 'currentB', 'currentC', 'powerAI', 'powerRI']);
const _BATTERY_KEYS = new Set(['Pbat', 'Pcharge', 'Pdischarge', 'Vbat', 'Ibat', 'Tbat', 'BattCycles', 'BattPower', 'BattCur', 'BattVolt', 'BattSOC', 'BattSOH', 'BattTemp', 'BattSn', 'TLBattSOC']);
const _BATTERY_PREFIX = ['Batt'];
const _CASA_KEYS = new Set(['generacion_wh', 'importacion_wh', 'excedentes_wh', 'demanda_wh', 'gen_dem_pct', 'exc_gen_pct', 'imp_dem_pct', 'yield_real', 'desempeno_pct', 'imax_a', 'potencia_kw']);
const _ATTR_KEYS = new Set(['spcus', 'gateway', 'mettype', 'active', 'zone', 'city', 'dept', 'latDev', 'lonDev', 'invbrand', 'invmodel', 'invcap', 'invarray', 'invtype']);

function classifyVariable(v: VariableMeta): { equipo: DictEquipo; marca: DictMarca } {
  const k = v.key;
  // Marca por sufijo
  let marca: DictMarca = 'ambas';
  if (k.endsWith('_LV')) marca = 'Livoltek';
  else if (k.endsWith('_DY')) marca = 'DEYE';

  // Equipo
  if (_BATTERY_KEYS.has(k) || _BATTERY_PREFIX.some((p) => k.startsWith(p))) return { equipo: 'bateria', marca };
  if (_METER_KEYS.has(k)) return { equipo: 'medidor', marca };
  if (_CASA_KEYS.has(k)) return { equipo: 'casa', marca };
  if (_ATTR_KEYS.has(k)) return { equipo: 'atributo', marca };
  // Resto = inversor (cubre powerAEg, powerAPg, voltGridA/B/C, energyED/PD, frequency, invstate, etc.
  //                  + las keys especulativas Ppv1/2/3, Pac, etc. + Ppv_estimado derivada)
  return { equipo: 'inversor', marca };
}

const EQUIPO_META: Record<DictEquipo, { label: string; color: string }> = {
  medidor:   { label: 'Medidor',   color: '#3b82f6' },
  inversor:  { label: 'Inversor',  color: '#8b5cf6' },
  bateria:   { label: 'Batería',   color: '#10b981' },
  casa:      { label: 'Casa (agregado)', color: '#f59e0b' },
  atributo:  { label: 'Atributo',  color: '#64748b' },
};
const MARCA_META: Record<DictMarca, { label: string; color: string }> = {
  Livoltek: { label: 'Livoltek', color: '#0ea5e9' },
  DEYE:     { label: 'DEYE',     color: '#ec4899' },
  ambas:    { label: 'Genérica', color: '#94a3b8' },
};

function VariablesDictionary({ keys: _keys, title = 'Diccionario de variables' }: { keys?: string[]; title?: string }) {
  const [open, setOpen] = useState(false);
  const [filterEquipo, setFilterEquipo] = useState<DictEquipo | 'all'>('all');
  const [filterMarca, setFilterMarca] = useState<DictMarca | 'all'>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 10;

  // Anotar todas las variables con su clasificación
  const annotated = useMemo(() => VARIABLES.map((v) => ({ ...v, ...classifyVariable(v) })), []);

  // Aplicar filtros
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return annotated.filter((v) => {
      if (filterEquipo !== 'all' && v.equipo !== filterEquipo) return false;
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
                placeholder="key, label o descripción…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ fontSize: '0.78rem', padding: '4px 8px' }}
              />
            </div>
          </div>

          {/* Tabla con paginación */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '0.78rem' }}>
              <thead style={{ background: 'var(--bg-elevated)' }}>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ padding: '8px 14px' }}>Equipo</th>
                  <th style={{ padding: '8px 14px' }}>Marca</th>
                  <th style={{ padding: '8px 14px' }}>Columna / UI</th>
                  <th style={{ padding: '8px 14px' }}>Key Metrum</th>
                  <th style={{ padding: '8px 14px' }}>Unidad</th>
                  <th style={{ padding: '8px 14px' }}>Categoría</th>
                  <th style={{ padding: '8px 14px' }}>Descripción</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr><td colSpan={7} style={{ padding: 18, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>Ninguna variable coincide con los filtros</td></tr>
                ) : visible.map((v) => (
                  <tr key={v.key} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 14px' }}>
                      <span style={{ fontSize: '0.66rem', padding: '1px 6px', borderRadius: 8, background: EQUIPO_META[v.equipo].color + '20', color: EQUIPO_META[v.equipo].color, fontWeight: 600 }}>
                        {EQUIPO_META[v.equipo].label}
                      </span>
                    </td>
                    <td style={{ padding: '6px 14px' }}>
                      <span style={{ fontSize: '0.66rem', padding: '1px 6px', borderRadius: 8, background: MARCA_META[v.marca].color + '20', color: MARCA_META[v.marca].color, fontWeight: 600 }}>
                        {MARCA_META[v.marca].label}
                      </span>
                    </td>
                    <td style={{ padding: '6px 14px', fontWeight: 600 }}>{v.label}</td>
                    <td style={{ padding: '6px 14px', fontFamily: 'ui-monospace, monospace', fontSize: '0.72rem', color: 'var(--accent)' }}>{v.key}</td>
                    <td style={{ padding: '6px 14px', color: 'var(--text-secondary)' }}>{v.unit || '—'}</td>
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
                  ← Anterior
                </button>
                <span style={{ alignSelf: 'center', fontSize: '0.74rem', color: 'var(--text-secondary)', padding: '0 6px' }}>
                  Página {currentPage + 1} / {totalPages}
                </span>
                <button
                  onClick={() => setPage(Math.min(totalPages - 1, currentPage + 1))}
                  disabled={currentPage >= totalPages - 1}
                  className="chip"
                  style={{ fontSize: '0.74rem', padding: '4px 10px', opacity: currentPage >= totalPages - 1 ? 0.4 : 1 }}>
                  Siguiente →
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
    // Normalizar a forma capitalizada estándar
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

  // Módems: En Línea / Sin Conexión via is_active
  const gatewaySlices = useMemo<Slice[]>(() => {
    let online = 0, offline = 0;
    for (const d of devices) {
      if (classifyDevice(d) !== 'gateway') continue;
      if (d.is_active === false) offline++;
      else online++;
    }
    const out: Slice[] = [];
    if (online > 0)  out.push({ label: 'En Línea',     value: online,  color: ONLINE_COLOR });
    if (offline > 0) out.push({ label: 'Sin Conexión', value: offline, color: OFFLINE_COLOR });
    return out;
  }, [devices]);

  useEffect(() => {
    loadDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const TAB_META: Record<Tab, { label: string; color: string; Icon: typeof BarChart3; description: string }> = {
    cierres:  { label: 'Vista Granular',         color: '#07c5a8', Icon: Activity,       description: 'Series de tiempo de Metrum por dispositivo. Multi-select de casas, zoom interactivo y tabla diaria/puntos.' },
    nar:      { label: 'NAR',                    color: '#ef4444', Icon: Bell,            description: 'Notificaciones, Alertas y Recomendaciones de la flota. Incluye análisis de Reactiva CREG.' },
    control:  { label: 'Control Manual Inversor', color: '#8b5cf6', Icon: Play,           description: 'Envío de comandos al inversor (cos φ, Q, P_max, modo) — stub hasta credenciales OEM.' },
  };
  const meta = TAB_META[tab];

  const totalDevices = devices.length;
  const gatewayTotal = gatewaySlices.reduce((s, x) => s + x.value, 0);
  const gatewayOnline = gatewaySlices.find((s) => s.label === 'En Línea')?.value ?? 0;

  return (
    <>
      {/* HEADER */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <BarChart3 size={24} style={{ color: 'var(--accent)' }} />
          <h1 style={{ margin: 0 }}>Dashboard</h1>
        </div>
        <p style={{ color: 'var(--text-secondary)', marginTop: 4, fontSize: '0.88rem' }}>
          Operación diaria del portafolio de 28 instalaciones solares. {totalDevices} dispositivos sincronizados desde Metrum
          {gatewayTotal > 0 && <> · <strong style={{ color: '#10b981' }}>{gatewayOnline}/{gatewayTotal}</strong> módems en línea</>}.
        </p>
      </div>

      {/* Estado de flota — 3 cards en grid coherente */}
      <div className="fleet-grid" style={{ marginBottom: 20 }}>
        <BreakdownCard title="Módems" slices={gatewaySlices} />
        <BreakdownCard title="Medidores" slices={meterSlices} />
        <BreakdownCard title="Inversores" slices={inverterSlices} />
        <style jsx>{`
          .fleet-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
          @media (max-width: 900px) { .fleet-grid { grid-template-columns: 1fr; } }
        `}</style>
      </div>

      {/* TABS — primary navigation con color por intención */}
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
      {tab === 'control' && <ControlManualTab devices={devices} />}
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
  // Corriente máxima por casa|date: undefined=no cargada, 'loading', number=A, null=sin datos
  const [maxCurrents, setMaxCurrents] = useState<Record<string, number | null | 'loading'>>({});

  // --- Estado Granular ---
  // Keys por device — cada equipo expone sus propias keys (un meter rojo tiene
  // voltageA/currentA/powerAI; un inversor tiene CenergyAE/SOC/etc.)
  const [keysByDevice, setKeysByDevice] = useState<Record<string, string[]>>({});
  const [selectedKeysByDevice, setSelectedKeysByDevice] = useState<Record<string, Set<string>>>({});
  const [keysLoading, setKeysLoading] = useState(false);
  const [keysError, setKeysError] = useState<string | null>(null);
  const [intervalLabel, setIntervalLabel] = useState<string>('1 hora');
  const [agg, setAgg] = useState<Agg>('AVG');
  // Multi-device: el usuario puede graficar varios devices a la vez en la sección granular
  const [granularDeviceIds, setGranularDeviceIds] = useState<Set<string>>(new Set());
  // Para diccionario y stats agregados de keys disponibles (union de todos los devices seleccionados)
  const allKeys = useMemo<string[]>(() => {
    const s = new Set<string>();
    for (const ks of Object.values(keysByDevice)) for (const k of ks) s.add(k);
    return Array.from(s).sort();
  }, [keysByDevice]);
  // Helper combinado: ¿hay alguna key seleccionada en cualquier device?
  const totalSelectedKeysCount = useMemo(
    () => Object.values(selectedKeysByDevice).reduce((sum, s) => sum + s.size, 0),
    [selectedKeysByDevice],
  );
  // granData ahora se indexa por deviceId → key → puntos
  const [granData, setGranData] = useState<Record<string, Record<string, { ts: number; value: string | number }[]>>>({});
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
  // 1° intento: leer daily_casa_metrics (pre-computada por /api/cron/sync, incluye imax)
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

  // Métricas calculadas por casa+día (usa pre-computada si está disponible, sino calcula en vivo)
  const casaMetrics = useMemo<CasaDayMetrics[]>(() => {
    if (casaMetricsPrecomputed) return casaMetricsPrecomputed;
    const all = computeCasaMetrics(closureRows);
    return all.filter((m) => (!startDate || m.date >= startDate) && (!endDate || m.date <= endDate));
  }, [casaMetricsPrecomputed, closureRows, startDate, endDate]);

  // Fetch corriente máxima on-demand para una fila casa+día (max de inversor y red meter)
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
  // Cuando el usuario cambia selectedDevice (en el dropdown), lo agregamos automáticamente
  // a granularDeviceIds para que la primera selección no requiera doble click.
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
        throw new Error('Rango inválido');
      }
      const preset = PRESETS.find((p) => p.label === intervalLabel)!;
      const next: Record<string, Record<string, { ts: number; value: string | number }[]>> = {};
      // Fetch en paralelo: cada device pide SU propia lista de keys (selectedKeysByDevice)
      await Promise.all(Array.from(granularDeviceIds).map(async (devId) => {
        const dev = devices.find((d) => d.id === devId);
        if (!dev) return;
        const devKeys = selectedKeysByDevice[devId];
        if (!devKeys || devKeys.size === 0) return; // este device no tiene keys seleccionadas, skip
        // Expandir keys derivadas a sus dependencias antes de pedir a Metrum
        // (las keys virtuales como Ppv_estimado se calculan después en chartData).
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
          console.error('granular fetch fail for', dev.name, json.error);
          return;
        }
        next[devId] = json.raw ?? {};
      }));
      setGranData(next);
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

  // Load granular keys cuando cambia la selección de devices.
  // Trae las keys solo para los devices que aún no tenemos cacheados, y elimina
  // del cache los que ya no están seleccionados. Cada device pide sus keys
  // específicas (un meter rojo y un inversor exponen variables muy distintas).
  useEffect(() => {
    const currentIds = Array.from(granularDeviceIds);
    // Limpiar cache de devices que ya no están seleccionados
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

    // Cargar keys para devices nuevos en la selección
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
  // Series compuesta = `${deviceShortName} · ${key}` para distinguir varias casas en una sola gráfica
  const granularDevicesMeta = useMemo(() => {
    return Array.from(granularDeviceIds)
      .map((id) => devices.find((d) => d.id === id))
      .filter((d): d is NonNullable<typeof d> => Boolean(d));
  }, [granularDeviceIds, devices]);

  // Construye una etiqueta corta que identifica el equipo dentro de la casa:
  //   - Medidor red → "Medidor RED"
  //   - Medidor solar → "Medidor SOLAR"
  //   - Inversor → "Inv <marca> <últimos 6 del serial>" (ej. "Inv LIVOLTEK 290023")
  //   - Pulsar (gateway) → "Pulsar"
  //   - Otro → device.name como fallback
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
      const casa = dev.casa ?? dev.name ?? '—';
      const tag = formatDeviceTag(dev);
      const devLabel = `${casa} · ${tag}`;
      const devKeys = selectedKeysByDevice[dev.id];
      if (!devKeys) continue;
      for (const k of devKeys) {
        out.push({ key: `${dev.id}__${k}`, label: `${devLabel} · ${k}`, deviceId: dev.id, baseKey: k });
      }
    }
    return out;
  }, [granularDevicesMeta, selectedKeysByDevice]);

  // ── Multi-gráfica: el usuario puede partir las series seleccionadas
  // en N gráficas, cada una con su propio Y axis (min/max/label).
  // Gráfica 1 por default muestra TODAS las series (comportamiento previo);
  // las gráficas extras arrancan vacías y el usuario asigna series con checkboxes.
  interface ChartConfig {
    id: string;
    title: string;
    seriesIncluded: 'all' | Set<string>; // 'all' = todas las series globales (default chart 1)
    yMin?: number;
    yMax?: number;
    yLabel?: string;
  }
  const [charts, setCharts] = useState<ChartConfig[]>([
    { id: 'chart-1', title: 'Gráfica 1', seriesIncluded: 'all' },
  ]);

  const addChart = () => {
    setCharts((cur) => [
      ...cur,
      { id: `chart-${Date.now()}`, title: `Gráfica ${cur.length + 1}`, seriesIncluded: new Set<string>() },
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
    // 2) Calcular keys derivadas (virtuales) por device, donde el usuario las pidió
    //    y todas las deps existen en granData. Se inyectan al mismo row del timestamp.
    for (const [devId, selectedSet] of Object.entries(selectedKeysByDevice)) {
      for (const k of selectedSet) {
        if (!isDerivedKey(k)) continue;
        const meta = DERIVED_KEYS[k];
        const seriesKey = `${devId}__${k}`;
        for (const [, row] of byTs) {
          const vals: Record<string, number> = {};
          let allPresent = true;
          for (const dep of meta.deps) {
            const v = row[`${devId}__${dep}`];
            if (v === null || v === undefined || !Number.isFinite(v)) { allPresent = false; break; }
            vals[dep] = v;
          }
          row[seriesKey] = allPresent ? meta.compute(vals) : null;
        }
      }
    }
    return Array.from(byTs.entries()).map(([ts, vals]) => ({ ts, ...vals })).sort((a, b) => a.ts - b.ts);
  }, [granData, selectedKeysByDevice]);

  // Agregación diaria (min/avg/max) por device+key
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
            <label className="input-label">Ubicación / Ciudad</label>
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

        {/* Selector multi-device con buscador. Click para añadir/quitar. */}
        <div className="input-group" style={{ marginBottom: 0 }}>
          <label className="input-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span>Dispositivos ({granularDeviceIds.size} seleccionados)</span>
            {granularDeviceIds.size > 0 && (
              <button onClick={() => { setGranularDeviceIds(new Set()); setSelectedDevice(''); }}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '0.72rem', cursor: 'pointer', textDecoration: 'underline' }}>
                Limpiar selección
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
                    placeholder="Buscar por nombre, casa, ciudad, marca, modelo…"
                    style={{ width: '100%', paddingLeft: 30, fontSize: '0.8rem' }} />
                  {deviceSearch && (
                    <button onClick={() => setDeviceSearch('')} title="Limpiar"
                      style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1rem', padding: '2px 6px', lineHeight: 1 }}>
                      ×
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 200, overflowY: 'auto', padding: 6, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-surface)' }}>
                  {filteredDevices.length === 0 ? (
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', padding: 4 }}>Ajusta los filtros de tipo o ubicación para ver dispositivos</span>
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

      {/* Cierre Diario eliminado por petición del usuario — se conserva la lógica
          pero no se renderiza (el bloque queda gated en `false`). Se puede
          rehabilitar cambiando false → true si se necesita volver a verla. */}
      {false && (
      <>
      <VariablesDictionary
        title="Diccionario — columnas del Cierre Diario"
        keys={['generacion_wh', 'importacion_wh', 'excedentes_wh', 'demanda_wh', 'gen_dem_pct', 'exc_gen_pct', 'imp_dem_pct', 'yield_real', 'desempeno_pct', 'potencia_kw', 'imax_a']}
      />
      <div className="glass-panel" style={{ padding: 0 }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div>
            <h2 className="card-title">Cierre Diario por Casa</h2>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Yield teórico ref.: {YIELD_TEORICO_REF} kWh/kWp/día (Cali) · {casaMetrics.length} filas
            </span>
          </div>
          <button
            className="secondary-btn"
            onClick={() => {
              const headers = ['Fecha', 'Casa', 'Generación (Wh)', 'Importación (Wh)', 'Excedentes (Wh)', 'Demanda Día (Wh)', 'Gen/Dem (%)', 'Exc/Gen (%)', 'Imp/Dem (%)', 'Yield Real (kWh/kWp)', 'Desempeño (%)', 'Imáx (A)'];
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
                <th title="Generación = ΔCenergyAE del inversor">Generación</th>
                <th title="Importación de red = ΔCenergyAI del medidor rojo">Importación</th>
                <th title="Excedentes a red = ΔCenergyAE del medidor rojo">Excedentes</th>
                <th title="Demanda Día = Generación + Importación − Excedentes">Demanda Día</th>
                <th title="Generación / Demanda">Gen/Dem</th>
                <th title="Excedentes / Generación">Exc/Gen</th>
                <th title="Importación / Demanda">Imp/Dem</th>
                <th title="Yield Real = Generación / Potencia instalada (kWh/kWp)">Yield Real</th>
                <th title={`Desempeño (PR) = Yield Real / ${YIELD_TEORICO_REF} × 100`}>Desempeño</th>
                <th title="Corriente Máxima del día (MAX inversor + red meter)">Imáx</th>
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
                          <span style={{ color: 'var(--text-muted)' }}>—</span>
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

      {/* ===== SECCIÓN: GRANULAR (única vista ahora) ===== */}
      {true && (
      <>
      {allKeys.length > 0 && <VariablesDictionary title="Diccionario — keys de Metrum disponibles" keys={allKeys} />}
      <div className="glass-panel">
        <div className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Activity size={18} style={{ color: 'var(--text-secondary)' }} />
            <h2 className="card-title">Vista Granular {!selectedMetrumId && <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 400 }}>— selecciona un dispositivo arriba</span>}</h2>
          </div>
          <button
            className="primary-btn"
            onClick={fetchGranular}
            disabled={granLoading || granularDeviceIds.size === 0 || totalSelectedKeysCount === 0}
          >
            <Play size={14} /> {granLoading ? 'Cargando...' : 'Consultar'}
          </button>
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
              {intervalLabel !== 'Crudo' && (
                <div>
                  <label className="input-label" style={{ display: 'block', marginBottom: '8px' }}>Agregación</label>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    {(['AVG', 'MIN', 'MAX', 'SUM'] as Agg[]).map((a) => (
                      <button key={a} onClick={() => setAgg(a)} className={`chip ${agg === a ? 'active' : ''}`}>{a}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Keys disponibles AGRUPADAS POR DEVICE — cada equipo expone sus propias variables */}
            <div style={{ marginBottom: '16px' }}>
              <label className="input-label" style={{ display: 'block', marginBottom: '8px' }}>
                Keys disponibles por dispositivo {totalSelectedKeysCount > 0 && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({totalSelectedKeysCount} seleccionadas en total)</span>}
              </label>
              {keysLoading && <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Cargando keys...</p>}
              {keysError && <div className="alert-error">{keysError}</div>}
              {granularDevicesMeta.length === 0 && !keysLoading && (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Selecciona uno o más dispositivos arriba para ver sus keys.</p>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {granularDevicesMeta.map((dev) => {
                  const rawKeys = keysByDevice[dev.id] ?? [];
                  const rawKeySet = new Set(rawKeys);
                  // Inyectar keys derivadas que aplican a este device si todas sus deps existen
                  const isInv = (dev.type ?? '').toLowerCase() === 'inverter';
                  const derivedAvailable = DERIVED_KEY_LIST.filter((dk) => {
                    const meta = DERIVED_KEYS[dk];
                    if (meta.appliesToInverter && !isInv) return false;
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
                            ({devKeys.length} keys · {devSelected.size} seleccionadas)
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
                          {keysLoading ? 'Cargando…' : 'Este dispositivo no expone keys de timeseries.'}
                        </p>
                      ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, maxHeight: 140, overflowY: 'auto' }}>
                          {devKeys.map((k) => {
                            const derived = isDerivedKey(k);
                            return (
                              <button key={k} onClick={() => toggleDeviceKey(dev.id, k)}
                                className={`chip ${devSelected.has(k) ? 'active' : ''}`}
                                title={derived ? 'Key calculada (estimación, no medición directa)' : undefined}
                                style={{
                                  fontSize: '0.72rem',
                                  fontStyle: derived ? 'italic' : undefined,
                                  borderLeft: derived ? '3px solid #f59e0b' : undefined,
                                }}>
                                {derived ? `ƒ ${k}` : k}
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

            {chartData.length > 0 && (
              <>
                {charts.map((cfg, chartIdx) => {
                  const series = chartSeriesFor(cfg);
                  const isFirst = chartIdx === 0;
                  return (
                    <div key={cfg.id} className="glass-panel" style={{ padding: 12, marginBottom: 12 }}>
                      {/* Header de la gráfica: título editable, controles Y axis, botón eliminar */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                        <input
                          value={cfg.title}
                          onChange={(e) => updateChart(cfg.id, { title: e.target.value })}
                          style={{ fontWeight: 700, fontSize: '0.92rem', maxWidth: 220, padding: '4px 8px' }}
                        />
                        <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                          {series.length} serie{series.length === 1 ? '' : 's'}
                        </span>
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
                              title="Eliminar gráfica"
                              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: '1rem', padding: '0 6px' }}>
                              ×
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Selector de series — click en un chip prende/apaga esa serie en esta gráfica */}
                      {seriesKeys.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8, padding: '6px 8px', background: 'var(--bg-elevated)', borderRadius: 6, alignItems: 'center' }}>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginRight: 4 }}>Series:</span>
                          <button
                            onClick={() => updateChart(cfg.id, { seriesIncluded: 'all' })}
                            className={`chip ${cfg.seriesIncluded === 'all' ? 'active' : ''}`}
                            style={{ fontSize: '0.68rem', padding: '2px 8px' }}
                            title="Mostrar todas las series seleccionadas en esta gráfica"
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
                          Sin series asignadas a esta gráfica
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
                                label={cfg.yLabel ? { value: cfg.yLabel, angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: 'var(--text-muted)' } } : undefined}
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
                              {isFirst && (
                                <Brush dataKey="ts" height={28} stroke="#07c5a8" fill="rgba(7,197,168,0.08)"
                                  travellerWidth={10}
                                  tickFormatter={(v) => new Date(v).toLocaleDateString('es-CO', { month: 'short', day: '2-digit' })} />
                              )}
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Botón para agregar más gráficas */}
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
                  <button onClick={addChart} className="secondary-btn" style={{ fontSize: '0.82rem' }}>
                    + Nueva gráfica
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, flexWrap: 'wrap', gap: 10 }}>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                    {chartData.length} puntos · {dailyData.length} día{dailyData.length === 1 ? '' : 's'} · Hover sobre el chart para ver valores · arrastra los bordes del mini-eje inferior para zoom
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
                        }}>Por día</button>
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
                    <div style={{ overflowX: 'auto', maxHeight: 380 }}>
                      <table style={{ width: '100%', fontSize: '0.78rem' }}>
                        <thead>
                          <tr>
                            <th style={{ position: 'sticky', top: 0, background: 'var(--bg-elevated)', textAlign: 'left' }}>Día</th>
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
                                const fmt = (n: number | null) => n === null ? '—' : n.toLocaleString('es-CO', { maximumFractionDigits: 2 });
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
                                    {r[s.key] === null || r[s.key] === undefined ? '—' : Number(r[s.key]).toLocaleString('es-CO', { maximumFractionDigits: 3 })}
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

// Definición de columnas tal como el Excel "Lecturas y consumos mayo"
type Col = { key: keyof ConsumptionRow; label: string; group: string; format?: 'num' | 'pct' | 'int' | 'bool' | 'txt' };
const COLS: Col[] = [
  { key: 'dia_consumo',     label: 'dia_consumo',     group: 'Identificación', format: 'txt' },
  { key: 'fecha_telemetria', label: 'fecha_telemetria', group: 'Identificación', format: 'txt' },

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
  'Identificación': 'var(--bg-elevated)',
  'Meter Solar':    'rgba(245, 158, 11, 0.08)',
  'Meter Red':      'rgba(59, 130, 246, 0.08)',
  'Inverter':       'rgba(7, 197, 168, 0.08)',
  'Battery':        'rgba(139, 92, 246, 0.08)',
  'Derivadas':      'rgba(16, 185, 129, 0.08)',
};

const fmtCell = (v: unknown, format?: Col['format']): string => {
  if (v === null || v === undefined) return '—';
  if (format === 'bool') return v ? 'true' : 'false';
  if (format === 'txt') return String(v);
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (format === 'pct') return (n * 100).toFixed(2) + '%';
  if (format === 'int') return n.toFixed(0);
  return n.toLocaleString('es-CO');
};

// Variables numéricas del daily_consumption para graficar (excluye txt/bool)
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

  // Para Gráficas: multi-select casas + multi-select variables
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

  // Construir chartData: [{ dia_consumo, 'Casa 2 · eai_meter_solar': 123, ... }]
  const chartSeries = useMemo(() => {
    const series: Array<{ key: string; casa: string; variable: string; label: string }> = [];
    for (const casa of chartCasas) {
      for (const v of chartVars) {
        const meta = COLS.find((c) => c.key === v);
        series.push({ key: `${casa}__${v}`, casa, variable: v, label: `${casa} · ${meta?.label ?? v}` });
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
      {/* ───── Filtros compartidos ───── */}
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
                <option key={h.id} value={h.id}>{h.casa}{h.location ? ` — ${h.location}` : ''}{h.city ? ` (${h.city})` : ''}</option>
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
        <button onClick={() => setSubTab('graficas')} className={`tab ${subTab === 'graficas' ? 'active' : ''}`}>Gráficas</button>
      </div>

      {/* ═══════ SUB-TAB: TABLA ═══════ */}
      {subTab === 'tabla' && (
        <>
          {!loading && rows.length === 0 && (
            <div className="alert-warning" style={{ fontSize: '0.85rem' }}>
              <strong>Sin consumo cargado.</strong> Usa <em>Sincronizar Metrum</em> en el header para traer la telemetría diaria.
            </div>
          )}

          {rows.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', color: 'var(--text-muted)', flexWrap: 'wrap', gap: 8 }}>
              <span>{rows.length} filas · scroll horizontal para ver todas las columnas</span>
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
                    <tr><td colSpan={COLS.length + 2} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>—</td></tr>
                  ) : (
                    rows.map((r) => (
                      <tr key={r.id}>
                        <td style={{ position: 'sticky', left: 0, zIndex: 10, background: 'var(--bg-surface)', fontWeight: 600, borderRight: '2px solid var(--border)', borderBottom: '1px solid var(--border)', padding: '6px 10px', minWidth: 120 }}>
                          {r.client_houses?.casa ?? '—'}
                        </td>
                        <td style={{ background: 'var(--bg-surface)', fontFamily: 'ui-monospace, monospace', fontSize: '0.7rem', color: 'var(--text-muted)', borderRight: '2px solid var(--border)', borderBottom: '1px solid var(--border)', padding: '6px 10px' }}>
                          {r.client_houses?.cliente_id?.slice(0, 12) ?? '—'}…
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

      {/* ═══════ SUB-TAB: GRÁFICAS ═══════ */}
      {subTab === 'graficas' && (
        <>
          <div className="glass-panel">
            <div style={{ marginBottom: 14 }}>
              <label className="input-label" style={{ display: 'block', marginBottom: 8 }}>
                Casas a comparar <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({chartCasas.size} seleccionadas — máx 6 recomendado)</span>
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
                  {chartSeries.length} serie{chartSeries.length !== 1 ? 's' : ''} · {chartData.length} días
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

/* ---------------- TAB: NAR (Notificaciones, Alertas y Recomendaciones) ---------------- */

interface AlertEventRow {
  id: string;
  casa: string;
  record_date: string;
  variable: string;
  value: number;
  threshold: number;
  operator: string;
  severity: 'high' | 'medium' | 'low';
  message: string;
  fired_at: string;
  acknowledged: boolean;
  alert_rules: { name: string; description: string | null } | null;
}

const SEV_META: Record<string, { label: string; color: string }> = {
  high: { label: 'Alto', color: '#ef4444' },
  medium: { label: 'Medio', color: '#f59e0b' },
  low: { label: 'Bajo', color: '#3b82f6' },
};

type NarSub = 'notificaciones' | 'alertas' | 'recomendaciones';

const NAR_SUB_META: Record<NarSub, { label: string; color: string; icon: typeof Bell; description: string }> = {
  notificaciones: { label: 'Notificaciones', color: '#3b82f6', icon: Info, description: 'Eventos informativos (severidad baja).' },
  alertas:        { label: 'Alertas',        color: '#ef4444', icon: AlertCircle, description: 'Eventos accionables (severidad media o alta).' },
  recomendaciones:{ label: 'Recomendaciones', color: '#10b981', icon: Lightbulb, description: 'Sugerencias derivadas del patrón: ajustes, visitas, control reactiva.' },
};

const opSymbolNar = (op: string) => ({ gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=' }[op] ?? op);


interface TopAlertRow {
  rule_id: string;
  casa: string;
  rule_name: string;
  variable: string | null;
  severity: 'high' | 'medium' | 'low';
  count: number;
  last_fired_at: string;
  first_fired_at: string;
}

function NarTab() {
  const [events, setEvents] = useState<AlertEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sub, setSub] = useState<NarSub>('alertas');

  // Top alerts (para "Recomendaciones" y para banda de info)
  const [topAlerts, setTopAlerts] = useState<TopAlertRow[]>([]);
  const [topLoading, setTopLoading] = useState(true);
  const [topDays, setTopDays] = useState<1 | 7 | 30>(7);

  const load = async () => {
    setLoading(true);
    const r = await fetch('/api/alerts/events?acknowledged=false');
    const j = await r.json();
    setEvents(j.events ?? []);
    setLoading(false);
  };

  const loadTop = async () => {
    setTopLoading(true);
    const r = await fetch(`/api/alerts/top?days=${topDays}&limit=100`);
    const j = await r.json();
    setTopAlerts(j.items ?? []);
    setTopLoading(false);
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { loadTop(); }, [topDays]);

  // ── Separar por sección NAR
  const notiEvents  = useMemo(() => events.filter((e) => e.severity === 'low'), [events]);
  const alertEvents = useMemo(() => events.filter((e) => e.severity === 'high' || e.severity === 'medium'), [events]);

  // Conteos por severidad (total no-ack)
  const totals = useMemo(() => {
    const t = { high: 0, medium: 0, low: 0 };
    for (const ev of events) t[ev.severity]++;
    return t;
  }, [events]);

  // ── Recomendaciones derivadas de topAlerts
  type Reco = { id: string; kind: 'tune' | 'visit' | 'reactiva'; title: string; body: string; sev: 'high' | 'medium' | 'low'; details?: string };
  const recommendations = useMemo<Reco[]>(() => {
    const out: Reco[] = [];
    const repeated = topAlerts.filter((t) => t.count >= 3);
    const byCasaMap = new Map<string, TopAlertRow[]>();
    for (const r of repeated) {
      if (!byCasaMap.has(r.casa)) byCasaMap.set(r.casa, []);
      byCasaMap.get(r.casa)!.push(r);
    }
    for (const [casa, list] of byCasaMap.entries()) {
      const total = list.reduce((s, r) => s + r.count, 0);
      const top = list[0];
      const sev: 'high' | 'medium' = list.some((r) => r.severity === 'high') ? 'high' : 'medium';
      out.push({
        id: `rep-${casa}`,
        kind: total >= 10 ? 'visit' : 'tune',
        title: `${casa} — ${total} disparos en ${topDays === 1 ? '24h' : `${topDays} días`}`,
        body: total >= 10
          ? `Recurrencia muy alta. Recomendamos visita en sitio. Regla principal: «${top.rule_name}» (${top.count}× ${top.severity}).`
          : `Las reglas están disparándose con frecuencia. Revisa umbral o sitio. Regla: «${top.rule_name}» (${top.count}× ${top.severity}).`,
        sev,
        details: list.map((r) => `· ${r.rule_name} (${r.count}× ${r.severity})`).join('\n'),
      });
    }

    // Reactiva CREG activa
    const reactiveActive = events.some((e) => {
      const cat = findVariableMeta(e.variable)?.category;
      return cat === 'reactiva' && (e.severity === 'high' || e.severity === 'medium');
    });
    if (reactiveActive) {
      out.push({
        id: 'reactiva',
        kind: 'reactiva',
        title: 'Penalización CREG activa',
        body: 'Hay casas con reactiva fuera de rango. Considera enviar comando set_power_factor=0.95 desde "Control Manual Inversor".',
        sev: 'high',
      });
    }
    return out.sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.sev] - { high: 0, medium: 1, low: 2 }[b.sev]));
  }, [topAlerts, events, topDays]);

  return (
    <>
      {/* Banda de resumen — 3 cards severidad + sub-pills */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        {(['high','medium','low'] as const).map((sev) => (
          <div key={sev} className="glass-panel" style={{ flex: '1 1 160px', padding: '12px 16px' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{SEV_META[sev].label}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: SEV_META[sev].color }} />
              <span style={{ fontSize: '1.5rem', fontWeight: 700 }}>{totals[sev]}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Sub-pills NAR */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {(Object.keys(NAR_SUB_META) as NarSub[]).map((k) => {
          const m = NAR_SUB_META[k];
          const Icon = m.icon;
          const count = k === 'notificaciones' ? notiEvents.length : k === 'alertas' ? alertEvents.length : recommendations.length;
          return (
            <button key={k} onClick={() => setSub(k)} className={`chip ${sub === k ? 'active' : ''}`}
              style={{ fontSize: '0.82rem', padding: '8px 12px', borderLeft: `3px solid ${m.color}`, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon size={13} /> {m.label} <span style={{ opacity: 0.7 }}>({count})</span>
            </button>
          );
        })}
      </div>

      <div className="glass-panel" style={{ padding: 10, borderLeft: `3px solid ${NAR_SUB_META[sub].color}`, marginBottom: 14 }}>
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{NAR_SUB_META[sub].description}</p>
      </div>

      {/* CONTENIDO */}
      {(sub === 'notificaciones' || sub === 'alertas') && (
        <NarEventsList
          events={sub === 'notificaciones' ? notiEvents : alertEvents}
          loading={loading}
          onAck={load}
          emptyText={sub === 'notificaciones'
            ? 'No hay notificaciones pendientes.'
            : '✓ Ninguna alerta activa. El sistema está operando dentro de los umbrales configurados.'}
          kind={sub}
        />
      )}

      {sub === 'recomendaciones' && (
        <div>
          {/* Selector ventana temporal */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, justifyContent: 'flex-end' }}>
            <button className={`chip ${topDays === 1 ? 'active' : ''}`} onClick={() => setTopDays(1)}>24 h</button>
            <button className={`chip ${topDays === 7 ? 'active' : ''}`} onClick={() => setTopDays(7)}>7 días</button>
            <button className={`chip ${topDays === 30 ? 'active' : ''}`} onClick={() => setTopDays(30)}>30 días</button>
          </div>

          {topLoading ? (
            <div className="glass-panel" style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Cargando…</div>
          ) : recommendations.length === 0 ? (
            <div className="alert-success" style={{ fontSize: '0.85rem' }}>
              ✓ No hay recomendaciones nuevas. La operación está estable.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {recommendations.map((r) => {
                const sm = SEV_META[r.sev];
                return (
                  <div key={r.id} className="glass-panel" style={{ padding: '12px 16px', borderLeft: `4px solid ${sm.color}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                      <span style={{ padding: '2px 8px', borderRadius: 8, background: sm.color + '20', color: sm.color, fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        {r.kind === 'tune' ? 'Ajustar umbral' : r.kind === 'visit' ? 'Visita técnica' : 'Control reactiva'}
                      </span>
                      <strong style={{ fontSize: '0.92rem' }}>{r.title}</strong>
                    </div>
                    <p style={{ margin: '4px 0', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>{r.body}</p>
                    {r.details && (
                      <pre style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: '0.72rem', fontFamily: 'ui-monospace, monospace', color: 'var(--text-muted)', margin: '4px 0 0', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{r.details}</pre>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Tabla cruda de alertas más frecuentes — sigue siendo útil como referencia */}
          <div className="glass-panel" style={{ padding: 14, marginTop: 14 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: '0.95rem' }}>Alertas más frecuentes (datos crudos)</h3>
            <p style={{ margin: '0 0 10px', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
              Conteo por regla y casa en los últimos {topDays === 1 ? '24 h' : `${topDays} días`}.
            </p>
            {topAlerts.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Sin datos en la ventana.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: '0.8rem' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      <th style={{ padding: '6px 8px', width: 60 }}>Sev</th>
                      <th style={{ padding: '6px 8px' }}>Casa</th>
                      <th style={{ padding: '6px 8px' }}>Regla</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right' }}>Eventos</th>
                      <th style={{ padding: '6px 8px' }}>Última</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topAlerts.slice(0, 20).map((row) => {
                      const sev = SEV_META[row.severity];
                      const isRep = row.count >= 3;
                      return (
                        <tr key={`${row.rule_id}|${row.casa}`} style={{ borderTop: '1px solid var(--border)', background: isRep ? sev.color + '08' : undefined }}>
                          <td style={{ padding: '6px 8px' }}>
                            <span style={{ padding: '2px 8px', borderRadius: 8, background: sev.color + '20', color: sev.color, fontSize: '0.68rem', fontWeight: 700 }}>{sev.label}</span>
                          </td>
                          <td style={{ padding: '6px 8px', fontWeight: 600 }}>{row.casa}</td>
                          <td style={{ padding: '6px 8px' }}>{row.rule_name}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: isRep ? sev.color : 'var(--text-primary)' }}>
                            {row.count}{isRep && '×'}
                          </td>
                          <td style={{ padding: '6px 8px', fontSize: '0.72rem', color: 'var(--text-secondary)', fontFamily: 'ui-monospace, monospace' }}>
                            {new Date(row.last_fired_at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/* Reusable list de eventos agrupados por casa para NAR */
function NarEventsList({ events, loading, onAck, emptyText, kind }: {
  events: AlertEventRow[]; loading: boolean; onAck: () => void; emptyText: string;
  kind: 'notificaciones' | 'alertas';
}) {
  const byCasa = useMemo(() => {
    const m = new Map<string, AlertEventRow[]>();
    for (const ev of events) {
      if (!m.has(ev.casa)) m.set(ev.casa, []);
      m.get(ev.casa)!.push(ev);
    }
    return Array.from(m.entries()).sort((a, b) => {
      const sa = a[1].filter((e) => e.severity === 'high').length;
      const sb = b[1].filter((e) => e.severity === 'high').length;
      if (sa !== sb) return sb - sa;
      return b[1].length - a[1].length;
    });
  }, [events]);

  if (loading) return <div className="glass-panel" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>Cargando…</div>;
  if (byCasa.length === 0) {
    return <div className={kind === 'alertas' ? 'alert-success' : 'glass-panel'} style={{ fontSize: '0.85rem', padding: kind === 'alertas' ? undefined : 20, textAlign: kind === 'notificaciones' ? 'center' : undefined, color: kind === 'notificaciones' ? 'var(--text-muted)' : undefined }}>{emptyText}</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {byCasa.map(([casa, list]) => {
        const high = list.filter((e) => e.severity === 'high').length;
        const med = list.filter((e) => e.severity === 'medium').length;
        const low = list.filter((e) => e.severity === 'low').length;
        const topSev = high > 0 ? 'high' : med > 0 ? 'medium' : 'low';
        return (
          <div key={casa} className="glass-panel" style={{ padding: '14px 20px', borderLeft: `4px solid ${SEV_META[topSev].color}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: '1rem' }}>{casa}</h3>
              <div style={{ display: 'flex', gap: 6, fontSize: '0.75rem' }}>
                {high > 0 && <span style={{ padding: '2px 8px', borderRadius: 8, background: SEV_META.high.color + '20', color: SEV_META.high.color, fontWeight: 600 }}>{high} alto</span>}
                {med > 0 && <span style={{ padding: '2px 8px', borderRadius: 8, background: SEV_META.medium.color + '20', color: SEV_META.medium.color, fontWeight: 600 }}>{med} medio</span>}
                {low > 0 && <span style={{ padding: '2px 8px', borderRadius: 8, background: SEV_META.low.color + '20', color: SEV_META.low.color, fontWeight: 600 }}>{low} bajo</span>}
              </div>
            </div>
            <table style={{ width: '100%', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ padding: '4px 8px' }}>Fecha</th>
                  <th style={{ padding: '4px 8px' }}>Regla</th>
                  <th style={{ padding: '4px 8px' }}>Variable</th>
                  <th style={{ padding: '4px 8px' }}>Lectura</th>
                  <th style={{ padding: '4px 8px' }}>Umbral</th>
                  <th style={{ padding: '4px 8px' }}></th>
                </tr>
              </thead>
              <tbody>
                {list.map((ev) => {
                  const meta = findVariableMeta(ev.variable);
                  const catMeta = meta ? ALERT_CATEGORIES[meta.category] : null;
                  return (
                    <tr key={ev.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace', fontSize: '0.74rem' }}>{ev.record_date}</td>
                      <td style={{ padding: '6px 8px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                            {catMeta && <span style={{ fontSize: '0.68rem', padding: '1px 6px', borderRadius: 8, background: catMeta.color + '20', color: catMeta.color, fontWeight: 600 }}>{catMeta.icon}</span>}
                            <strong style={{ fontSize: '0.82rem' }}>{ev.alert_rules?.name ?? ev.variable}</strong>
                          </span>
                          {ev.alert_rules?.description && (
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{ev.alert_rules.description}</span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '6px 8px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{meta?.label ?? ev.variable}</td>
                      <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem', fontWeight: 600 }}>{formatValue(Number(ev.value), ev.variable)}</td>
                      <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace', fontSize: '0.74rem', color: 'var(--text-muted)' }}>{opSymbolNar(ev.operator)} {formatValue(Number(ev.threshold), ev.variable)}</td>
                      <td style={{ padding: '6px 8px' }}>
                        <button
                          onClick={async () => { await fetch('/api/alerts/events', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: ev.id, acknowledged: true }) }); onAck(); }}
                          style={{ fontSize: '0.7rem', padding: '2px 8px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-elevated)', cursor: 'pointer' }}
                        >
                          {kind === 'alertas' ? 'Resolver' : 'OK'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- TAB: Control Manual Inversor ---------------- */

interface InverterCommand {
  id: string;
  casa: string;
  inverter_name: string;
  marca: string;
  modelo: string;
  action: string;
  target_value: number;
  target_unit: string;
  cos_phi_at_send: number | null;
  status: 'pending' | 'sent' | 'success' | 'failed' | 'mocked';
  error_message: string | null;
  sent_by: string;
  sent_at: string;
  response_payload: Record<string, unknown> | null;
}

const CONTROL_ACTIONS: Array<{ key: string; label: string; unit: string; min: number; max: number; step: number; help: string }> = [
  { key: 'set_power_factor',       label: 'Setear factor de potencia (cos φ)', unit: 'cos φ',   min: 0.80, max: 1.00, step: 0.01, help: 'Valor entre 0.80 y 1.00. La regla CREG exige ≥ 0.9. Recomendado: 0.95 para tener margen.' },
  { key: 'set_reactive_power',     label: 'Setear potencia reactiva (Q)',       unit: 'kvar',    min: -10,  max: 10,   step: 0.5,  help: 'Negativo = capacitiva, positivo = inductiva. Cuidado: reactiva alta reduce capacidad de activa.' },
  { key: 'set_active_power_limit', label: 'Limitar potencia activa (P)',        unit: 'kW',      min: 0,    max: 15,   step: 0.5,  help: 'Tope de generación. Útil para evitar exportar más de lo permitido.' },
  { key: 'set_work_mode',          label: 'Cambiar modo de operación',          unit: 'modo',    min: 0,    max: 5,    step: 1,    help: '0=Auto, 1=Self-consumption, 2=Selling First, 3=Off-grid, 4=Backup, 5=PF Priority. Depende del fabricante.' },
];

function ControlManualTab({ devices }: { devices: DeviceOption[] }) {
  const inverters = useMemo(() =>
    devices
      .filter((d) => classifyDevice(d) === 'inverter')
      .sort((a, b) => (a.casa ?? '').localeCompare(b.casa ?? '')),
    [devices]);

  const [selectedInverterId, setSelectedInverterId] = useState<string>('');
  const [action, setAction] = useState<string>('set_power_factor');
  const [value, setValue] = useState<string>('0.95');
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [history, setHistory] = useState<InverterCommand[]>([]);
  const [instantStatus, setInstantStatus] = useState<{ cos_phi_now: number | null; power_active_w: number | null; power_reactive_var: number | null } | null>(null);

  const selectedInverter = inverters.find((d) => d.id === selectedInverterId);
  const actionMeta = CONTROL_ACTIONS.find((a) => a.key === action)!;

  const loadHistory = async () => {
    const url = selectedInverter?.casa
      ? `/api/inverter/command?casa=${encodeURIComponent(selectedInverter.casa)}&limit=30`
      : '/api/inverter/command?limit=30';
    const r = await fetch(url);
    const j = await r.json();
    setHistory(j.commands ?? []);
  };

  // Cargar estado instant_metrics del inversor seleccionado
  useEffect(() => {
    if (!selectedInverter?.casa) { setInstantStatus(null); return; }
    (async () => {
      const { data } = await supabase
        .from('instant_metrics')
        .select('cos_phi_now, power_active_w, power_reactive_var, recorded_at')
        .eq('casa', selectedInverter.casa)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      setInstantStatus(data ?? null);
    })();
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInverterId]);

  useEffect(() => { loadHistory(); /* eslint-disable-next-line */ }, []);

  const sendCommand = async () => {
    if (!selectedInverterId) { setMsg({ kind: 'error', text: 'Selecciona un inversor primero' }); return; }
    const n = Number(value);
    if (!Number.isFinite(n)) { setMsg({ kind: 'error', text: 'Valor inválido' }); return; }
    if (n < actionMeta.min || n > actionMeta.max) {
      setMsg({ kind: 'error', text: `Valor fuera de rango (${actionMeta.min} a ${actionMeta.max} ${actionMeta.unit})` });
      return;
    }
    const confirmMsg = `¿Enviar "${actionMeta.label}" con valor ${n} ${actionMeta.unit} al inversor ${selectedInverter?.name} (${selectedInverter?.casa})?\n\nNota: hoy el comando se REGISTRA pero NO se envía al fabricante (faltan credenciales OEM).`;
    if (!confirm(confirmMsg)) return;
    setSending(true);
    setMsg(null);
    try {
      const r = await fetch('/api/inverter/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inverter_id: selectedInverterId, action, value: n, sent_by: 'manual-ui' }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Error');
      const status = j.status as string;
      setMsg({
        kind: status === 'mocked' ? 'info' : status === 'success' ? 'success' : 'error',
        text: status === 'mocked'
          ? `📋 Comando registrado en auditoría (status: mocked). ${j.hint ?? ''}`
          : `Comando ${status}.`,
      });
      await loadHistory();
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Error' });
    } finally {
      setSending(false);
    }
  };

  const statusColor = (s: string) => ({ success: '#10b981', sent: '#3b82f6', mocked: '#f59e0b', failed: '#ef4444', pending: '#94a3b8' }[s] ?? '#94a3b8');

  return (
    <>
      {/* Alerta de estado credenciales */}
      <div className="alert-warning" style={{ fontSize: '0.85rem' }}>
        ⚠️ <strong>Modo simulación.</strong> Los comandos se guardan en auditoría pero <strong>NO se envían</strong> al inversor — faltan credenciales OEM (LIVOLTEK_API_KEY o DEYE_CLIENT_ID/SECRET en Vercel). Cuando estén configuradas, el endpoint envía al fabricante automáticamente.
      </div>

      {/* Selector + estado */}
      <div className="glass-panel">
        <h3 style={{ margin: 0, marginBottom: 14, fontSize: '1rem' }}>🎛️ Selector de inversor</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label">Inversor a controlar</label>
            <select value={selectedInverterId} onChange={(e) => setSelectedInverterId(e.target.value)}>
              <option value="">— Selecciona un inversor —</option>
              {inverters.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.casa ?? '?'} · {d.name} ({d.marca ?? '?'} {d.modelo ?? ''})
                </option>
              ))}
            </select>
          </div>

          {selectedInverter && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, padding: 14, background: 'var(--bg-elevated)', borderRadius: 10 }}>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Marca / Modelo</div>
                <div style={{ fontSize: '0.95rem', fontWeight: 600, marginTop: 4 }}>{selectedInverter.marca ?? '—'}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{selectedInverter.modelo ?? '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Potencia</div>
                <div style={{ fontSize: '0.95rem', fontWeight: 600, marginTop: 4 }}>{selectedInverter.potencia_kw ?? '—'} kW</div>
              </div>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>cos φ ahora</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 700, marginTop: 4, color: (instantStatus?.cos_phi_now ?? 1) < 0.9 ? '#ef4444' : 'var(--text-primary)' }}>
                  {instantStatus?.cos_phi_now != null ? instantStatus.cos_phi_now.toFixed(3) : '—'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>P activa</div>
                <div style={{ fontSize: '0.95rem', fontWeight: 600, marginTop: 4 }}>{instantStatus?.power_active_w != null ? (instantStatus.power_active_w / 1000).toFixed(2) + ' kW' : '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Q reactiva</div>
                <div style={{ fontSize: '0.95rem', fontWeight: 600, marginTop: 4 }}>{instantStatus?.power_reactive_var != null ? (instantStatus.power_reactive_var / 1000).toFixed(2) + ' kvar' : '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Estado</div>
                <div style={{ fontSize: '0.95rem', fontWeight: 600, marginTop: 4, color: selectedInverter.is_active === false ? '#ef4444' : '#10b981' }}>
                  {selectedInverter.is_active === false ? 'Sin Conexión' : 'En Línea'}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Form de comando */}
      <div className="glass-panel">
        <h3 style={{ margin: 0, marginBottom: 14, fontSize: '1rem' }}>📤 Enviar comando</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div className="input-group" style={{ marginBottom: 0, gridColumn: 'span 2' }}>
            <label className="input-label">Acción</label>
            <select value={action} onChange={(e) => { setAction(e.target.value); const a = CONTROL_ACTIONS.find((x) => x.key === e.target.value); if (a) setValue(((a.min + a.max) / 2).toFixed(2)); }}>
              {CONTROL_ACTIONS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
            <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.45 }}>💡 {actionMeta.help}</p>
          </div>
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label">Valor ({actionMeta.unit})</label>
            <input
              type="number"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              min={actionMeta.min}
              max={actionMeta.max}
              step={actionMeta.step}
              placeholder={`${actionMeta.min} a ${actionMeta.max}`}
            />
          </div>
          <div className="input-group" style={{ marginBottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
            <button className="primary-btn" onClick={sendCommand} disabled={sending || !selectedInverterId} style={{ width: '100%', justifyContent: 'center', padding: '10px' }}>
              {sending ? 'Enviando...' : '📤 Enviar comando'}
            </button>
          </div>
        </div>

        {msg && (
          <div className={msg.kind === 'success' ? 'alert-success' : msg.kind === 'error' ? 'alert-error' : 'alert-warning'} style={{ marginTop: 12, fontSize: '0.82rem' }}>
            {msg.text}
          </div>
        )}
      </div>

      {/* Historial de comandos */}
      <div className="glass-panel" style={{ padding: 0 }}>
        <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ margin: 0, fontSize: '0.95rem' }}>
            📜 Historial de comandos
            {selectedInverter?.casa && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> — {selectedInverter.casa}</span>}
            <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.78rem' }}> · {history.length} registros</span>
          </h3>
        </div>
        <div className="table-container" style={{ border: 'none', overflowX: 'auto' }}>
          <table style={{ fontSize: '0.78rem' }}>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Casa</th>
                <th>Inversor</th>
                <th>Acción</th>
                <th>Valor</th>
                <th>cos φ al enviar</th>
                <th>Estado</th>
                <th>Por</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Sin comandos enviados todavía.</td></tr>
              ) : history.map((c) => {
                const actMeta = CONTROL_ACTIONS.find((a) => a.key === c.action);
                return (
                  <tr key={c.id}>
                    <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.72rem' }}>{new Date(c.sent_at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td><strong>{c.casa}</strong></td>
                    <td style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{c.marca} · {c.inverter_name}</td>
                    <td style={{ fontSize: '0.78rem' }}>{actMeta?.label ?? c.action}</td>
                    <td style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{c.target_value} {c.target_unit}</td>
                    <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem', color: 'var(--text-muted)' }}>{c.cos_phi_at_send?.toFixed(3) ?? '—'}</td>
                    <td>
                      <span style={{ padding: '2px 10px', borderRadius: 12, background: statusColor(c.status) + '20', color: statusColor(c.status), fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase' }}>
                        {c.status}
                      </span>
                      {c.error_message && <div style={{ fontSize: '0.7rem', color: '#ef4444', marginTop: 2 }}>{c.error_message}</div>}
                    </td>
                    <td style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{c.sent_by}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
