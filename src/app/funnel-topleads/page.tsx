'use client';

import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Download } from 'lucide-react';
import { StatCard } from '@/components/StatCard';
import { downloadCSV } from '@/lib/csv-export';

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

type SortField = 'numero' | 'fecha_firma' | 'titulo' | 'ciudad' | 'conjunto_residencial' | 'casa' | 'nombre_completo' | 'fecha_estimada_inicio' | 'estudio_estructural' | 'instalacion';
const COLUMNS: Array<{ field: SortField; label: string }> = [
  { field: 'numero', label: '#' },
  { field: 'fecha_firma', label: 'Fecha de firma' },
  { field: 'titulo', label: 'Título' },
  { field: 'ciudad', label: 'Ciudad' },
  { field: 'conjunto_residencial', label: 'Conjunto' },
  { field: 'casa', label: 'Casa' },
  { field: 'nombre_completo', label: 'Nombre completo' },
  { field: 'fecha_estimada_inicio', label: 'Fecha est. inicio' },
  { field: 'estudio_estructural', label: 'Estudio estructural' },
  { field: 'instalacion', label: 'Instalación' },
];

const BANDA_COLOR: Record<string, string> = {
  INTERESADOS: '#3b82f6',
  'EVALUACIÓN': '#84a83d',
  CIERRE: '#e88b2d',
  'EJECUCIÓN': '#0f9d6e',
};

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es-CO') : 'NO FECHA');
const fmtDateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-CO') : 'nunca');

export default function FunnelTopLeadsPage() {
  const [bandas, setBandas] = useState<Banda[]>([]);
  const [funnelCapturedAt, setFunnelCapturedAt] = useState<string | null>(null);
  const [deals, setDeals] = useState<ConstruccionRow[]>([]);
  const [dealsCapturedAt, setDealsCapturedAt] = useState<string | null>(null);
  const [construccionSummary, setConstruccionSummary] = useState<ConstruccionSummary>({ por_instalar: 0, en_instalacion: 0, instalados: 0, legalizandose: 0 });
  const [funnelLoading, setFunnelLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('fecha_firma');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const loadFunnel = useCallback(async () => {
    setFunnelLoading(true);
    try {
      const fRes = await fetch('/api/topleads/funnel-comercial', { cache: 'no-store' });
      const fJson = await fRes.json();
      setBandas(fJson.bandas ?? []);
      setFunnelCapturedAt(fJson.capturedAt ?? null);
    } finally {
      setFunnelLoading(false);
    }
  }, []);

  const loadDeals = useCallback(async () => {
    setTableLoading(true);
    try {
      const dRes = await fetch('/api/topleads/construccion', { cache: 'no-store' });
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
    const timer = window.setTimeout(() => { void loadDeals(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDeals]);
  useEffect(() => {
    const interval = window.setInterval(() => { loadDeals(); }, 60_000);
    return () => window.clearInterval(interval);
  }, [loadDeals]);

  const filteredDeals = deals.filter((d) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return [d.titulo, d.ciudad, d.conjunto_residencial, d.casa, d.nombre_completo, d.zona]
      .some((v) => (v ?? '').toString().toLowerCase().includes(q));
  });
  const sortedDeals = [...filteredDeals].sort((a, b) => {
    const av = a[sortField]; const bv = b[sortField];
    let cmp: number;
    if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
    else cmp = (av ?? '').toString().localeCompare((bv ?? '').toString(), 'es');
    return sortDir === 'asc' ? cmp : -cmp;
  });

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
      `bd-clientes-firmados-construccion-${new Date().toISOString().slice(0, 10)}.csv`,
      ['#', 'Fecha de firma', 'Días', 'Título', 'CIUDAD', 'Conjunto Residencial', 'Casa', 'Nombre Completo', 'Fecha estimada inicio', 'DÍAS', 'Estudio estructural', 'Instalación', 'Zona'],
      sortedDeals.map((d) => [
        d.numero, fmtDate(d.fecha_firma), d.dias_desde_firma ?? '', d.titulo, d.ciudad ?? '',
        d.conjunto_residencial ?? '', d.casa ?? '', d.nombre_completo ?? '', fmtDate(d.fecha_estimada_inicio),
        d.dias_para_inicio ?? 'NO FECHA', d.estudio_estructural, d.instalacion ?? '', d.zona,
      ]),
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.3rem' }}>Dash Comercial</h1>
        </div>
        <button className="secondary-btn" onClick={refreshNow} disabled={refreshing}>
          <RefreshCw size={14} /> {refreshing ? 'Actualizando…' : 'Actualizar ahora'}
        </button>
      </div>

      {error && <div className="alert-error">{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16, alignItems: 'stretch' }}>
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
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por título, ciudad, conjunto, casa, cliente o zona…"
          style={{ width: '100%', marginBottom: 12 }}
        />
        {tableLoading ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Cargando…</p>
        ) : deals.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Sin casas firmadas todavía.</p>
        ) : sortedDeals.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Ninguna coincide con la búsqueda.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ background: 'var(--bg-elevated)', textAlign: 'left' }}>
                  {COLUMNS.map((c) => (
                    <th key={c.field} style={{ padding: '7px 9px', fontSize: '0.64rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                      <button
                        onClick={() => {
                          if (sortField === c.field) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
                          else { setSortField(c.field); setSortDir('asc'); }
                        }}
                        style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: 'inherit', textTransform: 'inherit', letterSpacing: 'inherit' }}
                      >
                        {c.label}
                        {sortField === c.field && <span>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedDeals.map((d) => (
                  <tr key={d.numero} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: 7 }}>{d.numero}</td>
                    <td style={{ padding: 7 }}>{fmtDate(d.fecha_firma)}</td>
                    <td style={{ padding: 7, fontWeight: 600, maxWidth: 260 }}>{d.titulo}</td>
                    <td style={{ padding: 7 }}>{d.ciudad ?? '—'}</td>
                    <td style={{ padding: 7 }}>{d.conjunto_residencial ?? '—'}</td>
                    <td style={{ padding: 7 }}>{d.casa ?? '—'}</td>
                    <td style={{ padding: 7 }}>{d.nombre_completo ?? '—'}</td>
                    <td style={{ padding: 7 }}>{fmtDate(d.fecha_estimada_inicio)}</td>
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
