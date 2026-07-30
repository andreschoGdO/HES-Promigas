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

interface ConstruccionRow {
  numero: number;
  fecha_firma: string | null;
  dias_desde_firma: number | null;
  titulo: string;
  ciudad: string | null;
  conjunto_residencial: string | null;
  casa: string | null;
  nombre_completo: string | null;
  fecha_estimada_inicio: string | null;
  dias_para_inicio: number | null;
  estudio_estructural: string;
  instalacion: string | null;
  zona: 'Valle' | 'Costa' | 'Sin zona';
  operations_stage: string;
}

interface ConstruccionSummary {
  por_instalar: number;
  en_instalacion: number;
  instalados: number;
  legalizandose: number;
}

type ZonaFiltro = 'todas' | 'Valle' | 'Costa';

const fmtCOP = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es-CO') : 'NO FECHA');
const fmtDateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-CO') : 'nunca');

export default function FunnelTopLeadsPage() {
  const [stages, setStages] = useState<FunnelStage[]>([]);
  const [funnelCapturedAt, setFunnelCapturedAt] = useState<string | null>(null);
  const [deals, setDeals] = useState<ConstruccionRow[]>([]);
  const [dealsCapturedAt, setDealsCapturedAt] = useState<string | null>(null);
  const [construccionSummary, setConstruccionSummary] = useState<ConstruccionSummary>({ por_instalar: 0, en_instalacion: 0, instalados: 0, legalizandose: 0 });
  const [zona, setZona] = useState<ZonaFiltro>('todas');
  const [funnelLoading, setFunnelLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFunnel = useCallback(async () => {
    setFunnelLoading(true);
    try {
      const fRes = await fetch('/api/topleads/funnel', { cache: 'no-store' });
      const fJson = await fRes.json();
      setStages(fJson.stages ?? []);
      setFunnelCapturedAt(fJson.capturedAt ?? null);
    } finally {
      setFunnelLoading(false);
    }
  }, []);

  const loadDeals = useCallback(async (zonaFiltro: ZonaFiltro) => {
    setTableLoading(true);
    const qs = zonaFiltro === 'todas' ? '' : `?zona=${zonaFiltro}`;
    try {
      const dRes = await fetch(`/api/topleads/construccion${qs}`, { cache: 'no-store' });
      const dJson = await dRes.json();
      setDeals(dJson.deals ?? []);
      setConstruccionSummary(dJson.summary ?? { por_instalar: 0, en_instalacion: 0, instalados: 0, legalizandose: 0 });
      setDealsCapturedAt(dJson.capturedAt ?? null);
    } finally {
      setTableLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadFunnel(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadFunnel]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadDeals(zona); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDeals, zona]);
  useEffect(() => {
    const interval = window.setInterval(() => { loadDeals(zona); }, 60_000);
    return () => window.clearInterval(interval);
  }, [loadDeals, zona]);

  const refreshNow = async () => {
    setRefreshing(true);
    setError(null);
    const res = await fetch('/api/cron/topleads-funnel', { headers: { 'x-trigger': 'manual' } });
    const json = await res.json();
    if (!res.ok || !json.ok) { setError(json.error ?? 'No se pudo refrescar'); setRefreshing(false); return; }
    await loadFunnel();
    setRefreshing(false);
  };

  const downloadDeals = () => {
    downloadCSV(
      `bd-clientes-firmados-construccion-${zona === 'todas' ? 'todas' : zona.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`,
      ['#', 'Fecha de firma', 'Días', 'Título', 'CIUDAD', 'Conjunto Residencial', 'Casa', 'Nombre Completo', 'Fecha estimada inicio', 'DÍAS', 'Estudio estructural', 'Instalación', 'Zona'],
      deals.map((d) => [
        d.numero, fmtDate(d.fecha_firma), d.dias_desde_firma ?? '', d.titulo, d.ciudad ?? '',
        d.conjunto_residencial ?? '', d.casa ?? '', d.nombre_completo ?? '', fmtDate(d.fecha_estimada_inicio),
        d.dias_para_inicio ?? 'NO FECHA', d.estudio_estructural, d.instalacion ?? '', d.zona,
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
          <h1 style={{ margin: 0, fontSize: '1.3rem' }}>Funnel Comercial</h1>
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
        <StatCard label="Deals en el funnel" value={String(totalDeals)} hint="pipeline Prospectos Sunny, abiertos" />
        <StatCard label="Valor total en pipeline" value={fmtCOP(totalValue)} hint="suma de todas las etapas" />
        <StatCard label="Contrato firmado" value={String(firmados)} hint="etapa de conversión" />
      </div>

      <section className="card">
        <div className="card-header"><span className="card-title">Funnel por etapa</span></div>
        {funnelLoading ? (
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
              <TrendingDown size={13} /> Orden = el mismo de las etapas del pipeline en TopLeads. Solo deals abiertos (no Ganados/Perdidos).
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-header"><span className="card-title">Estado real de Construcción</span></div>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 0 }}>
          Datos vivos del CRM: obras por instalar, en ejecución, instaladas y en legalización.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))', gap: 12 }}>
          <StatCard label="Por instalar" value={String(construccionSummary.por_instalar)} hint="dimensionado o alistamiento" />
          <StatCard label="En instalación" value={String(construccionSummary.en_instalacion)} hint="obra en curso" />
          <StatCard label="Instalados" value={String(construccionSummary.instalados)} hint="operativos" />
          <StatCard label="Legalizándose" value={String(construccionSummary.legalizandose)} hint="trámite AGPE" />
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <span className="card-title">Obras activas de Construcción</span>
          <button className="secondary-btn" onClick={downloadDeals} disabled={deals.length === 0}>
            <Download size={14} /> Descargar
          </button>
        </div>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 0 }}>
          Datos en vivo del CRM de Construcción; esta tabla se actualiza sola cada minuto, {fmtDateTime(dealsCapturedAt)}.
        </p>
        <div className="tabs" style={{ marginBottom: 14 }}>
          {(['todas', 'Valle', 'Costa'] as ZonaFiltro[]).map((z) => (
            <button key={z} className={`tab ${zona === z ? 'active' : ''}`} onClick={() => setZona(z)}>
              {z === 'todas' ? 'Todas' : z}
            </button>
          ))}
        </div>
        {tableLoading ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Cargando…</p>
        ) : deals.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Sin obras activas de Construcción en esta zona todavía.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ background: 'var(--bg-elevated)', textAlign: 'left' }}>
                  {['#', 'Fecha de firma', 'Días', 'Título', 'CIUDAD', 'Conjunto', 'Casa', 'Nombre completo', 'Fecha est. inicio', 'DÍAS', 'Estudio estructural', 'Instalación'].map((h) => (
                    <th key={h} style={{ padding: '7px 9px', fontSize: '0.64rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {deals.map((d) => (
                  <tr key={d.numero} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: 7 }}>{d.numero}</td>
                    <td style={{ padding: 7 }}>{fmtDate(d.fecha_firma)}</td>
                    <td style={{ padding: 7 }}>{d.dias_desde_firma ?? '—'}</td>
                    <td style={{ padding: 7, fontWeight: 600, maxWidth: 260 }}>{d.titulo}</td>
                    <td style={{ padding: 7 }}>{d.ciudad ?? '—'}</td>
                    <td style={{ padding: 7 }}>{d.conjunto_residencial ?? '—'}</td>
                    <td style={{ padding: 7 }}>{d.casa ?? '—'}</td>
                    <td style={{ padding: 7 }}>{d.nombre_completo ?? '—'}</td>
                    <td style={{ padding: 7 }}>{fmtDate(d.fecha_estimada_inicio)}</td>
                    <td style={{ padding: 7 }}>{d.dias_para_inicio ?? 'NO FECHA'}</td>
                    <td style={{ padding: 7 }}>
                      <span className={d.estudio_estructural === 'APROBADO' ? 'badge-success' : 'badge-warning'}>{d.estudio_estructural}</span>
                    </td>
                    <td style={{ padding: 7 }}>{d.instalacion ?? '—'}</td>
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
