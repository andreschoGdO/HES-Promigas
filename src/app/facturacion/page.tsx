'use client';

import { useEffect, useMemo, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { Receipt, Download, Search, Pencil, X, Check, Loader2 } from 'lucide-react';

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

// Definición de columnas en el orden EXACTO solicitado por el negocio.
const COLUMNS: Array<{ key: keyof Row; label: string; type: 'text' | 'num' | 'money'; editable: boolean }> = [
  { key: 'ciudad',                   label: 'CIUDAD',                     type: 'text',  editable: false },
  { key: 'conjunto',                 label: 'CONJUNTO RESIDENCIAL',       type: 'text',  editable: false },
  { key: 'casa',                     label: 'CASA',                       type: 'text',  editable: false },
  { key: 'solucion',                 label: 'SOLUCIÓN',                   type: 'text',  editable: true  },
  { key: 'plan',                     label: 'PLAN',                       type: 'text',  editable: true  },
  { key: 'paneles',                  label: 'PANELES',                    type: 'num',   editable: false },
  { key: 'kwp',                      label: 'kwp',                        type: 'num',   editable: false },
  { key: 'bateria',                  label: 'BATERIA',                    type: 'num',   editable: false },
  { key: 'kwh',                      label: 'kwh',                        type: 'num',   editable: false },
  { key: 'constructor',              label: 'Constructor',                type: 'text',  editable: false },
  { key: 'marca_bateria',            label: 'Marca Bateria',              type: 'text',  editable: false },
  { key: 'marca_inversor',           label: 'Marca Inversor',             type: 'text',  editable: false },
  { key: 'marca_panel',              label: 'Marca Panel',                type: 'text',  editable: false },
  { key: 'costo_inversor',           label: 'Costo Inversor',             type: 'money', editable: true  },
  { key: 'costo_bateria',            label: 'Costo Bateria',              type: 'money', editable: true  },
  { key: 'costo_control_box',        label: 'Costo Control Box (BMS)',    type: 'money', editable: true  },
  { key: 'costo_top_cover',          label: 'Costo Top Cover',            type: 'money', editable: true  },
  { key: 'costo_panel_solar',        label: 'Panel Solar',                type: 'money', editable: true  },
  { key: 'costo_medidor_solar',      label: 'Medidor Solar',              type: 'money', editable: true  },
  { key: 'costo_medidor_generacion', label: 'Medidor Generacion',         type: 'money', editable: true  },
  { key: 'costo_modem',              label: 'Modem',                      type: 'money', editable: true  },
  { key: 'mano_de_obra',             label: 'Mano de Obra',               type: 'money', editable: true  },
  { key: 'desmantelamiento_mo',      label: 'Desmantelamiento x MO',      type: 'money', editable: true  },
  { key: 'capex',                    label: 'Capex',                      type: 'money', editable: true  },
  { key: 'operador_red',             label: 'OR',                         type: 'text',  editable: true  },
];

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

  // Totales para footer
  const totals = useMemo(() => {
    const sum = (k: keyof Row) =>
      filtered.reduce((acc, r) => acc + (typeof r[k] === 'number' ? (r[k] as number) : 0), 0);
    return {
      paneles: sum('paneles'),
      kwp: sum('kwp'),
      kwh: sum('kwh'),
      capex: sum('capex'),
    };
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
      // Actualizar la fila localmente
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
    // CSV header con los labels exactos solicitados.
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
    // BOM UTF-8 para que Excel detecte acentos
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `facturacion-${todayIso()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Receipt size={22} style={{ color: 'var(--accent)' }} />
            <h1 style={{ margin: 0 }}>Facturación</h1>
          </div>
          <p style={{ color: 'var(--text-secondary)', marginTop: 4, fontSize: '0.88rem' }}>
            Tabla consolidada por proyecto con datos del CRM, inventario y costos de facturación. Edita los costos haciendo clic en una celda.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
            <input
              type="text"
              placeholder="Buscar..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ padding: '6px 8px 6px 28px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text)', fontSize: '0.85rem', width: 220 }}
            />
          </div>
          <button onClick={exportCsv} className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Download size={14} />
            Descargar CSV
          </button>
        </div>
      </div>

      {err && (
        <div style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#ef4444', padding: 10, borderRadius: 6, marginTop: 12, fontSize: '0.85rem' }}>
          Error: {err}
        </div>
      )}

      <div className="glass-panel" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 240px)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', minWidth: 'max-content' }}>
            <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-elevated, #0f172a)', zIndex: 2 }}>
              <tr>
                {COLUMNS.map((c) => (
                  <th
                    key={String(c.key)}
                    style={{
                      textAlign: c.type === 'text' ? 'left' : 'right',
                      padding: '8px 10px',
                      borderBottom: '1px solid var(--border)',
                      whiteSpace: 'nowrap',
                      fontWeight: 600,
                      color: 'var(--text-secondary)',
                      fontSize: '0.75rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.03em',
                      background: c.editable ? 'rgba(7, 197, 168, 0.05)' : 'transparent',
                    }}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={COLUMNS.length} style={{ textAlign: 'center', padding: 20, color: 'var(--text-secondary)' }}>Cargando…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={COLUMNS.length} style={{ textAlign: 'center', padding: 20, color: 'var(--text-secondary)' }}>
                  {rows.length === 0 ? 'No hay proyectos en el CRM aún.' : 'No hay resultados para la búsqueda.'}
                </td></tr>
              )}
              {!loading && filtered.map((row) => (
                <tr key={row.project_id} style={{ borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.04))' }}>
                  {COLUMNS.map((c) => {
                    const isEditing = editing?.projectId === row.project_id && editing.field === c.key;
                    const v = row[c.key];
                    const display = c.type === 'money' ? fmtMoney(v as number | null) : c.type === 'num' ? fmtNum(v as number | null) : ((v as string | null) ?? '');
                    return (
                      <td
                        key={String(c.key)}
                        title={c.editable ? (display || 'Clic para editar') : undefined}
                        onClick={() => { if (c.editable && !isEditing) startEdit(row.project_id, c.key, v); }}
                        style={{
                          padding: isEditing ? '2px 4px' : '6px 10px',
                          textAlign: c.type === 'text' ? 'left' : 'right',
                          whiteSpace: 'nowrap',
                          color: v === null || v === '' ? 'var(--text-secondary)' : 'var(--text)',
                          cursor: c.editable ? 'pointer' : 'default',
                          background: c.editable && !isEditing ? 'rgba(7, 197, 168, 0.02)' : 'transparent',
                          fontFamily: c.type !== 'text' ? 'var(--font-mono, monospace)' : undefined,
                          fontSize: c.type !== 'text' ? '0.8rem' : undefined,
                        }}
                      >
                        {isEditing ? (
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                            <input
                              autoFocus
                              type={c.type === 'text' ? 'text' : 'number'}
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') void saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                              style={{ flex: 1, minWidth: 80, padding: '4px 6px', border: '1px solid var(--accent)', borderRadius: 4, background: 'var(--bg)', color: 'var(--text)', fontSize: '0.82rem', textAlign: c.type === 'text' ? 'left' : 'right' }}
                            />
                            <button onClick={() => void saveEdit()} disabled={saving} title="Guardar" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--accent)', padding: 2 }}>
                              {saving ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
                            </button>
                            <button onClick={cancelEdit} title="Cancelar" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 2 }}>
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            {display || (c.editable ? <Pencil size={10} style={{ opacity: 0.3 }} /> : '—')}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            {!loading && filtered.length > 0 && (
              <tfoot>
                <tr style={{ background: 'rgba(7, 197, 168, 0.05)', fontWeight: 600 }}>
                  {COLUMNS.map((c) => {
                    let val: string = '';
                    if (c.key === 'ciudad') val = `${filtered.length} proyectos`;
                    if (c.key === 'paneles') val = fmtNum(totals.paneles);
                    if (c.key === 'kwp')     val = fmtNum(totals.kwp);
                    if (c.key === 'kwh')     val = fmtNum(totals.kwh);
                    if (c.key === 'capex')   val = fmtMoney(totals.capex);
                    return (
                      <td key={String(c.key)} style={{ padding: '8px 10px', textAlign: c.type === 'text' ? 'left' : 'right', whiteSpace: 'nowrap', borderTop: '1px solid var(--border)', fontSize: '0.8rem' }}>
                        {val}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <style jsx>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </>
  );
}
