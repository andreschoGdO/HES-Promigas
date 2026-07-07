'use client';

import { useEffect, useState } from 'react';
import { Download, Sun, RefreshCw } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LabelList,
} from 'recharts';
import { generateDashPDF } from '@/lib/dash-pdf';
import { generateDashPPTX } from '@/lib/dash-pptx';
import { DEFAULT_REPORT, type DashReport } from '@/lib/dash-report-data';

const ACCENT = '#07c5a8';
const MARCA_COLORS = ['#07c5a8', '#3b82f6', '#f59e0b', '#8b5cf6'];

const fmtInt = (n: number) => n.toLocaleString('es-CO');
const fmt1   = (n: number) => n.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function StatCard({ label, value, hint, tag, detalle, detalleSecundario }: {
  label: string; value: string; hint: string;
  tag?: string;
  /** Lista de casas que componen esta métrica; se muestra al hover. */
  detalle?: string[];
  /** Lista secundaria (ej: para mostrar 'programadas' al lado de 'instaladas'). */
  detalleSecundario?: { label: string; items: string[] };
}) {
  const parts: string[] = [];
  if (detalle && detalle.length > 0) {
    parts.push(`${label}:\n${detalle.map((d, i) => `  ${i + 1}. ${d}`).join('\n')}`);
  }
  if (detalleSecundario && detalleSecundario.items.length > 0) {
    parts.push(`${detalleSecundario.label}:\n${detalleSecundario.items.map((d, i) => `  ${i + 1}. ${d}`).join('\n')}`);
  }
  const nativeTitle = parts.length > 0 ? parts.join('\n\n') : undefined;
  const showHint = parts.length > 0;
  return (
    <div className="stat-card" title={nativeTitle} style={{ position: 'relative' }}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div style={{ fontSize: '0.72rem', color: ACCENT, fontWeight: 600 }}>{hint}</div>
      {tag && (
        <div style={{
          marginTop: 4,
          display: 'inline-flex',
          alignSelf: 'flex-start',
          padding: '2px 8px',
          background: 'var(--bg-elevated)',
          color: 'var(--text-secondary)',
          borderRadius: 999,
          fontSize: '0.68rem',
          fontWeight: 600,
          border: '1px solid var(--border)',
        }}>
          {tag}
        </div>
      )}
      {showHint && (
        <div style={{
          marginTop: 6,
          fontSize: '0.68rem',
          color: 'var(--text-muted)',
          fontStyle: 'italic',
        }}>
          Ver casas ↗
        </div>
      )}
    </div>
  );
}

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

      {/* ─── SLIDE 2: AVANCE GLOBAL ─── */}
      <section className="card">
        <SectionHeader eyebrow="Avance global" title="Total instalado hasta la fecha" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
          <StatCard
            label="Casas instaladas (acum.)"
            value={fmtInt(report.global.casasAcum)}
            hint="desde inicio de operación"
            tag={report.global.mesesActivos > 0 ? `~${fmt1(report.global.casasAcum / report.global.mesesActivos)} casas/mes` : undefined}
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
            hint="desde inicio de operación"
            tag={report.global.casasAcum > 0 ? `~$${fmt1(report.global.capexAcumM / report.global.casasAcum)}M / casa` : undefined}
          />
          <StatCard
            label="Avance vs. meta anual"
            value={`${report.global.avancePct}%`}
            hint={`${report.global.casasAcum} de ${report.global.metaCasas} casas meta`}
            tag={`Faltan ${Math.max(0, report.global.metaCasas - report.global.casasAcum)} casas`}
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
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(180px, 1fr))`, gap: 12 }}>
              {report.global.usdWpBySolucion.map((s) => (
                <div key={s.solucion} className="stat-card" style={{ borderLeft: '4px solid var(--accent)' }}>
                  <div className="stat-label">{s.solucion}</div>
                  <div className="stat-value">${fmt1(s.usdWpPromedio)} USD/Wp</div>
                  <div style={{ fontSize: '0.72rem', color: ACCENT, fontWeight: 600 }}>{s.casas} casa{s.casas === 1 ? '' : 's'}</div>
                </div>
              ))}
              {/* Total ponderado */}
              {(() => {
                const totCasas = report.global.usdWpBySolucion.reduce((a, s) => a + s.casas, 0);
                if (totCasas === 0) return null;
                const totKwp = report.global.kwpAcum;
                const totUsdWp = totKwp > 0
                  ? (report.global.capexVentaAcumM * 1_000_000 / TRM_COP) / (totKwp * 1000)
                  : 0;
                return (
                  <div className="stat-card" style={{ borderLeft: '4px solid #64748b', background: 'var(--bg-elevated)' }}>
                    <div className="stat-label">Promedio general</div>
                    <div className="stat-value">${fmt1(totUsdWp)} USD/Wp</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>{totCasas} casas · ${fmtInt(report.global.capexVentaAcumM)}M venta</div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </section>

      {/* ─── SLIDE 3 (NUEVA): DETALLE GLOBAL POR MARCA, ZONA Y CONSTRUCTOR ─── */}
      <DetalleMarcaZonaConstructor
        eyebrow="Avance global"
        title="Detalle por marca, zona y constructor"
        marcas={report.detalleGlobal?.marcas ?? report.detalle.marcas}
        zonas={report.detalleGlobal?.zonas ?? report.detalle.zonas}
        constructores={report.detalleGlobal?.constructores ?? report.detalle.constructores}
      />

      {/* ─── SLIDE 4: CONSTRUCCIÓN (semanal + planeación unificados) ─── */}
      <section className="card">
        <SectionHeader eyebrow="Weekly" title="Construcción" size="large" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
          <StatCard
            label="Instaladas esta semana"
            value={fmtInt(report.semana.casasInstaladas)}
            hint={report.semana.casasInstaladas > 0 ? 'ya operativas' : 'ninguna esta semana'}
            detalle={report.semana.detalle?.instaladas}
          />
          <StatCard
            label="En curso"
            value={fmtInt(report.semana.porIniciar)}
            hint="alistamiento o instalación"
            detalle={report.semana.detalle?.porIniciar}
          />
          <StatCard
            label="Próxima semana"
            value={fmtInt(report.planeacion.casasAsignadas)}
            hint="en gestión + planeadas"
            tag={report.planeacion.casasAsignadas > 0 ? `${report.planeacion.distribucion.length} grupos` : undefined}
          />
          <StatCard
            label="kWp instalados"
            value={`${fmt1(report.semana.kwpSemana)} kWp`}
            hint="esta semana"
            tag={report.semana.kwpSemana > 0 ? `~${fmtInt(Math.round(report.semana.kwpSemana * 1000 / PANEL_WP))} paneles` : undefined}
          />
          <StatCard
            label="kWh batería"
            value={`${fmtInt(report.semana.kwhSemana)} kWh`}
            hint="esta semana"
            tag={report.semana.kwhSemana > 0 ? `~${fmtInt(Math.round(report.semana.kwhSemana / KWH_POR_BATERIA))} baterías` : undefined}
          />
        </div>

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

        {/* Distribución planeación próxima semana */}
        {report.planeacion.distribucion.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 8 }}>
              PRÓXIMA SEMANA — DISTRIBUCIÓN POR ZONA Y CONSTRUCTOR
            </div>
            <SimpleTable
              head={['Zona', 'Constructor', 'Casas', 'Marca', 'Fecha']}
              rows={report.planeacion.distribucion.map((p) => [p.zona, p.constructor, fmtInt(p.casas), p.marca, p.fecha])}
            />
          </div>
        )}

        {/* Motivos de stand-by (si hay) */}
        {report.semana.motivos.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 8 }}>
              STAND BY — REQUIERE ACCIÓN ({report.semana.standBy} CASAS)
            </div>
            <SimpleTable
              head={['Motivo', 'Casas', 'Acción']}
              rows={report.semana.motivos.map((m) => [m.motivo, fmtInt(m.casas), m.accion])}
            />
          </div>
        )}
      </section>

      {/* ─── SLIDE 7: LEGALIZACIONES ─── */}
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

      {/* ─── SLIDE 7: POSTVENTA ─── */}
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

      {/* ─── SLIDE 8: LOGÍSTICA ─── */}
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

function DetalleMarcaZonaConstructor({
  eyebrow, title, marcas, zonas, constructores,
}: {
  eyebrow: string; title: string;
  marcas: DashReport['detalle']['marcas'];
  zonas: DashReport['detalle']['zonas'];
  constructores: DashReport['detalle']['constructores'];
}) {
  const total = marcas.reduce((s, m) => s + m.casas, 0);
  const pie = marcas.map((m) => ({
    name: labelForMarca(m.marca),
    value: m.casas,
    pct: total ? Math.round((m.casas / total) * 100) : 0,
  }));
  return (
    <section className="card">
      <SectionHeader eyebrow={eyebrow} title={title} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 8 }}>
            CASAS INSTALADAS POR MARCA
          </div>
          <SimpleTable
            head={['Kit', 'Casas', 'kWp', 'kWh']}
            rows={marcas.map((m) => [labelForMarca(m.marca), fmtInt(m.casas), fmt1(m.kwp), fmtInt(m.kwh)])}
          />
          <div style={{ height: 220, marginTop: 16 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={pie}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={80}
                  label={(props: unknown) => {
                    const p = props as { payload?: { pct?: number } };
                    return p.payload?.pct !== undefined ? `${p.payload.pct}%` : '';
                  }}
                >
                  {pie.map((_, i) => (
                    <Cell key={i} fill={MARCA_COLORS[i % MARCA_COLORS.length]} />
                  ))}
                </Pie>
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 8 }}>
              CASAS Y CAPEX POR ZONA
            </div>
            <SimpleTable
              head={['Zona', 'Casas', 'CAPEX (COP)']}
              rows={zonas.map((z) => [z.zona, fmtInt(z.casas), z.capex])}
            />
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 8 }}>
              CASAS ASIGNADAS POR CONSTRUCTOR
            </div>
            <SimpleTable
              head={['Constructor', 'Asignadas', 'Instaladas']}
              rows={constructores.map((c) => [c.constructor, fmtInt(c.asignadas), fmtInt(c.instaladas)])}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Tabla con paginación. Muestra `pageSize` filas por página (default: 6) y
 * ofrece controles Prev/Next + indicador "Página X de Y". Si `rows.length <= pageSize`
 * se renderiza como una SimpleTable normal sin controles.
 */
function PaginatedTable({ head, rows, pageSize = 6 }: { head: string[]; rows: React.ReactNode[][]; pageSize?: number }) {
  const [page, setPage] = useState(0);
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const start = currentPage * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  if (total <= pageSize) return <SimpleTable head={head} rows={rows} />;

  return (
    <div>
      <SimpleTable head={head} rows={pageRows} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginTop: 8, fontSize: '0.78rem' }}>
        <span style={{ color: 'var(--text-muted)' }}>
          {start + 1}–{Math.min(start + pageSize, total)} de {total}
        </span>
        <button
          onClick={() => setPage(Math.max(0, currentPage - 1))}
          disabled={currentPage === 0}
          className="secondary-btn"
          style={{ padding: '4px 10px', fontSize: '0.78rem', opacity: currentPage === 0 ? 0.4 : 1 }}
        >
          ← Anterior
        </button>
        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
          {currentPage + 1} / {totalPages}
        </span>
        <button
          onClick={() => setPage(Math.min(totalPages - 1, currentPage + 1))}
          disabled={currentPage >= totalPages - 1}
          className="secondary-btn"
          style={{ padding: '4px 10px', fontSize: '0.78rem', opacity: currentPage >= totalPages - 1 ? 0.4 : 1 }}
        >
          Siguiente →
        </button>
      </div>
    </div>
  );
}

function SimpleTable({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          <tr style={{ background: '#1f2937', color: '#fff' }}>
            {head.map((h, i) => (
              <th key={i} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, fontSize: '0.78rem' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ background: i % 2 ? 'var(--bg-elevated)' : 'var(--bg-card)', borderTop: '1px solid var(--border)' }}>
              {row.map((cell, j) => (
                <td key={j} style={{ padding: '10px 12px', color: 'var(--text-primary)' }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
