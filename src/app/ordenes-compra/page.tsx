'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText, Plus, Trash2, Download, Eye, Upload, RefreshCw } from 'lucide-react';
import { PaginatedTable } from '@/components/DataTable';
import { ModalShell } from '@/components/ModalShell';
import { downloadCSV } from '@/lib/csv-export';
import { PURCHASE_ORDER_CATEGORIES } from '@/lib/purchase-orders';

const CATEGORIAS = PURCHASE_ORDER_CATEGORIES;

interface NewItem {
  categoria: string;
  codigo_servicio: string;
  descripcion: string;
  cantidad: string;
  unidad: string;
  precio_unitario: string;
  valor_total: string;
}
const blankItem = (): NewItem => ({ categoria: CATEGORIAS[0], codigo_servicio: '', descripcion: '', cantidad: '', unidad: '', precio_unitario: '', valor_total: '' });

interface PurchaseOrderItem {
  id: string;
  oc_id: string;
  posicion: number;
  categoria: string;
  codigo_servicio: string | null;
  descripcion: string;
  cantidad: number | null;
  unidad: string | null;
  precio_unitario: number | null;
  valor_total: number;
}

interface PurchaseOrder {
  id: string;
  numero_oc: string;
  proveedor: string;
  fecha_documento: string | null;
  kwp_total: number | null;
  valor_total: number;
  kwp_asignado: number;
  pct_kwp_asignado: number | null;
  costo_ejecutado: number;
  costo_no_ejecutado: number;
  casas_count: number;
  tiene_adicionales: boolean;
  adicionales_count: number;
  pdf_storage_path: string | null;
  items: PurchaseOrderItem[];
}

const fmtCOP = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;

export default function OrdenesDeCompraPage() {
  const [ocs, setOcs] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);

  const load = async () => {
    setLoading(true);
    const res = await fetch('/api/purchase-orders');
    const json = await res.json();
    setOcs(json.purchaseOrders ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);


  const downloadTable = () => {
    downloadCSV(
      `ordenes-de-compra-${new Date().toISOString().slice(0, 10)}.csv`,
      ['N. OC', 'Proveedor', 'Posición', 'Categoría', 'Código de servicio', 'Detalle', 'Cantidad', 'Unidad', 'Precio', 'Valor'],
      ocs.flatMap((o) => (o.items ?? []).map((it) => [
        o.numero_oc, o.proveedor, it.posicion, it.categoria, it.codigo_servicio ?? '', it.descripcion,
        it.cantidad ?? '', it.unidad ?? '', it.precio_unitario ?? '', it.valor_total,
      ])),
    );
  };

  const viewPdf = async (ocId: string) => {
    const res = await fetch(`/api/purchase-orders/${ocId}/pdf`);
    const json = await res.json();
    if (res.ok) window.open(json.url, '_blank');
    else alert(json.error ?? 'Esta OC no tiene PDF cargado');
  };

  const replacePdf = async (ocId: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`/api/purchase-orders/${ocId}/pdf`, { method: 'POST', body: fd });
    if (res.ok) load();
    else { const j = await res.json(); alert(j.error ?? 'Error al subir el PDF'); }
  };

  const deleteLine = async (ocId: string, itemId: string) => {
    if (!confirm('¿Borrar esta línea de la OC?')) return;
    const res = await fetch(`/api/purchase-orders/${ocId}/items?itemId=${itemId}`, { method: 'DELETE' });
    if (res.ok) load();
    else { const j = await res.json(); alert(j.error ?? 'Error al borrar la línea'); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.3rem' }}>Órdenes de Compra</h1>
          <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Trazabilidad de qué OC financió cada casa, sus adicionales y su ejecución.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="icon-btn" onClick={load} aria-label="Refrescar" title="Refrescar">
            <RefreshCw size={16} />
          </button>
          <button className="secondary-btn" onClick={downloadTable}>
            <Download size={14} /> Descargar tabla
          </button>
          <button className="primary-btn" onClick={() => setShowImport(true)}>
            <Plus size={14} /> Importar OC
          </button>
        </div>
      </div>

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Órdenes de compra</h2>
        </div>
        {loading ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Cargando…</p>
        ) : ocs.every((o) => (o.items ?? []).length === 0) ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Todavía no hay órdenes de compra cargadas.</p>
        ) : (
          <PaginatedTable
            head={['N.° OC', 'Proveedor', 'Posición', 'Categoría', 'Código de servicio', 'Detalle', 'Cantidad', 'Unidad', 'Precio', 'Valor', '']}
            pageSize={15}
            rows={ocs.flatMap((o) => (o.items ?? []).map((it) => [
              <Link key="n" href={`/ordenes-compra/${o.id}`} style={{ fontWeight: 700, color: 'var(--accent)' }}>{o.numero_oc}</Link>,
              o.proveedor,
              it.posicion,
              it.categoria,
              it.codigo_servicio ?? '—',
              it.descripcion,
              it.cantidad != null ? it.cantidad.toLocaleString('es-CO') : '—',
              it.unidad ?? '—',
              it.precio_unitario != null ? fmtCOP(it.precio_unitario) : '—',
              fmtCOP(it.valor_total),
              <div key="acts" style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <Link href={`/ordenes-compra/${o.id}`} className="icon-btn" aria-label="Ver detalle de la OC" title="Ver detalle de la OC">
                  <Eye size={14} />
                </Link>
                <button className="icon-btn" onClick={() => viewPdf(o.id)} disabled={!o.pdf_storage_path} aria-label="Ver PDF" title="Ver PDF">
                  <FileText size={14} />
                </button>
                <label className="icon-btn" style={{ cursor: 'pointer' }} aria-label="Reemplazar PDF" title="Reemplazar PDF">
                  <Upload size={14} />
                  <input type="file" accept="application/pdf" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) replacePdf(o.id, f); }} />
                </label>
                <button className="icon-btn" onClick={() => deleteLine(o.id, it.id)} aria-label="Borrar línea" title="Borrar línea">
                  <Trash2 size={14} />
                </button>
              </div>,
            ]))}
          />
        )}
      </section>

      {showImport && (
        <ImportOcModal
          onClose={() => setShowImport(false)}
          onSuccess={() => { setShowImport(false); load(); }}
        />
      )}
    </div>
  );
}

function ImportOcModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [tipoOc, setTipoOc] = useState<'construccion' | 'adicionales'>('construccion');
  const [form, setForm] = useState({
    numero_oc: '', proveedor: '', fecha_documento: '',
    condiciones_pago: '', kwp_total: '', valor_total: '', observaciones: '',
  });
  const [items, setItems] = useState<NewItem[]>([blankItem()]);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const setItem = (i: number, patch: Partial<NewItem>) => setItems((rows) => rows.map((r, j) => j === i ? { ...r, ...patch } : r));

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/purchase-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          numero_oc: form.numero_oc,
          proveedor: form.proveedor,
          fecha_documento: form.fecha_documento || null,
          condiciones_pago: form.condiciones_pago || null,
          kwp_total: tipoOc === 'construccion' && form.kwp_total ? Number(form.kwp_total) : null,
          valor_total: Number(form.valor_total),
          observaciones: form.observaciones || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? 'Error al crear la OC'); setSaving(false); return; }
      const ocId = json.purchaseOrder.id;

      const validItems = items.filter((it) => it.descripcion.trim() && it.valor_total !== '');
      if (validItems.length > 0) {
        const itemsRes = await fetch(`/api/purchase-orders/${ocId}/items`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: validItems.map((it, i) => ({
              posicion: i + 1,
              categoria: it.categoria,
              codigo_servicio: it.codigo_servicio || null,
              descripcion: it.descripcion,
              cantidad: it.cantidad ? Number(it.cantidad) : null,
              unidad: it.unidad || null,
              precio_unitario: it.precio_unitario ? Number(it.precio_unitario) : null,
              valor_total: Number(it.valor_total),
            })),
          }),
        });
        if (!itemsRes.ok) { const j = await itemsRes.json(); setError(`OC creada, pero falló guardar las líneas: ${j.error}`); setSaving(false); return; }
      }

      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        await fetch(`/api/purchase-orders/${ocId}/pdf`, { method: 'POST', body: fd });
      }
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Importar orden de compra" onClose={onClose} accent="#07c5a8" Icon={Upload} width={920}>
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {error && <div className="alert-error">{error}</div>}

        <Field label="Tipo de OC *">
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className={tipoOc === 'construccion' ? 'primary-btn' : 'secondary-btn'} onClick={() => setTipoOc('construccion')}>Construcción</button>
            <button type="button" className={tipoOc === 'adicionales' ? 'primary-btn' : 'secondary-btn'} onClick={() => setTipoOc('adicionales')}>Adicionales</button>
          </div>
        </Field>

        <div className="grid grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Número de OC *"><input value={form.numero_oc} onChange={(e) => set('numero_oc', e.target.value)} placeholder="4200028778" /></Field>
          <Field label="Proveedor *"><input value={form.proveedor} onChange={(e) => set('proveedor', e.target.value)} placeholder="ESTRUCCON INGENIERIA SAS" /></Field>
          <Field label="Fecha documento"><input type="date" value={form.fecha_documento} onChange={(e) => set('fecha_documento', e.target.value)} /></Field>
          <Field label="Valor total (COP) *"><input type="number" value={form.valor_total} onChange={(e) => set('valor_total', e.target.value)} placeholder="472650198" /></Field>
          {tipoOc === 'construccion' && (
            <Field label="kWp total OC"><input type="number" value={form.kwp_total} onChange={(e) => set('kwp_total', e.target.value)} placeholder="205.28" /></Field>
          )}
          <Field label="Condiciones de pago"><input value={form.condiciones_pago} onChange={(e) => set('condiciones_pago', e.target.value)} placeholder="Dentro de los 30 días sin DPP" /></Field>
          <Field label="PDF de la OC"><input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
        </div>
        <Field label="Observaciones">
          <textarea rows={2} value={form.observaciones} onChange={(e) => set('observaciones', e.target.value)} />
        </Field>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="input-label">Líneas de detalle</span>
            <button type="button" className="secondary-btn" onClick={() => setItems((it) => [...it, blankItem()])}>
              <Plus size={14} /> Agregar línea
            </button>
          </div>
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ background: 'var(--bg-elevated)', textAlign: 'left' }}>
                  {['Posición', 'Categoría', 'Código de servicio', 'Descripción', 'Cantidad', 'Unidad', 'Precio', 'Valor', ''].map((h) => (
                    <th key={h} style={{ padding: '7px 8px', fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: 5, color: 'var(--text-muted)' }}>{i + 1}</td>
                    <td style={{ padding: 5 }}>
                      <select value={it.categoria} onChange={(e) => setItem(i, { categoria: e.target.value })}>
                        {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: 5 }}>
                      <input value={it.codigo_servicio} onChange={(e) => setItem(i, { codigo_servicio: e.target.value })} style={{ width: 90 }} placeholder="70000018" />
                    </td>
                    <td style={{ padding: 5 }}>
                      <input value={it.descripcion} onChange={(e) => setItem(i, { descripcion: e.target.value })} style={{ minWidth: 160 }} />
                    </td>
                    <td style={{ padding: 5 }}>
                      <input type="number" value={it.cantidad} onChange={(e) => setItem(i, { cantidad: e.target.value })} style={{ width: 70 }} />
                    </td>
                    <td style={{ padding: 5 }}>
                      <input value={it.unidad} onChange={(e) => setItem(i, { unidad: e.target.value })} style={{ width: 60 }} />
                    </td>
                    <td style={{ padding: 5 }}>
                      <input type="number" value={it.precio_unitario} onChange={(e) => setItem(i, { precio_unitario: e.target.value })} style={{ width: 100 }} />
                    </td>
                    <td style={{ padding: 5 }}>
                      <input type="number" value={it.valor_total} onChange={(e) => setItem(i, { valor_total: e.target.value })} style={{ width: 110 }} />
                    </td>
                    <td style={{ padding: 5 }}>
                      {items.length > 1 && (
                        <button type="button" className="icon-btn" onClick={() => setItems((rows) => rows.filter((_, j) => j !== i))} aria-label="Quitar"><Trash2 size={13} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 6 }}>
            Precios por solución y casas asignadas se agregan después, desde el detalle de la OC.
          </p>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button className="secondary-btn" onClick={onClose} disabled={saving}>Cancelar</button>
          <button
            className="primary-btn"
            onClick={submit}
            disabled={saving || !form.numero_oc || !form.proveedor || !form.valor_total}
          >
            <FileText size={14} /> {saving ? 'Guardando…' : 'Crear OC'}
          </button>
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
