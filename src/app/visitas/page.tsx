'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { ClipboardCheck, Plus, Camera, Save, Trash2, ChevronRight, Eye, X, MapPin } from 'lucide-react';
import { VISIT_SCHEMAS, findSchema, type VisitType, type VisitTypeSchema, type VisitField } from '@/lib/visit-schemas';

type Tab = VisitType | 'historial';

interface VisitListItem {
  id: string;
  visit_type: VisitType;
  casa: string | null;
  technician_name: string | null;
  visit_date: string;
  status: 'draft' | 'completed' | 'cancelled';
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface HouseRow { id: string; casa: string; location: string | null; }

const supa = () => createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export default function VisitasPage() {
  const [tab, setTab] = useState<Tab>('historial');
  const [activeVisitId, setActiveVisitId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>('');

  useEffect(() => {
    supa().auth.getUser().then(({ data }) => {
      if (data.user?.email) setUserEmail(data.user.email);
    });
  }, []);

  return (
    <div style={{ paddingBottom: 40 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <ClipboardCheck size={24} style={{ color: 'var(--accent)' }} />
        <h1 style={{ margin: 0 }}>Visitas en Campo</h1>
      </div>
      <p style={{ color: 'var(--text-secondary)', marginTop: 4, marginBottom: 16 }}>
        Registra y consulta las actas de visitas técnicas. Diseñado para celular.
      </p>

      {/* Tabs grandes para móvil */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {VISIT_SCHEMAS.map((s) => (
          <button key={s.type}
            onClick={() => { setTab(s.type); setActiveVisitId(null); }}
            className={`chip ${tab === s.type ? 'active' : ''}`}
            style={{ fontSize: '0.85rem', padding: '8px 14px', borderLeft: `4px solid ${s.color}` }}>
            <span style={{ marginRight: 4 }}>{s.icon}</span>{s.shortLabel}
          </button>
        ))}
        <button
          onClick={() => { setTab('historial'); setActiveVisitId(null); }}
          className={`chip ${tab === 'historial' ? 'active' : ''}`}
          style={{ fontSize: '0.85rem', padding: '8px 14px' }}>
          📚 Historial
        </button>
      </div>

      {tab !== 'historial' && (
        activeVisitId
          ? <VisitForm visitId={activeVisitId} schema={findSchema(tab)!} userEmail={userEmail} onBack={() => setActiveVisitId(null)} />
          : <VisitTypeView type={tab} userEmail={userEmail} onOpen={setActiveVisitId} />
      )}

      {tab === 'historial' && (
        activeVisitId
          ? <VisitForm visitId={activeVisitId} schema={findSchema('previa')!} userEmail={userEmail} onBack={() => setActiveVisitId(null)} loadOnMount />
          : <HistorialView onOpen={(id) => setActiveVisitId(id)} />
      )}
    </div>
  );
}

/* ───────────── Vista por tipo: lista reciente + botón Nueva ───────────── */
function VisitTypeView({ type, userEmail, onOpen }: { type: VisitType; userEmail: string; onOpen: (id: string) => void }) {
  const [items, setItems] = useState<VisitListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const schema = findSchema(type)!;

  const load = async () => {
    setLoading(true);
    const r = await fetch(`/api/visits?type=${type}&limit=20`);
    const j = await r.json();
    setItems(j.visits ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [type]);

  const createNew = async () => {
    setCreating(true);
    try {
      const r = await fetch('/api/visits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visit_type: type, technician_email: userEmail, status: 'draft' }),
      });
      const j = await r.json();
      if (j.visit?.id) onOpen(j.visit.id);
    } finally { setCreating(false); }
  };

  return (
    <>
      <div className="glass-panel" style={{ padding: 18, borderLeft: `4px solid ${schema.color}` }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <div style={{ fontSize: '2.2rem', lineHeight: 1 }}>{schema.icon}</div>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{schema.label}</h2>
            <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{schema.description}</p>
          </div>
        </div>
        <button
          onClick={createNew}
          disabled={creating}
          className="primary-btn"
          style={{ marginTop: 14, width: '100%', justifyContent: 'center', padding: '14px', fontSize: '1rem', fontWeight: 600 }}>
          <Plus size={18} /> {creating ? 'Creando...' : `Nueva ${schema.shortLabel}`}
        </button>
      </div>

      <div style={{ marginTop: 14, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
        Últimas {items.length} {schema.shortLabel.toLowerCase()}{items.length !== 1 ? 's' : ''}
      </div>
      {loading ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Cargando…</div>
      ) : items.length === 0 ? (
        <div className="alert-warning" style={{ fontSize: '0.85rem' }}>Aún no hay actas de este tipo. Crea la primera arriba.</div>
      ) : (
        items.map((it) => <VisitCard key={it.id} item={it} onClick={() => onOpen(it.id)} />)
      )}
    </>
  );
}

/* ───────────── Historial: todas las visitas ───────────── */
function HistorialView({ onOpen }: { onOpen: (id: string) => void }) {
  const [items, setItems] = useState<VisitListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<VisitType | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'draft' | 'completed'>('all');
  const [filterCasa, setFilterCasa] = useState<string>('');

  const load = async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '200' });
    if (filterType !== 'all') params.set('type', filterType);
    if (filterStatus !== 'all') params.set('status', filterStatus);
    if (filterCasa) params.set('casa', filterCasa);
    const r = await fetch(`/api/visits?${params}`);
    const j = await r.json();
    setItems(j.visits ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [filterType, filterStatus, filterCasa]);

  const grouped = useMemo(() => {
    const m = new Map<string, VisitListItem[]>();
    for (const it of items) {
      if (!m.has(it.visit_date)) m.set(it.visit_date, []);
      m.get(it.visit_date)!.push(it);
    }
    return Array.from(m.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [items]);

  return (
    <>
      <div className="glass-panel" style={{ padding: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          <button className={`chip ${filterType === 'all' ? 'active' : ''}`} onClick={() => setFilterType('all')}>Todas</button>
          {VISIT_SCHEMAS.map((s) => (
            <button key={s.type} className={`chip ${filterType === s.type ? 'active' : ''}`} onClick={() => setFilterType(s.type)}>
              {s.icon} {s.shortLabel}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          <button className={`chip ${filterStatus === 'all' ? 'active' : ''}`} onClick={() => setFilterStatus('all')}>Todos los estados</button>
          <button className={`chip ${filterStatus === 'draft' ? 'active' : ''}`} onClick={() => setFilterStatus('draft')}>📝 Borrador</button>
          <button className={`chip ${filterStatus === 'completed' ? 'active' : ''}`} onClick={() => setFilterStatus('completed')}>✅ Completadas</button>
        </div>
        <input
          type="text"
          placeholder="Filtrar por casa (ej: Casa 10)"
          value={filterCasa}
          onChange={(e) => setFilterCasa(e.target.value)}
          style={{ width: '100%' }}
        />
      </div>

      {loading ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Cargando…</div>
      ) : items.length === 0 ? (
        <div className="alert-warning" style={{ fontSize: '0.85rem' }}>Sin visitas para los filtros actuales.</div>
      ) : (
        grouped.map(([date, list]) => (
          <div key={date} style={{ marginTop: 14 }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 6, padding: '0 4px' }}>
              {date} <span style={{ fontWeight: 400 }}>· {list.length} visita{list.length !== 1 ? 's' : ''}</span>
            </div>
            {list.map((it) => <VisitCard key={it.id} item={it} onClick={() => onOpen(it.id)} />)}
          </div>
        ))
      )}
    </>
  );
}

/* ───────────── Card resumen de una visita ───────────── */
function VisitCard({ item, onClick }: { item: VisitListItem; onClick: () => void }) {
  const schema = findSchema(item.visit_type)!;
  const statusBadge = item.status === 'completed'
    ? { label: '✅ Completada', color: '#10b981' }
    : item.status === 'cancelled'
      ? { label: '❌ Cancelada', color: '#94a3b8' }
      : { label: '📝 Borrador', color: '#f59e0b' };

  return (
    <button
      onClick={onClick}
      className="glass-panel"
      style={{ width: '100%', textAlign: 'left', padding: 14, marginTop: 10, cursor: 'pointer', border: 'none', display: 'flex', alignItems: 'center', gap: 12, borderLeft: `4px solid ${schema.color}` }}>
      <div style={{ fontSize: '1.6rem', lineHeight: 1, flexShrink: 0 }}>{schema.icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: '0.95rem' }}>{schema.shortLabel}</strong>
          <span style={{ fontSize: '0.7rem', padding: '1px 8px', borderRadius: 10, background: statusBadge.color + '20', color: statusBadge.color, fontWeight: 700 }}>{statusBadge.label}</span>
        </div>
        <div style={{ marginTop: 4, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          {item.casa ?? <em style={{ color: 'var(--text-muted)' }}>(sin casa asignada)</em>}
          {item.technician_name && <> · {item.technician_name}</>}
        </div>
        <div style={{ marginTop: 4, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          {item.visit_date} · creada {new Date(item.created_at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}
        </div>
      </div>
      <ChevronRight size={18} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
    </button>
  );
}

/* ───────────── Formulario de una visita ───────────── */
interface VisitFull {
  id: string;
  visit_type: VisitType;
  house_id: string | null;
  casa: string | null;
  technician_name: string | null;
  technician_email: string | null;
  visit_date: string;
  visit_time: string | null;
  status: 'draft' | 'completed' | 'cancelled';
  form_data: Record<string, unknown>;
  notes: string | null;
  lat: number | null;
  lng: number | null;
}

interface Photo {
  id: string;
  storage_path: string;
  filename: string | null;
  description: string | null;
  url: string | null;
  uploaded_at: string;
}

function VisitForm({ visitId, schema: schemaProp, userEmail, onBack, loadOnMount }: {
  visitId: string;
  schema: VisitTypeSchema;
  userEmail: string;
  onBack: () => void;
  loadOnMount?: boolean;
}) {
  const [visit, setVisit] = useState<VisitFull | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [houses, setHouses] = useState<HouseRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Usa el schema del visit cargado en lugar del prop si difiere
  const schema = visit ? findSchema(visit.visit_type) ?? schemaProp : schemaProp;

  const load = async () => {
    const r = await fetch(`/api/visits/${visitId}`);
    const j = await r.json();
    setVisit(j.visit);
    setPhotos(j.photos ?? []);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [visitId, loadOnMount]);

  useEffect(() => {
    supa().from('client_houses').select('id, casa, location').order('casa').then(({ data }) => {
      setHouses((data ?? []) as HouseRow[]);
    });
  }, []);

  if (!visit || !schema) {
    return <div className="glass-panel" style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>Cargando visita…</div>;
  }

  const setField = (key: string, value: unknown) => {
    setVisit((v) => v ? { ...v, form_data: { ...v.form_data, [key]: value } } : v);
  };

  const save = async (finalize = false) => {
    if (!visit) return;
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/visits/${visitId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          casa: visit.casa, house_id: visit.house_id,
          technician_name: visit.technician_name, technician_email: visit.technician_email || userEmail,
          visit_date: visit.visit_date, visit_time: visit.visit_time,
          form_data: visit.form_data, notes: visit.notes,
          lat: visit.lat, lng: visit.lng,
          status: finalize ? 'completed' : 'draft',
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Error');
      setVisit(j.visit);
      setMsg({ kind: 'success', text: finalize ? '✅ Acta marcada como completada' : '💾 Guardado' });
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Error al guardar' });
    } finally { setSaving(false); }
  };

  const handlePhotoUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setMsg(null);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('uploaded_by', userEmail || 'unknown');
        const r = await fetch(`/api/visits/${visitId}/photos`, { method: 'POST', body: fd });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? 'Error subiendo foto');
        setPhotos((prev) => [...prev, j.photo]);
      }
      setMsg({ kind: 'success', text: `📸 ${files.length} foto${files.length !== 1 ? 's' : ''} subida${files.length !== 1 ? 's' : ''}` });
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Error subiendo' });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const deletePhoto = async (photoId: string) => {
    if (!confirm('¿Eliminar esta foto?')) return;
    const r = await fetch(`/api/visits/${visitId}/photos?photo_id=${photoId}`, { method: 'DELETE' });
    if (r.ok) setPhotos((prev) => prev.filter((p) => p.id !== photoId));
  };

  const deleteVisit = async () => {
    if (!confirm('¿Eliminar esta acta? Esta acción NO se puede deshacer.')) return;
    const r = await fetch(`/api/visits/${visitId}`, { method: 'DELETE' });
    if (r.ok) onBack();
  };

  const captureGeo = () => {
    if (!navigator.geolocation) { setMsg({ kind: 'error', text: 'GPS no disponible en este dispositivo' }); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setVisit((v) => v ? { ...v, lat: pos.coords.latitude, lng: pos.coords.longitude } : v);
        setMsg({ kind: 'success', text: `📍 GPS guardado (${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)})` });
      },
      (err) => setMsg({ kind: 'error', text: `GPS error: ${err.message}` }),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  return (
    <>
      {/* Header sticky */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-base)', padding: '8px 0', marginBottom: 10 }}>
        <button onClick={onBack} className="secondary-btn" style={{ fontSize: '0.85rem' }}>← Volver</button>
      </div>

      <div className="glass-panel" style={{ padding: 16, borderLeft: `4px solid ${schema.color}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: '2rem' }}>{schema.icon}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{schema.label}</h2>
            <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 10, background: (visit.status === 'completed' ? '#10b98120' : '#f59e0b20'), color: visit.status === 'completed' ? '#10b981' : '#f59e0b', fontWeight: 700 }}>
              {visit.status === 'completed' ? '✅ Completada' : '📝 Borrador'}
            </span>
          </div>
        </div>
      </div>

      {msg && (
        <div className={msg.kind === 'success' ? 'alert-success' : msg.kind === 'error' ? 'alert-error' : 'alert-warning'} style={{ fontSize: '0.85rem' }}>
          {msg.text}
        </div>
      )}

      {/* Sección 0: identificación general */}
      <div className="glass-panel">
        <h3 style={{ margin: 0, marginBottom: 12, fontSize: '0.95rem' }}>📌 Identificación</h3>
        <div className="input-group">
          <label className="input-label">Casa</label>
          <select value={visit.house_id ?? ''} onChange={(e) => {
            const h = houses.find((x) => x.id === e.target.value);
            setVisit((v) => v ? { ...v, house_id: h?.id ?? null, casa: h?.casa ?? null } : v);
          }}>
            <option value="">— Sin asociar —</option>
            {houses.map((h) => <option key={h.id} value={h.id}>{h.casa}{h.location ? ` · ${h.location}` : ''}</option>)}
          </select>
        </div>
        <div className="input-group">
          <label className="input-label">Técnico que realiza la visita</label>
          <input type="text" value={visit.technician_name ?? ''} onChange={(e) => setVisit((v) => v ? { ...v, technician_name: e.target.value } : v)} placeholder="Nombre completo" />
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div className="input-group" style={{ flex: 1 }}>
            <label className="input-label">Fecha</label>
            <input type="date" value={visit.visit_date} onChange={(e) => setVisit((v) => v ? { ...v, visit_date: e.target.value } : v)} />
          </div>
          <div className="input-group" style={{ flex: 1 }}>
            <label className="input-label">Hora</label>
            <input type="time" value={visit.visit_time ?? ''} onChange={(e) => setVisit((v) => v ? { ...v, visit_time: e.target.value } : v)} />
          </div>
        </div>
        <button onClick={captureGeo} className="secondary-btn" style={{ width: '100%', justifyContent: 'center' }}>
          <MapPin size={14} /> {visit.lat && visit.lng ? `📍 GPS: ${visit.lat.toFixed(4)}, ${visit.lng.toFixed(4)}` : 'Capturar ubicación GPS'}
        </button>
      </div>

      {/* Secciones del schema */}
      {schema.sections.map((sec) => (
        <FormSection key={sec.title} section={sec} formData={visit.form_data} setField={setField} />
      ))}

      {/* Notas adicionales */}
      <div className="glass-panel">
        <h3 style={{ margin: 0, marginBottom: 12, fontSize: '0.95rem' }}>📝 Notas adicionales</h3>
        <textarea
          value={visit.notes ?? ''}
          onChange={(e) => setVisit((v) => v ? { ...v, notes: e.target.value } : v)}
          rows={4} style={{ width: '100%' }} placeholder="Cualquier observación que no quepa en los campos anteriores…" />
      </div>

      {/* Fotos */}
      <div className="glass-panel">
        <h3 style={{ margin: 0, marginBottom: 12, fontSize: '0.95rem' }}>📸 Fotos ({photos.length})</h3>
        <input ref={fileInputRef} type="file" accept="image/*" capture="environment" multiple
          onChange={(e) => handlePhotoUpload(e.target.files)}
          style={{ display: 'none' }} />
        <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
          className="primary-btn" style={{ width: '100%', justifyContent: 'center', padding: '14px', fontSize: '1rem' }}>
          <Camera size={18} /> {uploading ? 'Subiendo...' : 'Tomar / subir fotos'}
        </button>
        {photos.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8, marginTop: 12 }}>
            {photos.map((p) => (
              <div key={p.id} style={{ position: 'relative', aspectRatio: '1/1', borderRadius: 10, overflow: 'hidden', background: 'var(--bg-elevated)' }}>
                {p.url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.url} alt={p.filename ?? ''} style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer' }}
                    onClick={() => window.open(p.url ?? '', '_blank')} />
                )}
                <button onClick={() => deletePhoto(p.id)}
                  style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.7)', color: 'white', border: 'none', borderRadius: '50%', width: 24, height: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  title="Eliminar">
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Botones de acción — sticky bottom */}
      <div style={{ position: 'sticky', bottom: 0, zIndex: 10, background: 'var(--bg-base)', padding: '12px 0 4px', marginTop: 16, borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => save(false)} disabled={saving} className="secondary-btn" style={{ flex: 1, minWidth: 140, justifyContent: 'center', padding: '14px' }}>
            <Save size={16} /> Guardar borrador
          </button>
          {visit.status !== 'completed' && (
            <button onClick={() => save(true)} disabled={saving} className="primary-btn" style={{ flex: 2, minWidth: 180, justifyContent: 'center', padding: '14px', fontWeight: 600 }}>
              <Eye size={16} /> Marcar completada
            </button>
          )}
        </div>
        <button onClick={deleteVisit} style={{ marginTop: 8, width: '100%', background: 'transparent', color: '#ef4444', border: '1px solid #ef444440', borderRadius: 8, padding: 10, cursor: 'pointer', fontSize: '0.82rem' }}>
          <Trash2 size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Eliminar acta
        </button>
      </div>
    </>
  );
}

/* ───────────── Sección con sus campos ───────────── */
function FormSection({ section, formData, setField }: {
  section: { title: string; icon?: string; fields: VisitField[] };
  formData: Record<string, unknown>;
  setField: (key: string, value: unknown) => void;
}) {
  return (
    <div className="glass-panel">
      <h3 style={{ margin: 0, marginBottom: 14, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: 6 }}>
        {section.icon && <span style={{ fontSize: '1.1rem' }}>{section.icon}</span>}
        {section.title}
      </h3>
      {section.fields.map((f) => <FieldInput key={f.key} field={f} value={formData[f.key]} onChange={(v) => setField(f.key, v)} />)}
    </div>
  );
}

/* ───────────── Render de un campo individual ───────────── */
function FieldInput({ field, value, onChange }: { field: VisitField; value: unknown; onChange: (v: unknown) => void }) {
  const v = value ?? (field.type === 'checkbox' ? false : '');

  return (
    <div className="input-group" style={{ marginBottom: 14 }}>
      <label className="input-label" style={{ fontSize: '0.78rem', fontWeight: 600 }}>
        {field.label} {field.required && <span style={{ color: '#ef4444' }}>*</span>}
        {field.unit && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> ({field.unit})</span>}
      </label>
      {field.help && <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '0 0 6px', lineHeight: 1.4 }}>{field.help}</p>}

      {field.type === 'textarea' ? (
        <textarea value={String(v)} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} rows={3} style={{ width: '100%' }} />
      ) : field.type === 'select' ? (
        <select value={String(v)} onChange={(e) => onChange(e.target.value)}>
          <option value="">— Selecciona —</option>
          {field.options?.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      ) : field.type === 'radio' ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {field.options?.map((opt) => (
            <button key={opt} type="button"
              onClick={() => onChange(opt)}
              className={`chip ${v === opt ? 'active' : ''}`}
              style={{ fontSize: '0.82rem', padding: '8px 14px' }}>
              {opt}
            </button>
          ))}
        </div>
      ) : field.type === 'checkbox' ? (
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '8px 12px', background: v ? 'var(--accent)' + '20' : 'var(--bg-elevated)', borderRadius: 8, border: `1px solid ${v ? 'var(--accent)' : 'var(--border)'}` }}>
          <input type="checkbox" checked={!!v} onChange={(e) => onChange(e.target.checked)} style={{ width: 20, height: 20, cursor: 'pointer' }} />
          <span style={{ fontSize: '0.88rem' }}>{v ? 'Sí ✓' : 'Marcar como sí'}</span>
        </label>
      ) : (
        <input
          type={field.type === 'tel' || field.type === 'email' ? field.type : (field.type === 'number' ? 'text' : field.type)}
          inputMode={field.inputMode}
          value={String(v)}
          onChange={(e) => onChange(field.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value.replace(',', '.'))) : e.target.value)}
          placeholder={field.placeholder}
          required={field.required}
          style={{ width: '100%', minHeight: 44 }}
        />
      )}
    </div>
  );
}
