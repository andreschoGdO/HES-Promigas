'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Filter, Download } from 'lucide-react';

/* ───── Helpers locales (auto-contenidos) ───── */
const today = () => new Date();
const dateStr = (d: Date) => d.toISOString().slice(0, 10);

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
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const SERIES_COLORS = ['#07c5a8', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#10b981', '#ec4899', '#0ea5e9', '#a855f7', '#14b8a6'];

/* ───── Tipos y constantes ───── */
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
  month: string;
  ea_wh: number;
  eri_varh: number;
  ere_varh: number;
  ratio: number | null;
  excedente_varh: number;
  estimacion_cop: number;
  penalizada: boolean;
  cos_phi_approx: number | null;
  dias: number;
}

const THRESHOLD_RATIO = 0.5;

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

/* ═══════════════════════════════════════════════════════════════════
 *  ReactivaCREG — análisis mensual de reactiva vs activa según
 *  Resolución CREG 015-2018. Antes vivía como tab en /dashboard,
 *  ahora es un módulo reutilizable que se renderiza dentro de NAR.
 * ═══════════════════════════════════════════════════════════════════ */
export function ReactivaCREG() {
  const [closures, setClosures] = useState<ReactivaClosure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<'graficas' | 'tablas'>('graficas');
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 2);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState<string>(dateStr(today()));
  const [tarifaCOP, setTarifaCOP] = useState<number>(130);

  const [genByCasaMonth, setGenByCasaMonth] = useState<Map<string, number>>(new Map());
  const [chartCasas, setChartCasas] = useState<Set<string>>(new Set());
  const [chartVars, setChartVars] = useState<Set<string>>(new Set(['eri_kvarh', 'generacion_kwh']));

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
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

  const casaMonths = useMemo<CasaMonth[]>(() => {
    const byDevice = new Map<string, ReactivaClosure[]>();
    for (const c of closures) {
      if (!c.devices?.casa) continue;
      if (!byDevice.has(c.device_id)) byDevice.set(c.device_id, []);
      byDevice.get(c.device_id)!.push(c);
    }
    for (const arr of byDevice.values()) arr.sort((a, b) => a.record_date.localeCompare(b.record_date));

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

  const lastMonthChart = useMemo(() => {
    const lastMonth = casaMonths[0]?.month;
    if (!lastMonth) return [];
    return casaMonths
      .filter((m) => m.month === lastMonth && m.ratio !== null)
      .map((m) => ({ casa: m.casa, ratio_pct: Math.round((m.ratio ?? 0) * 100), penalizada: m.penalizada }))
      .sort((a, b) => b.ratio_pct - a.ratio_pct);
  }, [casaMonths]);

  const lastMonthLabel = casaMonths[0]?.month ?? '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="glass-panel">
        <div className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Filter size={18} style={{ color: 'var(--text-secondary)' }} />
            <h2 className="card-title">Análisis Reactiva vs Activa</h2>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>· Regla CREG 015-2018 · umbral 50% (fp 0.9)</span>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, alignItems: 'end' }}>
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

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button onClick={() => setSubTab('graficas')} className={`chip ${subTab === 'graficas' ? 'active' : ''}`}
          style={{ fontSize: '0.85rem', padding: '8px 14px', borderLeft: '4px solid #f59e0b' }}>
          Gráficas
        </button>
        <button onClick={() => setSubTab('tablas')} className={`chip ${subTab === 'tablas' ? 'active' : ''}`}
          style={{ fontSize: '0.85rem', padding: '8px 14px', borderLeft: '4px solid #3b82f6' }}>
          Tablas
        </button>
      </div>

      {subTab === 'graficas' && (
        <>
          <ReactivaChart casaMonths={casaMonths} genByCasaMonth={genByCasaMonth} chartCasas={chartCasas} setChartCasas={setChartCasas} chartVars={chartVars} setChartVars={setChartVars} />

          {lastMonthChart.length > 0 && (
            <div className="glass-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: '0.95rem' }}>
                  Ratio ERI / EA por casa — <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{lastMonthLabel}</span>
                </h3>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>línea roja = umbral 50%</span>
              </div>
              <div style={{ width: '100%', height: 280 }}>
                <ResponsiveContainer>
                  <LineChart data={lastMonthChart}>
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
        </>
      )}

      {subTab === 'tablas' && (
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
      )}

      <div className="alert-warning" style={{ fontSize: '0.78rem', lineHeight: 1.6 }}>
        <strong>📘 Cómo se calcula:</strong> La <strong>Resolución CREG 015 de 2018</strong> exige que el factor de potencia (cos φ)
        en redes ≤ 50 kW sea ≥ <strong>0.9</strong>, lo que equivale a que la energía reactiva inductiva consumida no supere el
        <strong> 50% de la energía activa importada</strong> medida mensualmente. Cuando lo supera, el comercializador penaliza
        cada kvarh excedente. La tarifa de penalización varía por comercializador (~$100-150 COP/kvarh).
        <br /><br />
        Los datos vienen del <strong>medidor de red</strong> (no del solar) y se agregan por mes calendario. La estimación COP es
        referencial — la tarifa real está en tu factura.
      </div>
    </div>
  );
}

/* ───── Sub-componente: gráficas comparativas ───── */
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
  const availableCasas = useMemo(() => Array.from(new Set(casaMonths.map((m) => m.casa))).sort(), [casaMonths]);

  const applyPreset = (preset: 'gen_vs_reactiva' | 'gen_vs_cosphi' | 'reactiva_vs_demanda') => {
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

  const NEEDS_RIGHT_AXIS = new Set(['ratio_pct', 'cos_phi']);
  const hasRightAxis = Array.from(chartVars).some((v) => NEEDS_RIGHT_AXIS.has(v));

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

      <div style={{ marginBottom: 12 }}>
        <label className="input-label" style={{ display: 'block', marginBottom: 6 }}>Análisis pre-configurados</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <button className="chip" onClick={() => applyPreset('gen_vs_reactiva')}>☀️ Generación vs ⚡ Reactiva</button>
          <button className="chip" onClick={() => applyPreset('gen_vs_cosphi')}>☀️ Generación vs cos φ</button>
          <button className="chip" onClick={() => applyPreset('reactiva_vs_demanda')}>🔌 Demanda vs Reactiva vs Ratio</button>
          <button className="chip" onClick={() => { setChartCasas(new Set()); setChartVars(new Set()); }} style={{ color: 'var(--text-muted)' }}>Limpiar</button>
        </div>
      </div>

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
