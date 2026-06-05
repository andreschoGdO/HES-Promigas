'use client';

import { useEffect, useMemo, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { Receipt, Download, Search, Pencil, X, Check, Loader2, MapPin, Tag, Layers, HardHat, Boxes, DollarSign, Wrench, Calculator, Lock, Unlock, History, Upload, Snowflake, AlertTriangle, FileText } from 'lucide-react';

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
  costo_inversor_is_derived?: boolean;
  costo_bateria: number | null;
  costo_bateria_is_derived?: boolean;
  costo_control_box: number | null;
  costo_top_cover: number | null;
  costo_panel_solar: number | null;
  costo_panel_solar_is_derived?: boolean;
  costo_medidor_solar: number | null;
  costo_medidor_generacion: number | null;
  costo_modem: number | null;
  costo_modem_is_derived?: boolean;
  mano_de_obra: number | null;
  desmantelamiento_mo: number | null;
  capex: number | null;
  capex_is_derived?: boolean;
  operador_red: string | null;
  has_record: boolean;
  frozen_at: string | null;
  frozen_by: string | null;
  periodo: string | null;
}

interface FactEvent {
  id: string;
  project_id: string;
  event_type: 'cost_change' | 'text_change' | 'freeze' | 'unfreeze' | 'snapshot_from_inventory' | 'import';
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  source: string | null;
  actor_email: string | null;
  notes: string | null;
  data: Record<string, unknown> | null;
  created_at: string;
}

// Mapeo de la key de columna al campo `_is_derived` correspondiente (cuando aplica)
const DERIVED_KEY: Record<string, keyof Row> = {
  costo_inversor: 'costo_inversor_is_derived',
  costo_bateria: 'costo_bateria_is_derived',
  costo_panel_solar: 'costo_panel_solar_is_derived',
  costo_modem: 'costo_modem_is_derived',
  capex: 'capex_is_derived',
};

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
  const [freezeTarget, setFreezeTarget] = useState<Row | null>(null);
  const [historyTarget, setHistoryTarget] = useState<Row | null>(null);
  const [importOpen, setImportOpen] = useState(false);

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

  const unfreezeRow = async (row: Row) => {
    if (!confirm(`Descongelar ${row.conjunto ?? ''} casa ${row.casa ?? ''}? Quedará editable de nuevo.`)) return;
    try {
      const params = new URLSearchParams({ project_id: row.project_id });
      if (userEmail) params.set('actor_email', userEmail);
      const r = await fetch(`/api/facturacion/freeze?${params.toString()}`, { method: 'DELETE' });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Error');
    }
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
            onClick={() => setImportOpen(true)}
            className="fact-btn-secondary"
            title="Importar costos desde CSV"
          >
            <Upload size={14} />
            Importar CSV
          </button>
          <button
            onClick={exportCsv}
            disabled={loading || filtered.length === 0}
            title={filtered.length === 0 ? 'No hay filas para exportar' : `Descargar ${filtered.length} fila${filtered.length === 1 ? '' : 's'} en CSV`}
            className="fact-btn-primary"
            style={{
              cursor: loading || filtered.length === 0 ? 'not-allowed' : 'pointer',
              opacity: loading || filtered.length === 0 ? 0.5 : 1,
            }}
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
                <th className="fact-group-th fact-actions-col">Acciones</th>
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
                <th className="fact-col-th fact-actions-col" style={{ textAlign: 'center' }}></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={COLUMNS.length + 2} style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)' }}>
                  <Loader2 size={16} className="spin" style={{ verticalAlign: 'middle', marginRight: 6 }} />
                  Cargando…
                </td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={COLUMNS.length + 2} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>
                  {rows.length === 0 ? 'No hay proyectos en el CRM todavía.' : 'Ningún proyecto coincide con el filtro actual.'}
                </td></tr>
              )}
              {!loading && filtered.map((row) => {
                const subtotal = rowSubtotal(row);
                const frozen = row.frozen_at != null;
                return (
                  <tr key={row.project_id} className={`fact-row ${row.has_record ? 'has-data' : ''} ${frozen ? 'frozen' : ''}`}>
                    {COLUMNS.map((c, i) => {
                      const isEditing = editing?.projectId === row.project_id && editing.field === c.key;
                      const v = row[c.key];
                      const display = c.type === 'money' ? fmtMoney(v as number | null) : c.type === 'num' ? fmtNum(v as number | null) : ((v as string | null) ?? '');
                      const stickyStyle = c.sticky ? { left: STICKY_LEFTS[i], zIndex: 2 } as React.CSSProperties : {};
                      const isLastOfGroup = isLastColOfGroup(i);
                      const derivedFlag = DERIVED_KEY[c.key as string];
                      const isDerived = !frozen && derivedFlag ? Boolean(row[derivedFlag]) : false;
                      const canEdit = c.editable && !frozen;
                      const onCellClick = () => {
                        if (!c.editable || isEditing) return;
                        if (frozen) { alert('Proyecto congelado. Descongelar antes de editar.'); return; }
                        startEdit(row.project_id, c.key, v);
                      };
                      const titleText = !c.editable ? undefined
                        : frozen ? 'Proyecto congelado'
                        : isDerived ? `Calculado desde inventario: ${display}. Clic para sobreescribir.`
                        : (display || 'Clic para editar');
                      return (
                        <td
                          key={String(c.key)}
                          title={titleText}
                          onClick={onCellClick}
                          className={`fact-cell ${canEdit ? 'editable' : ''} ${c.sticky ? 'sticky-col' : ''} ${isLastOfGroup ? 'group-divider' : ''} ${isEditing ? 'editing' : ''} ${isDerived ? 'derived' : ''} ${frozen && c.editable ? 'locked' : ''}`}
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
                              {display || (canEdit ? <Pencil size={10} style={{ opacity: 0.35 }} /> : <span style={{ opacity: 0.3 }}>—</span>)}
                              {isDerived && display && <span className="derived-badge" title="Calculado desde inventario">inv</span>}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="fact-cell fact-subtotal-col mono" style={{ textAlign: 'right', fontWeight: 600 }}>
                      {subtotal > 0 ? fmtMoney(subtotal) : <span style={{ opacity: 0.3 }}>—</span>}
                    </td>
                    <td className="fact-cell fact-actions-col" style={{ textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                        {frozen ? (
                          <>
                            <span className="frozen-badge" title={`Congelado ${row.frozen_at?.slice(0, 10)} · ${row.frozen_by ?? ''}`}>
                              <Lock size={11} /> {row.periodo ?? '—'}
                            </span>
                            <button onClick={() => void unfreezeRow(row)} className="row-action-btn" title="Descongelar">
                              <Unlock size={13} />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setFreezeTarget(row)}
                            disabled={subtotal === 0}
                            className="row-action-btn"
                            title={subtotal === 0 ? 'No hay costos para congelar' : 'Congelar (facturar)'}
                            style={{ opacity: subtotal === 0 ? 0.3 : 1 }}
                          >
                            <Snowflake size={13} />
                          </button>
                        )}
                        <button onClick={() => setHistoryTarget(row)} className="row-action-btn muted" title="Historial de cambios">
                          <History size={13} />
                        </button>
                      </div>
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
                  <td className="fact-cell fact-totals-cell fact-actions-col" style={{ textAlign: 'center' }}>
                    {(() => {
                      const frozenCount = filtered.filter((r) => r.frozen_at != null).length;
                      return <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{frozenCount}/{filtered.length} congelados</span>;
                    })()}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* MODALS */}
      {freezeTarget && (
        <FreezeModal
          row={freezeTarget}
          userEmail={userEmail}
          onClose={() => setFreezeTarget(null)}
          onSuccess={() => { setFreezeTarget(null); void load(); }}
        />
      )}
      {historyTarget && (
        <HistoryModal
          row={historyTarget}
          onClose={() => setHistoryTarget(null)}
        />
      )}
      {importOpen && (
        <ImportModal
          userEmail={userEmail}
          onClose={() => setImportOpen(false)}
          onSuccess={() => { setImportOpen(false); void load(); }}
        />
      )}

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

        /* Derived value (computed from inventory) */
        .fact-cell.derived .fact-value {
          font-style: italic;
          color: rgba(7, 197, 168, 0.85);
        }
        .derived-badge {
          margin-left: 6px;
          font-size: 0.6rem;
          font-style: normal;
          padding: 1px 5px;
          border-radius: 8px;
          background: rgba(7, 197, 168, 0.15);
          color: #07c5a8;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          font-weight: 700;
        }

        /* Frozen row */
        .fact-row.frozen .fact-cell.sticky-col {
          box-shadow: inset 3px 0 0 #6366f1, inset -1px 0 0 var(--border-subtle, rgba(255,255,255,0.04));
        }
        .fact-cell.locked {
          cursor: not-allowed !important;
          background: rgba(99, 102, 241, 0.04) !important;
        }
        .fact-cell.locked:hover {
          background: rgba(99, 102, 241, 0.06) !important;
        }
        .frozen-badge {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          font-size: 0.7rem;
          font-weight: 700;
          padding: 3px 7px;
          border-radius: 10px;
          background: rgba(99, 102, 241, 0.15);
          color: #6366f1;
          font-family: ui-monospace, monospace;
        }

        /* Row action buttons */
        .row-action-btn {
          background: transparent;
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 4px 6px;
          cursor: pointer;
          color: var(--text-secondary);
          display: inline-flex;
          align-items: center;
          transition: all 0.12s;
        }
        .row-action-btn:hover:not(:disabled) {
          border-color: #07c5a8;
          color: #07c5a8;
          background: rgba(7, 197, 168, 0.08);
        }
        .row-action-btn.muted:hover {
          border-color: var(--text-secondary);
          color: var(--text);
          background: rgba(255,255,255,0.04);
        }
        .row-action-btn:disabled { cursor: not-allowed; }

        .fact-actions-col {
          background: rgba(255,255,255,0.015);
        }

        /* Header buttons */
        .fact-btn-primary {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 8px 16px;
          border-radius: 8px;
          border: 1px solid #07c5a8;
          background: linear-gradient(180deg, rgba(7,197,168,0.18), rgba(7,197,168,0.10));
          color: #07c5a8;
          font-size: 0.85rem;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s;
        }
        .fact-btn-primary:hover:not(:disabled) {
          background: linear-gradient(180deg, rgba(7,197,168,0.28), rgba(7,197,168,0.16));
        }
        .fact-btn-secondary {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 8px 14px;
          border-radius: 8px;
          border: 1px solid var(--border);
          background: transparent;
          color: var(--text);
          font-size: 0.85rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.12s;
        }
        .fact-btn-secondary:hover {
          border-color: var(--accent);
          color: var(--accent);
        }

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

/* ─────────────────────────────────────────────────────────────────
 * Modals
 * ─────────────────────────────────────────────────────────────── */

const currentPeriodo = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

function FreezeModal({ row, userEmail, onClose, onSuccess }: { row: Row; userEmail: string; onClose: () => void; onSuccess: () => void }) {
  const [periodo, setPeriodo] = useState<string>(row.periodo ?? currentPeriodo());
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setErr(null);
    try {
      const r = await fetch('/api/facturacion/freeze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: row.project_id, periodo, actor_email: userEmail }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      onSuccess();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error');
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title="Congelar facturación" onClose={onClose} accent="#6366f1" Icon={Snowflake}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 18 }}>
        <div style={{ background: 'rgba(99, 102, 241, 0.06)', border: '1px solid rgba(99, 102, 241, 0.25)', borderRadius: 8, padding: 12, fontSize: '0.85rem', color: 'var(--text)' }}>
          <strong>{row.conjunto ?? '—'}</strong> · Casa {row.casa ?? '—'} · {row.ciudad ?? '—'}
          <div style={{ marginTop: 4, color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
            {row.project_code ?? ''} · {row.project_title}
          </div>
        </div>
        <div>
          <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
            Periodo de facturación (YYYY-MM)
          </label>
          <input
            type="month"
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text)', fontSize: '0.9rem' }}
          />
        </div>
        <div style={{ background: 'rgba(245, 158, 11, 0.06)', border: '1px solid rgba(245, 158, 11, 0.25)', borderRadius: 8, padding: 10, fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'flex', gap: 8 }}>
          <AlertTriangle size={14} style={{ color: '#f59e0b', flexShrink: 0, marginTop: 2 }} />
          <div>
            Al congelar, los costos derivados desde inventario se materializan permanentemente en este proyecto.
            <strong> Cambios futuros en precios de compra no afectarán este registro.</strong> Puedes descongelar después si necesitas corregir.
          </div>
        </div>
        {err && <div style={{ color: '#ef4444', fontSize: '0.82rem' }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="secondary-btn" disabled={submitting}>Cancelar</button>
          <button onClick={() => void submit()} disabled={submitting} className="primary-btn" style={{ background: '#6366f1' }}>
            {submitting ? 'Congelando…' : 'Congelar'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function HistoryModal({ row, onClose }: { row: Row; onClose: () => void }) {
  const [events, setEvents] = useState<FactEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`/api/facturacion/events?project_id=${row.project_id}`);
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error ?? `HTTP ${r.status}`);
        }
        const j = await r.json();
        if (!cancelled) setEvents(j.events ?? []);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Error');
      }
    })();
    return () => { cancelled = true; };
  }, [row.project_id]);

  return (
    <ModalShell title="Historial de cambios" onClose={onClose} accent="#0ea5e9" Icon={History} width={720}>
      <div style={{ padding: 18 }}>
        <div style={{ fontSize: '0.85rem', color: 'var(--text)', marginBottom: 10 }}>
          <strong>{row.conjunto ?? '—'}</strong> · Casa {row.casa ?? '—'}
          <span style={{ marginLeft: 8, color: 'var(--text-secondary)', fontSize: '0.78rem' }}>{row.project_code}</span>
        </div>
        {err && <div style={{ color: '#ef4444', fontSize: '0.82rem' }}>{err}</div>}
        {events === null && <div style={{ color: 'var(--text-secondary)', padding: 20, textAlign: 'center' }}>Cargando…</div>}
        {events && events.length === 0 && <div style={{ color: 'var(--text-secondary)', padding: 20, textAlign: 'center' }}>Sin eventos registrados todavía.</div>}
        {events && events.length > 0 && (
          <div style={{ maxHeight: 480, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-elevated, #0b1424)' }}>
                <tr>
                  <th style={{ textAlign: 'left',  padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>Fecha</th>
                  <th style={{ textAlign: 'left',  padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>Evento</th>
                  <th style={{ textAlign: 'left',  padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>Campo</th>
                  <th style={{ textAlign: 'right', padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>Antes → Después</th>
                  <th style={{ textAlign: 'left',  padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>Quien</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} style={{ borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.04))' }}>
                    <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontFamily: 'ui-monospace, monospace' }}>
                      {new Date(e.created_at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td style={{ padding: '6px 10px' }}>
                      <EventBadge type={e.event_type} source={e.source} />
                    </td>
                    <td style={{ padding: '6px 10px', fontFamily: 'ui-monospace, monospace', color: 'var(--text-secondary)' }}>{e.field ?? '—'}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>
                      <span style={{ color: 'var(--text-muted)' }}>{e.old_value ?? '—'}</span>
                      <span style={{ color: 'var(--text-secondary)', margin: '0 4px' }}>→</span>
                      <span style={{ color: 'var(--text)' }}>{e.new_value ?? '—'}</span>
                    </td>
                    <td style={{ padding: '6px 10px', color: 'var(--text-secondary)' }}>{e.actor_email ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

function EventBadge({ type, source }: { type: string; source: string | null }) {
  const meta: Record<string, { label: string; color: string }> = {
    cost_change:             { label: 'Costo',     color: '#0ea5e9' },
    text_change:             { label: 'Texto',     color: '#94a3b8' },
    freeze:                  { label: 'Congelado', color: '#6366f1' },
    unfreeze:                { label: 'Descong.',  color: '#f59e0b' },
    snapshot_from_inventory: { label: 'Snapshot',  color: '#07c5a8' },
    import:                  { label: 'Import',    color: '#8b5cf6' },
  };
  const m = meta[type] ?? { label: type, color: '#94a3b8' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ padding: '2px 7px', borderRadius: 8, background: `${m.color}25`, color: m.color, fontSize: '0.7rem', fontWeight: 700 }}>{m.label}</span>
      {source === 'csv_import' && <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>CSV</span>}
    </span>
  );
}

function ImportModal({ userEmail, onClose, onSuccess }: { userEmail: string; onClose: () => void; onSuccess: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [periodo, setPeriodo] = useState(currentPeriodo());
  const [freezeAfter, setFreezeAfter] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ total: number; updated: string[]; notFound: string[]; ambiguous: string[]; frozen?: string[]; errors: string[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const parseCsv = async (f: File): Promise<Record<string, string>[]> => {
    const text = await f.text();
    // Strip BOM if present
    const clean = text.replace(/^﻿/, '');
    const lines = clean.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length < 2) throw new Error('CSV vacío o sin filas de datos');
    // Simple CSV parser (handles quoted fields, escaped quotes, no embedded newlines)
    const splitLine = (line: string): string[] => {
      const out: string[] = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
          if (ch === '"') {
            if (line[i + 1] === '"') { cur += '"'; i++; }
            else inQuotes = false;
          } else cur += ch;
        } else {
          if (ch === ',') { out.push(cur); cur = ''; }
          else if (ch === '"') inQuotes = true;
          else cur += ch;
        }
      }
      out.push(cur);
      return out;
    };
    const headers = splitLine(lines[0]).map((h) => h.trim());
    return lines.slice(1).map((line) => {
      const cells = splitLine(line);
      const obj: Record<string, string> = {};
      headers.forEach((h, idx) => { obj[h] = (cells[idx] ?? '').trim(); });
      return obj;
    });
  };

  const submit = async () => {
    if (!file) { setErr('Selecciona un archivo CSV'); return; }
    setSubmitting(true);
    setErr(null);
    setResult(null);
    try {
      const rows = await parseCsv(file);
      const r = await fetch('/api/facturacion/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, actor_email: userEmail, periodo, freeze_after: freezeAfter }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      const j = await r.json();
      setResult(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title="Importar facturación desde CSV" onClose={result ? () => { onSuccess(); } : onClose} accent="#8b5cf6" Icon={Upload} width={620}>
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {!result && (
          <>
            <div style={{ background: 'rgba(139, 92, 246, 0.06)', border: '1px solid rgba(139, 92, 246, 0.25)', borderRadius: 8, padding: 12, fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'flex', gap: 8 }}>
              <FileText size={14} style={{ color: '#8b5cf6', flexShrink: 0, marginTop: 2 }} />
              <div>
                El CSV debe traer las columnas <strong>CIUDAD, CONJUNTO RESIDENCIAL, CASA</strong> para hacer match con los proyectos.
                Cualquier subconjunto de costos y campos editables se aplicará a los proyectos encontrados.
                <br />Tip: descarga el CSV actual desde el botón <em>Descargar CSV</em>, edita los costos en Excel y vuélvelo a subir.
              </div>
            </div>
            <div>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Archivo CSV</label>
              <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ width: '100%' }} />
              {file && <div style={{ marginTop: 6, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{file.name} · {(file.size / 1024).toFixed(1)} KB</div>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Periodo</label>
                <input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text)', fontSize: '0.85rem' }} />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', color: 'var(--text)', cursor: 'pointer', paddingTop: 22 }}>
                <input type="checkbox" checked={freezeAfter} onChange={(e) => setFreezeAfter(e.target.checked)} />
                Congelar después de importar
              </label>
            </div>
            {err && <div style={{ color: '#ef4444', fontSize: '0.82rem' }}>{err}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={onClose} className="secondary-btn" disabled={submitting}>Cancelar</button>
              <button onClick={() => void submit()} disabled={submitting || !file} className="primary-btn" style={{ background: '#8b5cf6' }}>
                {submitting ? 'Importando…' : 'Importar'}
              </button>
            </div>
          </>
        )}
        {result && (
          <>
            <div style={{ fontSize: '0.95rem', fontWeight: 600 }}>
              {result.updated.length}/{result.total} proyectos actualizados
            </div>
            <ResultBlock title="Actualizados"   items={result.updated}   color="#10b981" />
            {result.frozen && result.frozen.length > 0 && <ResultBlock title="Congelados" items={result.frozen} color="#6366f1" />}
            <ResultBlock title="No encontrados" items={result.notFound}  color="#f59e0b" />
            <ResultBlock title="Ambiguos"       items={result.ambiguous} color="#f59e0b" />
            <ResultBlock title="Errores"        items={result.errors}    color="#ef4444" />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={onSuccess} className="primary-btn">Cerrar</button>
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
}

function ResultBlock({ title, items, color }: { title: string; items: string[]; color: string }) {
  if (items.length === 0) return null;
  return (
    <div style={{ border: `1px solid ${color}30`, borderRadius: 8, padding: 10 }}>
      <div style={{ fontSize: '0.78rem', fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
        {title} ({items.length})
      </div>
      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', maxHeight: 120, overflowY: 'auto' }}>
        {items.map((it, i) => <div key={i}>• {it}</div>)}
      </div>
    </div>
  );
}

function ModalShell({ title, onClose, accent, Icon, width = 520, children }: { title: string; onClose: () => void; accent: string; Icon: typeof MapPin; width?: number; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-panel"
        style={{ width: '100%', maxWidth: width, maxHeight: '92vh', overflow: 'auto', padding: 0, borderTop: `3px solid ${accent}` }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon size={18} style={{ color: accent }} />
            <h3 style={{ margin: 0, fontSize: '1rem' }}>{title}</h3>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'inline-flex' }}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
