'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText, Plus, Download, Eye, Upload, RefreshCw } from 'lucide-react';
import { StatCard } from '@/components/StatCard';
import { PaginatedTable } from '@/components/DataTable';
import { ModalShell } from '@/components/ModalShell';
import { downloadCSV } from '@/lib/csv-export';

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
}

const fmtCOP = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;
const fmtPct = (n: number) => `${n.toFixed(1)}%`;

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

  const totalValor = ocs.reduce((s, o) => s + Number(o.valor_total), 0);
  const totalKwp = ocs.reduce((s, o) => s + Number(o.kwp_total), 0);
  const totalKwpAsignado = ocs.reduce((s, o) => s + Number(o.kwp_asignado), 0);
  const totalEjecutado = ocs.reduce((s, o) => s + Number(o.costo_ejecutado), 0);
  const totalNoEjecutado = ocs.reduce((s, o) => s + Number(o.costo_no_ejecutado), 0);

  const downloadTable = () => {
    downloadCSV(
      `ordenes-de-compra-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Numero OC', 'Proveedor', 'Fecha', 'kWp OC', 'kWp asignado', '% asignado', 'Valor total', 'Costo ejecutado', 'Costo no ejecutado', 'Casas asignadas', 'Adicionales'],
      ocs.map((o) => [
        o.numero_oc, o.proveedor, o.fecha_documento ?? '', o.kwp_total ?? '', o.kwp_asignado.toFixed(2),
        o.pct_kwp_asignado != null ? fmtPct(o.pct_kwp_asignado) : '', o.valor_total, Math.round(o.costo_ejecutado), Math.round(o.costo_no_ejecutado),
        o.casas_count, o.tiene_adicionales ? `Sí (${o.adicionales_count})` : 'No',
      ]),
    );
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

      <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <StatCard label="Valor total OC" value={fmtCOP(totalValor)} hint={`${ocs.length} orden${ocs.length === 1 ? '' : 'es'} de compra`} />
        <StatCard
          label="kWp asignado"
          value={`${totalKwpAsignado.toFixed(1)} / ${totalKwp.toFixed(1)} kWp`}
          hint={fmtPct(totalKwp > 0 ? (totalKwpAsignado / totalKwp) * 100 : 0)}
          tag="global"
        />
        <StatCard
          label="Costo ejecutado vs. no ejecutado"
          value={fmtCOP(totalEjecutado)}
          hint={`${fmtCOP(totalNoEjecutado)} sin ejecutar`}
          tag={totalValor > 0 ? fmtPct((totalEjecutado / totalValor) * 100) : undefined}
        />
      </div>

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Órdenes de compra</h2>
        </div>
        {loading ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Cargando…</p>
        ) : ocs.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Todavía no hay órdenes de compra cargadas.</p>
        ) : (
          <PaginatedTable
            head={['N.° OC', 'Proveedor', 'Casas', 'kWp OC', '% kWp asignado', 'Ejecutado', 'No ejecutado', 'Adicionales', '']}
            pageSize={10}
            rows={ocs.map((o) => [
              <Link key="n" href={`/ordenes-compra/${o.id}`} style={{ fontWeight: 700, color: 'var(--accent)' }}>{o.numero_oc}</Link>,
              o.proveedor,
              o.casas_count,
              o.kwp_total != null ? `${o.kwp_total.toLocaleString('es-CO')} kWp` : '—',
              o.pct_kwp_asignado != null ? fmtPct(o.pct_kwp_asignado) : '—',
              fmtCOP(o.costo_ejecutado),
              fmtCOP(o.costo_no_ejecutado),
              o.tiene_adicionales
                ? <span key="a" className="badge-warning">Sí ({o.adicionales_count})</span>
                : <span key="a" style={{ color: 'var(--text-muted)' }}>No</span>,
              <div key="acts" style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <Link href={`/ordenes-compra/${o.id}`} className="icon-btn" aria-label="Ver detalle" title="Ver detalle">
                  <Eye size={14} />
                </Link>
              </div>,
            ])}
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
  const [form, setForm] = useState({
    numero_oc: '', proveedor: '', fecha_documento: '', fecha_entrega: '',
    condiciones_pago: '', kwp_total: '', valor_total: '', observaciones: '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

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
          fecha_entrega: form.fecha_entrega || null,
          condiciones_pago: form.condiciones_pago || null,
          kwp_total: form.kwp_total ? Number(form.kwp_total) : null,
          valor_total: Number(form.valor_total),
          observaciones: form.observaciones || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? 'Error al crear la OC'); setSaving(false); return; }

      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        await fetch(`/api/purchase-orders/${json.purchaseOrder.id}/pdf`, { method: 'POST', body: fd });
      }
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Importar orden de compra" onClose={onClose} accent="#07c5a8" Icon={Upload} width={560}>
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Cargá los datos de cabecera del PDF de la OC. Las líneas de detalle, precios por
          solución y casas asignadas se agregan después, desde el detalle de la OC.
        </p>
        {error && <div className="alert-error">{error}</div>}
        <div className="grid grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Número de OC *"><input value={form.numero_oc} onChange={(e) => set('numero_oc', e.target.value)} placeholder="4200028778" /></Field>
          <Field label="Proveedor *"><input value={form.proveedor} onChange={(e) => set('proveedor', e.target.value)} placeholder="ESTRUCCON INGENIERIA SAS" /></Field>
          <Field label="Fecha documento"><input type="date" value={form.fecha_documento} onChange={(e) => set('fecha_documento', e.target.value)} /></Field>
          <Field label="Fecha entrega"><input type="date" value={form.fecha_entrega} onChange={(e) => set('fecha_entrega', e.target.value)} /></Field>
          <Field label="kWp total OC (si aplica)"><input type="number" value={form.kwp_total} onChange={(e) => set('kwp_total', e.target.value)} placeholder="205.28 — dejalo vacío si la OC no es de construcción" /></Field>
          <Field label="Valor total (COP) *"><input type="number" value={form.valor_total} onChange={(e) => set('valor_total', e.target.value)} placeholder="472650198" /></Field>
          <Field label="Condiciones de pago"><input value={form.condiciones_pago} onChange={(e) => set('condiciones_pago', e.target.value)} placeholder="Dentro de los 30 días sin DPP" /></Field>
          <Field label="PDF de la OC"><input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
        </div>
        <Field label="Observaciones">
          <textarea rows={3} value={form.observaciones} onChange={(e) => set('observaciones', e.target.value)} />
        </Field>
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
