"use client";
import { supabase } from '@/lib/supabase';
import { useEffect, useMemo, useState } from 'react';
import { Filter, RefreshCw, Download, Activity, Play, BookOpen, ChevronDown, ChevronUp } from 'lucide-react';
import { VARIABLES, findVariable, type VariableMeta } from '@/lib/variables-dict';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import { classifyDevice } from '../page';

type Tab = 'cierres' | 'consumos' | 'alertas' | 'reactiva' | 'control';
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

const deviceLabel = (d: DeviceOption) => {
  const parts = [d.name];
  if (d.client) parts.push(`(${d.client})`);
  return parts.join(' ');
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
function VariablesDictionary({ keys, title = 'Diccionario de variables' }: { keys?: string[]; title?: string }) {
  const [open, setOpen] = useState(false);
  const list: VariableMeta[] = useMemo(() => {
    if (!keys || keys.length === 0) return VARIABLES;
    return keys.map((k) => findVariable(k)).filter(Boolean) as VariableMeta[];
  }, [keys]);

  if (list.length === 0) return null;

  return (
    <div className="glass-panel" style={{ padding: 0 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-primary)' }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.9rem', fontWeight: 600 }}>
          <BookOpen size={16} style={{ color: 'var(--accent)' }} />
          {title} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({list.length} variables)</span>
        </span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open && (
        <div style={{ borderTop: '1px solid var(--border)', overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: '0.78rem' }}>
            <thead style={{ background: 'var(--bg-elevated)' }}>
              <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                <th style={{ padding: '8px 14px' }}>Columna / UI</th>
                <th style={{ padding: '8px 14px' }}>Key Metrum</th>
                <th style={{ padding: '8px 14px' }}>Unidad</th>
                <th style={{ padding: '8px 14px' }}>Origen</th>
                <th style={{ padding: '8px 14px' }}>Categoría</th>
                <th style={{ padding: '8px 14px' }}>Descripción</th>
              </tr>
            </thead>
            <tbody>
              {list.map((v) => (
                <tr key={v.key} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 14px', fontWeight: 600 }}>{v.label}</td>
                  <td style={{ padding: '6px 14px', fontFamily: 'ui-monospace, monospace', fontSize: '0.72rem', color: 'var(--accent)' }}>{v.key}</td>
                  <td style={{ padding: '6px 14px', color: 'var(--text-secondary)' }}>{v.unit || '—'}</td>
                  <td style={{ padding: '6px 14px' }}>
                    <span style={{ fontSize: '0.68rem', padding: '1px 8px', borderRadius: 10, background: v.source === 'derived' ? '#07c5a820' : v.source === 'metrum' ? '#3b82f620' : '#94a3b820', color: v.source === 'derived' ? '#07c5a8' : v.source === 'metrum' ? '#3b82f6' : '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>
                      {v.source}
                    </span>
                  </td>
                  <td style={{ padding: '6px 14px', color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{v.category}</td>
                  <td style={{ padding: '6px 14px', color: 'var(--text-secondary)', fontSize: '0.74rem' }}>{v.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BreakdownCard({ title, slices }: { title: string; slices: Slice[] }) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  return (
    <div className="glass-panel" style={{ flex: '1 1 260px', minWidth: 260, padding: '16px 20px' }}>
      <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '12px' }}>{title}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <SliceDonut slices={slices} total={total} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
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
  const [reloading, setReloading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const loadDevices = async () => {
    setReloading(true);
    const { data, error } = await supabase
      .from('devices')
      .select('id, metrum_id, name, type, client, casa, cliente_id, location, city, marca, modelo, potencia_kw, is_active, last_seen_at')
      .order('client', { ascending: true })
      .order('name', { ascending: true });
    setReloading(false);
    if (error) {
      console.error('Error fetching devices', error);
      return;
    }
    setDevices((data ?? []) as DeviceOption[]);
  };

  // Trigger manual del cron: corre dispositivos + casas + cierres + consumo + pre-cómputo casa metrics
  const handleSyncAll = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch('/api/cron/sync', { headers: { 'x-trigger': 'manual' } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      const s = json.steps ?? {};
      const parts = [
        s.devices !== undefined && `devices: ${s.devices}`,
        s.houses !== undefined && `casas: ${s.houses}`,
        s.cierres && `cierres: ${s.cierres.inserted}/${s.cierres.total}`,
        s.consumo && `consumo: ${s.consumo.inserted}`,
        s.casa_metrics && `métricas: ${s.casa_metrics.upserted}`,
      ].filter(Boolean);
      const kind = json.status === 'success' ? 'success' : 'error';
      setSyncMsg({ kind, text: `Sync ${json.status} · ${parts.join(' · ')}${json.errors?.length ? ` · errores: ${json.errors.join(', ')}` : ''}` });
      await loadDevices();
    } catch (e) {
      setSyncMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Error' });
    } finally {
      setSyncing(false);
    }
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

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1>Dashboard</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>
            {devices.length} dispositivos registrados en Supabase.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <button className="secondary-btn" onClick={loadDevices} disabled={reloading || syncing} title="Recarga los datos desde Supabase">
            <RefreshCw size={14} /> {reloading ? 'Recargando...' : 'Recargar'}
          </button>
          <button className="primary-btn" onClick={handleSyncAll} disabled={syncing} title="Sincroniza dispositivos + cierres + consumo desde Metrum">
            <Download size={14} /> {syncing ? 'Sincronizando...' : 'Sincronizar Metrum'}
          </button>
        </div>
      </div>

      {syncMsg && (
        <div className={syncMsg.kind === 'success' ? 'alert-success' : 'alert-error'}>{syncMsg.text}</div>
      )}

      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
        <BreakdownCard title="Módems" slices={gatewaySlices} />
        <BreakdownCard title="Medidores" slices={meterSlices} />
        <BreakdownCard title="Inversores" slices={inverterSlices} />
      </div>

      <div className="tabs">
        {([
          { id: 'cierres' as const, label: 'Cierres y Granular' },
          { id: 'consumos' as const, label: 'Consumo por Dispositivo' },
          { id: 'reactiva' as const, label: 'Reactiva vs Activa (CREG)' },
          { id: 'alertas' as const, label: 'Alertas por Casa' },
          { id: 'control' as const, label: 'Control Manual Inversor' },
        ]).map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`tab ${tab === t.id ? 'active' : ''}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'cierres' && <CierresGranularTab devices={devices} />}
      {tab === 'consumos' && <ConsumosTab />}
      {tab === 'reactiva' && <ReactivaTab />}
      {tab === 'alertas' && <AlertasCasaTab />}
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
  const [allKeys, setAllKeys] = useState<string[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [keysLoading, setKeysLoading] = useState(false);
  const [keysError, setKeysError] = useState<string | null>(null);
  const [intervalLabel, setIntervalLabel] = useState<string>('1 hora');
  const [agg, setAgg] = useState<Agg>('AVG');
  const [granData, setGranData] = useState<Record<string, { ts: number; value: string | number }[]>>({});
  const [granLoading, setGranLoading] = useState(false);
  const [granError, setGranError] = useState<string | null>(null);

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

  // --- Fetch Granular ---
  const fetchGranular = async () => {
    if (!selectedMetrumId || selectedKeys.size === 0) return;
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
      const params = new URLSearchParams({
        metrumId: selectedMetrumId,
        keys: Array.from(selectedKeys).join(','),
        startTs: String(startTs),
        endTs: String(endTs),
        agg: preset.ms === null ? 'NONE' : agg,
      });
      if (preset.ms !== null) params.set('interval', String(preset.ms));
      const res = await fetch(`/api/metrum/timeseries?${params.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setGranData(json.raw ?? {});
    } catch (e) {
      setGranError(e instanceof Error ? e.message : 'Error');
    } finally {
      setGranLoading(false);
    }
  };

  // Auto-fetch closures on shared filter change
  useEffect(() => {
    fetchClosures();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDevice, typeFilter, selectedLocation, startDate, endDate]);

  // Load granular keys when device changes
  useEffect(() => {
    if (!selectedMetrumId) {
      setAllKeys([]);
      setSelectedKeys(new Set());
      return;
    }
    setKeysLoading(true);
    setKeysError(null);
    setAllKeys([]);
    setSelectedKeys(new Set());
    fetch(`/api/metrum/keys?metrumId=${encodeURIComponent(selectedMetrumId)}`)
      .then((r) => r.json())
      .then((json) => {
        if (!json.ok) throw new Error(json.error ?? 'Error');
        const keys: string[] = json.keys ?? [];
        setAllKeys(keys);
        setSelectedKeys(new Set(keys.slice(0, 2)));
      })
      .catch((e) => setKeysError(e.message))
      .finally(() => setKeysLoading(false));
  }, [selectedMetrumId]);

  const toggleKey = (k: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  // Granular chart data
  const chartData = useMemo(() => {
    const byTs = new Map<number, Record<string, number | null>>();
    for (const [key, points] of Object.entries(granData)) {
      for (const p of points) {
        const num = Number(p.value);
        const row = byTs.get(p.ts) ?? {};
        row[key] = Number.isFinite(num) ? num : null;
        byTs.set(p.ts, row);
      }
    }
    return Array.from(byTs.entries()).map(([ts, vals]) => ({ ts, ...vals })).sort((a, b) => a.ts - b.ts);
  }, [granData]);
  const selectedKeysList = Array.from(selectedKeys);

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
                { id: 'gateway' as const, label: `Módems (${devices.filter((d) => classifyDevice(d) === 'gateway').length})` },
                { id: 'other' as const, label: `Otros (${devices.filter((d) => classifyDevice(d) === 'other').length})` },
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

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '14px', alignItems: 'end' }}>
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label">Dispositivo</label>
            <select value={selectedDevice} onChange={(e) => setSelectedDevice(e.target.value)}>
              <option value="">Todos ({filteredDevices.length})</option>
              {filteredDevices.map((d) => (
                <option key={d.id} value={d.id}>{deviceLabel(d)}</option>
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

      {/* Sub-tabs */}
      <div className="tabs">
        {([
          { id: 'cierre' as const, label: 'Cierre Diario' },
          { id: 'granular' as const, label: 'Vista Granular' },
        ]).map((t) => (
          <button key={t.id} onClick={() => setSubTab(t.id)} className={`tab ${subTab === t.id ? 'active' : ''}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* === CIERRE DIARIO (vista por CASA por DÍA) === */}
      {subTab === 'cierre' && (
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

      {/* ===== SECCIÓN: GRANULAR ===== */}
      {subTab === 'granular' && (
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
            disabled={granLoading || !selectedMetrumId || selectedKeys.size === 0}
          >
            <Play size={14} /> {granLoading ? 'Cargando...' : 'Consultar'}
          </button>
        </div>

        {selectedMetrumId && (
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

            <div style={{ marginBottom: '16px' }}>
              <label className="input-label" style={{ display: 'block', marginBottom: '8px' }}>
                Keys disponibles {allKeys.length > 0 && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({allKeys.length})</span>}
              </label>
              {keysLoading && <p style={{ color: 'var(--text-muted)' }}>Cargando keys...</p>}
              {keysError && <div className="alert-error">{keysError}</div>}
              {allKeys.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {allKeys.map((k) => (
                    <button key={k} onClick={() => toggleKey(k)} className={`chip ${selectedKeys.has(k) ? 'active' : ''}`}>{k}</button>
                  ))}
                </div>
              )}
            </div>

            {granError && <div className="alert-error">{granError}</div>}

            {chartData.length > 0 && (
              <div style={{ width: '100%', height: 320 }}>
                <ResponsiveContainer>
                  <LineChart data={chartData}>
                    <CartesianGrid stroke="rgba(0,0,0,0.06)" />
                    <XAxis
                      dataKey="ts"
                      tickFormatter={(v) => new Date(v).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      stroke="var(--text-muted)" fontSize={11}
                    />
                    <YAxis stroke="var(--text-muted)" fontSize={11} />
                    <Tooltip
                      labelFormatter={(v) => new Date(Number(v)).toLocaleString()}
                      contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8 }}
                    />
                    <Legend />
                    {selectedKeysList.map((k, i) => (
                      <Line key={k} type="monotone" dataKey={k} stroke={COLORS[i % COLORS.length]} dot={false} strokeWidth={2} connectNulls />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
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

/* ---------------- TAB: Alertas por Casa ---------------- */

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
  alert_rules: { name: string } | null;
}

const SEV_META: Record<string, { label: string; color: string }> = {
  high: { label: 'Alto', color: '#ef4444' },
  medium: { label: 'Medio', color: '#f59e0b' },
  low: { label: 'Bajo', color: '#3b82f6' },
};

/* ---------------- TAB: Reactiva vs Activa (penalización CREG Colombia) ---------------- */

// Regla CREG 015-2018 (y modificaciones):
//   Penalización mensual si Σ Reactiva Inductiva > 50% de Σ Activa Importada
//   Equivalente a cos φ < 0.9 (factor de potencia ≥ 0.9 = sin penalización).
//   Excedente penalizable = ER_inductiva − 0.5 × EA_importada
//   Tarifa típica kvarh ≈ COP 100-150 (variable por comercializador)

interface ReactivaClosure {
  device_id: string;
  record_date: string;
  energy_active_imported_wh: number | null;
  energy_active_exported_wh: number | null;
  energy_reactive_imported_varh: number | null;
  energy_reactive_exported_varh: number | null;
  devices: { name: string; type: string; casa: string | null } | null;
}

interface CasaMonth {
  casa: string;
  month: string;            // YYYY-MM
  ea_wh: number;            // Σ delta EA importada (Wh)
  eri_varh: number;         // Σ delta ER inductiva (varh)
  ere_varh: number;         // Σ delta ER capacitiva (varh)
  ratio: number | null;     // ERI / EA
  excedente_varh: number;   // max(0, ERI − 0.5·EA)
  estimacion_cop: number;   // excedente_varh / 1000 × tarifa
  penalizada: boolean;
  cos_phi_approx: number | null;
  dias: number;
}

const THRESHOLD_RATIO = 0.5;  // 50% — equivalente a fp 0.9 según CREG

// Variables que se pueden graficar en el ReactivaTab (todas son monthly aggregates)
const REACTIVA_CHART_VARS: Array<{ key: string; label: string; color: string; unit: string }> = [
  { key: 'ea_kwh',           label: 'Energía Activa Importada (kWh)', color: '#3b82f6', unit: 'kWh' },
  { key: 'eri_kvarh',        label: 'Reactiva Inductiva ERI (kvarh)', color: '#ef4444', unit: 'kvarh' },
  { key: 'ere_kvarh',        label: 'Reactiva Capacitiva ERE (kvarh)', color: '#8b5cf6', unit: 'kvarh' },
  { key: 'ratio_pct',        label: 'Ratio ERI/EA (%)',                color: '#f59e0b', unit: '%' },
  { key: 'cos_phi',          label: 'Factor de potencia (cos φ)',       color: '#10b981', unit: '' },
  { key: 'excedente_kvarh',  label: 'Excedente reactivo (kvarh)',       color: '#ec4899', unit: 'kvarh' },
  { key: 'cop',              label: 'Penalización estimada (COP)',      color: '#dc2626', unit: 'COP' },
  { key: 'generacion_kwh',   label: 'Generación solar mensual (kWh)',  color: '#07c5a8', unit: 'kWh' },
];

function ReactivaTab() {
  const [closures, setClosures] = useState<ReactivaClosure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 2);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState<string>(dateStr(today()));
  const [tarifaCOP, setTarifaCOP] = useState<number>(130);

  // Gráficas custom
  const [genByCasaMonth, setGenByCasaMonth] = useState<Map<string, number>>(new Map()); // "Casa|YYYY-MM" → Wh
  const [chartCasas, setChartCasas] = useState<Set<string>>(new Set());
  const [chartVars, setChartVars] = useState<Set<string>>(new Set(['eri_kvarh', 'generacion_kwh']));

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Solo medidores de red (type = 'red') porque son los que registran consumo desde la red
      const baselineStart = startDate
        ? dateStr(new Date(new Date(startDate + 'T00:00:00').getTime() - 86400000))
        : '';
      const { data, error } = await supabase
        .from('daily_energy_closures')
        .select('device_id, record_date, energy_active_imported_wh, energy_active_exported_wh, energy_reactive_imported_varh, energy_reactive_exported_varh, devices!inner(name, type, casa)')
        .eq('devices.type', 'red')
        .gte('record_date', baselineStart || startDate)
        .lte('record_date', endDate)
        .order('record_date', { ascending: true })
        .limit(10000);
      if (error) throw error;
      setClosures((data ?? []) as unknown as ReactivaClosure[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate]);

  // Cargar generación mensual por casa (agregado del daily_casa_metrics)
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('daily_casa_metrics')
        .select('casa, record_date, generacion_wh')
        .gte('record_date', startDate)
        .lte('record_date', endDate)
        .limit(10000);
      const m = new Map<string, number>();
      for (const r of data ?? []) {
        if (!r.casa || r.generacion_wh === null) continue;
        const month = r.record_date.slice(0, 7);
        const key = `${r.casa}|${month}`;
        m.set(key, (m.get(key) ?? 0) + Number(r.generacion_wh));
      }
      setGenByCasaMonth(m);
    })();
  }, [startDate, endDate]);

  // Calcular per casa per mes a partir de los closures
  const casaMonths = useMemo<CasaMonth[]>(() => {
    // 1. Agrupar por device, ordenar por fecha
    const byDevice = new Map<string, ReactivaClosure[]>();
    for (const c of closures) {
      if (!c.devices?.casa) continue;
      if (!byDevice.has(c.device_id)) byDevice.set(c.device_id, []);
      byDevice.get(c.device_id)!.push(c);
    }
    for (const arr of byDevice.values()) arr.sort((a, b) => a.record_date.localeCompare(b.record_date));

    // 2. Acumular deltas diarios por casa+mes
    const acc = new Map<string, CasaMonth>();
    for (const rows of byDevice.values()) {
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const prev = rows[i - 1];
        const casa = r.devices?.casa;
        if (!casa) continue;
        if (r.record_date < startDate) continue;
        const month = r.record_date.slice(0, 7);
        const key = `${casa}|${month}`;
        let m = acc.get(key);
        if (!m) {
          m = { casa, month, ea_wh: 0, eri_varh: 0, ere_varh: 0, ratio: null, excedente_varh: 0, estimacion_cop: 0, penalizada: false, cos_phi_approx: null, dias: 0 };
          acc.set(key, m);
        }
        const dEA  = (r.energy_active_imported_wh ?? null) !== null && prev.energy_active_imported_wh !== null
          ? r.energy_active_imported_wh! - prev.energy_active_imported_wh : 0;
        const dERI = (r.energy_reactive_imported_varh ?? null) !== null && prev.energy_reactive_imported_varh !== null
          ? r.energy_reactive_imported_varh! - prev.energy_reactive_imported_varh : 0;
        const dERE = (r.energy_reactive_exported_varh ?? null) !== null && prev.energy_reactive_exported_varh !== null
          ? r.energy_reactive_exported_varh! - prev.energy_reactive_exported_varh : 0;
        m.ea_wh += Math.max(0, dEA);
        m.eri_varh += Math.max(0, dERI);
        m.ere_varh += Math.max(0, dERE);
        m.dias++;
      }
    }

    // 3. Calcular ratios y penalizaciones
    const result: CasaMonth[] = [];
    for (const m of acc.values()) {
      if (m.ea_wh > 0) {
        m.ratio = m.eri_varh / m.ea_wh;
        m.cos_phi_approx = m.ea_wh / Math.sqrt(m.ea_wh ** 2 + m.eri_varh ** 2);
        const limite = THRESHOLD_RATIO * m.ea_wh;
        m.excedente_varh = Math.max(0, m.eri_varh - limite);
        m.penalizada = m.eri_varh > limite;
        m.estimacion_cop = (m.excedente_varh / 1000) * tarifaCOP;
      }
      result.push(m);
    }
    // Ordenar mes desc, casa asc
    result.sort((a, b) => b.month.localeCompare(a.month) || a.casa.localeCompare(b.casa));
    return result;
  }, [closures, startDate, tarifaCOP]);

  const totales = useMemo(() => {
    const t = { casas_penalizadas: 0, excedente_total_kvarh: 0, cop_total: 0 };
    const casasSet = new Set<string>();
    for (const m of casaMonths) {
      if (m.penalizada) {
        casasSet.add(m.casa);
        t.excedente_total_kvarh += m.excedente_varh / 1000;
        t.cop_total += m.estimacion_cop;
      }
    }
    t.casas_penalizadas = casasSet.size;
    return t;
  }, [casaMonths]);

  // Datos para chart: ratio % por casa (último mes)
  const chartData = useMemo(() => {
    const lastMonth = casaMonths[0]?.month;
    if (!lastMonth) return [];
    return casaMonths
      .filter((m) => m.month === lastMonth && m.ratio !== null)
      .map((m) => ({ casa: m.casa, ratio_pct: Math.round((m.ratio ?? 0) * 100), penalizada: m.penalizada }))
      .sort((a, b) => b.ratio_pct - a.ratio_pct);
  }, [casaMonths]);

  const lastMonthLabel = casaMonths[0]?.month ?? '';

  return (
    <>
      <div className="glass-panel">
        <div className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Filter size={18} style={{ color: 'var(--text-secondary)' }} />
            <h2 className="card-title">Análisis Reactiva vs Activa</h2>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>· Regla CREG 015-2018 · umbral 50% (fp 0.9)</span>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, alignItems: 'end' }}>
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label">Desde</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label">Hasta</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label">Tarifa COP / kvarh excedente</label>
            <input type="number" value={tarifaCOP} onChange={(e) => setTarifaCOP(Number(e.target.value) || 0)} min={0} step={10} />
          </div>
        </div>
      </div>

      {error && <div className="alert-error">{error}</div>}

      {/* Cards de resumen */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <div className="glass-panel" style={{ flex: '1 1 220px', padding: '14px 18px' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Casas penalizadas</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: totales.casas_penalizadas > 0 ? '#ef4444' : '#10b981' }} />
            <span style={{ fontSize: '1.7rem', fontWeight: 700 }}>{totales.casas_penalizadas}</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>en el período</span>
          </div>
        </div>
        <div className="glass-panel" style={{ flex: '1 1 220px', padding: '14px 18px' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Excedente reactivo</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 6 }}>
            <span style={{ fontSize: '1.7rem', fontWeight: 700 }}>{totales.excedente_total_kvarh.toFixed(1)}</span>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>kvarh</span>
          </div>
        </div>
        <div className="glass-panel" style={{ flex: '1 1 220px', padding: '14px 18px' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Estimación penalización</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 6 }}>
            <span style={{ fontSize: '1.7rem', fontWeight: 700, color: totales.cop_total > 0 ? '#ef4444' : 'var(--text-primary)' }}>
              ${totales.cop_total.toLocaleString('es-CO', { maximumFractionDigits: 0 })}
            </span>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>COP</span>
          </div>
        </div>
      </div>

      {/* Chart último mes */}
      {chartData.length > 0 && (
        <div className="glass-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: '0.95rem' }}>
              Ratio ERI / EA por casa — <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{lastMonthLabel}</span>
            </h3>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>línea roja = umbral 50%</span>
          </div>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <LineChart data={chartData}>
                <CartesianGrid stroke="rgba(0,0,0,0.06)" />
                <XAxis dataKey="casa" stroke="var(--text-muted)" fontSize={10} angle={-30} textAnchor="end" height={60} interval={0} />
                <YAxis stroke="var(--text-muted)" fontSize={11} label={{ value: 'ERI / EA (%)', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: 'var(--text-muted)' } }} />
                <Tooltip contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8 }} formatter={(v) => `${v}%`} />
                <Line type="monotone" dataKey="ratio_pct" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} name="Ratio %" />
                <Line type="monotone" dataKey={() => 50} stroke="#ef4444" strokeDasharray="5 5" strokeWidth={1.5} dot={false} name="Umbral CREG (50%)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Tabla per casa per mes */}
      <div className="glass-panel" style={{ padding: 0 }}>
        <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: '0.95rem' }}>Detalle mensual ({casaMonths.length} filas)</h3>
          <button
            className="secondary-btn"
            disabled={casaMonths.length === 0}
            onClick={() => {
              const headers = ['Mes', 'Casa', 'EA Importada (kWh)', 'ER Inductiva (kvarh)', 'ER Capacitiva (kvarh)', 'Ratio ERI/EA (%)', 'cos φ ≈', 'Umbral 50% kvarh', 'Excedente (kvarh)', 'Penalizada', `Estimación COP @ ${tarifaCOP}/kvarh`];
              const rows = casaMonths.map((m) => [
                m.month, m.casa,
                (m.ea_wh / 1000).toFixed(2),
                (m.eri_varh / 1000).toFixed(2),
                (m.ere_varh / 1000).toFixed(2),
                m.ratio !== null ? (m.ratio * 100).toFixed(1) : '',
                m.cos_phi_approx !== null ? m.cos_phi_approx.toFixed(3) : '',
                ((m.ea_wh * 0.5) / 1000).toFixed(2),
                (m.excedente_varh / 1000).toFixed(2),
                m.penalizada ? 'SI' : 'NO',
                m.estimacion_cop.toFixed(0),
              ]);
              downloadCSV(`reactiva-${startDate}_${endDate}.csv`, headers, rows);
            }}
            style={{ fontSize: '0.8rem' }}
          >
            <Download size={14} /> CSV
          </button>
        </div>
        <div className="table-container" style={{ border: 'none', overflowX: 'auto' }}>
          <table style={{ fontSize: '0.78rem', minWidth: 1000 }}>
            <thead>
              <tr>
                <th>Mes</th>
                <th>Casa</th>
                <th title="Energía Activa Importada">EA Imp.</th>
                <th title="Energía Reactiva Inductiva (kvarh) — la que paga penalización">ER Inductiva</th>
                <th title="Energía Reactiva Capacitiva (kvarh)">ER Capacitiva</th>
                <th title="ER Inductiva / EA — > 50% = penalización">Ratio</th>
                <th title="Factor de potencia ≈ cos(φ)">cos φ ≈</th>
                <th title="Excedente sobre el 50% — kvarh penalizables">Excedente</th>
                <th>Estado</th>
                <th title="Excedente × tarifa COP/kvarh">Estimación</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Cargando…</td></tr>
              ) : casaMonths.length === 0 ? (
                <tr><td colSpan={10} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Sin data. Verifica el rango.</td></tr>
              ) : casaMonths.map((m) => (
                <tr key={`${m.casa}|${m.month}`} style={{ background: m.penalizada ? 'rgba(239, 68, 68, 0.04)' : undefined }}>
                  <td style={{ fontFamily: 'ui-monospace, monospace' }}>{m.month}</td>
                  <td style={{ fontWeight: 600 }}>{m.casa}</td>
                  <td style={{ textAlign: 'right' }}>{(m.ea_wh / 1000).toFixed(1)} kWh</td>
                  <td style={{ textAlign: 'right' }}>{(m.eri_varh / 1000).toFixed(1)} kvarh</td>
                  <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{(m.ere_varh / 1000).toFixed(1)} kvarh</td>
                  <td style={{ textAlign: 'right', fontWeight: m.penalizada ? 700 : 400, color: m.penalizada ? '#ef4444' : undefined }}>
                    {m.ratio !== null ? `${(m.ratio * 100).toFixed(1)}%` : '—'}
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{m.cos_phi_approx?.toFixed(3) ?? '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: m.penalizada ? 600 : 400 }}>
                    {m.excedente_varh > 0 ? `${(m.excedente_varh / 1000).toFixed(1)} kvarh` : '—'}
                  </td>
                  <td>
                    {m.penalizada ? (
                      <span style={{ padding: '2px 8px', borderRadius: 10, background: '#ef444420', color: '#ef4444', fontSize: '0.7rem', fontWeight: 700 }}>PENALIZADA</span>
                    ) : (
                      <span style={{ padding: '2px 8px', borderRadius: 10, background: '#10b98120', color: '#10b981', fontSize: '0.7rem', fontWeight: 700 }}>OK</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: m.estimacion_cop > 0 ? 700 : 400, color: m.estimacion_cop > 0 ? '#ef4444' : undefined }}>
                    {m.estimacion_cop > 0 ? `$${m.estimacion_cop.toLocaleString('es-CO', { maximumFractionDigits: 0 })}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ═══════ GRÁFICAS COMPARATIVAS ═══════ */}
      <ReactivaChart casaMonths={casaMonths} genByCasaMonth={genByCasaMonth} chartCasas={chartCasas} setChartCasas={setChartCasas} chartVars={chartVars} setChartVars={setChartVars} />

      {/* Nota explicativa */}
      <div className="alert-warning" style={{ fontSize: '0.78rem', lineHeight: 1.6 }}>
        <strong>📘 Cómo se calcula:</strong> La <strong>Resolución CREG 015 de 2018</strong> exige que el factor de potencia (cos φ)
        en redes ≤ 50 kW sea ≥ <strong>0.9</strong>, lo que equivale a que la energía reactiva inductiva consumida no supere el
        <strong> 50% de la energía activa importada</strong> medida mensualmente. Cuando lo supera, el comercializador penaliza
        cada kvarh excedente. La tarifa de penalización varía por comercializador (~$100-150 COP/kvarh).
        <br /><br />
        Los datos vienen del <strong>medidor de red</strong> (no del solar) y se agregan por mes calendario. La estimación COP es
        referencial — la tarifa real está en tu factura.
      </div>
    </>
  );
}

/* ─────────────── Sub-componente: gráficas comparativas del ReactivaTab ─────────────── */
function ReactivaChart({
  casaMonths, genByCasaMonth, chartCasas, setChartCasas, chartVars, setChartVars,
}: {
  casaMonths: CasaMonth[];
  genByCasaMonth: Map<string, number>;
  chartCasas: Set<string>;
  setChartCasas: React.Dispatch<React.SetStateAction<Set<string>>>;
  chartVars: Set<string>;
  setChartVars: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  // Casas disponibles (de las que tienen al menos un mes con data)
  const availableCasas = useMemo(() => Array.from(new Set(casaMonths.map((m) => m.casa))).sort(), [casaMonths]);

  // Aplicar un preset
  const applyPreset = (preset: 'gen_vs_reactiva' | 'gen_vs_cosphi' | 'reactiva_vs_demanda') => {
    // Preseleccionar las 4 casas con mayor ratio si no hay nada
    if (chartCasas.size === 0) {
      const ranked = casaMonths
        .filter((m) => m.ratio !== null)
        .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0))
        .map((m) => m.casa);
      setChartCasas(new Set(Array.from(new Set(ranked)).slice(0, 4)));
    }
    if (preset === 'gen_vs_reactiva') setChartVars(new Set(['generacion_kwh', 'eri_kvarh']));
    else if (preset === 'gen_vs_cosphi') setChartVars(new Set(['generacion_kwh', 'cos_phi']));
    else if (preset === 'reactiva_vs_demanda') setChartVars(new Set(['ea_kwh', 'eri_kvarh', 'ratio_pct']));
  };

  // Variables que necesitan eje secundario (escala 0-1 o 0-100)
  const NEEDS_RIGHT_AXIS = new Set(['ratio_pct', 'cos_phi']);
  const hasRightAxis = Array.from(chartVars).some((v) => NEEDS_RIGHT_AXIS.has(v));

  // Helper: obtener valor de la variable para una fila CasaMonth + month
  const getValue = (m: CasaMonth, v: string): number | null => {
    switch (v) {
      case 'ea_kwh':          return m.ea_wh / 1000;
      case 'eri_kvarh':       return m.eri_varh / 1000;
      case 'ere_kvarh':       return m.ere_varh / 1000;
      case 'ratio_pct':       return m.ratio !== null ? m.ratio * 100 : null;
      case 'cos_phi':         return m.cos_phi_approx;
      case 'excedente_kvarh': return m.excedente_varh / 1000;
      case 'cop':             return m.estimacion_cop;
      case 'generacion_kwh': {
        const gen = genByCasaMonth.get(`${m.casa}|${m.month}`);
        return gen !== undefined ? gen / 1000 : null;
      }
      default: return null;
    }
  };

  // Construir series y data
  const chartSeries = useMemo(() => {
    const series: Array<{ key: string; casa: string; variable: string; label: string; color: string; right: boolean }> = [];
    let idx = 0;
    for (const casa of chartCasas) {
      for (const v of chartVars) {
        const meta = REACTIVA_CHART_VARS.find((x) => x.key === v);
        series.push({
          key: `${casa}__${v}`,
          casa, variable: v,
          label: `${casa} · ${meta?.label ?? v}`,
          color: SERIES_COLORS[idx % SERIES_COLORS.length],
          right: NEEDS_RIGHT_AXIS.has(v),
        });
        idx++;
      }
    }
    return series;
  }, [chartCasas, chartVars]);

  const chartData = useMemo(() => {
    // Map por mes
    const byMonth = new Map<string, Record<string, number | string | null>>();
    for (const m of casaMonths) {
      if (!chartCasas.has(m.casa)) continue;
      if (!byMonth.has(m.month)) byMonth.set(m.month, { month: m.month });
      const row = byMonth.get(m.month)!;
      for (const v of chartVars) {
        row[`${m.casa}__${v}`] = getValue(m, v);
      }
    }
    return Array.from(byMonth.values()).sort((a, b) => String(a.month).localeCompare(String(b.month)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [casaMonths, chartCasas, chartVars, genByCasaMonth]);

  return (
    <div className="glass-panel">
      <h3 style={{ margin: 0, marginBottom: 14, fontSize: '1rem' }}>📈 Gráficas comparativas</h3>

      {/* Presets */}
      <div style={{ marginBottom: 12 }}>
        <label className="input-label" style={{ display: 'block', marginBottom: 6 }}>Análisis pre-configurados</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <button className="chip" onClick={() => applyPreset('gen_vs_reactiva')}>☀️ Generación vs ⚡ Reactiva</button>
          <button className="chip" onClick={() => applyPreset('gen_vs_cosphi')}>☀️ Generación vs cos φ</button>
          <button className="chip" onClick={() => applyPreset('reactiva_vs_demanda')}>🔌 Demanda vs Reactiva vs Ratio</button>
          <button className="chip" onClick={() => { setChartCasas(new Set()); setChartVars(new Set()); }} style={{ color: 'var(--text-muted)' }}>Limpiar</button>
        </div>
      </div>

      {/* Selección de casas */}
      <div style={{ marginBottom: 12 }}>
        <label className="input-label" style={{ display: 'block', marginBottom: 6 }}>
          Casas a comparar <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({chartCasas.size} de {availableCasas.length})</span>
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 90, overflowY: 'auto' }}>
          {availableCasas.map((casa) => (
            <button key={casa}
              onClick={() => {
                setChartCasas((prev) => {
                  const next = new Set(prev);
                  if (next.has(casa)) next.delete(casa); else next.add(casa);
                  return next;
                });
              }}
              className={`chip ${chartCasas.has(casa) ? 'active' : ''}`}
              style={{ fontSize: '0.74rem' }}>
              {casa}
            </button>
          ))}
        </div>
      </div>

      {/* Selección de variables */}
      <div style={{ marginBottom: 12 }}>
        <label className="input-label" style={{ display: 'block', marginBottom: 6 }}>
          Variables a graficar <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({chartVars.size})</span>
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {REACTIVA_CHART_VARS.map((v) => (
            <button key={v.key}
              onClick={() => {
                setChartVars((prev) => {
                  const next = new Set(prev);
                  if (next.has(v.key)) next.delete(v.key); else next.add(v.key);
                  return next;
                });
              }}
              className={`chip ${chartVars.has(v.key) ? 'active' : ''}`}
              style={{ fontSize: '0.74rem', borderLeft: `3px solid ${v.color}` }}>
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      {chartCasas.size === 0 || chartVars.size === 0 ? (
        <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          Selecciona casas + variables o usa un preset para empezar
        </div>
      ) : chartData.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          Sin datos. Amplía el rango de fechas arriba.
        </div>
      ) : (
        <div style={{ width: '100%', height: 420 }}>
          <ResponsiveContainer>
            <LineChart data={chartData} margin={{ top: 10, right: hasRightAxis ? 40 : 20, bottom: 20, left: 20 }}>
              <CartesianGrid stroke="rgba(0,0,0,0.06)" />
              <XAxis dataKey="month" stroke="var(--text-muted)" fontSize={11} />
              <YAxis yAxisId="left" stroke="var(--text-muted)" fontSize={11} />
              {hasRightAxis && (
                <YAxis yAxisId="right" orientation="right" stroke="var(--text-muted)" fontSize={11}
                  label={{ value: 'ratio % / cos φ', angle: 90, position: 'insideRight', style: { fontSize: 10, fill: 'var(--text-muted)' } }} />
              )}
              <Tooltip contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: '0.78rem' }} />
              <Legend wrapperStyle={{ fontSize: '0.72rem' }} />
              {chartSeries.map((s) => (
                <Line key={s.key} yAxisId={s.right ? 'right' : 'left'}
                  type="monotone" dataKey={s.key} name={s.label} stroke={s.color}
                  strokeWidth={2} dot={{ r: 3 }} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
          {hasRightAxis && (
            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: 6 }}>
              💡 Ratio % y cos φ usan el <strong>eje derecho</strong> (escala distinta a kWh / kvarh)
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function AlertasCasaTab() {
  const [events, setEvents] = useState<AlertEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterAck, setFilterAck] = useState<'all' | 'pending'>('pending');

  const load = async () => {
    setLoading(true);
    const url = filterAck === 'pending' ? '/api/alerts/events?acknowledged=false' : '/api/alerts/events';
    const r = await fetch(url);
    const j = await r.json();
    setEvents(j.events ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [filterAck]);

  // Agrupar por casa
  const byCasa = useMemo(() => {
    const m = new Map<string, AlertEventRow[]>();
    for (const ev of events) {
      if (!m.has(ev.casa)) m.set(ev.casa, []);
      m.get(ev.casa)!.push(ev);
    }
    return Array.from(m.entries()).sort((a, b) => {
      // Casas con eventos high primero
      const sa = a[1].filter(e => e.severity === 'high').length;
      const sb = b[1].filter(e => e.severity === 'high').length;
      if (sa !== sb) return sb - sa;
      return b[1].length - a[1].length;
    });
  }, [events]);

  const totals = useMemo(() => {
    const t = { high: 0, medium: 0, low: 0 };
    for (const ev of events) t[ev.severity]++;
    return t;
  }, [events]);

  return (
    <>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {(['high','medium','low'] as const).map((sev) => (
          <div key={sev} className="glass-panel" style={{ flex: '1 1 180px', padding: '14px 18px' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{SEV_META[sev].label}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: SEV_META[sev].color }} />
              <span style={{ fontSize: '1.6rem', fontWeight: 700 }}>{totals[sev]}</span>
            </div>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <button className={`chip ${filterAck === 'pending' ? 'active' : ''}`} onClick={() => setFilterAck('pending')}>Pendientes</button>
          <button className={`chip ${filterAck === 'all' ? 'active' : ''}`} onClick={() => setFilterAck('all')}>Todas</button>
        </div>
      </div>

      {loading ? (
        <div className="glass-panel" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>Cargando…</div>
      ) : byCasa.length === 0 ? (
        <div className="alert-success" style={{ fontSize: '0.85rem' }}>
          ✓ Ninguna alerta activa. El sistema está operando dentro de los umbrales configurados.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {byCasa.map(([casa, list]) => {
            const high = list.filter(e => e.severity === 'high').length;
            const med = list.filter(e => e.severity === 'medium').length;
            const low = list.filter(e => e.severity === 'low').length;
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
                      <th style={{ padding: '4px 8px' }}>Detalle</th>
                      <th style={{ padding: '4px 8px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((ev) => (
                      <tr key={ev.id} style={{ opacity: ev.acknowledged ? 0.5 : 1, borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '6px 8px' }}>{ev.record_date}</td>
                        <td style={{ padding: '6px 8px' }}>{ev.alert_rules?.name ?? ev.variable}</td>
                        <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                          {ev.variable} = {Number(ev.value).toFixed(2)} {ev.operator} {ev.threshold}
                        </td>
                        <td style={{ padding: '6px 8px' }}>
                          {ev.acknowledged ? (
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>✓</span>
                          ) : (
                            <button
                              onClick={async () => { await fetch('/api/alerts/events', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: ev.id, acknowledged: true }) }); load(); }}
                              style={{ fontSize: '0.7rem', padding: '2px 8px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-elevated)', cursor: 'pointer' }}
                            >
                              Ack
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </>
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
