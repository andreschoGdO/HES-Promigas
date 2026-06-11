'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { Download, AlertCircle, Info, Zap, Sun, Calendar, BarChart3 } from 'lucide-react';

// ───── Helpers ─────
const dateStr = (d: Date) => d.toISOString().slice(0, 10);
const today = () => new Date();
const formatCOP = (n: number) =>
  n === 0 ? '$0' : `$${Math.round(n).toLocaleString('es-CO')}`;

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

// ───── Tipos ─────
interface RankRow {
  casa: string;
  house_id: string | null;
  alertas_high: number;
  alertas_medium: number;
  notificaciones: number;
  reactiva_cop: number;
  dias_reactiva: number;
  curtailment_kwh: number;
}

interface CurtailmentRow {
  casa: string;
  curtailment_kwh: number;
  devices_count: number;
}

type MetricKey = 'alertas' | 'notificaciones' | 'reactiva' | 'curtailment';

interface MetricDef {
  key: MetricKey;
  label: string;
  short: string;
  color: string;
  icon: typeof AlertCircle;
  unit: string;
  format: (n: number) => string;
  value: (r: RankRow) => number;
  available: boolean;
  disabledReason?: string;
}

type RangeKey = '7d' | '30d' | 'month';

const RANGES: Array<{ key: RangeKey; label: string }> = [
  { key: '7d',    label: 'Últimos 7 días' },
  { key: '30d',   label: 'Últimos 30 días' },
  { key: 'month', label: 'Mes actual' },
];

const rangeToDates = (r: RangeKey): { from: string; to: string } => {
  const now = today();
  if (r === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: dateStr(start), to: dateStr(now) };
  }
  const days = r === '7d' ? 7 : 30;
  const start = new Date(now.getTime() - days * 86400000);
  return { from: dateStr(start), to: dateStr(now) };
};

const METRICS: MetricDef[] = [
  {
    key: 'alertas',
    label: 'Alertas (high + medium)',
    short: 'Alertas',
    color: '#ef4444',
    icon: AlertCircle,
    unit: 'eventos',
    format: (n) => `${n}`,
    value: (r) => r.alertas_high + r.alertas_medium,
    available: true,
  },
  {
    key: 'notificaciones',
    label: 'Notificaciones (low)',
    short: 'Notificaciones',
    color: '#3b82f6',
    icon: Info,
    unit: 'eventos',
    format: (n) => `${n}`,
    value: (r) => r.notificaciones,
    available: true,
  },
  {
    key: 'reactiva',
    label: 'Reactiva CREG (COP estimado)',
    short: 'Reactiva',
    color: '#f59e0b',
    icon: Zap,
    unit: 'COP',
    format: formatCOP,
    value: (r) => r.reactiva_cop,
    available: true,
  },
  {
    key: 'curtailment',
    label: 'Curtailment DC (kWh acumulados en el rango)',
    short: 'Curtailment',
    color: '#10b981',
    icon: Sun,
    unit: 'kWh',
    format: (n) => `${n.toFixed(1)} kWh`,
    value: (r) => r.curtailment_kwh,
    available: true,
  },
];

const metricMeta = (k: MetricKey) => METRICS.find((m) => m.key === k)!;

// ═══════════════════════════════════════════════════════════════════
// HouseRanking — ranking de casas agrupado por métricas NAR
// ═══════════════════════════════════════════════════════════════════
export function HouseRanking() {
  const [range, setRange] = useState<RangeKey>('7d');
  const [selected, setSelected] = useState<Set<MetricKey>>(new Set(['alertas']));
  const [sortBy, setSortBy] = useState<MetricKey>('alertas');
  const [rows, setRows] = useState<RankRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [curtailmentMap, setCurtailmentMap] = useState<Map<string, number>>(new Map());
  const [curtailmentLoading, setCurtailmentLoading] = useState(false);
  const [curtailmentError, setCurtailmentError] = useState<string | null>(null);

  const { from, to } = useMemo(() => rangeToDates(range), [range]);
  const wantsCurtailment = selected.has('curtailment');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const res = await fetch(`/api/nar/ranking?from=${from}&to=${to}`);
        const j = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(j.error ?? 'Error');
        setRows(j.items ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [from, to]);

  // Curtailment se calcula solo cuando el usuario lo marca — es pesado
  // (Metrum + irradiancia por todos los inversores). Cache por rango.
  useEffect(() => {
    if (!wantsCurtailment) return;
    if (curtailmentMap.size > 0) return; // ya cargado para este rango
    let cancelled = false;
    (async () => {
      setCurtailmentLoading(true); setCurtailmentError(null);
      try {
        const res = await fetch(`/api/nar/curtailment?from=${from}&to=${to}`);
        const j = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(j.error ?? 'Error');
        const m = new Map<string, number>();
        for (const r of (j.items ?? []) as CurtailmentRow[]) {
          m.set(r.casa, r.curtailment_kwh);
        }
        setCurtailmentMap(m);
      } catch (e) {
        if (!cancelled) setCurtailmentError(e instanceof Error ? e.message : 'Error');
      } finally {
        if (!cancelled) setCurtailmentLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [wantsCurtailment, from, to, curtailmentMap]);

  // Invalidar cache de curtailment cuando cambia el rango
  useEffect(() => { setCurtailmentMap(new Map()); }, [from, to]);

  // Merge curtailment en rows
  const enrichedRows = useMemo<RankRow[]>(() => {
    const out = rows.map((r) => ({ ...r, curtailment_kwh: curtailmentMap.get(r.casa) ?? 0 }));
    // Casas que solo tienen curtailment (no aparecen en alertas/reactiva) — agregarlas
    const seen = new Set(out.map((r) => r.casa));
    for (const [casa, kwh] of curtailmentMap.entries()) {
      if (seen.has(casa)) continue;
      out.push({ casa, house_id: null, alertas_high: 0, alertas_medium: 0, notificaciones: 0, reactiva_cop: 0, dias_reactiva: 0, curtailment_kwh: kwh });
    }
    return out;
  }, [rows, curtailmentMap]);

  const toggleMetric = (k: MetricKey) => {
    const meta = metricMeta(k);
    if (!meta.available) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) {
        if (next.size === 1) return prev; // no permitir vaciar
        next.delete(k);
        // Si se ocultó la columna por la que ordenamos, ordenar por la primera disponible
        if (sortBy === k) setSortBy(Array.from(next)[0]);
      } else {
        next.add(k);
      }
      return next;
    });
  };

  const selectedMetrics = useMemo(
    () => METRICS.filter((m) => selected.has(m.key) && m.available),
    [selected],
  );

  const sortMeta = useMemo(() => metricMeta(sortBy), [sortBy]);

  const sortedRows = useMemo(() => {
    const arr = [...enrichedRows];
    arr.sort((a, b) => sortMeta.value(b) - sortMeta.value(a));
    return arr;
  }, [enrichedRows, sortMeta]);

  const chartData = useMemo(
    () => sortedRows.map((r) => ({ casa: r.casa, value: sortMeta.value(r) })),
    [sortedRows, sortMeta],
  );

  const exportCSV = () => {
    const headers = ['Casa', ...selectedMetrics.map((m) => m.short)];
    const csvRows = sortedRows.map((r) => [
      r.casa,
      ...selectedMetrics.map((m) => m.value(r)),
    ]);
    downloadCSV(`nar-ranking-${range}-${from}-a-${to}.csv`, headers, csvRows);
  };

  const totalCasas = sortedRows.length;
  const casasConDatos = sortedRows.filter((r) => selectedMetrics.some((m) => m.value(r) > 0)).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* CONTROLES — rango + métricas + descarga */}
      <div className="glass-panel" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Rango */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            <Calendar size={14} /> Rango:
          </span>
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`chip ${range === r.key ? 'active' : ''}`}
              style={{ fontSize: '0.82rem', padding: '6px 12px' }}
            >
              {r.label}
            </button>
          ))}
          <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
            {from} → {to}
          </span>
        </div>

        {/* Métricas */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            <BarChart3 size={14} /> Métricas:
          </span>
          {METRICS.map((m) => {
            const Icon = m.icon;
            const isOn = selected.has(m.key) && m.available;
            return (
              <button
                key={m.key}
                onClick={() => toggleMetric(m.key)}
                disabled={!m.available}
                title={m.available ? m.label : m.disabledReason}
                className={`chip ${isOn ? 'active' : ''}`}
                style={{
                  fontSize: '0.82rem',
                  padding: '6px 12px',
                  borderLeft: `3px solid ${m.color}`,
                  opacity: m.available ? 1 : 0.45,
                  cursor: m.available ? 'pointer' : 'not-allowed',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                <Icon size={13} /> {m.short}
              </button>
            );
          })}
          <button
            className="primary-btn"
            onClick={exportCSV}
            disabled={sortedRows.length === 0}
            style={{ marginLeft: 'auto', fontSize: '0.82rem', padding: '6px 12px' }}
          >
            <Download size={14} /> Descargar CSV
          </button>
        </div>

        {/* Selector "ordenar por" cuando hay más de una métrica activa */}
        {selectedMetrics.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Ordenar por:</span>
            {selectedMetrics.map((m) => (
              <button
                key={m.key}
                onClick={() => setSortBy(m.key)}
                className={`chip ${sortBy === m.key ? 'active' : ''}`}
                style={{ fontSize: '0.76rem', padding: '4px 10px' }}
              >
                {m.short}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <div className="alert-error">{error}</div>}
      {curtailmentLoading && (
        <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', padding: '8px 12px', background: 'rgba(16,185,129,0.08)', borderRadius: 6, borderLeft: '3px solid #10b981' }}>
          Calculando curtailment desde Metrum + irradiancia… puede tardar 10-30s para rangos amplios.
        </div>
      )}
      {curtailmentError && (
        <div className="alert-error">Curtailment: {curtailmentError}</div>
      )}

      {/* GRÁFICO horizontal */}
      <div className="glass-panel" style={{ padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: '0.95rem' }}>
            Ranking por casa — {sortMeta.short}
          </h3>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
            {casasConDatos} de {totalCasas} casas con datos
          </span>
        </div>
        {loading ? (
          <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>
            Cargando…
          </div>
        ) : chartData.length === 0 ? (
          <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>
            Sin datos en el rango.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(220, chartData.length * 28)}>
            <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 32, bottom: 4, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
              <YAxis
                type="category"
                dataKey="casa"
                width={140}
                tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
              />
              <Tooltip
                contentStyle={{ background: 'rgba(15,23,42,0.96)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontSize: '0.82rem' }}
                formatter={(v) => [sortMeta.format(Number(v) || 0), sortMeta.short] as [string, string]}
              />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {chartData.map((_, i) => (
                  <Cell key={i} fill={sortMeta.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* TABLA */}
      <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <th style={{ textAlign: 'left', padding: '10px 14px', fontWeight: 500 }}>Casa</th>
                {selectedMetrics.map((m) => (
                  <th
                    key={m.key}
                    style={{
                      textAlign: 'right',
                      padding: '10px 14px',
                      fontWeight: 500,
                      borderLeft: `3px solid ${m.color}`,
                      cursor: 'pointer',
                      opacity: sortBy === m.key ? 1 : 0.75,
                    }}
                    onClick={() => setSortBy(m.key)}
                    title="Click para ordenar"
                  >
                    {m.short} {sortBy === m.key ? '↓' : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.length === 0 && !loading && (
                <tr>
                  <td colSpan={selectedMetrics.length + 1} style={{ padding: 20, textAlign: 'center', color: 'var(--text-tertiary)' }}>
                    Sin datos en el rango.
                  </td>
                </tr>
              )}
              {sortedRows.map((r) => (
                <tr key={r.casa} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ padding: '8px 14px' }}>{r.casa}</td>
                  {selectedMetrics.map((m) => {
                    const v = m.value(r);
                    return (
                      <td key={m.key} style={{ padding: '8px 14px', textAlign: 'right', color: v > 0 ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                        {m.format(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
