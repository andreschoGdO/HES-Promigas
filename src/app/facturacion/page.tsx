'use client';

import { useEffect, useMemo, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { Receipt, Download, Search, Pencil, X, Check, Loader2, MapPin, Tag, Layers, HardHat, Boxes, DollarSign, Wrench, Calculator } from 'lucide-react';

interface Row {
  project_id: string;
  project_code: string | null;
  project_title: string;
  ciudad: string | null;
  conjunto: string | null;
  casa: string | null;
  solucion: string | null;
  plan: string | null;
  paneles: number | null;
  kwp: number | null;
  bateria: number | null;
  kwh: number | null;
  constructor: string | null;
  marca_bateria: string | null;
  marca_inversor: string | null;
  marca_panel: string | null;
  costo_inversor: number | null;
  costo_bateria: number | null;
  costo_control_box: number | null;
  costo_top_cover: number | null;
  costo_panel_solar: number | null;
  costo_medidor_solar: number | null;
  costo_medidor_generacion: number | null;
  costo_modem: number | null;
  mano_de_obra: number | null;
  desmantelamiento_mo: number | null;
  capex: number | null;
  operador_red: string | null;
  has_record: boolean;
}

type Col = {
  key: keyof Row;
  label: string;
  type: 'text' | 'num' | 'money';
  editable: boolean;
  sticky?: boolean;          // pin column at left while scrolling horizontally
  minWidth?: number;
};

type Group = {
  id: string;
  label: string;
  Icon: typeof MapPin;
  color: string;
  cols: Col[];
};

// Agrupación lógica de las 25 columnas pedidas, manteniendo el orden exacto.
const GROUPS: Group[] = [
  {
    id: 'ubicacion', label: 'Ubicación', Icon: MapPin, color: '#0ea5e9',
    cols: [
      { key: 'ciudad',   label: 'CIUDAD',                type: 'text', editable: false, sticky: true, minWidth: 110 },
      { key: 'conjunto', label: 'CONJUNTO RESIDENCIAL',  type: 'text', editable: false, sticky: true, minWidth: 200 },
      { key: 'casa',     label: 'CASA',                  type: 'text', editable: false, sticky: true, minWidth: 70 },
    ],
  },
  {
    id: 'plan', label: 'Plan comercial', Icon: Tag, color: '#10b981',
    cols: [
      { key: 'solucion', label: 'SOLUCIÓN', type: 'text', editable: true, minWidth: 160 },
      { key: 'plan',     label: 'PLAN',     type: 'text', editable: true, minWidth: 120 },
    ],
  },
  {
    id: 'diseno', label: 'Diseño', Icon: Layers, color: '#8b5cf6',
    cols: [
      { key: 'paneles', label: 'PANELES', type: 'num', editable: false, minWidth: 80 },
      { key: 'kwp',     label: 'kwp',     type: 'num', editable: false, minWidth: 70 },
      { key: 'bateria', label: 'BATERIA', type: 'num', editable: false, minWidth: 80 },
      { key: 'kwh',     label: 'kwh',     type: 'num', editable: false, minWidth: 70 },
    ],
  },
  {
    id: 'actores', label: 'Actores y marcas', Icon: HardHat, color: '#f59e0b',
    cols: [
      { key: 'constructor',    label: 'Constructor',     type: 'text', editable: false, minWidth: 130 },
      { key: 'marca_bateria',  label: 'Marca Bateria',   type: 'text', editable: false, minWidth: 130 },
      { key: 'marca_inversor', label: 'Marca Inversor',  type: 'text', editable: false, minWidth: 130 },
      { key: 'marca_panel',    label: 'Marca Panel',     type: 'text', editable: false, minWidth: 130 },
    ],
  },
  {
    id: 'costo_equipos', label: 'Costos equipos (COP)', Icon: Boxes, color: '#3b82f6',
    cols: [
      { key: 'costo_inversor',           label: 'Costo Inversor',          type: 'money', editable: true, minWidth: 120 },
      { key: 'costo_bateria',            label: 'Costo Bateria',           type: 'money', editable: true, minWidth: 120 },
      { key: 'costo_control_box',        label: 'Costo Control Box (BMS)', type: 'money', editable: true, minWidth: 150 },
      { key: 'costo_top_cover',          label: 'Costo Top Cover',         type: 'money', editable: true, minWidth: 130 },
      { key: 'costo_panel_solar',        label: 'Panel Solar',             type: 'money', editable: true, minWidth: 120 },
      { key: 'costo_medidor_solar',      label: 'Medidor Solar',           type: 'money', editable: true, minWidth: 120 },
      { key: 'costo_medidor_generacion', label: 'Medidor Generacion',      type: 'money', editable: true, minWidth: 130 },
      { key: 'costo_modem',              label: 'Modem',                   type: 'money', editable: true, minWidth: 110 },
    ],
  },
  {
    id: 'servicios', label: 'Servicios (COP)', Icon: Wrench, color: '#ec4899',
    cols: [
      { key: 'mano_de_obra',         label: 'Mano de Obra',           type: 'money', editable: true, minWidth: 130 },
      { key: 'desmantelamiento_mo',  label: 'Desmantelamiento x MO',  type: 'money', editable: true, minWidth: 160 },
    ],
  },
  {
    id: 'cierre', label: 'Cierre', Icon: Calculator, color: '#07c5a8',
    cols: [
      { key: 'capex',        label: 'Capex', type: 'money', editable: true, minWidth: 130 },
      { key: 'operador_red', label: 'OR',    type: 'text',  editable: true, minWidth: 100 },
    ],
  },
];

const COLUMNS: Col[] = GROUPS.flatMap((g) => g.cols);

// índices acumulados para sticky-left offsets (px) — calculados en tiempo de
// ejecución según minWidths declarados arriba.
const STICKY_LEFTS: number[] = (() => {
  const offsets: number[] = [];
  let acc = 0;
  for (const c of COLUMNS) {
    if (c.sticky) {
      offsets.push(acc);
      acc += c.minWidth ?? 120;
    } else {
      offsets.push(0);
    }
  }
  return offsets;
})();

const fmtMoney = (n: number | null): string => {
  if (n === null || n === undefined) return '';
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);
};
const fmtNum = (n: number | null): string => {
  if (n === null || n === undefined) return '';
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(n);
};

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function FacturacionPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ projectId: string; field: keyof Row } | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [userEmail, setUserEmail] = useState<string>('');

  useEffect(() => {
    const supa = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    supa.auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email); });
  }, []);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch('/api/facturacion');
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      const j = await r.json();
      setRows(j.rows ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.project_code, r.project_title, r.ciudad, r.conjunto, r.casa, r.constructor, r.marca_inversor, r.marca_panel, r.marca_bateria]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [rows, query]);

  const totals = useMemo(() => {
    const sum = (k: keyof Row) =>
      filtered.reduce((acc, r) => acc + (typeof r[k] === 'number' ? (r[k] as number) : 0), 0);
    const out: Record<string, number> = {};
    for (const c of COLUMNS) {
      if (c.type === 'money' || c.type === 'num') out[c.key as string] = sum(c.key);
    }
    return out;
  }, [filtered]);

  // KPIs del header — agregados rápidos
  const kpis = useMemo(() => {
    const totalCapex = filtered.reduce((acc, r) => acc + (r.capex ?? 0), 0);
    const withCosts = filtered.filter((r) => r.has_record).length;
    const totalPaneles = filtered.reduce((acc, r) => acc + (r.paneles ?? 0), 0);
    const totalKwp = filtered.reduce((acc, r) => acc + (r.kwp ?? 0), 0);
    return { totalCapex, withCosts, totalPaneles, totalKwp };
  }, [filtered]);

  const startEdit = (projectId: string, field: keyof Row, currentValue: unknown) => {
    setEditing({ projectId, field });
    setEditValue(currentValue === null || currentValue === undefined ? '' : String(currentValue));
  };
  const cancelEdit = () => { setEditing(null); setEditValue(''); };
  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const r = await fetch('/api/facturacion', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: editing.projectId,
          [editing.field]: editValue,
          actor_email: userEmail,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      setRows((cur) => cur.map((row) => {
        if (row.project_id !== editing.projectId) return row;
        const col = COLUMNS.find((c) => c.key === editing.field);
        const parsed = col?.type === 'text'
          ? (editValue.trim() === '' ? null : editValue.trim())
          : (editValue === '' ? null : Number(editValue));
        return { ...row, [editing.field]: parsed, has_record: true };
      }));
      cancelEdit();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Error guardando');
    } finally {
      setSaving(false);
    }
  };

  const exportCsv = () => {
    const header = COLUMNS.map((c) => c.label);
    const escape = (v: unknown): string => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[,"\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.map(escape).join(',')];
    for (const r of filtered) {
      const cells = COLUMNS.map((c) => {
        const v = r[c.key];
        if (v === null || v === undefined) return '';
        if (c.type === 'money' || c.type === 'num') return String(v);
        return escape(v);
      });
      lines.push(cells.join(','));
    }
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `facturacion-${todayIso()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Total horizontal de costos por fila (suma de todas las columnas money editables)
  const rowSubtotal = (r: Row): number => {
    return COLUMNS.filter((c) => c.type === 'money').reduce((acc, c) => acc + ((r[c.key] as number | null) ?? 0), 0);
  };

  return (
    <>
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Receipt size={22} style={{ color: 'var(--accent)' }} />
            <h1 style={{ margin: 0 }}>Facturación</h1>
          </div>
          <p style={{ color: 'var(--text-secondary)', marginTop: 4, fontSize: '0.88rem' }}>
            Tabla consolidada por proyecto. Las celdas con borde turquesa son editables — clic para capturar costos.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
            <input
              type="text"
              placeholder="Buscar ciudad, conjunto, casa…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ padding: '8px 12px 8px 30px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg)', color: 'var(--text)', fontSize: '0.85rem', width: 260 }}
            />
          </div>
          <button
            onClick={exportCsv}
            disabled={loading || filtered.length === 0}
            title={filtered.length === 0 ? 'No hay filas para exportar' : `Descargar ${filtered.length} fila${filtered.length === 1 ? '' : 's'} en CSV`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid #07c5a8',
              background: 'linear-gradient(180deg, rgba(7,197,168,0.18), rgba(7,197,168,0.10))',
              color: '#07c5a8',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: loading || filtered.length === 0 ? 'not-allowed' : 'pointer',
              opacity: loading || filtered.length === 0 ? 0.5 : 1,
              transition: 'background 0.15s, transform 0.05s',
            }}
            onMouseEnter={(e) => { if (!loading && filtered.length > 0) e.currentTarget.style.background = 'linear-gradient(180deg, rgba(7,197,168,0.28), rgba(7,197,168,0.16))'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'linear-gradient(180deg, rgba(7,197,168,0.18), rgba(7,197,168,0.10))'; }}
          >
            <Download size={15} />
            Descargar CSV
            <span style={{ fontSize: '0.72rem', opacity: 0.8, padding: '1px 6px', borderRadius: 10, background: 'rgba(7,197,168,0.2)', fontWeight: 700 }}>
              {filtered.length}
            </span>
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, marginTop: 14, marginBottom: 14 }}>
        <KpiCard label="Proyectos" value={String(filtered.length)} sub={`${kpis.withCosts} con costos capturados`} color="#0ea5e9" Icon={Receipt} />
        <KpiCard label="Paneles totales" value={fmtNum(kpis.totalPaneles)} sub="Unidades en diseño" color="#8b5cf6" Icon={Layers} />
        <KpiCard label="kWp instalado" value={fmtNum(kpis.totalKwp)} sub="Capacidad agregada" color="#f59e0b" Icon={Boxes} />
        <KpiCard label="Capex total" value={fmtMoney(kpis.totalCapex)} sub="COP — selección actual" color="#07c5a8" Icon={DollarSign} />
      </div>

      {err && (
        <div style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#ef4444', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: '0.85rem' }}>
          Error: {err}
        </div>
      )}

      {/* TABLA */}
      <div className="glass-panel fact-shell">
        <div className="fact-scroll">
          <table className="fact-table">
            <colgroup>
              {COLUMNS.map((c, i) => (
                <col key={i} style={{ minWidth: c.minWidth ?? 110 }} />
              ))}
              <col style={{ minWidth: 130 }} />
            </colgroup>
            <thead>
              {/* Group header row */}
              <tr className="fact-group-row">
                {GROUPS.map((g) => (
                  <th key={g.id} colSpan={g.cols.length} className="fact-group-th" style={{ '--g-color': g.color } as React.CSSProperties}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <g.Icon size={12} style={{ color: g.color }} />
                      {g.label}
                    </span>
                  </th>
                ))}
                <th className="fact-group-th fact-subtotal-col">Subtotal</th>
              </tr>
              {/* Column header row */}
              <tr className="fact-col-row">
                {COLUMNS.map((c, i) => {
                  const stickyStyle = c.sticky ? { left: STICKY_LEFTS[i], zIndex: 4 } as React.CSSProperties : {};
                  const isLastOfGroup = isLastColOfGroup(i);
                  return (
                    <th
                      key={String(c.key)}
                      className={`fact-col-th ${c.editable ? 'editable' : ''} ${c.sticky ? 'sticky-col' : ''} ${isLastOfGroup ? 'group-divider' : ''}`}
                      style={{ ...stickyStyle, textAlign: c.type === 'text' ? 'left' : 'right' }}
                    >
                      {c.label}
                    </th>
                  );
                })}
                <th className="fact-col-th fact-subtotal-col" style={{ textAlign: 'right' }}>COP</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={COLUMNS.length + 1} style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)' }}>
                  <Loader2 size={16} className="spin" style={{ verticalAlign: 'middle', marginRight: 6 }} />
                  Cargando…
                </td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={COLUMNS.length + 1} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>
                  {rows.length === 0 ? 'No hay proyectos en el CRM todavía.' : 'Ningún proyecto coincide con el filtro actual.'}
                </td></tr>
              )}
              {!loading && filtered.map((row) => {
                const subtotal = rowSubtotal(row);
                return (
                  <tr key={row.project_id} className={`fact-row ${row.has_record ? 'has-data' : ''}`}>
                    {COLUMNS.map((c, i) => {
                      const isEditing = editing?.projectId === row.project_id && editing.field === c.key;
                      const v = row[c.key];
                      const display = c.type === 'money' ? fmtMoney(v as number | null) : c.type === 'num' ? fmtNum(v as number | null) : ((v as string | null) ?? '');
                      const stickyStyle = c.sticky ? { left: STICKY_LEFTS[i], zIndex: 2 } as React.CSSProperties : {};
                      const isLastOfGroup = isLastColOfGroup(i);
                      return (
                        <td
                          key={String(c.key)}
                          title={c.editable ? (display || 'Clic para editar') : undefined}
                          onClick={() => { if (c.editable && !isEditing) startEdit(row.project_id, c.key, v); }}
                          className={`fact-cell ${c.editable ? 'editable' : ''} ${c.sticky ? 'sticky-col' : ''} ${isLastOfGroup ? 'group-divider' : ''} ${isEditing ? 'editing' : ''}`}
                          style={{ ...stickyStyle, textAlign: c.type === 'text' ? 'left' : 'right' }}
                        >
                          {isEditing ? (
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                              <input
                                autoFocus
                                type={c.type === 'text' ? 'text' : 'number'}
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') void saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                                className="fact-input"
                                style={{ textAlign: c.type === 'text' ? 'left' : 'right' }}
                              />
                              <button onClick={(e) => { e.stopPropagation(); void saveEdit(); }} disabled={saving} title="Guardar" className="fact-icon-btn">
                                {saving ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); cancelEdit(); }} title="Cancelar" className="fact-icon-btn muted">
                                <X size={13} />
                              </button>
                            </div>
                          ) : (
                            <span className={`fact-value ${c.type !== 'text' ? 'mono' : ''} ${v === null || v === '' ? 'empty' : ''}`}>
                              {display || (c.editable ? <Pencil size={10} style={{ opacity: 0.35 }} /> : <span style={{ opacity: 0.3 }}>—</span>)}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="fact-cell fact-subtotal-col mono" style={{ textAlign: 'right', fontWeight: 600 }}>
                      {subtotal > 0 ? fmtMoney(subtotal) : <span style={{ opacity: 0.3 }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {!loading && filtered.length > 0 && (
              <tfoot>
                <tr className="fact-totals">
                  {COLUMNS.map((c, i) => {
                    const stickyStyle = c.sticky ? { left: STICKY_LEFTS[i], zIndex: 3 } as React.CSSProperties : {};
                    const isLastOfGroup = isLastColOfGroup(i);
                    let val: React.ReactNode = '';
                    if (i === 0) val = <strong>{filtered.length} proyectos</strong>;
                    else if (c.type === 'money' || c.type === 'num') {
                      const t = totals[c.key as string] ?? 0;
                      val = t > 0 ? (c.type === 'money' ? fmtMoney(t) : fmtNum(t)) : '';
                    }
                    return (
                      <td
                        key={String(c.key)}
                        className={`fact-cell fact-totals-cell ${c.sticky ? 'sticky-col' : ''} ${isLastOfGroup ? 'group-divider' : ''} ${c.type !== 'text' ? 'mono' : ''}`}
                        style={{ ...stickyStyle, textAlign: c.type === 'text' ? 'left' : 'right' }}
                      >
                        {val}
                      </td>
                    );
                  })}
                  <td className="fact-cell fact-totals-cell fact-subtotal-col mono" style={{ textAlign: 'right' }}>
                    <strong>{fmtMoney(filtered.reduce((acc, r) => acc + rowSubtotal(r), 0))}</strong>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <style jsx>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }

        .fact-shell {
          margin-top: 0;
          padding: 0;
          overflow: hidden;
        }
        .fact-scroll {
          overflow: auto;
          max-height: calc(100vh - 320px);
          min-height: 360px;
        }
        .fact-table {
          width: 100%;
          border-collapse: separate;
          border-spacing: 0;
          font-size: 0.82rem;
          min-width: max-content;
        }

        /* Header rows */
        .fact-group-row th {
          position: sticky;
          top: 0;
          z-index: 5;
          background: var(--bg-elevated, #0b1424);
          padding: 8px 12px;
          border-bottom: 1px solid var(--border);
          font-size: 0.7rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--text-secondary);
          text-align: left;
          border-top: 3px solid var(--g-color, transparent);
        }
        .fact-col-row th {
          position: sticky;
          top: 36px;
          z-index: 3;
          background: var(--bg-elevated, #0b1424);
          padding: 8px 12px;
          border-bottom: 1px solid var(--border);
          font-size: 0.7rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          color: var(--text);
          white-space: nowrap;
        }
        .fact-col-th.editable {
          color: #07c5a8;
        }
        .fact-col-th.sticky-col,
        .fact-cell.sticky-col {
          position: sticky;
          background: var(--bg-elevated, #0b1424);
          box-shadow: inset -1px 0 0 var(--border-subtle, rgba(255,255,255,0.04));
        }

        /* Body cells */
        .fact-cell {
          padding: 7px 12px;
          border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.04));
          white-space: nowrap;
          color: var(--text);
        }
        .fact-cell.editable {
          cursor: pointer;
          background: rgba(7, 197, 168, 0.02);
        }
        .fact-cell.editable:hover {
          background: rgba(7, 197, 168, 0.08);
        }
        .fact-cell.editing {
          padding: 3px 4px;
          background: rgba(7, 197, 168, 0.10);
        }
        .fact-row:hover .fact-cell:not(.sticky-col) {
          background: rgba(255, 255, 255, 0.02);
        }
        .fact-row:hover .fact-cell.editable {
          background: rgba(7, 197, 168, 0.06);
        }
        .fact-row.has-data .fact-cell.sticky-col {
          box-shadow: inset 3px 0 0 #07c5a8, inset -1px 0 0 var(--border-subtle, rgba(255,255,255,0.04));
        }
        .group-divider {
          border-right: 1px solid var(--border);
        }
        .fact-value.mono {
          font-family: ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, monospace;
          font-size: 0.8rem;
        }
        .fact-value.empty {
          color: var(--text-muted, rgba(255,255,255,0.3));
        }

        /* Edit input */
        .fact-input {
          flex: 1;
          min-width: 80px;
          padding: 4px 6px;
          border: 1px solid var(--accent);
          border-radius: 4px;
          background: var(--bg);
          color: var(--text);
          font-size: 0.82rem;
        }
        .fact-icon-btn {
          background: transparent;
          border: none;
          cursor: pointer;
          color: var(--accent);
          padding: 2px;
          display: inline-flex;
          align-items: center;
        }
        .fact-icon-btn.muted { color: var(--text-secondary); }
        .fact-icon-btn:hover { color: var(--text); }

        /* Subtotal column (rightmost, derived) */
        .fact-subtotal-col {
          background: rgba(7, 197, 168, 0.06) !important;
          border-left: 2px solid rgba(7, 197, 168, 0.4);
        }
        .fact-col-th.fact-subtotal-col {
          color: #07c5a8;
        }

        /* Totals footer */
        .fact-totals-cell {
          position: sticky;
          bottom: 0;
          background: rgba(7, 197, 168, 0.08);
          border-top: 1px solid var(--border);
          border-bottom: none;
          font-weight: 600;
          z-index: 1;
        }
        .fact-totals-cell.sticky-col {
          z-index: 4;
        }
      `}</style>
    </>
  );
}

function isLastColOfGroup(absoluteIndex: number): boolean {
  let cursor = -1;
  for (const g of GROUPS) {
    cursor += g.cols.length;
    if (cursor === absoluteIndex) return true;
  }
  return false;
}

function KpiCard(props: {
  label: string;
  value: string;
  sub: string;
  color: string;
  Icon: typeof MapPin;
}) {
  const { label, value, sub, color, Icon } = props;
  return (
    <div className="glass-panel" style={{ padding: '14px 16px', borderLeft: `4px solid ${color}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
        <Icon size={13} style={{ color }} /> {label}
      </div>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text)', lineHeight: 1.1, fontFamily: 'ui-monospace, monospace' }}>
        {value}
      </div>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{sub}</div>
    </div>
  );
}
