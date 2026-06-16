'use client';

import { useEffect, useState, useMemo, useRef, useCallback, memo } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { ClipboardCheck, Plus, Camera, Save, Trash2, ChevronRight, ChevronDown, FileDown, ArrowLeft, X, MapPin, FileText, History, AlertOctagon, Settings2, Wrench, Pencil, ImagePlus, Check, ExternalLink } from 'lucide-react';
import { VISIT_SCHEMAS, findSchema, type VisitType, type VisitTypeSchema, type VisitField } from '@/lib/visit-schemas';
import { generateVisitPDF, type VisitPDFData, type VisitPhoto } from '@/lib/visit-pdf';

const VISIT_ICONS: Record<VisitType, typeof FileText> = {
  previa: FileText,
  instalacion: Wrench,
  emergencia: AlertOctagon,
  normalizacion: Settings2,
};

type Tab = VisitType | 'historial';

interface VisitListItem {
  id: string;
  visit_type: VisitType;
  casa: string | null;
  technician_name: string | null;
  contratista: string | null;
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

/**
 * Comprime una imagen del teléfono a un tamaño razonable antes de subirla.
 * Las fotos de cámara modernas pesan 3-10 MB; comprimidas a 1920px JPEG 85%
 * quedan en ~300-600 KB sin pérdida visible. Esto hace los uploads en mobile
 * 10x más rápidos y evita que la app se sienta congelada.
 *
 * Si el archivo NO es imagen, o ya es <500 KB, lo devuelve tal cual.
 */
async function compressImageIfNeeded(file: File, maxDim = 1920, quality = 0.85): Promise<{ blob: Blob; filename: string }> {
  if (!file.type.startsWith('image/') || file.size < 500_000) {
    return { blob: file, filename: file.name };
  }
  try {
    const dataUrl: string = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(r.error ?? new Error('FileReader fail'));
      r.readAsDataURL(file);
    });
    const img: HTMLImageElement = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('image decode fail'));
      i.src = dataUrl;
    });
    let { width, height } = img;
    if (width > maxDim || height > maxDim) {
      const scale = maxDim / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { blob: file, filename: file.name };
    ctx.drawImage(img, 0, 0, width, height);
    const blob: Blob | null = await new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', quality);
    });
    if (!blob || blob.size >= file.size) return { blob: file, filename: file.name };
    const filename = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return { blob, filename };
  } catch {
    return { blob: file, filename: file.name };
  }
}

// Determina si un campo se renderiza ancho completo (textarea, radios con muchas opciones, etc.)
const isFullWidthField = (f: VisitField) => {
  if (f.type === 'textarea') return true;
  if (f.type === 'radio' && (f.options?.length ?? 0) > 3) return true;
  return false;
};

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
    <div style={{ maxWidth: 980, margin: '0 auto', paddingBottom: 60 }}>
      {/* HEADER */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ClipboardCheck size={24} style={{ color: 'var(--accent)' }} />
          <h1 style={{ margin: 0 }}>Visitas en Campo</h1>
        </div>
        <p style={{ color: 'var(--text-secondary)', marginTop: 4, fontSize: '0.88rem' }}>
          Registra y consulta las actas de visitas técnicas. Optimizado para celular.
        </p>
      </div>

      {/* TABS — primary navigation */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
        {VISIT_SCHEMAS.map((s) => {
          const Icon = VISIT_ICONS[s.type];
          const active = tab === s.type;
          return (
            <button key={s.type}
              onClick={() => { setTab(s.type); setActiveVisitId(null); }}
              className={`chip ${active ? 'active' : ''}`}
              style={{ fontSize: '0.85rem', padding: '10px 14px', borderLeft: `4px solid ${s.color}`, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon size={14} /> {s.shortLabel}
            </button>
          );
        })}
        <button
          onClick={() => { setTab('historial'); setActiveVisitId(null); }}
          className={`chip ${tab === 'historial' ? 'active' : ''}`}
          style={{ fontSize: '0.85rem', padding: '10px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <History size={14} /> Historial
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
          : <HistorialTable onOpen={(id) => setActiveVisitId(id)} />
      )}
    </div>
  );
}

/* ───────────────────── Vista por tipo ───────────────────── */
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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visit_type: type, technician_email: userEmail, status: 'draft' }),
      });
      const j = await r.json();
      if (j.visit?.id) onOpen(j.visit.id);
    } finally { setCreating(false); }
  };

  return (
    <>
      <div className="glass-panel" style={{ padding: 22, borderLeft: `4px solid ${schema.color}` }}>
        <h2 style={{ margin: 0, fontSize: '1.15rem' }}>{schema.label}</h2>
        <p style={{ margin: '6px 0 14px', color: 'var(--text-secondary)', fontSize: '0.88rem' }}>{schema.description}</p>
        <button onClick={createNew} disabled={creating} className="primary-btn"
          style={{ width: '100%', justifyContent: 'center', padding: '14px', fontSize: '0.95rem', fontWeight: 600 }}>
          <Plus size={18} /> {creating ? 'Creando…' : `Nueva ${schema.shortLabel.toLowerCase()}`}
        </button>
      </div>

      <div style={{ marginTop: 18, marginBottom: 8, fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        Últimas {items.length} {schema.shortLabel.toLowerCase()}{items.length !== 1 ? 's' : ''}
      </div>
      {loading ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Cargando…</div>
      ) : items.length === 0 ? (
        <div className="alert-warning" style={{ fontSize: '0.85rem' }}>Aún no hay actas de este tipo.</div>
      ) : (
        items.map((it) => <VisitCard key={it.id} item={it} onClick={() => onOpen(it.id)} />)
      )}
    </>
  );
}

/* ───────────────────── Tabla del Historial ───────────────────── */
function HistorialTable({ onOpen }: { onOpen: (id: string) => void }) {
  const [items, setItems] = useState<VisitListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<VisitType | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'draft' | 'completed'>('all');
  const [filterCasa, setFilterCasa] = useState<string>('');
  const [filterFrom, setFilterFrom] = useState<string>('');
  const [filterTo, setFilterTo] = useState<string>('');
  const [filterContratista, setFilterContratista] = useState<string>('');
  const [filterTechnician, setFilterTechnician] = useState<string>('');
  const [zipBusy, setZipBusy] = useState(false);
  const [zipProgress, setZipProgress] = useState<{ done: number; total: number } | null>(null);

  const load = async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '500' });
    if (filterType !== 'all') params.set('type', filterType);
    if (filterStatus !== 'all') params.set('status', filterStatus);
    if (filterCasa) params.set('casa', filterCasa);
    if (filterFrom) params.set('from', filterFrom);
    if (filterTo) params.set('to', filterTo);
    if (filterContratista) params.set('contratista', filterContratista);
    if (filterTechnician) params.set('technician', filterTechnician);
    const r = await fetch(`/api/visits?${params}`);
    const j = await r.json();
    setItems(j.visits ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [filterType, filterStatus, filterCasa, filterFrom, filterTo, filterContratista, filterTechnician]);

  const handleDownloadPDF = async (id: string) => {
    try {
      const r = await fetch(`/api/visits/${id}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Error');
      await generateVisitPDF(j.visit as VisitPDFData, (j.photos ?? []) as VisitPhoto[]);
    } catch (e) {
      alert('Error generando PDF: ' + (e instanceof Error ? e.message : 'desconocido'));
    }
  };

  // Descarga masiva: empaqueta cada acta completada (de las filtradas) en su PDF
  // y junta todo en un .zip. JSZip se carga lazy (1ª vez ~50KB) para no inflar el bundle.
  const handleDownloadZip = async () => {
    const completed = items.filter((it) => it.status === 'completed');
    if (completed.length === 0) {
      alert('No hay actas completadas en los filtros actuales.');
      return;
    }
    if (!confirm(`Se generará un .zip con ${completed.length} acta(s) en PDF. Puede tardar 1-2 min. ¿Continuar?`)) return;

    setZipBusy(true);
    setZipProgress({ done: 0, total: completed.length });
    try {
      const { default: JSZip } = await import('jszip');
      const { buildVisitPDFBlob } = await import('@/lib/visit-pdf');
      const zip = new JSZip();
      let done = 0;
      for (const it of completed) {
        try {
          const r = await fetch(`/api/visits/${it.id}`);
          const j = await r.json();
          if (!r.ok) throw new Error(j.error ?? 'fetch fallo');
          const { blob, filename } = await buildVisitPDFBlob(j.visit as VisitPDFData, (j.photos ?? []) as VisitPhoto[]);
          zip.file(filename, blob);
        } catch (e) {
          console.error(`Acta ${it.id} fallida:`, e);
        }
        done++;
        setZipProgress({ done, total: completed.length });
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `actas-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Error generando ZIP: ' + (e instanceof Error ? e.message : 'desconocido'));
    } finally {
      setZipBusy(false);
      setZipProgress(null);
    }
  };

  const clearFilters = () => {
    setFilterType('all');
    setFilterStatus('all');
    setFilterCasa('');
    setFilterFrom('');
    setFilterTo('');
    setFilterContratista('');
    setFilterTechnician('');
  };
  const hasActiveFilters = filterType !== 'all' || filterStatus !== 'all' || filterCasa || filterFrom || filterTo || filterContratista || filterTechnician;
  const completedCount = items.filter((it) => it.status === 'completed').length;

  const handleDelete = async (item: VisitListItem) => {
    const label = `${findSchema(item.visit_type)?.shortLabel ?? item.visit_type}${item.casa ? ' · ' + item.casa : ''}`;
    if (!confirm(`¿Eliminar el acta "${label}" del ${item.visit_date}?\n\nEsto borra también todas sus fotos. NO se puede deshacer.`)) return;
    const r = await fetch(`/api/visits/${item.id}`, { method: 'DELETE' });
    if (r.ok) {
      setItems((prev) => prev.filter((v) => v.id !== item.id));
    } else {
      const j = await r.json().catch(() => ({}));
      alert('Error eliminando: ' + (j.error ?? 'desconocido'));
    }
  };

  return (
    <>
      {/* Filtros */}
      <div className="glass-panel" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Tipo</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
          <button className={`chip ${filterType === 'all' ? 'active' : ''}`} onClick={() => setFilterType('all')}>Todas</button>
          {VISIT_SCHEMAS.map((s) => {
            const Icon = VISIT_ICONS[s.type];
            return (
              <button key={s.type} className={`chip ${filterType === s.type ? 'active' : ''}`} onClick={() => setFilterType(s.type)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Icon size={12} /> {s.shortLabel}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 14, alignItems: 'flex-end' }}>
          <div style={{ flex: '0 0 auto' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Estado</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className={`chip ${filterStatus === 'all' ? 'active' : ''}`} onClick={() => setFilterStatus('all')}>Todos</button>
              <button className={`chip ${filterStatus === 'draft' ? 'active' : ''}`} onClick={() => setFilterStatus('draft')}>Borradores</button>
              <button className={`chip ${filterStatus === 'completed' ? 'active' : ''}`} onClick={() => setFilterStatus('completed')}>Completadas</button>
            </div>
          </div>

          <div style={{ flex: '1 1 220px', minWidth: 220 }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Rango de fechas</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="date" value={filterFrom} max={filterTo || undefined} onChange={(e) => setFilterFrom(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>→</span>
              <input type="date" value={filterTo} min={filterFrom || undefined} onChange={(e) => setFilterTo(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginBottom: 14 }}>
          <input type="text" placeholder="Buscar por casa…" value={filterCasa} onChange={(e) => setFilterCasa(e.target.value)} />
          <input type="text" placeholder="Contratista (empresa)…" value={filterContratista} onChange={(e) => setFilterContratista(e.target.value)} />
          <input type="text" placeholder="Quien llena el acta (técnico)…" value={filterTechnician} onChange={(e) => setFilterTechnician(e.target.value)} />
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {items.length} resultado{items.length === 1 ? '' : 's'} · {completedCount} completada{completedCount === 1 ? '' : 's'}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {hasActiveFilters && (
              <button onClick={clearFilters} className="chip" style={{ fontSize: '0.78rem', padding: '6px 10px' }}>
                Limpiar filtros
              </button>
            )}
            <button
              onClick={handleDownloadZip}
              disabled={zipBusy || completedCount === 0}
              className="primary-btn"
              style={{ fontSize: '0.82rem', padding: '6px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              title={completedCount === 0 ? 'No hay actas completadas en los filtros' : `Descargar ${completedCount} acta(s) completadas en .zip`}
            >
              <FileDown size={14} />
              {zipBusy && zipProgress
                ? `Generando… ${zipProgress.done}/${zipProgress.total}`
                : `Descargar ${completedCount} acta(s) en ZIP`}
            </button>
          </div>
        </div>
      </div>

      {/* Tabla en desktop / cards en móvil */}
      {loading ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Cargando…</div>
      ) : items.length === 0 ? (
        <div className="alert-warning" style={{ fontSize: '0.85rem' }}>Sin actas para los filtros actuales.</div>
      ) : (
        <>
          {/* Desktop: tabla */}
          <div className="glass-panel hist-desktop" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: '0.82rem' }}>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Tipo</th>
                    <th>Fecha</th>
                    <th>Casa</th>
                    <th>Realizado por</th>
                    <th>Estado</th>
                    <th style={{ width: 110, textAlign: 'right' }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => {
                    const schema = findSchema(it.visit_type)!;
                    const Icon = VISIT_ICONS[it.visit_type];
                    const shortId = it.id.slice(0, 8).toUpperCase();
                    const statusColor = it.status === 'completed' ? '#10b981' : it.status === 'cancelled' ? '#94a3b8' : '#f59e0b';
                    const statusLabel = it.status === 'completed' ? 'Completada' : it.status === 'cancelled' ? 'Cancelada' : 'Borrador';
                    return (
                      <tr key={it.id} style={{ borderLeft: `3px solid ${schema.color}` }}>
                        <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{shortId}</td>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}>
                            <Icon size={14} style={{ color: schema.color }} /> {schema.shortLabel}
                          </span>
                        </td>
                        <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem' }}>{it.visit_date}</td>
                        <td><strong>{it.casa ?? <em style={{ color: 'var(--text-muted)' }}>sin casa</em>}</strong></td>
                        <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{it.technician_name ?? '—'}</td>
                        <td>
                          <span style={{ padding: '2px 10px', borderRadius: 10, background: statusColor + '20', color: statusColor, fontSize: '0.7rem', fontWeight: 700 }}>{statusLabel}</span>
                        </td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button onClick={() => handleDownloadPDF(it.id)} title="Descargar PDF"
                            style={{ padding: 6, background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', borderRadius: 4 }}>
                            <FileDown size={16} />
                          </button>
                          <button onClick={() => onOpen(it.id)} title="Ver / Editar"
                            style={{ padding: 6, background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', borderRadius: 4 }}>
                            <Pencil size={16} />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); handleDelete(it); }} title="Eliminar"
                            style={{ padding: 6, background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', borderRadius: 4 }}>
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile: cards */}
          <div className="hist-mobile">
            {items.map((it) => <VisitCard key={it.id} item={it} onClick={() => onOpen(it.id)} />)}
          </div>
        </>
      )}
      <style jsx>{`
        .hist-desktop { display: block; }
        .hist-mobile { display: none; }
        @media (max-width: 768px) {
          .hist-desktop { display: none; }
          .hist-mobile { display: block; }
        }
      `}</style>
    </>
  );
}

/* ───────────── Card resumen (usado solo en mobile y en TypeView) ───────────── */
function VisitCard({ item, onClick }: { item: VisitListItem; onClick: () => void }) {
  const schema = findSchema(item.visit_type)!;
  const Icon = VISIT_ICONS[item.visit_type];
  const statusColor = item.status === 'completed' ? '#10b981' : item.status === 'cancelled' ? '#94a3b8' : '#f59e0b';
  const statusLabel = item.status === 'completed' ? 'Completada' : item.status === 'cancelled' ? 'Cancelada' : 'Borrador';
  return (
    <button onClick={onClick} className="glass-panel"
      style={{ width: '100%', textAlign: 'left', padding: 14, marginTop: 10, cursor: 'pointer', border: 'none', display: 'flex', alignItems: 'center', gap: 12, borderLeft: `4px solid ${schema.color}` }}>
      <Icon size={22} style={{ color: schema.color, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: '0.95rem' }}>{schema.shortLabel}</strong>
          <span style={{ fontSize: '0.7rem', padding: '1px 8px', borderRadius: 10, background: statusColor + '20', color: statusColor, fontWeight: 700 }}>{statusLabel}</span>
        </div>
        <div style={{ marginTop: 4, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          {item.casa ?? <em style={{ color: 'var(--text-muted)' }}>(sin casa)</em>}{item.technician_name && <> · {item.technician_name}</>}
        </div>
        <div style={{ marginTop: 4, fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace' }}>
          {item.visit_date} · ID {item.id.slice(0, 8).toUpperCase()}
        </div>
      </div>
      <ChevronRight size={18} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
    </button>
  );
}

/* ───────────────────── Formulario de visita ───────────────────── */
interface VisitFull {
  id: string;
  visit_type: VisitType;
  house_id: string | null;
  casa: string | null;
  technician_name: string | null;
  technician_email: string | null;
  contratista: string | null;
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
  const [photoCategory, setPhotoCategory] = useState<string>('');
  const [customCategory, setCustomCategory] = useState<string>('');
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const schema = visit ? findSchema(visit.visit_type) ?? schemaProp : schemaProp;

  // Re-inicializa al cambiar de visita: primera sección abierta, demás cerradas.
  // Importante resetear: las section keys son distintas entre tipos de visita, no deben filtrarse.
  useEffect(() => {
    if (!visit || !schema) return;
    const init: Record<string, boolean> = { __ident: true };
    schema.sections.forEach((s, i) => { init[s.title] = i === 0; });
    setOpenSections(init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visit?.id, visit?.visit_type]);

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

  // setField estable: identidad no cambia entre renders. IMPORTANTE: este hook
  // DEBE estar antes de cualquier early return — Rules of Hooks: el orden de
  // hooks debe ser consistente en cada render. Si visit es null al inicio y
  // luego se carga, mover esto debajo del early return causa React error #310
  // ("Rendered fewer hooks than expected") y la app crashea.
  const setField = useCallback((key: string, value: unknown) => {
    setVisit((v) => v ? { ...v, form_data: { ...v.form_data, [key]: value } } : v);
  }, []);

  if (!visit || !schema) {
    return <div className="glass-panel" style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>Cargando visita…</div>;
  }

  const save = async (finalize = false) => {
    if (!visit) return;
    setSaving(true); setMsg(null);
    try {
      const r = await fetch(`/api/visits/${visitId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          casa: visit.casa, house_id: visit.house_id,
          technician_name: visit.technician_name, technician_email: visit.technician_email || userEmail,
          contratista: visit.contratista,
          visit_date: visit.visit_date, visit_time: visit.visit_time,
          form_data: visit.form_data, notes: visit.notes,
          lat: visit.lat, lng: visit.lng,
          status: finalize ? 'completed' : visit.status,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Error');
      setVisit(j.visit);
      const linked = j.inventoryLink?.linked ?? [];
      const okMsg = finalize
        ? linked.length > 0
          ? `Acta completada · ${linked.length} equipo${linked.length === 1 ? '' : 's'} enlazado${linked.length === 1 ? '' : 's'} al inventario`
          : 'Acta marcada como completada'
        : 'Guardado';
      setMsg({ kind: 'success', text: okMsg });
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Error al guardar' });
    } finally { setSaving(false); }
  };

  const clearFileInputs = () => {
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    if (galleryInputRef.current) galleryInputRef.current.value = '';
  };

  const handlePhotoUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const catToUse = photoCategory === 'Otro' ? customCategory.trim() : photoCategory;
    if (!catToUse) {
      setMsg({ kind: 'error', text: 'Selecciona una categoría antes de subir la foto' });
      clearFileInputs();
      return;
    }
    setUploading(true); setMsg(null);
    let okCount = 0;
    let nullUrlCount = 0;
    try {
      for (const file of Array.from(files)) {
        // Comprimir antes de subir — fotos de cámara mobile son 3-10 MB,
        // comprimidas pesan ~500 KB y suben 10x más rápido.
        const { blob, filename } = await compressImageIfNeeded(file);
        const fd = new FormData();
        fd.append('file', blob, filename);
        fd.append('description', catToUse);
        fd.append('uploaded_by', userEmail || 'unknown');
        const r = await fetch(`/api/visits/${visitId}/photos`, { method: 'POST', body: fd });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? 'Error subiendo foto');
        if (!j.photo?.url) nullUrlCount++;
        setPhotos((prev) => [...prev, j.photo]);
        okCount++;
      }
      if (nullUrlCount > 0) {
        setMsg({ kind: 'error', text: `${okCount} foto${okCount !== 1 ? 's subidas' : ' subida'}, pero ${nullUrlCount} sin URL — revisa permisos del bucket "visit-photos" en Supabase Storage.` });
      } else {
        setMsg({ kind: 'success', text: `${okCount} foto${okCount !== 1 ? 's' : ''} subida${okCount !== 1 ? 's' : ''} como "${catToUse}"` });
      }
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Error subiendo' });
    } finally {
      setUploading(false);
      clearFileInputs();
    }
  };

  const updatePhotoDescription = async (photoId: string, newDescription: string) => {
    const prevPhoto = photos.find((p) => p.id === photoId);
    if (prevPhoto?.description === newDescription) return;
    setPhotos((prev) => prev.map((p) => p.id === photoId ? { ...p, description: newDescription } : p));
    const { error } = await supa().from('field_visit_photos').update({ description: newDescription }).eq('id', photoId);
    if (error) {
      setPhotos((prev) => prev.map((p) => p.id === photoId ? { ...p, description: prevPhoto?.description ?? null } : p));
      setMsg({ kind: 'error', text: 'No se pudo guardar la descripción de la foto' });
    }
  };

  const deletePhoto = async (photoId: string) => {
    if (!confirm('¿Eliminar esta foto?')) return;
    const r = await fetch(`/api/visits/${visitId}/photos?photo_id=${photoId}`, { method: 'DELETE' });
    if (r.ok) setPhotos((prev) => prev.filter((p) => p.id !== photoId));
  };

  const deleteVisit = async () => {
    if (!confirm('¿Eliminar esta acta? NO se puede deshacer.')) return;
    const r = await fetch(`/api/visits/${visitId}`, { method: 'DELETE' });
    if (r.ok) onBack();
  };

  const captureGeo = () => {
    if (!navigator.geolocation) { setMsg({ kind: 'error', text: 'GPS no disponible' }); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const coordStr = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        setVisit((v) => v ? {
          ...v,
          lat,
          lng,
          // Autocompleta el campo de form_data "coordenadas" si existe en el schema actual
          form_data: { ...v.form_data, coordenadas: coordStr },
        } : v);
        setMsg({ kind: 'success', text: `GPS guardado (${coordStr})` });
      },
      (err) => setMsg({ kind: 'error', text: `GPS error: ${err.message}` }),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const downloadPDF = async () => {
    try { await generateVisitPDF(visit as unknown as VisitPDFData, photos as unknown as VisitPhoto[]); }
    catch (e) { setMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Error generando PDF' }); }
  };

  const toggleSection = (title: string) => setOpenSections((s) => ({ ...s, [title]: !s[title] }));

  const statusColor = visit.status === 'completed' ? '#10b981' : '#f59e0b';
  const statusLabel = visit.status === 'completed' ? 'Completada' : 'Borrador';

  return (
    <>
      {/* Volver — botón siempre visible arriba */}
      <button onClick={onBack} className="secondary-btn" style={{ marginBottom: 14, fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <ArrowLeft size={14} /> Volver al listado
      </button>

      {/* Strip de identidad del acta */}
      <div className="glass-panel" style={{ padding: 16, borderLeft: `4px solid ${schema.color}`, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {(() => { const Icon = VISIT_ICONS[visit.visit_type]; return <Icon size={28} style={{ color: schema.color, flexShrink: 0 }} />; })()}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{schema.label}</h2>
            <div style={{ marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace' }}>ID {visit.id.slice(0, 8).toUpperCase()}</span>
              <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: 10, background: statusColor + '20', color: statusColor, fontWeight: 700 }}>{statusLabel}</span>
            </div>
          </div>
          <button onClick={downloadPDF} className="secondary-btn" style={{ fontSize: '0.82rem' }}>
            <FileDown size={14} /> PDF
          </button>
        </div>
      </div>

      {msg && (
        <div className={msg.kind === 'success' ? 'alert-success' : msg.kind === 'error' ? 'alert-error' : 'alert-warning'} style={{ fontSize: '0.85rem' }}>
          {msg.text}
        </div>
      )}

      {/* Identificación general (siempre visible, no colapsable) */}
      <CollapsibleSection
        title="Identificación de la visita"
        open={openSections.__ident ?? true}
        onToggle={() => toggleSection('__ident')}>
        <FieldsGrid>
          {/* Casa: texto libre para PREVIA, dropdown para los demás */}
          {schema.casaIsFreeText ? (
            <FieldWrapper label="Nombre del conjunto o casa" required>
              <input type="text"
                placeholder="Ej: Reservas de Pance · Casa 30"
                value={visit.casa ?? ''}
                onChange={(e) => setVisit((v) => v ? { ...v, casa: e.target.value, house_id: null } : v)}
                style={{ minHeight: 44 }} />
            </FieldWrapper>
          ) : (
            <FieldWrapper label="Casa" required>
              <select value={visit.house_id ?? ''} onChange={(e) => {
                const h = houses.find((x) => x.id === e.target.value);
                setVisit((v) => v ? { ...v, house_id: h?.id ?? null, casa: h?.casa ?? null } : v);
              }}>
                <option value="">— Selecciona —</option>
                {houses.map((h) => <option key={h.id} value={h.id}>{h.casa}{h.location ? ` · ${h.location}` : ''}</option>)}
              </select>
            </FieldWrapper>
          )}

          <FieldWrapper label="Técnico que realiza la visita" required>
            <input type="text" value={visit.technician_name ?? ''}
              onChange={(e) => setVisit((v) => v ? { ...v, technician_name: e.target.value } : v)}
              placeholder="Nombre completo (persona que firma el acta)" />
          </FieldWrapper>

          <FieldWrapper label="Empresa contratista">
            <input type="text" value={visit.contratista ?? ''}
              onChange={(e) => setVisit((v) => v ? { ...v, contratista: e.target.value } : v)}
              placeholder="Ej. Energía Solar SAS (empresa que ejecuta)" />
          </FieldWrapper>

          <FieldWrapper label="Fecha">
            <input type="date" value={visit.visit_date}
              onChange={(e) => setVisit((v) => v ? { ...v, visit_date: e.target.value } : v)} />
          </FieldWrapper>

          <FieldWrapper label="Hora">
            <input type="time" value={visit.visit_time ?? ''}
              onChange={(e) => setVisit((v) => v ? { ...v, visit_time: e.target.value } : v)} />
          </FieldWrapper>

          <FieldWrapper label="Ubicación GPS" fullWidth>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={captureGeo} className="secondary-btn" type="button" style={{ flex: 1, minWidth: 200, justifyContent: 'center' }}>
                <MapPin size={14} /> {visit.lat && visit.lng ? `${visit.lat.toFixed(5)}, ${visit.lng.toFixed(5)}` : 'Capturar ubicación GPS'}
              </button>
              {visit.lat !== null && visit.lng !== null && (
                <a
                  href={`https://www.google.com/maps?q=${visit.lat},${visit.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="primary-btn"
                  style={{ justifyContent: 'center', textDecoration: 'none', padding: '8px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <ExternalLink size={14} /> Abrir en Maps
                </a>
              )}
            </div>
          </FieldWrapper>
        </FieldsGrid>
      </CollapsibleSection>

      {/* Secciones del schema, colapsables */}
      {schema.sections.map((sec) => (
        <CollapsibleSection
          key={sec.title}
          title={sec.title}
          open={openSections[sec.title] ?? false}
          onToggle={() => toggleSection(sec.title)}>
          <FieldsGrid>
            {sec.fields.map((f) => (
              <FieldWrapper key={f.key} label={f.label} required={f.required} unit={f.unit} fullWidth={isFullWidthField(f)} help={f.help}>
                <FieldInput field={f} value={visit.form_data[f.key]} onChange={(v) => setField(f.key, v)} />
              </FieldWrapper>
            ))}
          </FieldsGrid>
        </CollapsibleSection>
      ))}

      {/* Fotos */}
      <CollapsibleSection title={`Registro fotográfico (${photos.length})`} open={openSections['__fotos'] ?? true} onToggle={() => toggleSection('__fotos')}>
        {/* Checklist visual de categorías esperadas */}
        {schema.photoCategories.filter((c) => c !== 'Otro').length > 0 && (() => {
          const covered = new Set(photos.map((p) => (p.description ?? '').trim()).filter(Boolean));
          const expected = schema.photoCategories.filter((c) => c !== 'Otro');
          const coveredCount = expected.filter((c) => covered.has(c)).length;
          return (
            <div style={{ marginBottom: 14, padding: 12, background: 'var(--bg-elevated)', borderRadius: 8, borderLeft: `3px solid ${coveredCount === expected.length ? '#10b981' : '#f59e0b'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)' }}>Categorías esperadas</div>
                <div style={{ fontSize: '0.74rem', color: coveredCount === expected.length ? '#10b981' : '#f59e0b', fontWeight: 600 }}>
                  {coveredCount} de {expected.length} cubiertas
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {expected.map((cat) => {
                  const has = covered.has(cat);
                  return (
                    <button key={cat} type="button" onClick={() => setPhotoCategory(cat)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '4px 10px',
                        borderRadius: 12,
                        fontSize: '0.72rem',
                        fontWeight: 500,
                        border: '1px solid ' + (photoCategory === cat ? '#07c5a8' : has ? '#10b98140' : 'var(--border)'),
                        background: photoCategory === cat ? '#07c5a820' : has ? '#10b98115' : 'var(--bg-surface)',
                        color: has ? '#10b981' : 'var(--text-secondary)',
                        cursor: 'pointer',
                      }}>
                      {has && <Check size={11} />} {cat}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}

        <div style={{ marginBottom: 12 }}>
          <label className="input-label" style={{ fontSize: '0.78rem' }}>Categoría de la(s) próxima(s) foto(s)</label>
          <select value={photoCategory} onChange={(e) => setPhotoCategory(e.target.value)} style={{ marginBottom: 8 }}>
            <option value="">— Selecciona categoría —</option>
            {schema.photoCategories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
          </select>
          {photoCategory === 'Otro' && (
            <input type="text" placeholder="Describe la categoría" value={customCategory} onChange={(e) => setCustomCategory(e.target.value)} style={{ marginTop: 4 }} />
          )}
        </div>

        {/* Inputs ocultos: uno con `capture` para cámara, otro sin para galería */}
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" multiple
          onChange={(e) => handlePhotoUpload(e.target.files)}
          style={{ display: 'none' }} />
        <input ref={galleryInputRef} type="file" accept="image/*" multiple
          onChange={(e) => handlePhotoUpload(e.target.files)}
          style={{ display: 'none' }} />

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => cameraInputRef.current?.click()} disabled={uploading || !photoCategory}
            className="primary-btn" style={{ flex: 1, justifyContent: 'center', padding: '14px', fontSize: '0.9rem' }}>
            <Camera size={16} /> {uploading ? 'Subiendo…' : 'Tomar foto'}
          </button>
          <button onClick={() => galleryInputRef.current?.click()} disabled={uploading || !photoCategory}
            className="secondary-btn" style={{ flex: 1, justifyContent: 'center', padding: '14px', fontSize: '0.9rem' }}>
            <ImagePlus size={16} /> Galería
          </button>
        </div>

        {photos.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, marginTop: 14 }}>
            {photos.map((p) => (
              <div key={p.id} style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--bg-elevated)' }}>
                <div style={{ position: 'relative', aspectRatio: '1/1' }}>
                  {p.url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.url} alt={p.description ?? p.filename ?? ''}
                      loading="lazy" decoding="async"
                      style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer' }}
                      onClick={() => window.open(p.url ?? '', '_blank')} />
                  )}
                  <button onClick={() => deletePhoto(p.id)} title="Eliminar"
                    style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.7)', color: 'white', border: 'none', borderRadius: '50%', width: 24, height: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <X size={12} />
                  </button>
                </div>
                <PhotoDescriptionInput photo={p} onCommit={(val) => updatePhotoDescription(p.id, val)} />
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>

      {/* Botones de acción al final del formulario (no sticky para no montarse sobre el contenido) */}
      <div style={{ padding: '18px 0 4px', marginTop: 18, borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={onBack} className="secondary-btn" style={{ minWidth: 120, justifyContent: 'center', padding: '12px' }}>
            <ArrowLeft size={14} /> Volver
          </button>
          <button onClick={() => save(false)} disabled={saving} className="secondary-btn" style={{ flex: 1, minWidth: 140, justifyContent: 'center', padding: '12px' }}>
            <Save size={14} /> Guardar borrador
          </button>
          {visit.status !== 'completed' && (
            <button onClick={() => save(true)} disabled={saving} className="primary-btn" style={{ flex: 2, minWidth: 180, justifyContent: 'center', padding: '12px', fontWeight: 600 }}>
              Marcar completada
            </button>
          )}
        </div>
        <button onClick={deleteVisit} style={{ marginTop: 10, width: '100%', background: 'transparent', color: '#ef4444', border: '1px solid #ef444440', borderRadius: 8, padding: 10, cursor: 'pointer', fontSize: '0.85rem' }}>
          <Trash2 size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Eliminar acta
        </button>
      </div>
    </>
  );
}

/* ───────────── Input de descripción de foto (local state + onBlur) ───────────── */
function PhotoDescriptionInput({ photo, onCommit }: { photo: Photo; onCommit: (val: string) => void }) {
  const [value, setValue] = useState(photo.description ?? '');
  useEffect(() => { setValue(photo.description ?? ''); }, [photo.id, photo.description]);
  return (
    <input type="text" value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value.trim())}
      placeholder="Título / categoría"
      style={{ width: '100%', border: 'none', padding: '6px 8px', fontSize: '0.72rem', background: 'transparent', borderTop: '1px solid var(--border)' }} />
  );
}

/* ───────────── Componente sección colapsable ───────────── */
function CollapsibleSection({ title, open, onToggle, children }: {
  title: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="glass-panel" style={{ padding: 0, marginBottom: 12, overflow: 'hidden' }}>
      <button onClick={onToggle}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-primary)', textAlign: 'left' }}>
        <span style={{ fontSize: '0.95rem', fontWeight: 600 }}>{title}</span>
        {open ? <ChevronDown size={18} style={{ color: 'var(--text-muted)' }} /> : <ChevronRight size={18} style={{ color: 'var(--text-muted)' }} />}
      </button>
      {open && (
        <div style={{ padding: '0 18px 18px', borderTop: '1px solid var(--border)' }}>
          <div style={{ paddingTop: 14 }}>{children}</div>
        </div>
      )}
    </div>
  );
}

/* ───────────── Grid 2 columnas para campos cortos ───────────── */
function FieldsGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="fields-grid">
      {children}
      <style jsx>{`
        .fields-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
        }
        @media (max-width: 600px) {
          .fields-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}

/* ───────────── Wrapper de un campo con label + help ───────────── */
function FieldWrapper({ label, required, unit, fullWidth, help, children }: {
  label: string; required?: boolean; unit?: string; fullWidth?: boolean; help?: string; children: React.ReactNode;
}) {
  return (
    <div style={{ gridColumn: fullWidth ? '1 / -1' : 'auto', display: 'flex', flexDirection: 'column' }}>
      <label className="input-label" style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: 6 }}>
        {label}{required && <span style={{ color: '#ef4444', marginLeft: 3 }}>*</span>}
        {unit && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> ({unit})</span>}
      </label>
      {help && <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '0 0 6px', lineHeight: 1.4 }}>{help}</p>}
      {children}
    </div>
  );
}

/* ───────────── Render del input según tipo ───────────── */
function FieldInput({ field, value, onChange }: { field: VisitField; value: unknown; onChange: (v: unknown) => void }) {
  const v = value ?? (field.type === 'checkbox' ? false : '');

  if (field.type === 'textarea') {
    return <textarea value={String(v)} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} rows={3} style={{ width: '100%' }} />;
  }
  if (field.type === 'select') {
    return (
      <select value={String(v)} onChange={(e) => onChange(e.target.value)}>
        <option value="">— Selecciona —</option>
        {field.options?.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    );
  }
  if (field.type === 'radio') {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {field.options?.map((opt) => (
          <button key={opt} type="button" onClick={() => onChange(opt)}
            className={`chip ${v === opt ? 'active' : ''}`}
            style={{ fontSize: '0.82rem', padding: '8px 14px' }}>
            {opt}
          </button>
        ))}
      </div>
    );
  }
  if (field.type === 'checkbox') {
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '8px 12px', background: v ? 'var(--accent)20' : 'var(--bg-elevated)', borderRadius: 8, border: `1px solid ${v ? 'var(--accent)' : 'var(--border)'}` }}>
        <input type="checkbox" checked={!!v} onChange={(e) => onChange(e.target.checked)} style={{ width: 20, height: 20, cursor: 'pointer' }} />
        <span style={{ fontSize: '0.85rem' }}>{v ? 'Sí' : 'Marcar como sí'}</span>
      </label>
    );
  }
  return (
    <input
      type={field.type === 'tel' || field.type === 'email' ? field.type : (field.type === 'number' ? 'text' : field.type)}
      inputMode={field.inputMode}
      value={String(v)}
      onChange={(e) => onChange(field.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value.replace(',', '.'))) : e.target.value)}
      placeholder={field.placeholder}
      required={field.required}
      style={{ width: '100%', minHeight: 44 }}
    />
  );
}
