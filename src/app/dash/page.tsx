'use client';

import { useEffect, useState } from 'react';
import { Download, Sun, RefreshCw } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LabelList,
  LineChart, Line, CartesianGrid,
} from 'recharts';
import { generateDashPDF } from '@/lib/dash-pdf';
import { generateDashPPTX } from '@/lib/dash-pptx';
import { DEFAULT_REPORT, type DashReport } from '@/lib/dash-report-data';
import { StatCard } from '@/components/StatCard';
import { SimpleTable, PaginatedTable } from '@/components/DataTable';

const ACCENT = '#07c5a8';
const MARCA_COLORS = ['#07c5a8', '#3b82f6', '#f59e0b', '#8b5cf6'];

const fmtInt = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 1 });
const fmt1   = (n: number) => n.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Watt-peak por panel para calcular cuántos paneles equivalen a un kWp acumulado. */
const PANEL_WP = 595;
const KWH_POR_BATERIA = 5.1;  // Livoltek HV promedio
const TRM_COP = 3901.29;      // TRM operativa (mig 46 tiene los USD/Wp calculados con la TRM del cierre)

/**
 * Formatter para <LabelList> de Recharts. Acepta el tipo ancho (RenderableText,
 * puede venir undefined/string/number) y devuelve string vacío para ceros o
 * valores no numéricos — así no aparecen "0" ni "NaN" en la gráfica.
 */
const fmtLabel = (v: unknown): string => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? String(n) : '';
};

/* ─────────────── GANTT + CURVA S — helpers y tipos ─────────────── */
const DAY_MS = 24 * 60 * 60 * 1000;
const daysBetween = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / DAY_MS);
// `new Date('YYYY-MM-DD')` parsea como UTC medianoche; sumar/leer con
// getDate/setDate (locales) en un timezone detrás de UTC (Colombia, UTC-5)
// devuelve el día anterior — cada etiqueta del eje del Gantt salía corrida
// un día hacia atrás respecto a cronograma_fecha_inicio/installation_date
// real. Fix: quedarse en UTC de punta a punta (parseo, suma y formato).
const addDaysLabel = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', timeZone: 'UTC' });
};

interface FunnelBandaFila { label: string; value: number; activos?: boolean }
interface FunnelBanda { nombre: string; total: number; filas: FunnelBandaFila[] }

/** Secciones que se pueden activar/desactivar desde el panel al final del dashboard. */
type SectionKey =
  | 'resumenEjecucion' | 'avanceGlobal' | 'detalleGlobal' | 'ordenesCompra'
  | 'construccion' | 'gantt' | 'curvaS' | 'legalizaciones' | 'postventa' | 'logistica';
const SECTION_DEFS: { key: SectionKey; label: string }[] = [
  { key: 'resumenEjecucion', label: 'Resumen de ejecución (ventas)' },
  { key: 'avanceGlobal', label: 'Avance global' },
  { key: 'detalleGlobal', label: 'Detalle por marca, zona y constructor' },
  { key: 'ordenesCompra', label: 'Desglose Órdenes de Compra' },
  { key: 'construccion', label: 'Construcción (semanal)' },
  { key: 'gantt', label: 'Gantt de obra' },
  { key: 'curvaS', label: 'Curva S' },
  { key: 'legalizaciones', label: 'Legalizaciones' },
  { key: 'postventa', label: 'Postventa' },
  { key: 'logistica', label: 'Logística' },
];
const DEFAULT_SECTIONS: Record<SectionKey, boolean> = SECTION_DEFS.reduce(
  (acc, s) => ({ ...acc, [s.key]: true }), {} as Record<SectionKey, boolean>,
);
const SECTIONS_STORAGE_KEY = 'dash-construccion-secciones';

interface GanttRow {
  id: string; cliente_casa: string; zona: string; constructor: string; conjunto: string;
  cronograma_fecha_inicio: string; cronograma_fecha_fin: string;
  operations_stage: string; inst_progreso_pct: number; operativo_at: string | null;
  marca: string | null;
}
interface ScurvePoint { week: string; planeado: number; real: number; }
interface ScurveResp { total: number; from: string; to: string; points: ScurvePoint[]; zonaOptions?: string[]; constructorOptions?: string[]; }

function SectionHeader({ eyebrow, title, size = 'normal' }: { eyebrow: string; title: string; size?: 'normal' | 'large' }) {
  const titleSize = size === 'large' ? '2.2rem' : '1.4rem';
  const eyebrowSize = size === 'large' ? '0.82rem' : '0.72rem';
  return (
    <div style={{ marginBottom: size === 'large' ? 20 : 16 }}>
      <div style={{ color: ACCENT, fontSize: eyebrowSize, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {eyebrow}
      </div>
      <h2 style={{ fontSize: titleSize, fontWeight: 700, margin: '4px 0 0', letterSpacing: '-0.02em' }}>{title}</h2>
    </div>
  );
}

const NIVEL_COLOR: Record<string, string> = {
  Bajo: '#ef4444',
  Medio: '#f59e0b',
  Adecuado: '#10b981',
  Alto: '#10b981',
};

const ESTADO_COLOR: Record<string, string> = {
  Aprobado: '#10b981',
  'Reemplazo aprobado': '#10b981',
  'Resuelto en sitio': '#10b981',
  'En revisión': '#f59e0b',
  Radicado: '#3b82f6',
};

export default function DashPage() {
  const [report, setReport] = useState<DashReport>(DEFAULT_REPORT);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const today = () => new Date().toISOString().slice(0, 10);
  /**
   * Ventana por defecto: semana anterior completa + lo que va de la semana
   * actual. Ej: si hoy es martes semana N, arranca lunes semana N-1.
   */
  const prevWeekMonday = () => {
    const d = new Date();
    const dow = d.getDay();               // 0=dom, 1=lun, ..., 6=sáb
    const daysSinceMonday = (dow + 6) % 7; // lunes=0, domingo=6
    d.setDate(d.getDate() - daysSinceMonday - 7);
    return d.toISOString().slice(0, 10);
  };
  const [from, setFrom] = useState<string>(prevWeekMonday());
  const [to, setTo] = useState<string>(today());

  const load = async (f: string, t: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/dash/report?from=${f}&to=${t}`);
      if (r.ok) {
        const j = await r.json();
        setReport(j);
      }
    } catch (e) {
      console.error('[dash] load fallo', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(from, to); }, [from, to]);

  // ── Órdenes de Compra: CAPEX ejecutado adicional + desglose por
  // categoría/casa. Aditivo sobre el CAPEX de Facturación de arriba — no lo
  // reemplaza (ver nota en /presupuesto y ARCHITECTURE del módulo de OC).
  const [ocCapexEjecutado, setOcCapexEjecutado] = useState(0);
  const [ocExecution, setOcExecution] = useState<{ grupo: string; presupuestado: number; ejecutado: number; pct: number }[]>([]);
  const [ocByHouse, setOcByHouse] = useState<{ casa: string; ocs: string[]; adicionales: string[]; costoTotal: number; ejecutado: boolean }[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const [ocRes, execRes, houseRes] = await Promise.all([
          fetch('/api/purchase-orders'),
          fetch(`/api/budget/execution?anio=${new Date().getFullYear()}`),
          fetch('/api/purchase-orders/by-house'),
        ]);
        const [ocJson, execJson, houseJson] = await Promise.all([ocRes.json(), execRes.json(), houseRes.json()]);
        setOcCapexEjecutado((ocJson.purchaseOrders ?? []).reduce((s: number, o: { costo_ejecutado: number }) => s + Number(o.costo_ejecutado), 0));
        setOcExecution(execJson.grupos ?? []);
        setOcByHouse(houseJson.houses ?? []);
      } catch (e) {
        console.error('[dash] carga de Órdenes de Compra falló', e);
      }
    })();
  }, []);

  // ─── GANTT ───
  const [ganttRows, setGanttRows] = useState<GanttRow[]>([]);
  const [ganttLoading, setGanttLoading] = useState(true);
  const [ganttZona, setGanttZona] = useState('');
  const [ganttConstructor, setGanttConstructor] = useState('');
  const [ganttConjunto, setGanttConjunto] = useState('');
  useEffect(() => {
    void (async () => {
      setGanttLoading(true);
      try {
        const r = await fetch('/api/dash/gantt');
        if (r.ok) { const j = await r.json(); setGanttRows(j.rows ?? []); }
      } catch (e) { console.error('[dash] gantt load fallo', e); }
      finally { setGanttLoading(false); }
    })();
  }, []);

  // ─── CURVA S ───
  const [scurve, setScurve] = useState<ScurveResp | null>(null);
  const [scurveLoading, setScurveLoading] = useState(true);
  const [scurveFrom, setScurveFrom] = useState('');
  const [scurveTo, setScurveTo] = useState('');
  const [scurveZona, setScurveZona] = useState('');
  const [scurveConstructor, setScurveConstructor] = useState('');
  const loadScurve = async (f: string, t: string, zona: string, constructor: string) => {
    setScurveLoading(true);
    try {
      const params = new URLSearchParams();
      if (f) params.set('from', f);
      if (t) params.set('to', t);
      if (zona) params.set('zona', zona);
      if (constructor) params.set('constructor', constructor);
      const r = await fetch(`/api/dash/scurve?${params}`);
      if (r.ok) {
        const j = await r.json();
        setScurve(j);
        setScurveFrom(j.from);
        setScurveTo(j.to);
      }
    } catch (e) { console.error('[dash] scurve load fallo', e); }
    finally { setScurveLoading(false); }
  };
  useEffect(() => { void loadScurve('', '', '', ''); }, []);

  // ─── Resumen de ejecución (ventas) — datos de TopLeads/ActiveCampaign,
  // independientes del CRM de construcción. Casas Firmadas = "Firmado" del
  // funnel comercial (contrato firmado o más avanzado); el desglose viene
  // de la banda EJECUCIÓN de esa misma API.
  const [casasFirmadas, setCasasFirmadas] = useState(0);
  const [ejecucionBanda, setEjecucionBanda] = useState<FunnelBanda | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/topleads/funnel-comercial');
        if (r.ok) {
          const j = await r.json();
          const funnel: { key: string; value: number }[] = j.funnel ?? [];
          setCasasFirmadas(funnel.find((f) => f.key === 'firmado')?.value ?? 0);
          setEjecucionBanda((j.bandas ?? []).find((b: FunnelBanda) => b.nombre === 'EJECUCIÓN') ?? null);
        }
      } catch (e) { console.error('[dash] funnel comercial load fallo', e); }
    })();
  }, []);
  const ejecucionFila = (label: string) => ejecucionBanda?.filas.find((f) => f.label === label)?.value ?? 0;
  // "Avance vs. meta anual" se mide contra Energizados (funnel comercial),
  // no contra casasAcum del CRM — son dos fuentes distintas y esta tarjeta
  // vive junto a "Energizados" en la misma sección.
  const energizados = ejecucionFila('Energizados');
  const avancePctEnergizados = report.global.metaCasas > 0 ? Math.round((energizados / report.global.metaCasas) * 100) : 0;

  // ─── Secciones visibles — preferencia local del usuario, no compartida. ───
  const [sections, setSections] = useState<Record<SectionKey, boolean>>(DEFAULT_SECTIONS);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SECTIONS_STORAGE_KEY);
      if (raw) setSections({ ...DEFAULT_SECTIONS, ...JSON.parse(raw) });
    } catch (e) { console.error('[dash] preferencias de secciones inválidas', e); }
  }, []);
  const toggleSection = (key: SectionKey) => {
    setSections((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try { window.localStorage.setItem(SECTIONS_STORAGE_KEY, JSON.stringify(next)); } catch (e) { console.error('[dash] no se pudo guardar preferencia', e); }
      return next;
    });
  };

  const [downloadingPptx, setDownloadingPptx] = useState(false);
  const handleDownload = async () => {
    setDownloading(true);
    try {
      generateDashPDF(report);
    } finally {
      setTimeout(() => setDownloading(false), 400);
    }
  };
  const handleDownloadPptx = async () => {
    setDownloadingPptx(true);
    try {
      generateDashPPTX(report);
    } finally {
      setTimeout(() => setDownloadingPptx(false), 400);
    }
  };

  return (
    <div className="page-content" style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      {/* ─── PORTADA ─── */}
      <section
        className="card"
        style={{
          padding: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 24,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{
            background: 'var(--accent-dim)',
            border: '1px solid var(--accent-border)',
            borderRadius: 14,
            padding: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Sun size={40} strokeWidth={2.5} fill={ACCENT} color={ACCENT} />
          </div>
          <div>
            <div style={{ color: ACCENT, fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Construcción · Seguimiento semanal
            </div>
            <h1 style={{ fontSize: '1.8rem', fontWeight: 700, margin: '4px 0', letterSpacing: '-0.02em' }}>
              Weekly Construcción
            </h1>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              Sistemas Solares + BESS residenciales
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: 6 }}>
              Semana del {report.periodo.desde} al {report.periodo.hasta} · {report.periodo.anio}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border-strong)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.8rem' }}
            />
            <span style={{ color: 'var(--text-muted)' }}>→</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border-strong)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.8rem' }}
            />
            <button
              onClick={() => void load(from, to)}
              disabled={loading}
              title="Refrescar"
              style={{ background: 'transparent', border: '1px solid var(--border-strong)', color: 'var(--text-secondary)', borderRadius: 6, padding: 6, cursor: 'pointer' }}
            >
              <RefreshCw size={14} className={loading ? 'spin' : ''} />
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button
              className="primary-btn"
              onClick={handleDownload}
              disabled={downloading || loading}
            >
              <Download size={16} />
              {downloading ? 'Generando…' : 'PDF'}
            </button>
            <button
              className="primary-btn"
              onClick={handleDownloadPptx}
              disabled={downloadingPptx || loading}
              style={{ background: '#D24726', color: '#fff' }}
            >
              <Download size={16} />
              {downloadingPptx ? 'Generando…' : 'PPTX'}
            </button>
          </div>
        </div>
      </section>

      {/* ─── RESUMEN DE EJECUCIÓN (VENTAS) — antes de Avance global ─── */}
      {sections.resumenEjecucion && (
        <section className="card">
          <SectionHeader eyebrow="Ejecución" title="Resumen global de ventas y ejecución" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <StatCard label="Casas Firmadas" value={fmtInt(casasFirmadas)} hint="contrato firmado o más avanzado" />
            <StatCard label="Energizados" value={fmtInt(energizados)} hint="ganado / instalación terminada" />
            <StatCard label="En Construcción" value={fmtInt(ejecucionFila('En Construcción'))} hint="obra en curso" />
            <StatCard label="Instalados" value={fmtInt(ejecucionFila('Instalados'))} hint="pendiente de energizar" />
            <StatCard label="Firmados sin Instalar" value={fmtInt(ejecucionFila('Firmados sin Instalar'))} hint="contrato firmado, obra sin empezar" />
            <StatCard
              label="Avance vs. meta anual"
              value={`${avancePctEnergizados}%`}
              hint={`${energizados} de ${report.global.metaCasas} casas meta`}
              tag={`Faltan ${Math.max(0, report.global.metaCasas - energizados)} casas`}
            />
          </div>
        </section>
      )}

      {/* ─── SLIDE 2: AVANCE GLOBAL ─── */}
      {sections.avanceGlobal && (
      <section className="card">
        <SectionHeader eyebrow="Avance global" title="Total instalado hasta la fecha" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
          <StatCard
            label="Casas instaladas (acum.)"
            value={fmtInt(energizados)}
            hint="Energizados — funnel comercial (TopLeads)"
            tag={report.global.mesesActivos > 0 ? `~${fmt1(energizados / report.global.mesesActivos)} casas/mes` : undefined}
          />
          <StatCard
            label="kWp solar (acum.)"
            value={`${fmt1(report.global.kwpAcum)} kWp`}
            hint="instalados a la fecha"
            tag={`~${fmtInt(Math.round(report.global.kwpAcum * 1000 / PANEL_WP))} paneles ${PANEL_WP}W`}
          />
          <StatCard
            label="kWh batería (acum.)"
            value={`${fmtInt(report.global.kwhAcum)} kWh`}
            hint="instalados a la fecha"
            tag={`~${fmtInt(Math.round(report.global.kwhAcum / KWH_POR_BATERIA))} baterías`}
          />
          <StatCard
            label="CAPEX ejecutado (acum.)"
            value={`$${fmtInt(report.global.capexAcumM)}M COP`}
            hint="desde inicio de operación — equipos (Facturación)"
            tag={report.global.casasAcum > 0 ? `~$${fmt1(report.global.capexAcumM / report.global.casasAcum)}M / casa` : undefined}
          />
          <StatCard
            label="CAPEX Órdenes de Compra"
            value={`$${fmtInt(ocCapexEjecutado / 1_000_000)}M COP`}
            hint="ejecutado — casas en instalación o posterior"
            tag="adicional al de arriba"
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 8 }}>
              CASAS POR MES, POR SOLUCIÓN
            </div>
            <div style={{ height: 260 }}>
              <ResponsiveContainer>
                <BarChart
                  data={report.global.porMes.map((m) => ({
                    ...m,
                    total: m.sol1 + m.sol2 + m.sol3 + m.sol4,
                  }))}
                  margin={{ top: 22, right: 8, left: -12, bottom: 0 }}
                >
                  <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="sol1" stackId="a" fill="#07c5a8" name="Solución 1">
                    <LabelList dataKey="sol1" position="center" style={{ fill: '#fff', fontSize: 10, fontWeight: 700 }} formatter={fmtLabel} />
                  </Bar>
                  <Bar dataKey="sol2" stackId="a" fill="#3b82f6" name="Solución 2">
                    <LabelList dataKey="sol2" position="center" style={{ fill: '#fff', fontSize: 10, fontWeight: 700 }} formatter={fmtLabel} />
                  </Bar>
                  <Bar dataKey="sol3" stackId="a" fill="#94a3b8" name="Solución 3">
                    <LabelList dataKey="sol3" position="center" style={{ fill: '#fff', fontSize: 10, fontWeight: 700 }} formatter={fmtLabel} />
                  </Bar>
                  <Bar dataKey="sol4" stackId="a" fill="#1f2937" name="Solución 4">
                    <LabelList dataKey="sol4" position="center" style={{ fill: '#fff', fontSize: 10, fontWeight: 700 }} formatter={fmtLabel} />
                    <LabelList dataKey="total" position="top" style={{ fill: 'var(--text-primary)', fontSize: 11, fontWeight: 700 }} formatter={fmtLabel} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 8 }}>
              DETALLE MENSUAL: INSTALACIÓN Y CAPEX
            </div>
            <PaginatedTable
              head={['Mes', 'Casas', 'kWp', 'kWh', 'CAPEX']}
              rows={report.global.porMes.map((m) => [m.mes, fmtInt(m.casas), fmt1(m.kwp), fmtInt(m.kwh), `$${fmtInt(m.capexM)}M`])}
              pageSize={6}
            />
          </div>
        </div>

        {/* USD/Wp por solución */}
        {report.global.usdWpBySolucion && report.global.usdWpBySolucion.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 8 }}>
              USD/Wp POR SOLUCIÓN · TRM {new Intl.NumberFormat('es-CO').format(TRM_COP)} COP/USD
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(120px, 1fr))`, gap: 8 }}>
              {report.global.usdWpBySolucion.map((s) => (
                <div key={s.solucion} className="stat-card" style={{ borderLeft: '3px solid var(--accent)', padding: '10px 12px', gap: 2 }}>
                  <div className="stat-label" style={{ fontSize: '0.64rem' }}>Sol. {s.solucion}</div>
                  <div className="stat-value" style={{ fontSize: '1.05rem' }}>${fmt1(s.usdWpPromedio)} USD/Wp</div>
                  <div style={{ fontSize: '0.66rem', color: ACCENT, fontWeight: 600 }}>{s.casas} casa{s.casas === 1 ? '' : 's'}</div>
                </div>
              ))}
              {/* Total ponderado — SOLO sobre las casas que tienen usd_wp cargado
                  (no todas las instaladas: capex_venta/usd_wp solo se sembraron
                  para un subconjunto en mig 46 y no hay forma de cargarlos para
                  casas nuevas todavía; dividir su venta entre el kWp de TODAS
                  las casas instaladas inflaba el denominador y subestimaba el
                  promedio real). */}
              {report.global.casasConUsdWp > 0 && (
                <div className="stat-card" style={{ borderLeft: '3px solid #64748b', background: 'var(--bg-elevated)', padding: '10px 12px', gap: 2 }}>
                  <div className="stat-label" style={{ fontSize: '0.64rem' }}>Promedio general</div>
                  <div className="stat-value" style={{ fontSize: '1.05rem' }}>${fmt1(report.global.usdWpPromedioGeneral)} USD/Wp</div>
                  <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                    {report.global.casasConUsdWp} de {report.global.casasAcum} casas con dato · ${fmtInt(report.global.capexVentaAcumM)}M venta
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </section>
      )}

      {/* ─── SLIDE 3 (NUEVA): DETALLE GLOBAL POR MARCA, ZONA Y CONSTRUCTOR ─── */}
      {sections.detalleGlobal && (
      <DetalleMarcaZonaConstructor
        eyebrow="Avance global"
        title="Detalle por marca, zona y constructor"
        marcas={report.detalleGlobal?.marcas ?? report.detalle.marcas}
        zonas={report.detalleGlobal?.zonas ?? report.detalle.zonas}
        constructores={report.detalleGlobal?.constructores ?? report.detalle.constructores}
      />
      )}

      {/* ─── SLIDE 3B (NUEVA): DESGLOSE DE EJECUCIÓN — ÓRDENES DE COMPRA ─── */}
      {sections.ordenesCompra && (
      <section className="card">
        <SectionHeader eyebrow={`Presupuesto ${new Date().getFullYear()}`} title="Desglose de ejecución — Órdenes de Compra" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          <div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Por categoría (presupuestado vs. ejecutado)
            </div>
            <SimpleTable
              head={['Categoría', 'Presupuestado', 'Ejecutado', '%']}
              rows={ocExecution.map((r) => [
                r.grupo,
                `$${fmtInt(r.presupuestado)}`,
                `$${fmtInt(r.ejecutado)}`,
                `${r.pct.toFixed(0)}%`,
              ])}
            />
            {ocExecution.length === 0 && <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Sin presupuesto/OC cargados para este año todavía.</p>}
          </div>
          <div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Por casa (OC + adicionales que la financian)
            </div>
            <PaginatedTable
              head={['Casa', 'OC', 'Adicionales', 'Costo total', 'Estado']}
              pageSize={6}
              rows={ocByHouse.map((h) => [
                h.casa,
                h.ocs.join(', ') || '—',
                h.adicionales.length > 0 ? h.adicionales.join(', ') : '—',
                `$${fmtInt(h.costoTotal)}`,
                h.ejecutado ? <span key="e" className="badge-success">Ejecutado</span> : <span key="e" className="badge-warning">Comprometido</span>,
              ])}
            />
            {ocByHouse.length === 0 && <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Ninguna casa tiene una Orden de Compra asignada todavía.</p>}
          </div>
        </div>
      </section>
      )}

      {/* ─── SLIDE 4: CONSTRUCCIÓN (semanal + planeación unificados) ─── */}
      {sections.construccion && (
      <section className="card">
        <SectionHeader eyebrow="Weekly" title="Construcción" size="large" />
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: -8, marginBottom: 16 }}>
          Casas en Alistamiento (reserva de equipos) o Instalación (obra en sitio) ahora mismo. Al pasar a Operativo salen de esta lista.
        </p>
        <SemanaResumenTable rows={ganttRows} loading={ganttLoading} />

        {/* Detalle por marca / zona / constructor (semanal — puede estar vacío si no hay instalaciones) */}
        {report.detalle.marcas.length + report.detalle.zonas.length + report.detalle.constructores.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginTop: 12 }}>
            {report.detalle.marcas.length > 0 && (
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 8 }}>
                  KIT (SEMANA)
                </div>
                <SimpleTable
                  head={['Kit', 'Casas', 'kWp']}
                  rows={report.detalle.marcas.map((m) => [labelForMarca(m.marca), fmtInt(m.casas), fmt1(m.kwp)])}
                />
              </div>
            )}
            {report.detalle.zonas.length > 0 && (
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 8 }}>
                  ZONA (SEMANA)
                </div>
                <SimpleTable
                  head={['Zona', 'Casas', 'CAPEX']}
                  rows={report.detalle.zonas.map((z) => [z.zona, fmtInt(z.casas), z.capex])}
                />
              </div>
            )}
            {report.detalle.constructores.length > 0 && (
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 8 }}>
                  CONSTRUCTOR
                </div>
                <SimpleTable
                  head={['Constructor', 'Asignadas', 'Instaladas']}
                  rows={report.detalle.constructores.map((c) => [c.constructor, fmtInt(c.asignadas), fmtInt(c.instaladas)])}
                />
              </div>
            )}
          </div>
        )}

      </section>
      )}

      {/* ─── GANTT DE OBRA ─── */}
      {sections.gantt && (
      <section className="card">
        <SectionHeader eyebrow="Cronograma" title="Gantt de obra" size="large" />
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: -8, marginBottom: 16 }}>
          Casas activas con cronograma cargado (inicio → fin planeados). El relleno de la barra
          muestra el avance físico real durante la etapa de Instalación.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          <select value={ganttZona} onChange={(e) => setGanttZona(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border-strong)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.8rem' }}>
            <option value="">Todas las zonas</option>
            {Array.from(new Set(ganttRows.map((r) => r.zona))).sort().map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
          <select value={ganttConstructor} onChange={(e) => setGanttConstructor(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border-strong)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.8rem' }}>
            <option value="">Todos los constructores</option>
            {Array.from(new Set(ganttRows.map((r) => r.constructor))).sort().map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={ganttConjunto} onChange={(e) => setGanttConjunto(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border-strong)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.8rem' }}>
            <option value="">Todos los conjuntos</option>
            {Array.from(new Set(ganttRows.map((r) => r.conjunto))).sort().map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <GanttChart rows={ganttRows} loading={ganttLoading} zona={ganttZona} constructor={ganttConstructor} conjunto={ganttConjunto} />
      </section>
      )}

      {/* ─── CURVA S ─── */}
      {sections.curvaS && (
      <section className="card">
        <SectionHeader eyebrow="Cronograma" title="Curva S — planeado vs real" size="large" />
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: -8, marginBottom: 16 }}>
          % acumulado de casas con fin de cronograma planeado en el rango, comparado contra cuándo
          quedaron realmente operativas.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
          <input type="date" value={scurveFrom} onChange={(e) => void loadScurve(e.target.value, scurveTo, scurveZona, scurveConstructor)}
            style={{ width: 'auto', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border-strong)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.8rem' }} />
          <span style={{ color: 'var(--text-muted)' }}>→</span>
          <input type="date" value={scurveTo} onChange={(e) => void loadScurve(scurveFrom, e.target.value, scurveZona, scurveConstructor)}
            style={{ width: 'auto', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border-strong)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.8rem' }} />
          <select value={scurveZona} onChange={(e) => { setScurveZona(e.target.value); void loadScurve(scurveFrom, scurveTo, e.target.value, scurveConstructor); }}
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border-strong)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.8rem' }}>
            <option value="">Todas las zonas</option>
            {(scurve?.zonaOptions ?? []).map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
          <select value={scurveConstructor} onChange={(e) => { setScurveConstructor(e.target.value); void loadScurve(scurveFrom, scurveTo, scurveZona, e.target.value); }}
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border-strong)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.8rem' }}>
            <option value="">Todos los constructores</option>
            {(scurve?.constructorOptions ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          {scurve && <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{scurve.total} casas con fin de cronograma en el rango</span>}
        </div>
        <SCurveChart scurve={scurve} loading={scurveLoading} />
      </section>
      )}

      {/* ─── SLIDE 7: LEGALIZACIONES ─── */}
      {sections.legalizaciones && (
      <section className="card">
        <SectionHeader eyebrow="Legalizaciones" title="Trámites para venta de excedentes (AGPE)" />
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: -8, marginBottom: 16 }}>
          Seguimiento personalizado a las casas en proceso de legalización ante el operador de red para habilitar la venta de excedentes de energía.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
          <StatCard label="Casas en trámite"       value={fmtInt(report.legalizaciones.tramite)}    hint="esta semana" />
          <StatCard label="Aprobadas"              value={fmtInt(report.legalizaciones.aprobadas)}  hint="habilitadas para excedentes" />
          <StatCard label="En revisión / radicadas" value={fmtInt(report.legalizaciones.enRevision)} hint="con el operador de red" />
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 8 }}>
          DETALLE POR CASA
        </div>
        <SimpleTable
          head={['Cliente / Casa', 'Zona', 'Operador de red', 'Estado del trámite', 'Fecha estimada']}
          rows={report.legalizaciones.detalle.map((l) => [
            l.casa, l.zona, l.operador,
            <span key={l.casa} style={{ color: ESTADO_COLOR[l.estado] ?? 'inherit', fontWeight: 600 }}>{l.estado}</span>,
            l.fecha,
          ])}
        />
      </section>
      )}

      {/* ─── SLIDE 7: POSTVENTA ─── */}
      {sections.postventa && (
      <section className="card">
        <SectionHeader eyebrow="Postventa" title="Garantías: equipos y retorno a bodega" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
          <StatCard label="Casos abiertos"      value={fmtInt(report.postventa.abiertos)}       hint="en garantía esta semana" />
          <StatCard label="Equipos en tránsito" value={fmtInt(report.postventa.enTransito)}     hint="recolección programada" />
          <StatCard label="Resueltos en sitio"  value={fmtInt(report.postventa.resueltosSitio)} hint="sin retorno a bodega" />
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 8 }}>
          DETALLE DE CASOS EN GARANTÍA
        </div>
        <SimpleTable
          head={['Marca', 'Equipo', 'Falla reportada', 'Estado', 'Retorno a bodega']}
          rows={report.postventa.detalle.map((g) => [
            g.marca, g.equipo, g.falla,
            <span key={g.equipo} style={{ color: ESTADO_COLOR[g.estado] ?? 'inherit', fontWeight: 600 }}>{g.estado}</span>,
            g.retorno,
          ])}
        />
      </section>
      )}

      {/* ─── SLIDE 8: LOGÍSTICA ─── */}
      {sections.logistica && (
      <section className="card">
        <SectionHeader eyebrow="Logística" title="Estado de inventario en bodega" />
        {/* Stock por bodega — union de marcas para que las 3 tablas tengan las mismas filas */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 20 }}>
          {(() => {
            const bodegas = report.logistica.stockPorBodega ?? [];
            // Union de marcas presente en cualquiera de las bodegas, ordenada alfabeticamente
            const marcasUnion = Array.from(new Set(bodegas.flatMap((b) => b.stock.map((s) => s.marca)))).sort((a, b) => a.localeCompare(b));
            return bodegas.map((b) => {
              const stockMap = new Map(b.stock.map((s) => [s.marca, s] as const));
              // Rellenar cada bodega con las marcas faltantes en 0
              const rows = marcasUnion.map((marca) => {
                const s = stockMap.get(marca) ?? { marca, paneles: 0, inversores: 0, baterias: 0, estructuras: 0, cobertura: 0 };
                return [s.marca, fmtInt(s.paneles), fmtInt(s.inversores), fmtInt(s.baterias), fmtInt(s.estructuras)];
              });
              return (
                <div key={b.warehouseName}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 8 }}>
                    STOCK · {b.warehouseName.toUpperCase()}
                  </div>
                  <SimpleTable
                    head={['Marca', 'Pan.', 'Inv.', 'Bat.', 'Est.']}
                    rows={rows}
                  />
                </div>
              );
            });
          })()}
          {/* Fallback si stockPorBodega no viene (data vieja): mostrar el stock global */}
          {(!report.logistica.stockPorBodega || report.logistica.stockPorBodega.length === 0) && (
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 8 }}>
                STOCK DISPONIBLE POR MARCA (GLOBAL)
              </div>
              <SimpleTable
                head={['Marca', 'Paneles', 'Inversores', 'Baterías', 'Estructuras']}
                rows={report.logistica.stock.map((s) => [s.marca, fmtInt(s.paneles), fmtInt(s.inversores), fmtInt(s.baterias), fmtInt(s.estructuras)])}
              />
            </div>
          )}
        </div>

        {/* Alertas de reabastecimiento (nivel global) */}
        <div>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 8 }}>
              ALERTAS DE REABASTECIMIENTO
            </div>
            <SimpleTable
              head={['Componente', 'Nivel']}
              rows={report.logistica.alertas.map((a) => [
                a.componente,
                <span key={a.componente} style={{
                  display: 'inline-block',
                  padding: '2px 10px',
                  borderRadius: 999,
                  background: `${NIVEL_COLOR[a.nivel]}22`,
                  color: NIVEL_COLOR[a.nivel],
                  fontWeight: 600,
                  fontSize: '0.78rem',
                }}>{a.nivel}</span>,
              ])}
            />
          </div>
        </div>
        <div style={{ marginTop: 24 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 8 }}>
            KITS SOLARES ARMABLES POR BODEGA — SIMULACIÓN
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
            {(report.logistica.kitsPorBodega ?? []).map((kit) => {
              const pct = (n: number) => kit.totalKits > 0 ? Math.round((n / kit.totalKits) * 100) : 0;
              return (
                <div key={kit.warehouseName} className="stat-card" style={{ padding: 16, borderLeft: '4px solid var(--accent)' }}>
                  <div className="stat-label" style={{ marginBottom: 4 }}>{kit.warehouseName}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 8 }}>
                    Prio: T2 {Math.round(kit.priority.T2 * 100)}% · T3 {Math.round(kit.priority.T3 * 100)}% · T4 {Math.round(kit.priority.T4 * 100)}%
                  </div>
                  <div className="stat-value" style={{ marginBottom: 8 }}>{fmtInt(kit.totalKits)} kits</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
                      <span>Tipo 2</span>
                      <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{kit.byTipo.T2} ({pct(kit.byTipo.T2)}%)</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
                      <span>Tipo 3</span>
                      <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{kit.byTipo.T3} ({pct(kit.byTipo.T3)}%)</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
                      <span>Tipo 4</span>
                      <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{kit.byTipo.T4} ({pct(kit.byTipo.T4)}%)</span>
                    </div>
                  </div>

                  {/* Desglose por sub-kit — muestra cuáles se pueden armar (K2A, K2B, K3A, etc.) */}
                  {kit.porKit && kit.porKit.some((p) => p.count > 0) && (
                    <details style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                      <summary style={{ cursor: 'pointer', fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                        Ver detalle por kit
                      </summary>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6, paddingLeft: 4 }}>
                        {kit.porKit.filter((p) => p.count > 0).map((p) => (
                          <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                            <span title={p.label}>{p.label.length > 40 ? p.label.slice(0, 40) + '…' : p.label}</span>
                            <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600, color: 'var(--text-primary)' }}>{p.count}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              );
            })}
            {(report.logistica.kitsPorBodega ?? []).length === 0 && (
              <div style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center', gridColumn: '1 / -1', background: 'var(--bg-elevated)', borderRadius: 8 }}>
                No hay bodegas o stock disponible para simular kits.
              </div>
            )}
          </div>
          <p style={{ marginTop: 8, fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
            Simulación con el stock actual y las prioridades por ciudad. Los equipos no se reutilizan entre kits.
          </p>
        </div>
      </section>
      )}

      {/* ─── PANEL: SECCIONES VISIBLES ─── */}
      <section className="card">
        <SectionHeader eyebrow="Preferencias" title="Secciones visibles en este dashboard" />
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: -8, marginBottom: 16 }}>
          Activa o desactiva qué secciones se muestran acá abajo. Se guarda solo en este navegador.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          {SECTION_DEFS.map((s) => (
            <label key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={sections[s.key]} onChange={() => toggleSection(s.key)} />
              {s.label}
            </label>
          ))}
        </div>
      </section>

      {/* ─── CIERRE ─── */}
      <section
        className="card"
        style={{ padding: 32, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}
      >
        <Sun size={40} strokeWidth={2.5} fill={ACCENT} color={ACCENT} />
        <h2 style={{ fontSize: '2rem', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>Gracias</h2>
        <div style={{ color: ACCENT, fontWeight: 600 }}>
          Sunny · Avance Semanal de Construcción
        </div>
      </section>
    </div>
  );
}

/**
 * Bloque reutilizable "Detalle por marca, zona y constructor".
 * Se usa dos veces en la página: una para el acumulado global y otra para
 * los datos de la semana. Recibe eyebrow/title para diferenciar.
 */
/**
 * Convierte el texto de "marca" (viene de la marca de batería del proyecto)
 * al nombre completo del kit (inversor + batería) que se muestra al usuario.
 * Livoltek battery → Kit Livoltek + Livoltek (inversor + batería Livoltek)
 * DEYE battery     → Kit Deye + Deye
 * Pylontech        → Kit Deye + Pylontech (siempre con inversor Deye 6k LV)
 */
const KIT_LABEL_BY_MARCA: Record<string, string> = {
  'Livoltek':  'Kit Livoltek + Livoltek',
  'DEYE':      'Kit Deye + Deye',
  'Deye':      'Kit Deye + Deye',
  'Deye HV':   'Kit Deye + Deye',
  'Pylontech': 'Kit Deye + Pylontech',
};
const labelForMarca = (m: string): string => KIT_LABEL_BY_MARCA[m] ?? m;

/** Tooltip enriquecido del pie de marcas — reemplaza a la tabla "Casas instaladas por marca" que se quitó. */
function KitPieTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { name: string; value: number; kwp: number; kwh: number } }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: '0.76rem' }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{d.name}</div>
      <div>Casas: <strong>{fmtInt(d.value)}</strong></div>
      <div>kWp: <strong>{fmt1(d.kwp)}</strong></div>
      <div>kWh: <strong>{fmtInt(d.kwh)}</strong></div>
    </div>
  );
}

/** Tooltip del pie de constructores — Asignadas + Instaladas, reemplaza la tabla que se quitó. */
function ConstructorPieTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { name: string; value: number; instaladas: number } }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: '0.76rem' }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{d.name}</div>
      <div>Asignadas: <strong>{fmtInt(d.value)}</strong></div>
      <div>Instaladas: <strong>{fmtInt(d.instaladas)}</strong></div>
    </div>
  );
}

function DetalleMarcaZonaConstructor({
  eyebrow, title, marcas, zonas, constructores,
}: {
  eyebrow: string; title: string;
  marcas: DashReport['detalle']['marcas'];
  zonas: DashReport['detalle']['zonas'];
  constructores: DashReport['detalle']['constructores'];
}) {
  const total = marcas.reduce((s, m) => s + m.casas, 0);
  const pieMarcas = marcas.map((m) => ({
    name: labelForMarca(m.marca),
    value: m.casas,
    kwp: m.kwp,
    kwh: m.kwh,
    pct: total ? Math.round((m.casas / total) * 100) : 0,
  }));
  const totalAsignadas = constructores.reduce((s, c) => s + c.asignadas, 0);
  const pieConstructores = constructores.map((c) => ({
    name: c.constructor,
    value: c.asignadas,
    instaladas: c.instaladas,
    pct: totalAsignadas ? Math.round((c.asignadas / totalAsignadas) * 100) : 0,
  }));
  return (
    <section className="card">
      <SectionHeader eyebrow={eyebrow} title={title} />
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 8 }}>
          CASAS Y CAPEX POR ZONA
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          {zonas.map((z) => (
            <StatCard key={z.zona} label={z.zona} value={z.capex} hint={`${fmtInt(z.casas)} casas`} />
          ))}
          {zonas.length === 0 && <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Sin datos por zona todavía.</p>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 8 }}>
            CASAS INSTALADAS POR MARCA
          </div>
          <div style={{ height: 300 }}>
            <ResponsiveContainer>
              <PieChart margin={{ top: 24, right: 8, bottom: 0, left: 8 }}>
                <Pie
                  data={pieMarcas}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={80}
                  label={(props: unknown) => {
                    const p = props as { payload?: { pct?: number; value?: number } };
                    if (p.payload?.pct === undefined) return '';
                    return `${p.payload.pct}% · ${p.payload.value ?? 0} casas`;
                  }}
                >
                  {pieMarcas.map((_, i) => (
                    <Cell key={i} fill={MARCA_COLORS[i % MARCA_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<KitPieTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: 11 }}
                  formatter={(value: string, entry: unknown) => {
                    const e = entry as { payload?: { value?: number } };
                    return `${value} — ${e.payload?.value ?? 0} casas`;
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 8 }}>
            CASAS ASIGNADAS POR CONSTRUCTOR
          </div>
          <div style={{ height: 300 }}>
            <ResponsiveContainer>
              <PieChart margin={{ top: 24, right: 8, bottom: 0, left: 8 }}>
                <Pie
                  data={pieConstructores}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={80}
                  label={(props: unknown) => {
                    const p = props as { payload?: { pct?: number; value?: number; instaladas?: number } };
                    if (p.payload?.pct === undefined) return '';
                    return `${p.payload.pct}% · ${p.payload.value ?? 0} asig. / ${p.payload.instaladas ?? 0} inst.`;
                  }}
                >
                  {pieConstructores.map((_, i) => (
                    <Cell key={i} fill={MARCA_COLORS[i % MARCA_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<ConstructorPieTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: 11 }}
                  formatter={(value: string, entry: unknown) => {
                    const e = entry as { payload?: { value?: number; instaladas?: number } };
                    return `${value} — ${e.payload?.value ?? 0} asig. / ${e.payload?.instaladas ?? 0} inst.`;
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </section>
  );
}

const ETAPA_CONSTRUCCION_LABEL: Record<string, string> = {
  alistamiento: 'Alistamiento (reserva de equipos)',
  instalacion: 'Instalación (obra en sitio)',
};
const ETAPA_CONSTRUCCION_COLOR: Record<string, string> = {
  alistamiento: '#3b82f6',
  instalacion: '#8b5cf6',
};

/**
 * Tabla única de "Weekly Construcción" — una fila por casa que está AHORA
 * MISMO en Alistamiento o Instalación (las 2 etapas de obra del CRM, ver
 * OPERATIONS_STAGES en crm-stages.ts). Se arma con la misma data que ya
 * carga el Gantt (/api/dash/gantt), así que en cuanto una casa pasa a
 * Operativo, sale sola de la lista — no hace falta filtrar nada a mano.
 * Las fechas son explícitamente las del cronograma (inicio/fin planeados),
 * no un "Fecha" genérico.
 */
function SemanaResumenTable({ rows, loading }: { rows: GanttRow[]; loading: boolean }) {
  const filas = rows
    .filter((r) => r.operations_stage === 'alistamiento' || r.operations_stage === 'instalacion')
    .sort((a, b) => a.cronograma_fecha_inicio.localeCompare(b.cronograma_fecha_inicio));

  if (loading) return <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Cargando…</div>;

  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          <tr style={{ background: '#1f2937', color: '#fff' }}>
            {['Casa', 'Etapa', 'Kit', 'Constructor', 'Zona', 'Fecha inicio cronograma', 'Fecha fin cronograma (plan)', 'Avance instalación'].map((h) => (
              <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, fontSize: '0.78rem' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.length === 0 && (
            <tr>
              <td colSpan={8} style={{ padding: '14px 16px', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                Ninguna casa en Alistamiento o Instalación ahora mismo.
              </td>
            </tr>
          )}
          {filas.map((r) => (
            <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '10px 12px', fontWeight: 600 }}>{r.cliente_casa}</td>
              <td style={{ padding: '10px 12px' }}>
                <span style={{ color: ETAPA_CONSTRUCCION_COLOR[r.operations_stage] ?? 'inherit', fontWeight: 600 }}>
                  {ETAPA_CONSTRUCCION_LABEL[r.operations_stage] ?? r.operations_stage}
                </span>
              </td>
              <td style={{ padding: '10px 12px' }}>{r.marca ? labelForMarca(r.marca) : '—'}</td>
              <td style={{ padding: '10px 12px' }}>{r.constructor}</td>
              <td style={{ padding: '10px 12px' }}>{r.zona}</td>
              <td style={{ padding: '10px 12px' }}>{r.cronograma_fecha_inicio}</td>
              <td style={{ padding: '10px 12px' }}>{r.cronograma_fecha_fin}</td>
              <td style={{ padding: '10px 12px' }}>
                {r.operations_stage === 'instalacion' ? `${r.inst_progreso_pct}%` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const GANTT_MAX_ROWS = 25;

/** Colores del segmento "hecho" / "restante" de cada barra, según etapa. */
function ganttColors(row: GanttRow): { done: string; remaining: string } {
  if (row.operativo_at || row.operations_stage === 'operativo') return { done: '#10b981', remaining: '#10b98130' };
  if (row.operations_stage === 'instalacion') return { done: '#3b82f6', remaining: '#bfdbfe' };
  return { done: '#94a3b8', remaining: '#e2e8f0' }; // dimensionado/alistamiento — obra sin arrancar
}

function GanttChart({ rows, loading, zona, constructor, conjunto }: {
  rows: GanttRow[]; loading: boolean; zona: string; constructor: string; conjunto: string;
}) {
  const filtered = rows.filter((r) =>
    (!zona || r.zona === zona) && (!constructor || r.constructor === constructor) && (!conjunto || r.conjunto === conjunto),
  );

  if (loading) return <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Cargando…</div>;
  if (filtered.length === 0) return <div className="alert-warning" style={{ fontSize: '0.85rem' }}>No hay casas con cronograma cargado para estos filtros.</div>;

  const truncated = filtered.length > GANTT_MAX_ROWS;
  const shown = filtered.slice(0, GANTT_MAX_ROWS);
  const minDate = shown.reduce((min, r) => r.cronograma_fecha_inicio < min ? r.cronograma_fecha_inicio : min, shown[0].cronograma_fecha_inicio);

  const data = shown.map((r) => {
    const offset = daysBetween(minDate, r.cronograma_fecha_inicio);
    const duration = Math.max(1, daysBetween(r.cronograma_fecha_inicio, r.cronograma_fecha_fin));
    const doneFrac = r.operativo_at || r.operations_stage === 'operativo' ? 1 : (r.operations_stage === 'instalacion' ? r.inst_progreso_pct / 100 : 0);
    const done = Math.round(duration * doneFrac);
    const { done: doneColor, remaining: remainingColor } = ganttColors(r);
    return {
      name: r.cliente_casa, offset, done, remaining: duration - done,
      doneColor, remainingColor,
      inicio: r.cronograma_fecha_inicio, fin: r.cronograma_fecha_fin,
      etapa: r.operations_stage, pct: r.inst_progreso_pct,
    };
  });
  const maxDay = Math.max(...data.map((d) => d.offset + d.done + d.remaining), 1);

  return (
    <>
      {truncated && (
        <div className="alert-warning" style={{ fontSize: '0.8rem', marginBottom: 10 }}>
          Mostrando las primeras {GANTT_MAX_ROWS} de {filtered.length} — usa los filtros para acotar.
        </div>
      )}
      <div style={{ height: Math.max(220, data.length * 34) }}>
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
            <XAxis type="number" domain={[0, maxDay]} tickFormatter={(v) => addDaysLabel(minDate, Number(v))} tick={{ fontSize: 10 }} />
            <YAxis type="category" dataKey="name" width={190} tick={{ fontSize: 11 }} />
            <Tooltip
              formatter={(_v, key, entry) => {
                const d = entry.payload as typeof data[number];
                if (key === 'done' || key === 'remaining') return [`${d.inicio} → ${d.fin} · ${d.etapa}${d.etapa === 'instalacion' ? ` (${d.pct}%)` : ''}`, 'Cronograma'];
                return [String(_v), String(key)];
              }}
            />
            <Bar dataKey="offset" stackId="gantt" fill="transparent" isAnimationActive={false} />
            <Bar dataKey="done" stackId="gantt" isAnimationActive={false}>
              {data.map((d, i) => <Cell key={i} fill={d.doneColor} />)}
            </Bar>
            <Bar dataKey="remaining" stackId="gantt" isAnimationActive={false}>
              {data.map((d, i) => <Cell key={i} fill={d.remainingColor} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10, fontSize: '0.74rem', color: 'var(--text-muted)' }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#94a3b8', marginRight: 4 }} />Dimensionado / Alistamiento</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#3b82f6', marginRight: 4 }} />Instalación (avance real)</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#10b981', marginRight: 4 }} />Operativo</span>
      </div>
    </>
  );
}

function SCurveChart({ scurve, loading }: { scurve: ScurveResp | null; loading: boolean }) {
  if (loading) return <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Cargando…</div>;
  if (!scurve || scurve.total === 0) return <div className="alert-warning" style={{ fontSize: '0.85rem' }}>No hay proyectos con cronograma en este rango de fechas.</div>;

  return (
    <div style={{ height: 300 }}>
      <ResponsiveContainer>
        <LineChart data={scurve.points} margin={{ top: 8, right: 16, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="week" tick={{ fontSize: 10 }} tickFormatter={(v) => new Date(String(v)).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })} />
          <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} />
          <Tooltip labelFormatter={(v) => new Date(String(v)).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })} formatter={(v: unknown) => `${v}%`} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line type="monotone" dataKey="planeado" name="Planeado" stroke="#94a3b8" strokeDasharray="5 4" dot={false} strokeWidth={2} />
          <Line type="monotone" dataKey="real" name="Real" stroke={ACCENT} dot={false} strokeWidth={2.5} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
