'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { Download, AlertCircle, Info, Sun, Calendar, BarChart3, Lightbulb, Filter } from 'lucide-react';
import { ALERT_CATEGORIES, type AlertCategory } from '@/lib/alert-variables';

// ───── Helpers ─────
const dateStr = (d: Date) => d.toISOString().slice(0, 10);
const today = () => new Date();

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
  recomendaciones: number;
  curtailment_kwh: number;
}

interface RankApiRow {
  casa: string;
  house_id: string | null;
  alertas_high: number;
  alertas_medium: number;
  notificaciones: number;
  recomendaciones: number;
}

interface CurtailmentApiRow {
  casa: string;
  curtailment_kwh: number;
  devices_count: number;
  days: number;
}

type MetricKey = 'alertas' | 'notificaciones' | 'curtailment' | 'recomendaciones';

interface MetricDef {
  key: MetricKey;
  label: string;
  short: string;
  color: string;
  icon: typeof AlertCircle;
  unit: string;
  format: (n: number) => string;
  value: (r: RankRow) => number;
}

type RangePreset = '7d' | '30d' | 'month' | 'custom';

const PRESETS: Array<{ key: RangePreset; label: string }> = [
  { key: '7d',     label: 'Últimos 7 días' },
  { key: '30d',    label: 'Últimos 30 días' },
  { key: 'month',  label: 'Mes actual' },
  { key: 'custom', label: 'Personalizado' },
];

const presetToDates = (r: RangePreset): { from: string; to: string } => {
  const now = today();
  if (r === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: dateStr(start), to: dateStr(now) };
  }
  if (r === 'custom') {
    // Caller maneja custom — devolvemos lo mismo de 7d como fallback inicial
    const start = new Date(now.getTime() - 7 * 86400000);
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
  },
  {
    key: 'curtailment',
    label: 'Curtailment DC (kWh acumulados)',
    short: 'Curtailment',
    color: '#10b981',
    icon: Sun,
    unit: 'kWh',
    format: (n) => `${n.toFixed(1)} kWh`,
    value: (r) => r.curtailment_kwh,
  },
  {
    key: 'recomendaciones',
    label: 'Recomendaciones (reglas con ≥3 disparos)',
    short: 'Recomendaciones',
    color: '#8b5cf6',
    icon: Lightbulb,
    unit: 'reglas',
    format: (n) => `${n}`,
    value: (r) => r.recomendaciones,
  },
];

const metricMeta = (k: MetricKey) => METRICS.find((m) => m.key === k)!;

// ═══════════════════════════════════════════════════════════════════
// HouseRanking — ranking de casas agrupado por métricas NAR
// ═══════════════════════════════════════════════════════════════════
export function HouseRanking() {
  const [preset, setPreset] = useState<RangePreset>('7d');
  const [customFrom, setCustomFrom] = useState<string>(() => dateStr(new Date(Date.now() - 7 * 86400000)));
  const [customTo, setCustomTo] = useState<string>(() => dateStr(today()));
  const [selected, setSelected] = useState<Set<MetricKey>>(new Set(['alertas']));
  const [sortBy, setSortBy] = useState<MetricKey>('alertas');
  const [selectedCategories, setSelectedCategories] = useState<Set<AlertCategory>>(new Set());
  const [rows, setRows] = useState<RankApiRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [curtailmentMap, setCurtailmentMap] = useState<Map<string, number>>(new Map());
  const [curtailmentLoading, setCurtailmentLoading] = useState(false);
  const [curtailmentError, setCurtailmentError] = useState<string | null>(null);

  // Resolver fechas efectivas según preset o custom
  const { from, to } = useMemo(() => {
    if (preset === 'custom') return { from: customFrom, to: customTo };
    return presetToDates(preset);
  }, [preset, customFrom, customTo]);

  const wantsCurtailment = selected.has('curtailment');
  const categoriesParam = useMemo(
    () => (selectedCategories.size === 0 ? '' : `&categories=${Array.from(selectedCategories).join(',')}`),
    [selectedCategories],
  );

  // Fetch del ranking base (alertas + notif + recomendaciones)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const res = await fetch(`/api/nar/ranking?from=${from}&to=${to}${categoriesParam}`);
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
  }, [from, to, categoriesParam]);

  // Curtailment: fetch separado, cache por rango (BD lo sirve rápido si el cron corrió)
  useEffect(() => {
    if (!wantsCurtailment) return;
    if (curtailmentMap.size > 0) return;
    let cancelled = false;
    (async () => {
      setCurtailmentLoading(true); setCurtailmentError(null);
      try {
        const res = await fetch(`/api/nar/curtailment?from=${from}&to=${to}`);
        const j = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(j.error ?? 'Error');
        const m = new Map<string, number>();
        for (const r of (j.items ?? []) as CurtailmentApiRow[]) m.set(r.casa, r.curtailment_kwh);
        setCurtailmentMap(m);
      } catch (e) {
        if (!cancelled) setCurtailmentError(e instanceof Error ? e.message : 'Error');
      } finally {
        if (!cancelled) setCurtailmentLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [wantsCurtailment, from, to, curtailmentMap]);

  // Invalidar curtailment al cambiar rango
  useEffect(() => { setCurtailmentMap(new Map()); }, [from, to]);

  const toggleMetric = (k: MetricKey) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) {
        if (next.size === 1) return prev;
        next.delete(k);
        if (sortBy === k) setSortBy(Array.from(next)[0]);
      } else {
        next.add(k);
      }
      return next;
    });
  };

  const toggleCategory = (c: AlertCategory) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });
  };

  const selectedMetrics = useMemo(
    () => METRICS.filter((m) => selected.has(m.key)),
    [selected],
  );

  const sortMeta = useMemo(() => metricMeta(sortBy), [sortBy]);

  const enrichedRows = useMemo<RankRow[]>(() => {
    const out: RankRow[] = rows.map((r) => ({ ...r, curtailment_kwh: curtailmentMap.get(r.casa) ?? 0 }));
    const seen = new Set(out.map((r) => r.casa));
    for (const [casa, kwh] of curtailmentMap.entries()) {
      if (seen.has(casa)) continue;
      out.push({ casa, house_id: null, alertas_high: 0, alertas_medium: 0, notificaciones: 0, recomendaciones: 0, curtailment_kwh: kwh });
    }
    return out;
  }, [rows, curtailmentMap]);

  const sortedRows = useMemo(() => {
    const arr = [...enrichedRows];
    arr.sort((a, b) => sortMeta.value(b) - sortMeta.value(a));
    return arr;
  }, [enrichedRows, sortMeta]);

  // Para alertas: barras stacked por severidad (high + medium).
  // Para el resto: una sola barra con el valor total de la métrica.
  const chartData = useMemo(() => {
    if (sortBy === 'alertas') {
      return sortedRows.map((r) => ({
        casa: r.casa,
        high: r.alertas_high,
        medium: r.alertas_medium,
        value: r.alertas_high + r.alertas_medium, // mantenido para el tooltip "Total"
      }));
    }
    return sortedRows.map((r) => ({ casa: r.casa, value: sortMeta.value(r) }));
  }, [sortedRows, sortBy, sortMeta]);

  const isStackedAlertas = sortBy === 'alertas';

  const exportCSV = () => {
    const headers = ['Casa', ...selectedMetrics.map((m) => m.short)];
    const csvRows = sortedRows.map((r) => [r.casa, ...selectedMetrics.map((m) => m.value(r))]);
    downloadCSV(`nar-ranking-${from}-a-${to}.csv`, headers, csvRows);
  };

  const totalCasas = sortedRows.length;
  const casasConDatos = sortedRows.filter((r) => selectedMetrics.some((m) => m.value(r) > 0)).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* CONTROLES — rango + métricas + categorías + descarga */}
      <div className="glass-panel" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Rango: presets + date inputs custom */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            <Calendar size={14} /> Rango:
          </span>
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPreset(p.key)}
              className={`chip ${preset === p.key ? 'active' : ''}`}
              style={{ fontSize: '0.82rem', padding: '6px 12px' }}
            >
              {p.label}
            </button>
          ))}
          {preset === 'custom' && (
            <>
              <input
                type="date"
                value={customFrom}
                max={customTo}
                onChange={(e) => setCustomFrom(e.target.value)}
                style={{ padding: '6px 10px', fontSize: '0.82rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
              />
              <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>→</span>
              <input
                type="date"
                value={customTo}
                min={customFrom}
                max={dateStr(today())}
                onChange={(e) => setCustomTo(e.target.value)}
                style={{ padding: '6px 10px', fontSize: '0.82rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
              />
            </>
          )}
          {preset !== 'custom' && (
            <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
              {from} → {to}
            </span>
          )}
        </div>

        {/* Métricas */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            <BarChart3 size={14} /> Métricas:
          </span>
          {METRICS.map((m) => {
            const Icon = m.icon;
            const isOn = selected.has(m.key);
            return (
              <button
                key={m.key}
                onClick={() => toggleMetric(m.key)}
                title={m.label}
                className={`chip ${isOn ? 'active' : ''}`}
                style={{
                  fontSize: '0.82rem',
                  padding: '6px 12px',
                  borderLeft: `3px solid ${m.color}`,
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

        {/* Filtro de categoría (aplica a alertas/notif/recomendaciones — no a curtailment) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            <Filter size={14} /> Categorías:
          </span>
          <button
            onClick={() => setSelectedCategories(new Set())}
            className={`chip ${selectedCategories.size === 0 ? 'active' : ''}`}
            style={{ fontSize: '0.78rem', padding: '4px 10px' }}
          >
            Todas
          </button>
          {(Object.keys(ALERT_CATEGORIES) as AlertCategory[]).map((c) => {
            const meta = ALERT_CATEGORIES[c];
            const isOn = selectedCategories.has(c);
            return (
              <button
                key={c}
                onClick={() => toggleCategory(c)}
                className={`chip ${isOn ? 'active' : ''}`}
                style={{ fontSize: '0.78rem', padding: '4px 10px', borderLeft: `3px solid ${meta.color}`, display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <span>{meta.icon}</span> {meta.label}
              </button>
            );
          })}
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
          Cargando curtailment… si el cron nocturno no ha corrido aún, esto puede tardar (calcula y persiste para futuras consultas).
        </div>
      )}
      {curtailmentError && (
        <div className="alert-error">Curtailment: {curtailmentError}</div>
      )}

      {/* GRÁFICO horizontal */}
      <div className="glass-panel" style={{ padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10, gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: '0.95rem' }}>
            Ranking por casa — {sortMeta.short}
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            {isStackedAlertas && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 10, height: 10, background: '#ef4444', borderRadius: 2 }} /> Alta
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 10, height: 10, background: '#f59e0b', borderRadius: 2 }} /> Media
                </span>
              </div>
            )}
            <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
              {casasConDatos} de {totalCasas} casas con datos
            </span>
          </div>
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
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
              <YAxis
                type="category"
                dataKey="casa"
                width={140}
                tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
              />
              <Tooltip
                cursor={{ fill: 'var(--bg-elevated)', opacity: 0.4 }}
                contentStyle={{
                  background: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  fontSize: '0.82rem',
                  boxShadow: '0 6px 24px rgba(0,0,0,0.12)',
                }}
                labelStyle={{ color: 'var(--text-primary)', fontWeight: 600 }}
                itemStyle={{ color: 'var(--text-primary)' }}
                formatter={(v, name) => {
                  const n = Number(v) || 0;
                  if (isStackedAlertas) {
                    const label = name === 'high' ? 'Alta' : name === 'medium' ? 'Media' : String(name);
                    return [`${n} ${n === 1 ? 'evento' : 'eventos'}`, label] as [string, string];
                  }
                  return [sortMeta.format(n), sortMeta.short] as [string, string];
                }}
              />
              {isStackedAlertas ? (
                <>
                  <Bar dataKey="high" stackId="alertas" fill="#ef4444" name="high" />
                  <Bar dataKey="medium" stackId="alertas" fill="#f59e0b" name="medium" radius={[0, 4, 4, 0]} />
                </>
              ) : (
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={sortMeta.color} />
                  ))}
                </Bar>
              )}
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
