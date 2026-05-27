'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Filter as FilterIcon, RefreshCw, TrendingUp, DollarSign, Zap, CheckCircle2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts';
import { SALES_STAGES, ENGINEERING_STAGES, OPERATIONS_STAGES, MODULE_META } from '@/lib/crm-stages';

interface FunnelProject {
  id: string;
  code: string;
  title: string;
  current_module: 'sales' | 'engineering' | 'operations' | 'closed';
  sales_stage: string;
  engineering_stage: string;
  operations_stage: string;
  client_name: string | null;
  client_city: string | null;
  invoice_kwh_mensual: number | null;
  propuesta_kwp: number | null;
  propuesta_valor_cop: number | null;
  diseno_kwp: number | null;
  contractor_name: string | null;
  installation_date: string | null;
  operativo_at: string | null;
  legalizado_at: string | null;
  created_at: string;
  updated_at: string;
}

interface FunnelData {
  total: number;
  by_module: Record<string, Record<string, number>>;
  stats: {
    total_valor_propuesta_cop: number;
    total_kwp_aprobado: number;
    cerrados: number;
    operativos: number;
    legalizados: number;
  };
  projects: FunnelProject[];
}

export default function FunnelPage() {
  const [data, setData] = useState<FunnelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [moduleFilter, setModuleFilter] = useState<'all' | 'sales' | 'engineering' | 'operations' | 'closed'>('all');

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch('/api/crm/funnel', { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Error');
      setData(j as FunnelData);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  // Funnel ordenado: todas las etapas en secuencia con conteos
  const funnelStages = useMemo(() => {
    if (!data) return [];
    const out: Array<{ key: string; label: string; module: string; color: string; count: number }> = [];
    for (const s of SALES_STAGES) {
      if (s.key === 'completado') continue;
      out.push({ key: `sales_${s.key}`, label: s.shortLabel, module: 'Ventas', color: MODULE_META.sales.color, count: data.by_module.sales?.[s.key] ?? 0 });
    }
    for (const s of ENGINEERING_STAGES) {
      if (s.key === 'completado') continue;
      out.push({ key: `engineering_${s.key}`, label: s.shortLabel, module: 'Ingeniería', color: MODULE_META.engineering.color, count: data.by_module.engineering?.[s.key] ?? 0 });
    }
    for (const s of OPERATIONS_STAGES) {
      if (s.key === 'completado') continue;
      out.push({ key: `operations_${s.key}`, label: s.shortLabel, module: 'Operaciones', color: MODULE_META.operations.color, count: data.by_module.operations?.[s.key] ?? 0 });
    }
    out.push({ key: 'closed', label: 'Cerrado', module: 'Cerrado', color: '#10b981', count: data.by_module.closed?.completado ?? 0 });
    return out;
  }, [data]);

  const filteredProjects = useMemo(() => {
    if (!data) return [];
    if (moduleFilter === 'all') return data.projects;
    return data.projects.filter((p) => p.current_module === moduleFilter);
  }, [data, moduleFilter]);

  const conversion = useMemo(() => {
    if (!data) return null;
    const totalEnVentas = Object.values(data.by_module.sales ?? {}).reduce((a, b) => a + b, 0);
    const totalEnIngeniera = Object.values(data.by_module.engineering ?? {}).reduce((a, b) => a + b, 0);
    const totalEnOperaciones = Object.values(data.by_module.operations ?? {}).reduce((a, b) => a + b, 0);
    const totalCerrados = data.by_module.closed?.completado ?? 0;
    const acumPaso2 = totalEnIngeniera + totalEnOperaciones + totalCerrados;
    const acumPaso3 = totalEnOperaciones + totalCerrados;
    const total = totalEnVentas + acumPaso2;
    return {
      total,
      v_to_i: total > 0 ? (acumPaso2 / total) * 100 : 0,
      i_to_o: acumPaso2 > 0 ? (acumPaso3 / acumPaso2) * 100 : 0,
      o_to_closed: acumPaso3 > 0 ? (totalCerrados / acumPaso3) * 100 : 0,
    };
  }, [data]);

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', paddingBottom: 40 }}>
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <TrendingUp size={24} style={{ color: 'var(--accent)' }} />
          <h1 style={{ margin: 0 }}>Funnel de Proyectos</h1>
        </div>
        <p style={{ color: 'var(--text-secondary)', marginTop: 4, fontSize: '0.88rem' }}>
          Seguimiento end-to-end del pipeline: ventas → ingeniería → operaciones → cerrado. Identifica cuellos de botella y proyectos atascados.
        </p>
      </div>

      {loading && !data && <div className="glass-panel" style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Cargando…</div>}
      {err && <div className="alert-error" style={{ marginBottom: 14 }}>{err}</div>}

      {data && (
        <>
          {/* KPI cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 18 }}>
            <KpiCard label="Total proyectos" value={data.total.toString()} Icon={TrendingUp} color="#07c5a8" />
            <KpiCard label="Valor pipeline" value={`$${(data.stats.total_valor_propuesta_cop / 1_000_000).toFixed(1)} M`} sub="propuestas firmadas en curso" Icon={DollarSign} color="#3b82f6" />
            <KpiCard label="kWp aprobados" value={data.stats.total_kwp_aprobado.toFixed(1)} sub="en alistamiento o más adelante" Icon={Zap} color="#f59e0b" />
            <KpiCard label="Operativos" value={data.stats.operativos.toString()} sub={`${data.stats.legalizados} legalizados`} Icon={CheckCircle2} color="#10b981" />
          </div>

          {/* Tasas de conversión entre módulos */}
          {conversion && (
            <div className="glass-panel" style={{ padding: 14, marginBottom: 14 }}>
              <h3 style={{ margin: '0 0 10px', fontSize: '0.95rem' }}>Tasas de conversión entre módulos</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                <ConvCard from="Ventas" to="Ingeniería" pct={conversion.v_to_i} />
                <ConvCard from="Ingeniería" to="Operaciones" pct={conversion.i_to_o} />
                <ConvCard from="Operaciones" to="Cerrado" pct={conversion.o_to_closed} />
              </div>
            </div>
          )}

          {/* Funnel chart */}
          <div className="glass-panel" style={{ padding: 14, marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: '0.95rem' }}>Distribución por etapa</h3>
              <button onClick={load} className="secondary-btn" style={{ fontSize: '0.78rem', padding: '6px 10px' }}>
                <RefreshCw size={12} /> Actualizar
              </button>
            </div>
            <div style={{ width: '100%', height: 340 }}>
              <ResponsiveContainer>
                <BarChart data={funnelStages} layout="vertical" margin={{ top: 5, right: 30, left: 100, bottom: 5 }}>
                  <CartesianGrid stroke="rgba(0,0,0,0.06)" />
                  <XAxis type="number" allowDecimals={false} stroke="var(--text-muted)" fontSize={11} />
                  <YAxis type="category" dataKey="label" width={140} stroke="var(--text-muted)" fontSize={11} />
                  <Tooltip contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: '0.8rem' }} formatter={(v) => [`${v} proyectos`, '']} />
                  <Bar dataKey="count">
                    {funnelStages.map((s) => <Cell key={s.key} fill={s.color} />)}
                    <LabelList dataKey="count" position="right" style={{ fill: 'var(--text-primary)', fontSize: 11, fontWeight: 600 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={{ display: 'flex', gap: 14, fontSize: '0.74rem', marginTop: 8, flexWrap: 'wrap' }}>
              {Object.entries(MODULE_META).filter(([k]) => k !== 'closed').map(([k, m]) => (
                <div key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: m.color }} />
                  <span>{m.label}</span>
                </div>
              ))}
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: '#10b981' }} />
                <span>Cerrado</span>
              </div>
            </div>
          </div>

          {/* Filtro + Tabla */}
          <div className="glass-panel" style={{ padding: 14, marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
              <FilterIcon size={14} style={{ color: 'var(--text-muted)' }} />
              <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>Filtrar tabla por módulo actual:</span>
              <button className={`chip ${moduleFilter === 'all' ? 'active' : ''}`} onClick={() => setModuleFilter('all')}>Todos ({data.projects.length})</button>
              {(['sales', 'engineering', 'operations', 'closed'] as const).map((m) => {
                const count = m === 'closed' ? data.by_module.closed?.completado ?? 0 : Object.values(data.by_module[m] ?? {}).reduce((a, b) => a + b, 0);
                return (
                  <button key={m} className={`chip ${moduleFilter === m ? 'active' : ''}`} onClick={() => setModuleFilter(m)} style={{ borderLeft: `3px solid ${MODULE_META[m].color}` }}>
                    {MODULE_META[m].label} ({count})
                  </button>
                );
              })}
            </div>
          </div>

          <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: '0.82rem' }}>
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Proyecto</th>
                    <th>Módulo actual</th>
                    <th>Etapa</th>
                    <th>kWp</th>
                    <th>Valor</th>
                    <th>Actualizado</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProjects.map((p) => {
                    const modMeta = MODULE_META[p.current_module];
                    const stageKey = p.current_module === 'sales' ? p.sales_stage
                      : p.current_module === 'engineering' ? p.engineering_stage
                      : p.current_module === 'operations' ? p.operations_stage
                      : 'completado';
                    const stageList = p.current_module === 'sales' ? SALES_STAGES
                      : p.current_module === 'engineering' ? ENGINEERING_STAGES
                      : p.current_module === 'operations' ? OPERATIONS_STAGES
                      : [];
                    const stageMeta = stageList.find((s) => s.key === stageKey);
                    const detailHref = p.current_module === 'sales' ? '/ventas'
                      : p.current_module === 'engineering' ? '/ingenieria'
                      : p.current_module === 'operations' ? '/operaciones'
                      : '/funnel';
                    return (
                      <tr key={p.id} style={{ borderLeft: `3px solid ${modMeta.color}` }}>
                        <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.72rem' }}>
                          <Link href={detailHref} style={{ color: 'var(--accent)', textDecoration: 'none' }}>{p.code}</Link>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{p.title}</div>
                          {p.client_name && <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{p.client_name}{p.client_city && ` · ${p.client_city}`}</div>}
                        </td>
                        <td>
                          <span style={{ padding: '2px 10px', borderRadius: 10, background: modMeta.color + '20', color: modMeta.color, fontSize: '0.7rem', fontWeight: 700 }}>{modMeta.label}</span>
                        </td>
                        <td>
                          {stageMeta && <span style={{ fontSize: '0.78rem', color: stageMeta.color, fontWeight: 600 }}>{stageMeta.shortLabel}</span>}
                          {!stageMeta && p.current_module === 'closed' && <span style={{ fontSize: '0.78rem', color: '#10b981', fontWeight: 600 }}>Cerrado</span>}
                        </td>
                        <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem' }}>
                          {p.diseno_kwp ?? p.propuesta_kwp ?? '—'}
                        </td>
                        <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem' }}>
                          {p.propuesta_valor_cop ? `$${(Number(p.propuesta_valor_cop) / 1_000_000).toFixed(1)}M` : '—'}
                        </td>
                        <td style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{new Date(p.updated_at).toLocaleDateString('es-CO')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filteredProjects.length === 0 && (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Sin proyectos en este filtro.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({ label, value, sub, color, Icon }: { label: string; value: string; sub?: string; color: string; Icon: typeof TrendingUp }) {
  return (
    <div className="glass-panel" style={{ padding: 16, borderLeft: `4px solid ${color}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>{label}</div>
        <Icon size={16} style={{ color, opacity: 0.6 }} />
      </div>
      <div style={{ fontSize: '1.6rem', fontWeight: 700, color, marginTop: 4, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function ConvCard({ from, to, pct }: { from: string; to: string; pct: number }) {
  const color = pct >= 70 ? '#10b981' : pct >= 40 ? '#f59e0b' : '#ef4444';
  return (
    <div style={{ padding: 12, background: 'var(--bg-elevated)', borderRadius: 8, borderLeft: `3px solid ${color}` }}>
      <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginBottom: 4 }}>{from} → {to}</div>
      <div style={{ fontSize: '1.4rem', fontWeight: 700, color }}>{pct.toFixed(1)}%</div>
      <div style={{ marginTop: 6, height: 4, background: 'var(--bg-surface)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: color }} />
      </div>
    </div>
  );
}
