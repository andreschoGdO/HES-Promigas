'use client';

/**
 * Bitácora de Construcción — un contenedor por casa (abierta/cerrada) con
 * múltiples entradas de avance diario adentro. Vive como pestaña propia en
 * /visitas (ver page.tsx) pero fuera del catálogo VISIT_SCHEMAS: no es una
 * acta de "un evento = un registro", es un registro que crece con el tiempo.
 *
 * Backend: tablas construction_logs / construction_log_entries /
 * construction_log_entry_photos (migración 70) y las rutas bajo
 * /api/construction-logs/**.
 */

import { useEffect, useRef, useState } from 'react';
import {
  NotebookPen, Plus, MapPin, Camera, ImagePlus, X, Lock, Unlock, FileDown, Trash2, Cloud, Layers, ArrowLeft, Pencil,
} from 'lucide-react';
import { compressImageIfNeeded } from '@/lib/image-compress';

const ETAPAS = [
  'Alistamiento de sitio', 'Cimentación / anclajes', 'Estructura de montaje', 'Instalación de paneles',
  'Cableado DC', 'Cableado AC', 'Tablero SSFV / inversor', 'Puesta en marcha', 'Ajustes / retrabajo',
  'Retraso — clima', 'Retraso — material', 'Retraso — otro', 'Otro',
];
const CLIMAS = ['Soleado', 'Parcialmente nublado', 'Nublado', 'Lluvia', 'Lluvia fuerte / tormenta'];
const PHOTO_CATEGORIES = ['Avance general', 'Estructura', 'Paneles', 'Cableado', 'Tablero / Inversor', 'Incidencia', 'Otro'];

interface LogListItem {
  id: string;
  casa: string;
  contratista: string | null;
  status: 'abierta' | 'cerrada';
  opened_by: string | null;
  opened_at: string;
  closed_at: string | null;
}

interface EntryPhoto {
  id: string;
  storage_path: string;
  filename: string | null;
  description: string | null;
  category: string | null;
  url: string | null;
}

interface Entry {
  id: string;
  log_id: string;
  entry_date: string;
  etapa: string | null;
  clima: string | null;
  descripcion: string;
  observaciones: string | null;
  lat: number | null;
  lng: number | null;
  created_by: string | null;
  created_at: string;
  photos: EntryPhoto[];
}

interface LogDetail extends LogListItem {
  house_id: string | null;
  created_at: string;
  updated_at: string;
}

const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
const fmtDateTime = (d: string) => new Date(d).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function ConstructionLog({ userEmail }: { userEmail: string }) {
  const [activeLogId, setActiveLogId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  if (activeLogId) {
    return <LogDetailView logId={activeLogId} userEmail={userEmail} onBack={() => { setActiveLogId(null); setRefreshKey((k) => k + 1); }} />;
  }
  return <LogListView key={refreshKey} onOpen={setActiveLogId} userEmail={userEmail} />;
}

/* ───────────────────── Listado de bitácoras ───────────────────── */
function LogListView({ onOpen, userEmail }: { onOpen: (id: string) => void; userEmail: string }) {
  const [logs, setLogs] = useState<LogListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'abierta' | 'cerrada' | ''>('abierta');
  const [showNew, setShowNew] = useState(false);
  const [casa, setCasa] = useState('');
  const [contratista, setContratista] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setListError(null);
    try {
      const q = filter ? `?status=${filter}` : '';
      const r = await fetch(`/api/construction-logs${q}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setListError(j.error ?? `Error al cargar (${r.status})`); setLogs([]); return; }
      setLogs(j.logs ?? []);
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'No se pudo conectar con el servidor');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [filter]);

  const create = async () => {
    if (!casa.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const r = await fetch('/api/construction-logs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ casa: casa.trim(), contratista: contratista.trim() || null, opened_by: userEmail }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.log?.id) {
        setError(j.error ?? `No se pudo crear la bitácora (error ${r.status}). Intenta de nuevo o recarga la página.`);
        return;
      }
      setShowNew(false); setCasa(''); setContratista('');
      onOpen(j.log.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo conectar con el servidor — revisa tu conexión e intenta de nuevo.');
    } finally { setCreating(false); }
  };

  return (
    <>
      <div className="glass-panel" style={{ padding: 22, borderLeft: '4px solid #3b82f6' }}>
        <h2 style={{ margin: 0, fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: 8 }}>
          <NotebookPen size={20} /> Bitácora de Construcción
        </h2>
        <p style={{ margin: '6px 0 14px', color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
          Un registro por casa donde vas dejando el avance de la obra día a día, hasta cerrarla. No es un acta puntual: podés abrir la bitácora de una casa y volver a ella cuantas veces necesites.
        </p>
        {!showNew ? (
          <button onClick={() => setShowNew(true)} className="primary-btn" style={{ width: '100%', justifyContent: 'center', padding: '14px', fontSize: '0.95rem', fontWeight: 600 }}>
            <Plus size={18} /> Nueva bitácora
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input type="text" placeholder="Casa (ej: Casa 108 - Reserva de Pance)" value={casa} onChange={(e) => setCasa(e.target.value)} style={{ minHeight: 44 }} autoFocus />
            <input type="text" placeholder="Contratista (opcional)" value={contratista} onChange={(e) => setContratista(e.target.value)} />
            <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-muted)' }}>Si esa casa ya tiene una bitácora abierta, se reutiliza en vez de crear una nueva.</p>
            {error && <div className="alert-error" style={{ fontSize: '0.8rem' }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={create} disabled={creating || !casa.trim()} className="primary-btn" style={{ flex: 1, justifyContent: 'center' }}>
                {creating ? 'Creando…' : 'Abrir bitácora'}
              </button>
              <button onClick={() => setShowNew(false)} className="secondary-btn" style={{ flex: 1, justifyContent: 'center' }}>Cancelar</button>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, margin: '16px 0' }}>
        {(['abierta', 'cerrada', ''] as const).map((f) => (
          <button key={f || 'todas'} onClick={() => setFilter(f)} className={`chip ${filter === f ? 'active' : ''}`} style={{ fontSize: '0.82rem' }}>
            {f === 'abierta' ? 'Abiertas' : f === 'cerrada' ? 'Cerradas' : 'Todas'}
          </button>
        ))}
      </div>

      {listError && <div className="alert-error" style={{ fontSize: '0.85rem', marginBottom: 12 }}>{listError}</div>}

      {loading ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Cargando…</p>
      ) : listError ? null : logs.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No hay bitácoras {filter ? `${filter}s` : ''}.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {logs.map((log) => (
            <button key={log.id} onClick={() => onOpen(log.id)} className="glass-panel"
              style={{ textAlign: 'left', padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, cursor: 'pointer', border: 'none', width: '100%' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.92rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.casa}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  {log.contratista ? `${log.contratista} · ` : ''}Abierta {fmtDateTime(log.opened_at)}
                  {log.closed_at ? ` · Cerrada ${fmtDateTime(log.closed_at)}` : ''}
                </div>
              </div>
              <span style={{
                fontSize: '0.72rem', padding: '3px 10px', borderRadius: 10, fontWeight: 700, flexShrink: 0,
                background: log.status === 'abierta' ? '#10b98120' : '#64748b20',
                color: log.status === 'abierta' ? '#10b981' : '#64748b',
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}>
                {log.status === 'abierta' ? <Unlock size={11} /> : <Lock size={11} />}
                {log.status === 'abierta' ? 'Abierta' : 'Cerrada'}
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/* ───────────────────── Detalle de una bitácora ───────────────────── */
function LogDetailView({ logId, userEmail, onBack }: { logId: string; userEmail: string; onBack: () => void }) {
  const [log, setLog] = useState<LogDetail | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = async () => {
    setLoading(true);
    const r = await fetch(`/api/construction-logs/${logId}`);
    const j = await r.json();
    if (j.log) { setLog(j.log); setEntries(j.entries ?? []); }
    setLoading(false);
  };
  useEffect(() => { load(); }, [logId]);

  const toggleStatus = async () => {
    if (!log) return;
    const next = log.status === 'abierta' ? 'cerrada' : 'abierta';
    if (next === 'cerrada' && !confirm('¿Cerrar esta bitácora? No vas a poder agregar más entradas hasta reabrirla.')) return;
    const r = await fetch(`/api/construction-logs/${logId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    });
    const j = await r.json();
    if (j.log) { setLog(j.log); setMsg({ kind: 'success', text: next === 'cerrada' ? 'Bitácora cerrada' : 'Bitácora reabierta' }); }
  };

  const deleteEntry = async (entryId: string) => {
    if (!confirm('¿Borrar esta entrada y sus fotos? No se puede deshacer.')) return;
    const r = await fetch(`/api/construction-logs/${logId}/entries/${entryId}`, { method: 'DELETE' });
    if (r.ok) setEntries((prev) => prev.filter((e) => e.id !== entryId));
  };

  const exportPdf = async () => {
    if (!log) return;
    setExporting(true);
    try {
      const { generateConstructionLogPDF } = await import('@/lib/construction-log-pdf');
      await generateConstructionLogPDF(log, entries);
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Error generando PDF' });
    } finally { setExporting(false); }
  };

  if (loading) return <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Cargando…</p>;
  if (!log) return <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Bitácora no encontrada.</p>;

  return (
    <>
      <button onClick={onBack} className="secondary-btn" style={{ marginBottom: 14, fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <ArrowLeft size={14} /> Volver al listado
      </button>

      <div className="glass-panel" style={{ padding: 16, borderLeft: '4px solid #3b82f6', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <NotebookPen size={28} style={{ color: '#3b82f6', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{log.casa}</h2>
            <div style={{ marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {log.contratista && <span>{log.contratista}</span>}
              <span style={{
                padding: '2px 8px', borderRadius: 10, fontWeight: 700,
                background: log.status === 'abierta' ? '#10b98120' : '#64748b20',
                color: log.status === 'abierta' ? '#10b981' : '#64748b',
              }}>
                {log.status === 'abierta' ? 'Abierta' : 'Cerrada'}
              </span>
              <span>{entries.length} entrada{entries.length === 1 ? '' : 's'}</span>
            </div>
          </div>
          <button onClick={exportPdf} disabled={exporting} className="secondary-btn" style={{ fontSize: '0.82rem' }}>
            <FileDown size={14} /> {exporting ? 'Generando…' : 'PDF'}
          </button>
          <button onClick={toggleStatus} className="secondary-btn" style={{ fontSize: '0.82rem' }}>
            {log.status === 'abierta' ? <><Lock size={14} /> Cerrar</> : <><Unlock size={14} /> Reabrir</>}
          </button>
        </div>
      </div>

      {msg && (
        <div className={msg.kind === 'success' ? 'alert-success' : 'alert-error'} style={{ fontSize: '0.85rem' }}>{msg.text}</div>
      )}

      {log.status === 'abierta' && (
        showForm
          ? <EntryForm logId={logId} userEmail={userEmail} onSaved={(e) => { setEntries((prev) => [e, ...prev]); setShowForm(false); }} onCancel={() => setShowForm(false)} />
          : (
            <button onClick={() => setShowForm(true)} className="primary-btn" style={{ width: '100%', justifyContent: 'center', padding: '14px', fontSize: '0.95rem', fontWeight: 600, marginBottom: 16 }}>
              <Plus size={18} /> Agregar entrada de hoy
            </button>
          )
      )}
      {log.status === 'cerrada' && !showForm && (
        <div className="alert-warning" style={{ fontSize: '0.82rem', marginBottom: 16 }}>Bitácora cerrada — reábrela para agregar o editar entradas.</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {entries.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Sin entradas todavía.</p>}
        {entries.map((entry) => (
          editingEntryId === entry.id ? (
            <EntryForm key={entry.id} logId={logId} userEmail={userEmail} entry={entry}
              onSaved={(e) => { setEntries((prev) => prev.map((x) => x.id === entry.id ? { ...e, photos: entry.photos } : x)); setEditingEntryId(null); }}
              onCancel={() => setEditingEntryId(null)} />
          ) : (
            <EntryCard key={entry.id} entry={entry} logId={logId}
              canEdit={log.status === 'abierta'}
              onEdit={() => setEditingEntryId(entry.id)}
              onDelete={() => deleteEntry(entry.id)}
              onPhotosChange={(photos) => setEntries((prev) => prev.map((e) => e.id === entry.id ? { ...e, photos } : e))} />
          )
        ))}
      </div>
    </>
  );
}

/* ───────────────────── Form de entrada (nueva o edición) ───────────────────── */
function EntryForm({ logId, userEmail, entry, onSaved, onCancel }: {
  logId: string; userEmail: string; entry?: Entry; onSaved: (e: Entry) => void; onCancel: () => void;
}) {
  const isEdit = !!entry;
  const [entryDate, setEntryDate] = useState(entry?.entry_date ?? new Date().toISOString().slice(0, 10));
  const [etapa, setEtapa] = useState(entry?.etapa ?? '');
  const [clima, setClima] = useState(entry?.clima ?? '');
  const [descripcion, setDescripcion] = useState(entry?.descripcion ?? '');
  const [observaciones, setObservaciones] = useState(entry?.observaciones ?? '');
  const [lat, setLat] = useState<number | null>(entry?.lat ?? null);
  const [lng, setLng] = useState<number | null>(entry?.lng ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const captureGeo = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLat(pos.coords.latitude); setLng(pos.coords.longitude); },
      () => {},
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const submit = async () => {
    if (!descripcion.trim()) { setError('Describe el avance del día antes de guardar'); return; }
    setSaving(true);
    setError(null);
    try {
      const url = isEdit ? `/api/construction-logs/${logId}/entries/${entry!.id}` : `/api/construction-logs/${logId}/entries`;
      const body: Record<string, unknown> = {
        entry_date: entryDate, etapa: etapa || null, clima: clima || null,
        descripcion: descripcion.trim(), observaciones: observaciones.trim() || null, lat, lng,
      };
      if (!isEdit) body.created_by = userEmail;
      const r = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error ?? `Error al guardar (${r.status})`); return; }
      onSaved(j.entry);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo conectar con el servidor — revisa tu conexión e intenta de nuevo.');
    } finally { setSaving(false); }
  };

  return (
    <div className="glass-panel" style={{ padding: 16, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h3 style={{ margin: 0, fontSize: '0.92rem' }}>{isEdit ? 'Editar entrada' : 'Nueva entrada'}</h3>
      <div>
        <label className="input-label" style={{ fontSize: '0.78rem' }}>Fecha del avance</label>
        <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
      </div>
      <div>
        <label className="input-label" style={{ fontSize: '0.78rem' }}>Etapa del día</label>
        <select value={etapa} onChange={(e) => setEtapa(e.target.value)}>
          <option value="">— Selecciona —</option>
          {ETAPAS.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
      </div>
      <div>
        <label className="input-label" style={{ fontSize: '0.78rem' }}>Clima</label>
        <select value={clima} onChange={(e) => setClima(e.target.value)}>
          <option value="">— Selecciona —</option>
          {CLIMAS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div>
        <label className="input-label" style={{ fontSize: '0.78rem' }}>Descripción del avance del día *</label>
        <textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={4} placeholder="Qué se hizo hoy en la obra…" />
      </div>
      <div>
        <label className="input-label" style={{ fontSize: '0.78rem' }}>Pendientes / notas adicionales</label>
        <textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={2} />
      </div>
      <button type="button" onClick={captureGeo} className="secondary-btn" style={{ justifyContent: 'center' }}>
        <MapPin size={14} /> {lat && lng ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : 'Capturar ubicación GPS (opcional)'}
      </button>
      {error && <span style={{ fontSize: '0.75rem', color: '#ef4444' }}>{error}</span>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={submit} disabled={saving} className="primary-btn" style={{ flex: 1, justifyContent: 'center' }}>
          {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Guardar entrada'}
        </button>
        <button onClick={onCancel} className="secondary-btn" style={{ flex: 1, justifyContent: 'center' }}>Cancelar</button>
      </div>
    </div>
  );
}

/* ───────────────────── Tarjeta de una entrada + sus fotos ───────────────────── */
function EntryCard({ entry, logId, canEdit, onEdit, onDelete, onPhotosChange }: {
  entry: Entry; logId: string; canEdit: boolean; onEdit: () => void; onDelete: () => void; onPhotosChange: (photos: EntryPhoto[]) => void;
}) {
  const [category, setCategory] = useState('');
  const [uploading, setUploading] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const next = [...entry.photos];
      for (const file of Array.from(files)) {
        const { blob, filename } = await compressImageIfNeeded(file);
        const fd = new FormData();
        fd.append('file', blob, filename);
        if (category) fd.append('category', category);
        const r = await fetch(`/api/construction-logs/${logId}/entries/${entry.id}/photos`, { method: 'POST', body: fd });
        const j = await r.json();
        if (j.photo) next.push(j.photo);
      }
      onPhotosChange(next);
    } finally {
      setUploading(false);
      if (cameraRef.current) cameraRef.current.value = '';
      if (galleryRef.current) galleryRef.current.value = '';
    }
  };

  const deletePhoto = async (photoId: string) => {
    const r = await fetch(`/api/construction-logs/${logId}/entries/${entry.id}/photos?photo_id=${photoId}`, { method: 'DELETE' });
    if (r.ok) onPhotosChange(entry.photos.filter((p) => p.id !== photoId));
  };

  return (
    <div className="glass-panel" style={{ padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{fmtDate(entry.entry_date)}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
            Digitado {fmtDateTime(entry.created_at)}{entry.created_by ? ` · ${entry.created_by}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {canEdit && (
            <button onClick={onEdit} title="Editar entrada" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
              <Pencil size={15} />
            </button>
          )}
          <button onClick={onDelete} title="Borrar entrada" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0' }}>
        {entry.etapa && (
          <span style={{ fontSize: '0.72rem', padding: '3px 9px', borderRadius: 10, background: '#3b82f620', color: '#3b82f6', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Layers size={11} /> {entry.etapa}
          </span>
        )}
        {entry.clima && (
          <span style={{ fontSize: '0.72rem', padding: '3px 9px', borderRadius: 10, background: 'var(--bg-elevated)', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Cloud size={11} /> {entry.clima}
          </span>
        )}
        {entry.lat !== null && entry.lng !== null && (
          <a href={`https://www.google.com/maps?q=${entry.lat},${entry.lng}`} target="_blank" rel="noreferrer"
            style={{ fontSize: '0.72rem', padding: '3px 9px', borderRadius: 10, background: 'var(--bg-elevated)', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
            <MapPin size={11} /> Ver ubicación
          </a>
        )}
      </div>

      <p style={{ margin: '4px 0', fontSize: '0.86rem', whiteSpace: 'pre-wrap' }}>{entry.descripcion}</p>
      {entry.observaciones && (
        <p style={{ margin: '4px 0', fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
          <b>Pendientes:</b> {entry.observaciones}
        </p>
      )}

      {entry.photos.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8, marginTop: 10 }}>
          {entry.photos.map((p) => (
            <div key={p.id} style={{ position: 'relative', aspectRatio: '1/1', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
              {p.url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.url} alt={p.description ?? ''} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer' }} onClick={() => window.open(p.url ?? '', '_blank')} />
              )}
              <button onClick={() => deletePhoto(p.id)} title="Eliminar"
                style={{ position: 'absolute', top: 3, right: 3, background: 'rgba(0,0,0,0.7)', color: 'white', border: 'none', borderRadius: '50%', width: 20, height: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ fontSize: '0.78rem', minHeight: 34, flex: '1 1 160px' }}>
          <option value="">Categoría de foto…</option>
          {PHOTO_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple onChange={(e) => upload(e.target.files)} style={{ display: 'none' }} />
        <input ref={galleryRef} type="file" accept="image/*" multiple onChange={(e) => upload(e.target.files)} style={{ display: 'none' }} />
        <button onClick={() => cameraRef.current?.click()} disabled={uploading} className="secondary-btn" style={{ fontSize: '0.78rem', padding: '6px 10px' }}>
          <Camera size={13} /> Foto
        </button>
        <button onClick={() => galleryRef.current?.click()} disabled={uploading} className="secondary-btn" style={{ fontSize: '0.78rem', padding: '6px 10px' }}>
          <ImagePlus size={13} /> Galería
        </button>
      </div>
    </div>
  );
}
