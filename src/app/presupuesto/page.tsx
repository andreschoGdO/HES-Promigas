'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Plus, Trash2, Save, RefreshCw } from 'lucide-react';
import { StatCard } from '@/components/StatCard';

const GRUPOS: { numero: number; nombre: string }[] = [
  { numero: 1, nombre: 'Inversor' },
  { numero: 2, nombre: 'Batería' },
  { numero: 3, nombre: 'BMS' },
  { numero: 4, nombre: 'Equipos adicionales' },
  { numero: 5, nombre: 'Medidores' },
  { numero: 6, nombre: 'Modem' },
  { numero: 7, nombre: 'Paneles' },
  { numero: 8, nombre: 'Puntos de anclaje' },
  { numero: 9, nombre: 'Análisis estructural' },
  { numero: 10, nombre: 'Mano de obra' },
  { numero: 11, nombre: 'Factibilidad' },
];

interface BudgetLine {
  _key: string;         // identidad local (React key + índice de edición) — item_numero es texto libre editable, no sirve de identidad
  grupo_numero: number;
  grupo_nombre: string;
  item_numero: string;
  referencia: string | null;
  descripcion: string;
  precio_usd: number | null;
  trm: number | null;
  cantidad: number;
  precio_cop: number | null;
  precio_total: number | null;
}

let localKeySeq = 0;
const newLocalKey = () => `local-${Date.now()}-${localKeySeq++}`;

interface ExecutionRow { grupo: string; presupuestado: number; ejecutado: number; pct: number; }

const fmtCOP = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

function computeLine(line: BudgetLine): BudgetLine {
  const precioCop = line.precio_usd != null && line.trm != null ? round2(line.precio_usd * line.trm) : line.precio_cop;
  const precioTotal = precioCop != null ? round2(precioCop * (line.cantidad ?? 0)) : null;
  return { ...line, precio_cop: precioCop, precio_total: precioTotal };
}

export default function PresupuestoPage() {
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [lines, setLines] = useState<BudgetLine[]>([]);
  const [execution, setExecution] = useState<ExecutionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [bRes, eRes] = await Promise.all([
      fetch(`/api/budget?anio=${anio}`),
      fetch(`/api/budget/execution?anio=${anio}`),
    ]);
    const bJson = await bRes.json();
    const eJson = await eRes.json();
    setLines((bJson.items ?? []).map((l: Omit<BudgetLine, '_key'>) => ({ ...l, _key: newLocalKey() })));
    setExecution(eJson.grupos ?? []);
    setLoading(false);
  }, [anio]);

  useEffect(() => { load(); }, [load]);

  const addLine = (grupo: { numero: number; nombre: string }) => {
    const countInGroup = lines.filter((l) => l.grupo_numero === grupo.numero).length;
    setLines((ls) => [...ls, {
      _key: newLocalKey(),
      grupo_numero: grupo.numero, grupo_nombre: grupo.nombre,
      item_numero: `${grupo.numero}.${countInGroup + 1}`,
      referencia: '', descripcion: '', precio_usd: null, trm: null, cantidad: 0, precio_cop: null, precio_total: null,
    }]);
  };

  const updateLine = (key: string, patch: Partial<BudgetLine>) => {
    setLines((ls) => ls.map((l) => l._key === key ? computeLine({ ...l, ...patch }) : l));
  };

  const removeLine = (key: string) => setLines((ls) => ls.filter((l) => l._key !== key));

  const save = async () => {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/budget?anio=${anio}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: lines.map(({ _key, ...rest }) => rest) }),
    });
    const json = await res.json();
    if (!res.ok) { setError(json.error); setSaving(false); return; }
    setSaving(false);
    load(); // refresca líneas (con sus ids reales) y la ejecución
  };

  const totals = useMemo(() => {
    const total = lines.reduce((s, l) => s + Number(l.precio_total ?? 0), 0);
    const iva = total * 0.19;
    return { total, iva, gran: total + iva };
  }, [lines]);

  const totalEjecutado = execution.reduce((s, r) => s + r.ejecutado, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.3rem' }}>Presupuesto</h1>
          <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>APU editable por año, comparado contra lo ejecutado en Órdenes de Compra.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <select value={anio} onChange={(e) => setAnio(Number(e.target.value))}>
            {[anio - 1, anio, anio + 1, anio + 2].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button className="icon-btn" onClick={load} aria-label="Refrescar"><RefreshCw size={16} /></button>
          <button className="primary-btn" onClick={save} disabled={saving}><Save size={14} /> {saving ? 'Guardando…' : 'Guardar presupuesto'}</button>
        </div>
      </div>

      {error && <div className="alert-error">{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <StatCard label={`Presupuesto ${anio}`} value={fmtCOP(totals.gran)} hint="Gran total (IVA 19% incluido)" />
        <StatCard label="Ejecutado (OC del año)" value={fmtCOP(totalEjecutado)} hint={totals.total > 0 ? `${((totalEjecutado / totals.total) * 100).toFixed(1)}% del presupuesto sin IVA` : 'Sin base presupuestada'} />
        <StatCard label="Disponible" value={fmtCOP(Math.max(0, totals.total - totalEjecutado))} hint="Presupuesto (sin IVA) menos ejecutado" />
      </div>

      {loading ? <p style={{ color: 'var(--text-muted)' }}>Cargando…</p> : (
        <>
          <section className="card">
            <div className="overflow-x" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elevated)', textAlign: 'left' }}>
                    {['Item', 'Referencia', 'Descripción', 'Precio USD', 'TRM', 'Precio COP', 'Cantidad', 'Precio Total', ''].map((h) => (
                      <th key={h} style={{ padding: '7px 9px', fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {GRUPOS.map((grupo) => {
                    const groupLines = lines.filter((l) => l.grupo_numero === grupo.numero);
                    const groupTotal = groupLines.reduce((s, l) => s + Number(l.precio_total ?? 0), 0);
                    return (
                      <FragmentGroup key={grupo.numero}>
                        <tr style={{ background: 'var(--bg-card)', borderTop: '2px solid var(--border)' }}>
                          <td colSpan={7} style={{ padding: '8px 9px', fontWeight: 700 }}>{grupo.numero}. {grupo.nombre}</td>
                          <td style={{ padding: '8px 9px', fontWeight: 700 }}>{fmtCOP(groupTotal)}</td>
                          <td style={{ padding: '8px 9px' }}>
                            <button className="icon-btn" onClick={() => addLine(grupo)} aria-label="Agregar línea"><Plus size={13} /></button>
                          </td>
                        </tr>
                        {groupLines.map((line) => (
                          <tr key={line._key} style={{ borderTop: '1px solid var(--border)' }}>
                            <td style={{ padding: 5 }}><input value={line.item_numero} onChange={(e) => updateLine(line._key, { item_numero: e.target.value })} style={{ width: 60 }} /></td>
                            <td style={{ padding: 5 }}><input value={line.referencia ?? ''} onChange={(e) => updateLine(line._key, { referencia: e.target.value })} style={{ width: 110 }} /></td>
                            <td style={{ padding: 5 }}><input value={line.descripcion} onChange={(e) => updateLine(line._key, { descripcion: e.target.value })} style={{ minWidth: 160 }} /></td>
                            <td style={{ padding: 5 }}><input type="number" value={line.precio_usd ?? ''} onChange={(e) => updateLine(line._key, { precio_usd: e.target.value ? Number(e.target.value) : null })} style={{ width: 90 }} /></td>
                            <td style={{ padding: 5 }}><input type="number" value={line.trm ?? ''} onChange={(e) => updateLine(line._key, { trm: e.target.value ? Number(e.target.value) : null })} style={{ width: 80 }} /></td>
                            <td style={{ padding: 5, color: 'var(--text-muted)' }}>{line.precio_cop != null ? fmtCOP(line.precio_cop) : '—'}</td>
                            <td style={{ padding: 5 }}><input type="number" value={line.cantidad} onChange={(e) => updateLine(line._key, { cantidad: Number(e.target.value) })} style={{ width: 70 }} /></td>
                            <td style={{ padding: 5, fontWeight: 600 }}>{line.precio_total != null ? fmtCOP(line.precio_total) : '—'}</td>
                            <td style={{ padding: 5 }}><button className="icon-btn" onClick={() => removeLine(line._key)} aria-label="Quitar"><Trash2 size={12} /></button></td>
                          </tr>
                        ))}
                        {groupLines.length === 0 && (
                          <tr><td colSpan={9} style={{ padding: '6px 9px', color: 'var(--text-muted)', fontStyle: 'italic' }}>Sin líneas en este grupo.</td></tr>
                        )}
                      </FragmentGroup>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--border)' }}>
                    <td colSpan={7} style={{ padding: '8px 9px', textAlign: 'right', fontWeight: 700 }}>TOTAL</td>
                    <td colSpan={2} style={{ padding: '8px 9px', fontWeight: 700 }}>{fmtCOP(totals.total)}</td>
                  </tr>
                  <tr>
                    <td colSpan={7} style={{ padding: '4px 9px', textAlign: 'right', color: 'var(--text-secondary)' }}>IVA 19%</td>
                    <td colSpan={2} style={{ padding: '4px 9px', color: 'var(--text-secondary)' }}>{fmtCOP(totals.iva)}</td>
                  </tr>
                  <tr>
                    <td colSpan={7} style={{ padding: '4px 9px', textAlign: 'right', fontWeight: 800 }}>GRAN TOTAL</td>
                    <td colSpan={2} style={{ padding: '4px 9px', fontWeight: 800 }}>{fmtCOP(totals.gran)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <section className="card">
            <div className="card-header"><span className="card-title">Ejecución por categoría</span></div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ background: 'var(--bg-elevated)', textAlign: 'left' }}>
                  <th style={{ padding: 8 }}>Categoría</th><th style={{ padding: 8 }}>Presupuestado</th><th style={{ padding: 8 }}>Ejecutado</th><th style={{ padding: 8 }}>%</th>
                </tr>
              </thead>
              <tbody>
                {execution.map((r) => (
                  <tr key={r.grupo} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: 8 }}>{r.grupo}</td>
                    <td style={{ padding: 8 }}>{fmtCOP(r.presupuestado)}</td>
                    <td style={{ padding: 8 }}>{fmtCOP(r.ejecutado)}</td>
                    <td style={{ padding: 8 }}>
                      <span className={r.pct >= 100 ? 'badge-success' : r.pct >= 60 ? 'badge-warning' : 'badge-error'}>{r.pct.toFixed(0)}%</span>
                    </td>
                  </tr>
                ))}
                {execution.length === 0 && <tr><td colSpan={4} style={{ padding: 12, color: 'var(--text-muted)' }}>Sin datos de ejecución para {anio}.</td></tr>}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}

/** Envoltorio trivial para poder devolver varias <tr> desde un .map sin key duplicada en <>. */
function FragmentGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
