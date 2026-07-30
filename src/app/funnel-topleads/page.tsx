'use client';

import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Download, TrendingDown } from 'lucide-react';
import { StatCard } from '@/components/StatCard';
import { downloadCSV } from '@/lib/csv-export';

interface FunnelStage {
  stage_id: string;
  stage_title: string;
  stage_order: number;
  deals_count: number;
  deals_value_total: number;
}

interface ConstruccionDeal {
  id: string;
  ac_deal_id: string;
  title: string;
  stage_title: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  value: number;
  ac_created_at: string | null;
  ac_updated_at: string | null;
}

const fmtCOP = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es-CO') : '—');
const fmtDateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-CO') : 'nunca');

export default function FunnelTopLeadsPage() {
  const [stages, setStages] = useState<FunnelStage[]>([]);
  const [funnelCapturedAt, setFunnelCapturedAt] = useState<string | null>(null);
  const [deals, setDeals] = useState<ConstruccionDeal[]>([]);
  const [dealsCapturedAt, setDealsCapturedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [fRes, dRes] = await Promise.all([
      fetch('/api/topleads/funnel'),
      fetch('/api/topleads/construccion'),
    ]);
    const fJson = await fRes.json();
    const dJson = await dRes.json();
    setStages(fJson.stages ?? []);
    setFunnelCapturedAt(fJson.capturedAt ?? null);
    setDeals(dJson.deals ?? []);
    setDealsCapturedAt(dJson.capturedAt ?? null);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const refreshNow = async () => {
    setRefreshing(true);
    setError(null);
    const res = await fetch('/api/cron/topleads-funnel', { headers: { 'x-trigger': 'manual' } });
    const json = await res.json();
    if (!res.ok || !json.ok) { setError(json.error ?? 'No se pudo refrescar'); setRefreshing(false); return; }
    await load();
    setRefreshing(false);
  };

  const downloadDeals = () => {
    downloadCSV(
      `bd-clientes-firmados-construccion-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Proyecto', 'Etapa', 'Contacto', 'Email', 'Teléfono', 'Valor', 'Creado', 'Actualizado'],
      deals.map((d) => [
        d.title, d.stage_title, d.contact_name ?? '', d.contact_email ?? '', d.contact_phone ?? '',
        d.value, fmtDate(d.ac_created_at), fmtDate(d.ac_updated_at),
      ]),
    );
  };

  const maxCount = Math.max(1, ...stages.map((s) => s.deals_count));
  const totalDeals = stages.reduce((s, r) => s + r.deals_count, 0);
  const totalValue = stages.reduce((s, r) => s + r.deals_value_total, 0);
  const firmados = stages.find((s) => s.stage_title === 'Contrato firmado')?.deals_count ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.3rem' }}>Funnel TopLeads</h1>
          <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Pipeline de ventas &ldquo;Prospectos Sunny&rdquo; — actualizado {fmtDateTime(funnelCapturedAt)}.
          </p>
        </div>
        <button className="secondary-btn" onClick={refreshNow} disabled={refreshing}>
          <RefreshCw size={14} /> {refreshing ? 'Actualizando…' : 'Actualizar ahora'}
        </button>
      </div>

      {error && <div className="alert-error">{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <StatCard label="Deals en el funnel" value={String(totalDeals)} hint="pipeline Prospectos Sunny" />
        <StatCard label="Valor total en pipeline" value={fmtCOP(totalValue)} hint="suma de todas las etapas" />
        <StatCard label="Contrato firmado" value={String(firmados)} hint="etapa de conversión" />
      </div>

      <section className="card">
        <div className="card-header"><span className="card-title">Funnel por etapa</span></div>
        {loading ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Cargando…</p>
        ) : stages.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Sin datos todavía — tocá &ldquo;Actualizar ahora&rdquo; para traer la primera foto de TopLeads.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {stages.map((s) => (
              <div key={s.stage_id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 190, fontSize: '0.8rem', color: 'var(--text-secondary)', flexShrink: 0 }}>{s.stage_title}</div>
                <div style={{ flex: 1, background: 'var(--bg-elevated)', borderRadius: 6, overflow: 'hidden', height: 26, position: 'relative' }}>
                  <div
                    style={{
                      width: `${Math.max(2, (s.deals_count / maxCount) * 100)}%`,
                      height: '100%',
                      background: 'var(--accent)',
                      borderRadius: 6,
                      transition: 'width .2s ease',
                    }}
                  />
                  <span style={{ position: 'absolute', left: 10, top: 0, height: '100%', display: 'flex', alignItems: 'center', fontSize: '0.76rem', fontWeight: 700, color: '#fff', mixBlendMode: 'difference' }}>
                    {s.deals_count}
                  </span>
                </div>
                <div style={{ width: 130, textAlign: 'right', fontSize: '0.78rem', color: 'var(--text-muted)', flexShrink: 0 }}>{fmtCOP(s.deals_value_total)}</div>
              </div>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 6 }}>
              <TrendingDown size={13} /> Orden = el mismo de las etapas del pipeline en TopLeads.
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-header">
          <span className="card-title">BD Clientes Firmados Construcción</span>
          <button className="secondary-btn" onClick={downloadDeals} disabled={deals.length === 0}>
            <Download size={14} /> Descargar
          </button>
        </div>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 0 }}>
          Todos los proyectos del pipeline &ldquo;Constructoras&rdquo; de TopLeads (el CRM de construcción) — actualizado {fmtDateTime(dealsCapturedAt)}.
        </p>
        {loading ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Cargando…</p>
        ) : deals.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Sin datos todavía.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ background: 'var(--bg-elevated)', textAlign: 'left' }}>
                  {['Proyecto', 'Etapa', 'Contacto', 'Valor', 'Creado', 'Actualizado'].map((h) => (
                    <th key={h} style={{ padding: '8px 10px', fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {deals.map((d) => (
                  <tr key={d.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: 8, fontWeight: 600 }}>{d.title}</td>
                    <td style={{ padding: 8 }}><span className="badge-warning">{d.stage_title}</span></td>
                    <td style={{ padding: 8 }}>{d.contact_name ?? '—'}</td>
                    <td style={{ padding: 8 }}>{fmtCOP(d.value)}</td>
                    <td style={{ padding: 8 }}>{fmtDate(d.ac_created_at)}</td>
                    <td style={{ padding: 8 }}>{fmtDate(d.ac_updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
