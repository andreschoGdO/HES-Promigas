'use client';

import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Download } from 'lucide-react';
import { StatCard } from '@/components/StatCard';
import { downloadCSV } from '@/lib/csv-export';

interface FunnelBar {
  key: string;
  label: string;
  value: number;
}

interface BandaFila {
  label: string;
  value: number;
  activos?: boolean;
}

interface Banda {
  nombre: string;
  total: number;
  filas: BandaFila[];
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

const BANDA_COLOR: Record<string, string> = {
  INTERESADOS: '#3b82f6',
  'EVALUACIÓN': '#84a83d',
  CIERRE: '#e88b2d',
  'EJECUCIÓN': '#0f9d6e',
};

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es-CO') : 'NO FECHA');
const fmtDateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-CO') : 'nunca');

export default function FunnelTopLeadsPage() {
  const [funnel, setFunnel] = useState<FunnelBar[]>([]);
  const [bandas, setBandas] = useState<Banda[]>([]);
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
      const fRes = await fetch('/api/topleads/funnel-comercial', { cache: 'no-store' });
      const fJson = await fRes.json();
      setFunnel(fJson.funnel ?? []);
      setBandas(fJson.bandas ?? []);
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
    try {
      await loadFunnel();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo refrescar');
    } finally {
      setRefreshing(false);
    }
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

  const totalLeads = funnel.find((f) => f.key === 'total')?.value ?? 0;
  const maxFunnel = Math.max(1, ...funnel.map((f) => f.value));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.3rem' }}>Funnel Comercial</h1>
        </div>
        <button className="secondary-btn" onClick={refreshNow} disabled={refreshing}>
          <RefreshCw size={14} /> {refreshing ? 'Actualizando…' : 'Actualizar ahora'}
        </button>
      </div>

      {error && <div className="alert-error">{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16, alignItems: 'stretch' }}>
        <section className="card">
          <div className="card-header"><span className="card-title">Funnel</span></div>
          {funnelLoading ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Cargando…</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {funnel.map((f) => {
                const pct = totalLeads > 0 ? (f.value / totalLeads) * 100 : 0;
                const isPerdidos = f.key === 'perdidos';
                return (
                  <div key={f.key}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: 4 }}>
                      <span style={{ fontWeight: 600 }}>{f.label}</span>
                      <span><strong>{f.value}</strong> <span style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>{pct.toFixed(0)}% del total</span></span>
                    </div>
                    <div style={{ background: 'var(--bg-elevated)', borderRadius: 6, height: 8, overflow: 'hidden' }}>
                      <div style={{
                        width: `${Math.max(1, (f.value / maxFunnel) * 100)}%`,
                        height: '100%',
                        background: isPerdidos ? 'var(--error)' : 'var(--accent)',
                        borderRadius: 6,
                      }} />
                    </div>
                  </div>
                );
              })}
              <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', margin: 0 }}>
                Los % indican cuántos de los {totalLeads} leads totales llegaron a cada etapa. Cada etapa es acumulada (incluye las siguientes).
              </p>
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-header"><span className="card-title">Tabla de control</span></div>
          {funnelLoading ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Cargando…</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {bandas.map((b) => (
                <div key={b.nombre} style={{ display: 'flex', gap: 10 }}>
                  <div style={{
                    width: 22, flexShrink: 0, borderRadius: 4, background: BANDA_COLOR[b.nombre] ?? 'var(--accent)',
                    color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    writingMode: 'vertical-rl', textOrientation: 'mixed', fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.04em', padding: '6px 0',
                  }}>
                    {b.nombre}
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    {b.filas.map((f) => (
                      <div key={f.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--border)', fontSize: '0.8rem' }}>
                        <span>
                          {f.label}
                          {f.activos && <span className="badge-success" style={{ marginLeft: 6, fontSize: '0.6rem' }}>ACTIVOS</span>}
                        </span>
                        <strong>{f.value}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-header"><span className="card-title">Estado real de Construcción</span></div>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 0 }}>
          Datos vivos del CRM: obras por instalar, en ejecución e instaladas.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))', gap: 12 }}>
          <StatCard label="Por instalar" value={String(construccionSummary.por_instalar)} hint="dimensionado o alistamiento" />
          <StatCard label="En instalación" value={String(construccionSummary.en_instalacion)} hint="obra en curso" />
          <StatCard label="Instalados" value={String(construccionSummary.instalados)} hint="operativos" />
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <span className="card-title">BD Clientes Firmados Construcción</span>
          <button className="secondary-btn" onClick={downloadDeals} disabled={deals.length === 0}>
            <Download size={14} /> Descargar
          </button>
        </div>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 0 }}>
          Todas las casas con contrato firmado — congruente con &ldquo;Firmado&rdquo; del funnel de arriba. En vivo del CRM, {fmtDateTime(dealsCapturedAt)}.
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
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Sin casas firmadas en esta zona todavía.</p>
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
