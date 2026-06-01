'use client';

import { useState } from 'react';
import { Activity, AlertTriangle, FileText, Package, TrendingUp, Briefcase, Download, Eye, Calendar } from 'lucide-react';
import { downloadCSV, fileDateRange } from '@/lib/csv-export';

type ReportType = 'operacion' | 'reactiva' | 'alertas' | 'inventario' | 'pipeline' | 'ejecutivo';

interface ReportDef {
  type: ReportType;
  title: string;
  description: string;
  Icon: typeof Activity;
  color: string;
  needsPeriod: boolean;
  needsSeverity?: boolean;
}

const REPORTS: ReportDef[] = [
  {
    type: 'ejecutivo',
    title: 'Resumen ejecutivo',
    description: 'KPIs consolidados de todo el sistema: operación, conectividad, alertas, inventario y CRM en una sola hoja.',
    Icon: TrendingUp,
    color: '#07c5a8',
    needsPeriod: true,
  },
  {
    type: 'operacion',
    title: 'Operación diaria por casa',
    description: 'Energía generada, demanda, importación, excedentes, yield real y desempeño (PR) por casa y por día.',
    Icon: Activity,
    color: '#3b82f6',
    needsPeriod: true,
  },
  {
    type: 'reactiva',
    title: 'Reactiva CREG (mensual)',
    description: 'Ratio ER inductiva / EA mensual por casa, flag de penalización CREG 015-2018 y estimación COP.',
    Icon: FileText,
    color: '#f59e0b',
    needsPeriod: true,
  },
  {
    type: 'alertas',
    title: 'Eventos de alertas',
    description: 'Listado de eventos disparados en el período con casa, regla, valor, umbral y estado de acknowledge.',
    Icon: AlertTriangle,
    color: '#ef4444',
    needsPeriod: true,
    needsSeverity: true,
  },
  {
    type: 'inventario',
    title: 'Snapshot de inventario',
    description: 'Estado actual de equipos serializados (status, casa, garantía) + consumibles con flag de stock bajo.',
    Icon: Package,
    color: '#8b5cf6',
    needsPeriod: false,
  },
  {
    type: 'pipeline',
    title: 'Pipeline CRM',
    description: 'Todos los proyectos con su módulo actual, etapa, cliente, valor de propuesta y diseño aprobado.',
    Icon: Briefcase,
    color: '#ec4899',
    needsPeriod: false,
  },
];

// Default = mes actual
const today = () => new Date().toISOString().slice(0, 10);
const firstOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};

export default function ReportesPage() {
  const [from, setFrom] = useState<string>(firstOfMonth());
  const [to, setTo] = useState<string>(today());
  const [severity, setSeverity] = useState<string>('');
  const [busy, setBusy] = useState<ReportType | null>(null);
  const [preview, setPreview] = useState<ReportData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const runReport = async (type: ReportType, mode: 'csv' | 'preview') => {
    setBusy(type); setErr(null); setPreview(null);
    try {
      const params = new URLSearchParams({ type });
      const def = REPORTS.find((r) => r.type === type)!;
      if (def.needsPeriod) { params.set('from', from); params.set('to', to); }
      if (def.needsSeverity && severity) params.set('severity', severity);
      const r = await fetch(`/api/reports?${params}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Error');
      if (mode === 'csv') {
        const filename = `${type}-${def.needsPeriod ? fileDateRange(from, to) : today()}.csv`;
        downloadCSV(filename, j.headers, j.rows);
        if (j.extra) {
          downloadCSV(filename.replace('.csv', '-consumibles.csv'), j.extra.headers, j.extra.rows);
        }
      } else {
        setPreview(j as ReportData);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', paddingBottom: 40 }}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ margin: 0 }}>Reportes</h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: 4, fontSize: '0.88rem' }}>
          Exporta el estado actual y la operación histórica del sistema. CSV se descarga directo (ábrelo en Excel/Sheets), vista previa muestra el contenido en pantalla con opción a imprimir.
        </p>
      </div>

      {/* Filtros compartidos */}
      <div className="glass-panel" style={{ padding: 14, marginBottom: 18 }}>
        <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Calendar size={12} /> Filtros del período
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <div>
            <label className="input-label" style={{ fontSize: '0.74rem' }}>Desde</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="input-label" style={{ fontSize: '0.74rem' }}>Hasta</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label className="input-label" style={{ fontSize: '0.74rem' }}>Severidad (solo alertas)</label>
            <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="">Todas</option>
              <option value="high">Alta</option>
              <option value="medium">Media</option>
              <option value="low">Baja</option>
            </select>
          </div>
        </div>
        <p style={{ margin: '10px 0 0', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          Los reportes "Inventario" y "Pipeline" ignoran el período (son snapshots del estado actual).
        </p>
      </div>

      {err && <div className="alert-error" style={{ marginBottom: 14 }}>{err}</div>}

      {/* Grid de reportes */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))', gap: 14, marginBottom: 18 }}>
        {REPORTS.map((r) => (
          <div key={r.type} className="glass-panel" style={{ padding: 16, borderLeft: `4px solid ${r.color}`, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <r.Icon size={20} style={{ color: r.color }} />
              <h3 style={{ margin: 0, fontSize: '0.98rem' }}>{r.title}</h3>
            </div>
            <p style={{ margin: '0 0 14px', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.45, flex: 1 }}>
              {r.description}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => runReport(r.type, 'preview')}
                disabled={busy !== null}
                className="secondary-btn"
                style={{ flex: 1, fontSize: '0.78rem', padding: '8px 10px' }}
              >
                <Eye size={13} /> {busy === r.type ? 'Cargando…' : 'Ver'}
              </button>
              <button
                onClick={() => runReport(r.type, 'csv')}
                disabled={busy !== null}
                className="primary-btn"
                style={{ flex: 1, fontSize: '0.78rem', padding: '8px 10px', background: r.color, border: 'none' }}
              >
                <Download size={13} /> CSV
              </button>
            </div>
          </div>
        ))}
      </div>

      {preview && <ReportPreview data={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

interface ReportData {
  type: ReportType;
  title: string;
  period?: { from?: string; to?: string; severity?: string };
  headers: string[];
  rows: Array<Array<unknown>>;
  extra?: { title: string; headers: string[]; rows: Array<Array<unknown>> };
  summary?: Record<string, unknown>;
  generated_at: string;
}

function ReportPreview({ data, onClose }: { data: ReportData; onClose: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: 1100, maxHeight: '90vh', overflowY: 'auto', padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <div className="report-print">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.15rem' }}>{data.title}</h2>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 2 }}>
                {data.period?.from && data.period?.to && (
                  <span>{data.period.from} → {data.period.to}{data.period.severity ? ` · severidad: ${data.period.severity}` : ''} · </span>
                )}
                Generado: {new Date(data.generated_at).toLocaleString('es-CO')}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }} className="no-print">
              <button onClick={() => window.print()} className="secondary-btn" style={{ fontSize: '0.78rem' }}>Imprimir / PDF</button>
              <button onClick={() => {
                const def = REPORTS.find((r) => r.type === data.type)!;
                const filename = `${data.type}-${def.needsPeriod && data.period?.from ? `${data.period.from}_${data.period.to}` : new Date().toISOString().slice(0, 10)}.csv`;
                downloadCSV(filename, data.headers, data.rows);
                if (data.extra) {
                  downloadCSV(filename.replace('.csv', '-consumibles.csv'), data.extra.headers, data.extra.rows);
                }
              }} className="primary-btn" style={{ fontSize: '0.78rem' }}>
                <Download size={12} /> CSV
              </button>
              <button onClick={onClose} className="secondary-btn no-print" style={{ fontSize: '0.78rem' }}>Cerrar</button>
            </div>
          </div>

          {data.summary && (
            <div style={{ marginBottom: 14, padding: 12, background: 'var(--bg-elevated)', borderRadius: 8, fontSize: '0.78rem' }}>
              <strong>Resumen:</strong>{' '}
              {Object.entries(data.summary).map(([k, v], i, arr) => (
                <span key={k}>
                  {k.replace(/_/g, ' ')}: <strong>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</strong>{i < arr.length - 1 ? ' · ' : ''}
                </span>
              ))}
            </div>
          )}

          <DataTable headers={data.headers} rows={data.rows} />

          {data.extra && (
            <>
              <h3 style={{ margin: '24px 0 10px', fontSize: '1rem' }}>{data.extra.title}</h3>
              <DataTable headers={data.extra.headers} rows={data.extra.rows} />
            </>
          )}
        </div>

        <style jsx>{`
          @media print {
            :global(.sidebar), :global(.topbar), .no-print { display: none !important; }
            :global(.main-area) { margin-left: 0 !important; }
            .report-print { font-size: 10pt; }
          }
        `}</style>
      </div>
    </div>
  );
}

function DataTable({ headers, rows }: { headers: string[]; rows: Array<Array<unknown>> }) {
  if (rows.length === 0) {
    return <div className="alert-warning" style={{ fontSize: '0.82rem' }}>Sin datos para los filtros seleccionados.</div>;
  }
  return (
    <div style={{ overflowX: 'auto', maxHeight: 480, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
      <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} style={{ position: 'sticky', top: 0, background: 'var(--bg-elevated)', textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid var(--border)', fontWeight: 700, fontSize: '0.72rem' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 500).map((row, ri) => (
            <tr key={ri} style={{ borderBottom: '1px solid var(--border)' }}>
              {row.map((c, ci) => (
                <td key={ci} style={{ padding: '6px 10px', fontSize: '0.76rem', fontFamily: typeof c === 'number' || (typeof c === 'string' && /^[\d.,\-]+$/.test(c)) ? 'ui-monospace, monospace' : 'inherit', textAlign: typeof c === 'number' ? 'right' : 'left' }}>
                  {c === null || c === undefined ? '' : String(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 500 && (
        <div style={{ padding: 10, fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'center', background: 'var(--bg-elevated)' }}>
          Mostrando 500 de {rows.length} filas. Descarga el CSV para ver todo.
        </div>
      )}
    </div>
  );
}
