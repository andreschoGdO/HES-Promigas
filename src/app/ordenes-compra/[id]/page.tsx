'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Trash2, Upload, Eye, Save, Home, FileText } from 'lucide-react';
import { ModalShell } from '@/components/ModalShell';
import { PURCHASE_ORDER_CATEGORIES } from '@/lib/purchase-orders';

const CATEGORIAS = PURCHASE_ORDER_CATEGORIES;
const fmtCOP = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;

interface Item {
  id?: string;
  posicion: number;
  categoria: string;
  codigo_servicio: string | null;
  descripcion: string;
  cantidad: number | null;
  unidad: string | null;
  precio_unitario: number | null;
  valor_total: number;
}

interface SolutionPrice { id?: string; solucion: number | null; precio_kwp: number; }

interface Assignment {
  id: string;
  project_id: string;
  kwp_asignado: number | null;
  monto_fijo: number | null;
  solucion: number | null;
  project: { id: string; title: string; conjunto: string | null; casa_numero: string | null; diseno_kwp: number | null; operations_stage: string | null };
}

interface Addendum { id: string; numero_adicional: string; fecha: string | null; valor_total: number; }

export default function OrdenDeCompraDetallePage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [oc, setOc] = useState<Record<string, unknown> | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [solutionPrices, setSolutionPrices] = useState<SolutionPrice[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [addenda, setAddenda] = useState<Addendum[]>([]);
  const [addendaTotal, setAddendaTotal] = useState(0);
  const [addendaLimit, setAddendaLimit] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [showAssign, setShowAssign] = useState(false);
  const [showAddendum, setShowAddendum] = useState(false);
  const [savingItems, setSavingItems] = useState(false);
  const [savingPrices, setSavingPrices] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/purchase-orders/${id}`);
    if (!res.ok) { setLoading(false); return; }
    const json = await res.json();
    setOc(json.purchaseOrder);
    setItems(json.items);
    setSolutionPrices(json.solutionPrices);
    setAssignments(json.assignments);
    setAddenda(json.addenda);
    setAddendaTotal(json.addendaTotal);
    setAddendaLimit(json.addendaLimit);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p style={{ color: 'var(--text-muted)' }}>Cargando…</p>;
  if (!oc) return <p style={{ color: 'var(--text-muted)' }}>Orden de compra no encontrada.</p>;

  const saveItems = async () => {
    setSavingItems(true);
    setError(null);
    const res = await fetch(`/api/purchase-orders/${id}/items`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items.map((it, i) => ({ ...it, posicion: i + 1 })) }),
    });
    const json = await res.json();
    if (!res.ok) { setError(json.error); setSavingItems(false); return; }
    setItems(json.items);
    setSavingItems(false);
    load();
  };

  const savePrices = async () => {
    setSavingPrices(true);
    setError(null);
    const res = await fetch(`/api/purchase-orders/${id}/solution-prices`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ solutionPrices }),
    });
    const json = await res.json();
    if (!res.ok) { setError(json.error); setSavingPrices(false); return; }
    setSolutionPrices(json.solutionPrices);
    setSavingPrices(false);
  };

  const viewPdf = async () => {
    const res = await fetch(`/api/purchase-orders/${id}/pdf`);
    const json = await res.json();
    if (res.ok) setPdfUrl(json.url);
    else setError(json.error);
  };

  const uploadPdf = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`/api/purchase-orders/${id}/pdf`, { method: 'POST', body: fd });
    const json = await res.json();
    if (!res.ok) { setError(json.error); return; }
    load();
  };

  const unassign = async (projectId: string) => {
    if (!confirm('¿Quitar esta casa de la OC?')) return;
    await fetch(`/api/purchase-orders/${id}/assignments?project_id=${projectId}`, { method: 'DELETE' });
    load();
  };

  const ocData = oc as { numero_oc: string; proveedor: string; fecha_documento: string | null; fecha_entrega: string | null; kwp_total: number | null; valor_total: number; kwp_asignado: number; pct_kwp_asignado: number | null; costo_ejecutado: number; costo_no_ejecutado: number; observaciones: string | null; pdf_storage_path: string | null; construccion_subtotal: number; flat_subtotal: number };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="icon-btn" onClick={() => router.push('/ordenes-compra')} aria-label="Volver"><ArrowLeft size={16} /></button>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.3rem' }}>OC {ocData.numero_oc}</h1>
          <p style={{ margin: '2px 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{ocData.proveedor}</p>
        </div>
      </div>

      {error && <div className="alert-error">{error}</div>}

      <section className="card">
        <div className="card-header"><span className="card-title">Cabecera</span></div>
        <div className="grid grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, fontSize: '0.85rem' }}>
          <Kv label="Fecha documento" value={ocData.fecha_documento ?? '—'} />
          <Kv label="Fecha entrega" value={ocData.fecha_entrega ?? '—'} />
          <Kv label="kWp total" value={ocData.kwp_total != null ? `${ocData.kwp_total} kWp` : 'No aplica (sin líneas de construcción)'} />
          <Kv
            label="kWp asignado"
            value={ocData.kwp_total != null ? `${ocData.kwp_asignado.toFixed(2)} kWp (${(ocData.pct_kwp_asignado ?? 0).toFixed(1)}%)` : '—'}
          />
          <Kv label="Valor total" value={fmtCOP(ocData.valor_total)} />
          <Kv label="· Construcción (por kWp)" value={fmtCOP(ocData.construccion_subtotal ?? 0)} />
          <Kv label="· Otro tema (monto fijo por casa)" value={fmtCOP(ocData.flat_subtotal ?? 0)} />
          <Kv label="Costo ejecutado" value={fmtCOP(ocData.costo_ejecutado)} />
          <Kv label="Costo no ejecutado" value={fmtCOP(ocData.costo_no_ejecutado)} />
        </div>
        {ocData.observaciones && <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 10 }}>{ocData.observaciones}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button className="secondary-btn" onClick={viewPdf} disabled={!ocData.pdf_storage_path}><Eye size={14} /> Ver PDF</button>
          <label className="secondary-btn" style={{ cursor: 'pointer' }}>
            <Upload size={14} /> {ocData.pdf_storage_path ? 'Reemplazar PDF' : 'Subir PDF'}
            <input type="file" accept="application/pdf" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPdf(f); }} />
          </label>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <span className="card-title">Líneas de detalle</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="secondary-btn" onClick={() => setItems((it) => [...it, { posicion: it.length + 1, categoria: CATEGORIAS[0], codigo_servicio: null, descripcion: '', cantidad: null, unidad: null, precio_unitario: null, valor_total: 0 }])}>
              <Plus size={14} /> Agregar línea
            </button>
            <button className="primary-btn" onClick={saveItems} disabled={savingItems}><Save size={14} /> {savingItems ? 'Guardando…' : 'Guardar líneas'}</button>
          </div>
        </div>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 0 }}>
          Una OC puede mezclar líneas de <strong>construcción</strong> (Inversor, Batería, BMS, Paneles, Puntos de anclaje, Análisis estructural, Mano de obra — se reparten entre casas por kWp) con líneas de <strong>otro tema</strong> (Medidores, Modem, Equipos adicionales, Factibilidad, Otro — se reparten con un monto fijo por casa, en &ldquo;Casas asignadas&rdquo; abajo).
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ background: 'var(--bg-elevated)', textAlign: 'left' }}>
                {['Categoría', 'Código de servicio', 'Descripción', 'Cantidad', 'Unidad', 'Precio unit.', 'Valor total', ''].map((h) => (
                  <th key={h} style={{ padding: '8px 10px', fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: 6 }}>
                    <select value={it.categoria} onChange={(e) => setItems((rows) => rows.map((r, j) => j === i ? { ...r, categoria: e.target.value } : r))}>
                      {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: 6 }}>
                    <input value={it.codigo_servicio ?? ''} onChange={(e) => setItems((rows) => rows.map((r, j) => j === i ? { ...r, codigo_servicio: e.target.value } : r))} style={{ width: 100 }} placeholder="70000018" />
                  </td>
                  <td style={{ padding: 6 }}>
                    <input value={it.descripcion} onChange={(e) => setItems((rows) => rows.map((r, j) => j === i ? { ...r, descripcion: e.target.value } : r))} style={{ minWidth: 180 }} />
                  </td>
                  <td style={{ padding: 6 }}>
                    <input type="number" value={it.cantidad ?? ''} onChange={(e) => setItems((rows) => rows.map((r, j) => j === i ? { ...r, cantidad: e.target.value ? Number(e.target.value) : null } : r))} style={{ width: 80 }} />
                  </td>
                  <td style={{ padding: 6 }}>
                    <input value={it.unidad ?? ''} onChange={(e) => setItems((rows) => rows.map((r, j) => j === i ? { ...r, unidad: e.target.value } : r))} style={{ width: 70 }} />
                  </td>
                  <td style={{ padding: 6 }}>
                    <input type="number" value={it.precio_unitario ?? ''} onChange={(e) => setItems((rows) => rows.map((r, j) => j === i ? { ...r, precio_unitario: e.target.value ? Number(e.target.value) : null } : r))} style={{ width: 110 }} />
                  </td>
                  <td style={{ padding: 6 }}>
                    <input type="number" value={it.valor_total} onChange={(e) => setItems((rows) => rows.map((r, j) => j === i ? { ...r, valor_total: Number(e.target.value) } : r))} style={{ width: 120 }} />
                  </td>
                  <td style={{ padding: 6 }}>
                    <button className="icon-btn" onClick={() => setItems((rows) => rows.filter((_, j) => j !== i))} aria-label="Quitar"><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={8} style={{ padding: 12, color: 'var(--text-muted)' }}>Sin líneas todavía.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <span className="card-title">Precio por solución (opcional)</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="secondary-btn" onClick={() => setSolutionPrices((p) => [...p, { solucion: null, precio_kwp: 0 }])}><Plus size={14} /> Agregar precio</button>
            <button className="primary-btn" onClick={savePrices} disabled={savingPrices}><Save size={14} /> {savingPrices ? 'Guardando…' : 'Guardar precios'}</button>
          </div>
        </div>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 0 }}>
          Si esta OC cobra distinto según la solución de la casa (1-4), definilo acá. Dejalo vacío para un precio único (kWp de la OC = valor total / kWp total).
        </p>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead>
            <tr style={{ background: 'var(--bg-elevated)', textAlign: 'left' }}>
              <th style={{ padding: 8 }}>Solución</th><th style={{ padding: 8 }}>Precio $/kWp</th><th></th>
            </tr>
          </thead>
          <tbody>
            {solutionPrices.map((sp, i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: 6 }}>
                  <select value={sp.solucion ?? ''} onChange={(e) => setSolutionPrices((rows) => rows.map((r, j) => j === i ? { ...r, solucion: e.target.value ? Number(e.target.value) : null } : r))}>
                    <option value="">Único (sin solución)</option>
                    {[1, 2, 3, 4].map((s) => <option key={s} value={s}>Solución {s}</option>)}
                  </select>
                </td>
                <td style={{ padding: 6 }}>
                  <input type="number" value={sp.precio_kwp} onChange={(e) => setSolutionPrices((rows) => rows.map((r, j) => j === i ? { ...r, precio_kwp: Number(e.target.value) } : r))} style={{ width: 140 }} />
                </td>
                <td style={{ padding: 6 }}>
                  <button className="icon-btn" onClick={() => setSolutionPrices((rows) => rows.filter((_, j) => j !== i))} aria-label="Quitar"><Trash2 size={13} /></button>
                </td>
              </tr>
            ))}
            {solutionPrices.length === 0 && <tr><td colSpan={3} style={{ padding: 12, color: 'var(--text-muted)' }}>Sin precios por solución — se usa el precio promedio (valor total / kWp total).</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="card">
        <div className="card-header">
          <span className="card-title">Casas asignadas ({assignments.length})</span>
          <button className="primary-btn" onClick={() => setShowAssign(true)}><Home size={14} /> Asignar casa</button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead>
            <tr style={{ background: 'var(--bg-elevated)', textAlign: 'left' }}>
              <th style={{ padding: 8 }}>Casa</th><th style={{ padding: 8 }}>kWp (construcción)</th><th style={{ padding: 8 }}>Monto fijo (otro tema)</th><th style={{ padding: 8 }}>Solución</th><th style={{ padding: 8 }}>Etapa</th><th></th>
            </tr>
          </thead>
          <tbody>
            {assignments.map((a) => (
              <tr key={a.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: 8 }}>{a.project.title} {a.project.conjunto ? `— ${a.project.conjunto} #${a.project.casa_numero ?? ''}` : ''}</td>
                <td style={{ padding: 8 }}>{a.kwp_asignado != null ? `${a.kwp_asignado} kWp` : '—'}</td>
                <td style={{ padding: 8 }}>{a.monto_fijo != null ? fmtCOP(a.monto_fijo) : '—'}</td>
                <td style={{ padding: 8 }}>{a.solucion ?? '—'}</td>
                <td style={{ padding: 8 }}><span className="badge-warning">{a.project.operations_stage ?? '—'}</span></td>
                <td style={{ padding: 8 }}><button className="icon-btn" onClick={() => unassign(a.project_id)} aria-label="Quitar"><Trash2 size={13} /></button></td>
              </tr>
            ))}
            {assignments.length === 0 && <tr><td colSpan={6} style={{ padding: 12, color: 'var(--text-muted)' }}>Sin casas asignadas todavía.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="card">
        <div className="card-header">
          <span className="card-title">Adicionales ({addenda.length}) — {fmtCOP(addendaTotal)} de {fmtCOP(addendaLimit)} tope (10%)</span>
          <button className="primary-btn" onClick={() => setShowAddendum(true)} disabled={addendaTotal >= addendaLimit}><Plus size={14} /> Nuevo adicional</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {addenda.map((a) => <AddendumRow key={a.id} addendum={a} />)}
          {addenda.length === 0 && <p style={{ padding: 12, color: 'var(--text-muted)', margin: 0 }}>Sin adicionales.</p>}
        </div>
      </section>

      {showAssign && (
        <AssignHouseModal ocId={id} onClose={() => setShowAssign(false)} onSuccess={() => { setShowAssign(false); load(); }} />
      )}
      {showAddendum && (
        <AddendumModal ocId={id} onClose={() => setShowAddendum(false)} onSuccess={() => { setShowAddendum(false); load(); }} />
      )}
      {pdfUrl && (
        <ModalShell title="PDF de la OC" onClose={() => setPdfUrl(null)} accent="#07c5a8" Icon={FileText} width={900}>
          <iframe src={pdfUrl} style={{ width: '100%', height: '80vh', border: 'none' }} title="PDF de la orden de compra" />
        </ModalShell>
      )}
    </div>
  );
}

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontWeight: 600 }}>{value}</div>
    </div>
  );
}

interface CasaOption { id: string; title: string; conjunto: string | null; casa_numero: string | null; diseno_kwp: number | null; }

function AssignHouseModal({ ocId, onClose, onSuccess }: { ocId: string; onClose: () => void; onSuccess: () => void }) {
  const [q, setQ] = useState('');
  const [options, setOptions] = useState<CasaOption[]>([]);
  const [selected, setSelected] = useState<CasaOption | null>(null);
  const [kwp, setKwp] = useState('');
  const [montoFijo, setMontoFijo] = useState('');
  const [solucion, setSolucion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) { setOptions([]); return; }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/crm/projects?q=${encodeURIComponent(q)}&limit=20`);
      const json = await res.json();
      setOptions((json.projects ?? []).map((p: CasaOption) => ({ id: p.id, title: p.title, conjunto: p.conjunto, casa_numero: p.casa_numero, diseno_kwp: p.diseno_kwp })));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const submit = async () => {
    if (!selected || (!kwp && !montoFijo)) return;
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/purchase-orders/${ocId}/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: selected.id,
        kwp_asignado: kwp ? Number(kwp) : null,
        monto_fijo: montoFijo ? Number(montoFijo) : null,
        solucion: solucion ? Number(solucion) : null,
      }),
    });
    const json = await res.json();
    if (!res.ok) { setError(json.error); setSaving(false); return; }
    onSuccess();
  };

  return (
    <ModalShell title="Asignar casa a la OC" onClose={onClose} accent="#07c5a8" Icon={Home} width={480}>
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error && <div className="alert-error">{error}</div>}
        <Field label="Buscar casa">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, código o cliente..." />
        </Field>
        {options.length > 0 && !selected && (
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, maxHeight: 180, overflowY: 'auto' }}>
            {options.map((o) => (
              <div
                key={o.id}
                onClick={() => { setSelected(o); setOptions([]); }}
                style={{ padding: '8px 10px', cursor: 'pointer', borderTop: '1px solid var(--border)', fontSize: '0.82rem' }}
              >
                {o.title} {o.conjunto ? `— ${o.conjunto} #${o.casa_numero ?? ''}` : ''} {o.diseno_kwp ? `(${o.diseno_kwp} kWp diseñado)` : ''}
              </div>
            ))}
          </div>
        )}
        {selected && (
          <div className="alert-success" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{selected.title}</span>
            <button className="icon-btn" onClick={() => setSelected(null)} aria-label="Cambiar"><Trash2 size={13} /></button>
          </div>
        )}
        <Field label="kWp asignado (parte de construcción)"><input type="number" value={kwp} onChange={(e) => setKwp(e.target.value)} placeholder="ej. 5.5" /></Field>
        <Field label="Monto fijo COP (parte de otro tema, ej. medidor)"><input type="number" value={montoFijo} onChange={(e) => setMontoFijo(e.target.value)} placeholder="ej. 5000000" /></Field>
        <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', margin: '-6px 0 0' }}>Al menos uno de los dos. Podés cargar ambos si la casa recibe plata de las dos partes de esta OC.</p>
        <Field label="Solución (opcional)">
          <select value={solucion} onChange={(e) => setSolucion(e.target.value)}>
            <option value="">Sin especificar</option>
            {[1, 2, 3, 4].map((s) => <option key={s} value={s}>Solución {s}</option>)}
          </select>
        </Field>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="secondary-btn" onClick={onClose}>Cancelar</button>
          <button className="primary-btn" onClick={submit} disabled={saving || !selected || (!kwp && !montoFijo)}>{saving ? 'Asignando…' : 'Asignar'}</button>
        </div>
      </div>
    </ModalShell>
  );
}

function AddendumModal({ ocId, onClose, onSuccess }: { ocId: string; onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({ numero_adicional: '', fecha: '', motivo: '', solicitado_por: '', aprobado_por: '', valor_total: '' });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setSaving(true);
    setError(null);
    const res = await fetch('/api/purchase-orders/addenda', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oc_id: ocId, ...form, valor_total: Number(form.valor_total) }),
    });
    const json = await res.json();
    if (!res.ok) { setError(json.error); setSaving(false); return; }
    onSuccess();
  };

  return (
    <ModalShell title="Nuevo adicional (otrosí)" onClose={onClose} accent="#f59e0b" Icon={Plus} width={480}>
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error && <div className="alert-error">{error}</div>}
        <Field label="Número de adicional *"><input value={form.numero_adicional} onChange={(e) => set('numero_adicional', e.target.value)} /></Field>
        <Field label="Fecha"><input type="date" value={form.fecha} onChange={(e) => set('fecha', e.target.value)} /></Field>
        <Field label="Motivo"><textarea rows={2} value={form.motivo} onChange={(e) => set('motivo', e.target.value)} /></Field>
        <Field label="Solicitado por"><input value={form.solicitado_por} onChange={(e) => set('solicitado_por', e.target.value)} /></Field>
        <Field label="Aprobado por"><input value={form.aprobado_por} onChange={(e) => set('aprobado_por', e.target.value)} /></Field>
        <Field label="Valor total (COP) *"><input type="number" value={form.valor_total} onChange={(e) => set('valor_total', e.target.value)} /></Field>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="secondary-btn" onClick={onClose}>Cancelar</button>
          <button className="primary-btn" onClick={submit} disabled={saving || !form.numero_adicional || !form.valor_total}>{saving ? 'Guardando…' : 'Crear adicional'}</button>
        </div>
      </div>
    </ModalShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label className="input-label">{label}</label>
      {children}
    </div>
  );
}

interface AddendumItem { id?: string; posicion: number; categoria: string; codigo_servicio: string | null; descripcion: string; cantidad: number | null; unidad: string | null; precio_unitario: number | null; valor_total: number; }
interface AddendumAssignment { id: string; project_id: string; porcentaje: number; detalle: string | null; project: { title: string; conjunto: string | null; casa_numero: string | null } }

/**
 * Fila de la tabla de adicionales — al hacer click se expande y trae su
 * propio detalle (líneas + % por casa), mismo patrón que la OC principal
 * pero a menor escala. Evita una ruta /addenda/[id] aparte.
 */
function AddendumRow({ addendum }: { addendum: Addendum }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AddendumItem[]>([]);
  const [assignments, setAssignments] = useState<AddendumAssignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingItems, setSavingItems] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAssignHouse, setShowAssignHouse] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/purchase-orders/addenda/${addendum.id}`);
    const json = await res.json();
    setItems(json.items ?? []);
    setAssignments(json.assignments ?? []);
    setLoading(false);
  }, [addendum.id]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const saveItems = async () => {
    setSavingItems(true);
    setError(null);
    const res = await fetch(`/api/purchase-orders/addenda/${addendum.id}/items`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items.map((it, i) => ({ ...it, posicion: i + 1 })) }),
    });
    const json = await res.json();
    if (!res.ok) { setError(json.error); setSavingItems(false); return; }
    setItems(json.items);
    setSavingItems(false);
  };

  const unassign = async (projectId: string) => {
    await fetch(`/api/purchase-orders/addenda/${addendum.id}/assignments?project_id=${projectId}`, { method: 'DELETE' });
    load();
  };

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
      <div
        onClick={() => setOpen((v) => !v)}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', cursor: 'pointer' }}
      >
        <span><strong>{addendum.numero_adicional}</strong> — {addendum.fecha ?? 'sin fecha'}</span>
        <span>{fmtCOP(addendum.valor_total)}</span>
      </div>
      {open && (
        <div style={{ padding: 12, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {loading ? <p style={{ color: 'var(--text-muted)' }}>Cargando…</p> : (
            <>
              {error && <div className="alert-error">{error}</div>}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <strong style={{ fontSize: '0.82rem' }}>Líneas de detalle</strong>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="secondary-btn" onClick={() => setItems((it) => [...it, { posicion: it.length + 1, categoria: CATEGORIAS[0], codigo_servicio: null, descripcion: '', cantidad: null, unidad: null, precio_unitario: null, valor_total: 0 }])}>
                      <Plus size={12} /> Línea
                    </button>
                    <button className="primary-btn" onClick={saveItems} disabled={savingItems}><Save size={12} /> Guardar</button>
                  </div>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                  <tbody>
                    {items.map((it, i) => (
                      <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: 4 }}>
                          <select value={it.categoria} onChange={(e) => setItems((rows) => rows.map((r, j) => j === i ? { ...r, categoria: e.target.value } : r))}>
                            {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: 4 }}><input value={it.codigo_servicio ?? ''} onChange={(e) => setItems((rows) => rows.map((r, j) => j === i ? { ...r, codigo_servicio: e.target.value } : r))} style={{ width: 90 }} placeholder="Código" /></td>
                        <td style={{ padding: 4 }}><input value={it.descripcion} onChange={(e) => setItems((rows) => rows.map((r, j) => j === i ? { ...r, descripcion: e.target.value } : r))} style={{ minWidth: 160 }} /></td>
                        <td style={{ padding: 4 }}><input type="number" value={it.valor_total} onChange={(e) => setItems((rows) => rows.map((r, j) => j === i ? { ...r, valor_total: Number(e.target.value) } : r))} style={{ width: 110 }} /></td>
                        <td style={{ padding: 4 }}><button className="icon-btn" onClick={() => setItems((rows) => rows.filter((_, j) => j !== i))} aria-label="Quitar"><Trash2 size={12} /></button></td>
                      </tr>
                    ))}
                    {items.length === 0 && <tr><td colSpan={5} style={{ padding: 8, color: 'var(--text-muted)' }}>Sin líneas.</td></tr>}
                  </tbody>
                </table>
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <strong style={{ fontSize: '0.82rem' }}>% asignado a casas</strong>
                  <button className="secondary-btn" onClick={() => setShowAssignHouse(true)}><Plus size={12} /> Casa</button>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                  <tbody>
                    {assignments.map((a) => (
                      <tr key={a.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: 4 }}>{a.project.title}</td>
                        <td style={{ padding: 4 }}>{a.porcentaje}%</td>
                        <td style={{ padding: 4, color: 'var(--text-secondary)' }}>{a.detalle ?? '—'}</td>
                        <td style={{ padding: 4 }}><button className="icon-btn" onClick={() => unassign(a.project_id)} aria-label="Quitar"><Trash2 size={12} /></button></td>
                      </tr>
                    ))}
                    {assignments.length === 0 && <tr><td colSpan={4} style={{ padding: 8, color: 'var(--text-muted)' }}>Sin casas asignadas.</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
      {showAssignHouse && (
        <AssignHouseToAddendumModal
          addendumId={addendum.id}
          onClose={() => setShowAssignHouse(false)}
          onSuccess={() => { setShowAssignHouse(false); load(); }}
        />
      )}
    </div>
  );
}

function AssignHouseToAddendumModal({ addendumId, onClose, onSuccess }: { addendumId: string; onClose: () => void; onSuccess: () => void }) {
  const [q, setQ] = useState('');
  const [options, setOptions] = useState<CasaOption[]>([]);
  const [selected, setSelected] = useState<CasaOption | null>(null);
  const [porcentaje, setPorcentaje] = useState('');
  const [detalle, setDetalle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) { setOptions([]); return; }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/crm/projects?q=${encodeURIComponent(q)}&limit=20`);
      const json = await res.json();
      setOptions((json.projects ?? []).map((p: CasaOption) => ({ id: p.id, title: p.title, conjunto: p.conjunto, casa_numero: p.casa_numero, diseno_kwp: p.diseno_kwp })));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const submit = async () => {
    if (!selected || !porcentaje) return;
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/purchase-orders/addenda/${addendumId}/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: selected.id, porcentaje: Number(porcentaje), detalle: detalle || null }),
    });
    const json = await res.json();
    if (!res.ok) { setError(json.error); setSaving(false); return; }
    onSuccess();
  };

  return (
    <ModalShell title="Asignar % del adicional a una casa" onClose={onClose} accent="#f59e0b" Icon={Home} width={460}>
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error && <div className="alert-error">{error}</div>}
        <Field label="Buscar casa"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, código o cliente..." /></Field>
        {options.length > 0 && !selected && (
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, maxHeight: 180, overflowY: 'auto' }}>
            {options.map((o) => (
              <div key={o.id} onClick={() => { setSelected(o); setOptions([]); }} style={{ padding: '8px 10px', cursor: 'pointer', borderTop: '1px solid var(--border)', fontSize: '0.82rem' }}>
                {o.title} {o.conjunto ? `— ${o.conjunto} #${o.casa_numero ?? ''}` : ''}
              </div>
            ))}
          </div>
        )}
        {selected && (
          <div className="alert-success" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{selected.title}</span>
            <button className="icon-btn" onClick={() => setSelected(null)} aria-label="Cambiar"><Trash2 size={13} /></button>
          </div>
        )}
        <Field label="% de este adicional que le corresponde *"><input type="number" value={porcentaje} onChange={(e) => setPorcentaje(e.target.value)} /></Field>
        <Field label="Detalle (por qué le corresponde ese %)"><textarea rows={2} value={detalle} onChange={(e) => setDetalle(e.target.value)} /></Field>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="secondary-btn" onClick={onClose}>Cancelar</button>
          <button className="primary-btn" onClick={submit} disabled={saving || !selected || !porcentaje}>{saving ? 'Guardando…' : 'Asignar'}</button>
        </div>
      </div>
    </ModalShell>
  );
}
