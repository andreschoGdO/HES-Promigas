'use client';

import { useEffect, useState } from 'react';
import { Download, Sun, RefreshCw } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { generateDashPDF } from '@/lib/dash-pdf';
import { DEFAULT_REPORT, type DashReport } from '@/lib/dash-report-data';

const ACCENT = '#07c5a8';
const MARCA_COLORS = ['#07c5a8', '#3b82f6', '#f59e0b', '#8b5cf6'];

const fmtInt = (n: number) => n.toLocaleString('es-CO');
const fmt1   = (n: number) => n.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div style={{ fontSize: '0.72rem', color: ACCENT, fontWeight: 600 }}>{hint}</div>
    </div>
  );
}

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ color: ACCENT, fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {eyebrow}
      </div>
      <h2 style={{ fontSize: '1.4rem', fontWeight: 700, margin: '4px 0 0', letterSpacing: '-0.02em' }}>{title}</h2>
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
  const weekAgo = () => new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [from, setFrom] = useState<string>(weekAgo());
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

  const handleDownload = async () => {
    setDownloading(true);
    try {
      generateDashPDF(report);
    } finally {
      setTimeout(() => setDownloading(false), 400);
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
              Avance Semanal de Instalación
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
          <button
            className="primary-btn"
            onClick={handleDownload}
            disabled={downloading || loading}
          >
            <Download size={16} />
            {downloading ? 'Generando…' : 'Descargar PDF'}
          </button>
        </div>
      </section>

      {/* ─── SLIDE 2: AVANCE GLOBAL ─── */}
      <section className="card">
        <SectionHeader eyebrow="Avance global" title="Total instalado hasta la fecha" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
          <StatCard label="Casas instaladas (acum.)" value={fmtInt(report.global.casasAcum)} hint="desde inicio de operación" />
          <StatCard label="kWp solar (acum.)"        value={`${fmt1(report.global.kwpAcum)} kWp`} hint="instalados a la fecha" />
          <StatCard label="kWh batería (acum.)"      value={`${fmtInt(report.global.kwhAcum)} kWh`} hint="instalados a la fecha" />
          <StatCard label="CAPEX ejecutado (acum.)"  value={`$${fmtInt(report.global.capexAcumM)}M COP`} hint="desde inicio de operación" />
          <StatCard label="Avance vs. meta anual"    value={`${report.global.avancePct}%`} hint={`${report.global.casasAcum} de ${report.global.metaCasas} casas meta`} />
          <StatCard label="Meses activos"            value={`${report.global.mesesActivos}`} hint={`${report.global.porMes[0]?.mes} - ${report.global.porMes.at(-1)?.mes}`} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 8 }}>
              CASAS POR MES, POR SOLUCIÓN
            </div>
            <div style={{ height: 240 }}>
              <ResponsiveContainer>
                <BarChart data={report.global.porMes}>
                  <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="sol1" stackId="a" fill="#07c5a8" name="Solución 1" />
                  <Bar dataKey="sol2" stackId="a" fill="#3b82f6" name="Solución 2" />
                  <Bar dataKey="sol3" stackId="a" fill="#94a3b8" name="Solución 3" />
                  <Bar dataKey="sol4" stackId="a" fill="#1f2937" name="Solución 4" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 8 }}>
              DETALLE MENSUAL: INSTALACIÓN Y CAPEX
            </div>
            <SimpleTable
              head={['Mes', 'Casas', 'kWp', 'kWh', 'CAPEX']}
              rows={report.global.porMes.map((m) => [m.mes, fmtInt(m.casas), fmt1(m.kwp), fmtInt(m.kwh), `$${fmtInt(m.capexM)}M`])}
            />
          </div>
        </div>
      </section>

      {/* ─── SLIDE 3 (NUEVA): DETALLE GLOBAL POR MARCA, ZONA Y CONSTRUCTOR ─── */}
      <DetalleMarcaZonaConstructor
        eyebrow="Avance global"
        title="Detalle por marca, zona y constructor"
        marcas={report.detalleGlobal?.marcas ?? report.detalle.marcas}
        zonas={report.detalleGlobal?.zonas ?? report.detalle.zonas}
        constructores={report.detalleGlobal?.constructores ?? report.detalle.constructores}
      />

      {/* ─── SLIDE 4: PLANEACIÓN (movido antes del avance semanal) ─── */}
      <section className="card">
        <SectionHeader eyebrow="Planeación" title="Lo asignado para ejecutar la próxima semana" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
          <StatCard label="Casas asignadas"      value={fmtInt(report.planeacion.casasAsignadas)} hint="para la próxima semana" />
          <StatCard label="kWp planificados"     value={`${fmt1(report.planeacion.kwpPlan)} kWp`} hint="estimado" />
          <StatCard label="kWh batería planif."  value={`${fmtInt(report.planeacion.kwhPlan)} kWh`} hint="estimado" />
          <StatCard label="CAPEX estimado"        value={`$${fmtInt(report.planeacion.capexPlanM)}M COP`} hint="próxima semana" />
          <StatCard label="Constructores activos" value={`${report.planeacion.constructoresActivos}`} hint={report.planeacion.constructoresLista} />
          <StatCard label="Zonas con actividad"   value={`${report.planeacion.zonasActivas}`} hint={report.planeacion.zonasLista} />
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 8 }}>
          DISTRIBUCIÓN DE LO ASIGNADO POR ZONA Y CONSTRUCTOR
        </div>
        <SimpleTable
          head={['Zona', 'Constructor', 'Casas asignadas', 'Marca predominante', 'Fecha estimada de inicio']}
          rows={report.planeacion.distribucion.map((p) => [p.zona, p.constructor, fmtInt(p.casas), p.marca, p.fecha])}
        />
      </section>

      {/* ─── SLIDE 5: AVANCE SEMANAL ─── */}
      <section className="card">
        <SectionHeader eyebrow="Avance semanal" title="Resultados de construcción de esta semana" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
          <StatCard label="Casas instaladas"       value={fmtInt(report.semana.casasInstaladas)} hint={`de ${report.semana.programadas} programadas`} />
          <StatCard label="En stand by"            value={fmtInt(report.semana.standBy)}          hint="ver motivos abajo" />
          <StatCard label="Por iniciar próxima"    value={fmtInt(report.semana.porIniciar)}       hint="ya asignadas" />
          <StatCard label="kWp solar instalados"   value={`${fmt1(report.semana.kwpSemana)} kWp`} hint="esta semana" />
          <StatCard label="kWh batería instalados" value={`${fmtInt(report.semana.kwhSemana)} kWh`} hint="esta semana" />
          <StatCard label="CAPEX ejecutado"        value={`$${fmtInt(report.semana.capexSemanaM)}M COP`} hint="acumulado semana" />
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 8 }}>
          MOTIVOS DE STAND BY ({report.semana.standBy} CASAS)
        </div>
        <SimpleTable
          head={['Motivo', 'Casas', 'Acción en curso']}
          rows={report.semana.motivos.map((m) => [m.motivo, fmtInt(m.casas), m.accion])}
        />
      </section>

      {/* ─── SLIDE 6: DETALLE SEMANAL POR MARCA, ZONA Y CONSTRUCTOR ─── */}
      <DetalleMarcaZonaConstructor
        eyebrow="Avance semanal"
        title="Detalle por marca, zona y constructor"
        marcas={report.detalle.marcas}
        zonas={report.detalle.zonas}
        constructores={report.detalle.constructores}
      />

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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 8 }}>
              STOCK DISPONIBLE POR MARCA
            </div>
            <SimpleTable
              head={['Marca', 'Paneles', 'Inversores', 'Baterías', 'Estructuras']}
              rows={report.logistica.stock.map((s) => [s.marca, fmtInt(s.paneles), fmtInt(s.inversores), fmtInt(s.baterias), fmtInt(s.estructuras)])}
            />
          </div>
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
            COBERTURA ESTIMADA (SEMANAS DE INSTALACIÓN)
          </div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={report.logistica.stock}>
                <XAxis dataKey="marca" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="cobertura" fill={ACCENT} name="Semanas" />
              </BarChart>
            </ResponsiveContainer>
          </div>
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
    name: m.marca,
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
            head={['Marca', 'Casas', 'kWp', 'kWh']}
            rows={marcas.map((m) => [m.marca, fmtInt(m.casas), fmt1(m.kwp), fmtInt(m.kwh)])}
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
