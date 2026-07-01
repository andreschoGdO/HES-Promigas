'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Search, ArrowRight, ExternalLink, ChevronDown, ChevronUp, History, Settings, Trash2, GripVertical, Upload, Pencil, CalendarRange } from 'lucide-react';
import {
  type CrmModule, type StageMeta, type TransitionDef,
  OPERATIONS_STAGES,
  transitionsFrom,
} from '@/lib/crm-stages';

interface CrmProject {
  id: string;
  code: string;
  title: string;
  current_module: CrmModule;
  sales_stage: string;
  engineering_stage: string;
  operations_stage: string;
  client_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  client_address: string | null;
  client_city: string | null;
  estrato: number | null;
  tipo_vivienda: string | null;
  conjunto: string | null;
  casa_numero: string | null;
  carga_carro_electrico: string | null;
  autosuficiencia_objetivo_pct: number | null;
  invoice_kwh_mensual: number | null;
  invoice_valor_cop: number | null;
  propuesta_kwp: number | null;
  propuesta_valor_cop: number | null;
  propuesta_url: string | null;
  contrato_url: string | null;
  oferta_url: string | null;
  contrato_signed_at: string | null;
  diseno_kwp: number | null;
  diseno_paneles: number | null;
  diseno_baterias_cantidad: number | null;
  diseno_inversor_marca: string | null;
  diseno_inversor_potencia_kw: number | null;
  diseno_bateria_marca: string | null;
  diseno_bateria_capacidad_kwh: number | null;
  diseno_inversor_categoria_id: string | null;
  diseno_panel_categoria_id: string | null;
  diseno_bateria_categoria_id: string | null;
  diseno_yield_estimado_kwh_mes: number | null;
  diseno_notes: string | null;
  diseno_aprobado_por: string | null;
  diseno_aprobado_at: string | null;
  tipo_red: string | null;
  visita_previa_id: string | null;
  visita_instalacion_id: string | null;
  reservation_id: string | null;
  house_id: string | null;
  contractor_name: string | null;
  contractor_email: string | null;
  installation_date: string | null;
  lectura_inicial_kwh: number | null;
  legalizado_at: string | null;
  created_at: string;
  updated_at: string;
  notes: string | null;
  assigned_to: string | null;
  tags: string[] | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
}

export function CrmModulePage({ module, title, description, color, userEmail }: {
  module: 'operations';
  title: string;
  description: string;
  color: string;
  userEmail: string;
}) {
  const [projects, setProjects] = useState<CrmProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'kanban' | 'tabla'>('kanban');
  const [activeProject, setActiveProject] = useState<CrmProject | null>(null);
  const [transition, setTransition] = useState<{ project: CrmProject; def: TransitionDef } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [configStage, setConfigStage] = useState<StageMeta | null>(null);
  const stages = OPERATIONS_STAGES;

  const load = async () => {
    setLoading(true);
    const params = new URLSearchParams({ module });
    if (search) params.set('q', search);
    const r = await fetch(`/api/crm/projects?${params}`);
    const j = await r.json();
    setProjects(j.projects ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [module, search]);

  const projectsByStage = useMemo(() => {
    const m = new Map<string, CrmProject[]>();
    for (const s of stages) m.set(s.key, []);
    for (const p of projects) {
      const stage = p.operations_stage;
      if (m.has(stage)) m.get(stage)!.push(p);
    }
    return m;
  }, [projects, stages]);

  return (
    <div style={{ maxWidth: 1600, margin: '0 auto', paddingBottom: 40 }}>
      {/* HEADER compacto estilo Pipefy */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 style={{ margin: 0, fontSize: '1.5rem', letterSpacing: '-0.02em' }}>{title}</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: 2, fontSize: '0.82rem' }}>{description}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setShowImport(true)} className="secondary-btn" style={{ padding: '10px 14px', fontSize: '0.86rem', borderRadius: 8, fontWeight: 600 }}>
            <Upload size={15} /> Importar CSV
          </button>
          <button onClick={() => setShowCreate(true)} className="primary-btn" style={{ padding: '10px 16px', fontSize: '0.86rem', borderRadius: 8, fontWeight: 600, background: color, border: 'none' }}>
            <Plus size={15} /> Nueva card manual
          </button>
        </div>
      </div>

      {/* Toolbar — búsqueda + view toggle */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 240, position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input type="text" placeholder="Buscar por código, título, cliente, email…"
            value={search} onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%', paddingLeft: 36, paddingTop: 9, paddingBottom: 9, borderRadius: 8 }} />
        </div>
        <div style={{ display: 'inline-flex', background: 'var(--bg-elevated)', borderRadius: 8, padding: 3, border: '1px solid var(--border)' }}>
          <button onClick={() => setView('kanban')} style={{
            padding: '6px 14px', fontSize: '0.78rem', fontWeight: 600, borderRadius: 6, border: 'none', cursor: 'pointer',
            background: view === 'kanban' ? 'var(--bg-surface)' : 'transparent',
            color: view === 'kanban' ? 'var(--text-primary)' : 'var(--text-muted)',
            boxShadow: view === 'kanban' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
          }}>Kanban</button>
          <button onClick={() => setView('tabla')} style={{
            padding: '6px 14px', fontSize: '0.78rem', fontWeight: 600, borderRadius: 6, border: 'none', cursor: 'pointer',
            background: view === 'tabla' ? 'var(--bg-surface)' : 'transparent',
            color: view === 'tabla' ? 'var(--text-primary)' : 'var(--text-muted)',
            boxShadow: view === 'tabla' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
          }}>Tabla</button>
        </div>
      </div>

      {loading ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Cargando…</div>
      ) : (
        <>
          {/* Hint cuando no hay proyectos, pero el kanban se sigue mostrando con las etapas vacías */}
          {projects.length === 0 && (
            <div className="alert-warning" style={{ fontSize: '0.82rem', marginBottom: 14 }}>
              No hay proyectos en operaciones. Crea uno con &quot;Nueva card manual&quot; o importa varios con &quot;Importar CSV&quot;.
            </div>
          )}
          {view === 'kanban' ? (
            <KanbanView stages={stages} projectsByStage={projectsByStage} onOpen={setActiveProject} module={module} onAdvance={setTransition} onConfigureStage={setConfigStage} />
          ) : (
            <TableView projects={projects} stages={stages} module={module} onOpen={setActiveProject} onAdvance={setTransition} />
          )}
        </>
      )}

      {activeProject && <ProjectDetailModal project={activeProject} onClose={() => setActiveProject(null)} onChanged={() => { setActiveProject(null); load(); }} userEmail={userEmail} module={module} onAdvance={(t) => { setActiveProject(null); setTransition(t); }} />}
      {transition && <TransitionModal project={transition.project} def={transition.def} userEmail={userEmail} onClose={() => setTransition(null)} onDone={() => { setTransition(null); load(); }} />}
      {showCreate && <CreateProjectModal userEmail={userEmail} module={module} onClose={() => setShowCreate(false)} onCreated={(p) => { setShowCreate(false); load(); setActiveProject(p); }} />}
      {showImport && <ImportCsvModal userEmail={userEmail} onClose={() => setShowImport(false)} onImported={() => { setShowImport(false); load(); }} />}
      {configStage && <StageConfigModal module={module} stage={configStage} onClose={() => setConfigStage(null)} />}
    </div>
  );
}

/* ─────────────── KANBAN — estilo Pipefy ─────────────── */
function KanbanView({ stages, projectsByStage, onOpen, module, onAdvance, onConfigureStage }: {
  stages: StageMeta[];
  projectsByStage: Map<string, CrmProject[]>;
  onOpen: (p: CrmProject) => void;
  module: 'operations';
  onAdvance: (t: { project: CrmProject; def: TransitionDef }) => void;
  onConfigureStage: (stage: StageMeta) => void;
}) {
  return (
    <div className="pipefy-board">
      {stages.map((s) => {
        const list = projectsByStage.get(s.key) ?? [];
        return (
          <div key={s.key} className="pipefy-col">
            {/* Header de columna con stripe colorida arriba — click abre configurador */}
            <button
              className="pipefy-col-head"
              style={{ borderTopColor: s.color, textAlign: 'left', width: '100%', background: 'var(--bg-surface)', border: 'none', cursor: 'pointer', display: 'block' }}
              onClick={() => onConfigureStage(s)}
              title="Click para ver/editar los campos de esta etapa"
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, letterSpacing: '-0.01em' }}>{s.shortLabel}</span>
                  <Settings size={11} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
                </div>
                <span style={{
                  fontSize: '0.7rem', fontWeight: 700, color: s.color,
                  background: s.color + '15', padding: '2px 9px', borderRadius: 12, minWidth: 22, textAlign: 'center',
                }}>{list.length}</span>
              </div>
              <p style={{ margin: '4px 0 0', fontSize: '0.66rem', color: 'var(--text-muted)', lineHeight: 1.35 }}>{s.description}</p>
            </button>
            {/* Body de columna — fondo gris suave */}
            <div className="pipefy-col-body">
              {list.length === 0 ? (
                <div className="pipefy-empty">
                  <div style={{ fontSize: '0.74rem' }}>Vacío</div>
                  <div style={{ fontSize: '0.66rem', marginTop: 4, opacity: 0.6 }}>Las cards aparecen aquí</div>
                </div>
              ) : list.map((p) => (
                <ProjectCard key={p.id} project={p} onOpen={() => onOpen(p)} module={module} onAdvance={onAdvance} stageColor={s.color} />
              ))}
            </div>
          </div>
        );
      })}
      <style jsx>{`
        .pipefy-board {
          display: grid;
          grid-template-columns: repeat(${stages.length}, minmax(280px, 1fr));
          gap: 14px;
          overflow-x: auto;
          padding-bottom: 8px;
        }
        .pipefy-col {
          display: flex;
          flex-direction: column;
          min-width: 280px;
          background: var(--bg-surface);
          border-radius: 12px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.04);
          border: 1px solid var(--border);
          overflow: hidden;
        }
        .pipefy-col-head {
          padding: 14px 14px 12px;
          background: var(--bg-surface);
          border-top: 4px solid;
          border-bottom: 1px solid var(--border);
        }
        .pipefy-col-body {
          padding: 10px;
          background: var(--bg-elevated);
          min-height: 360px;
          max-height: calc(100vh - 280px);
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 8px;
          flex: 1;
        }
        .pipefy-empty {
          text-align: center;
          padding: 28px 12px;
          color: var(--text-muted);
          border: 2px dashed var(--border);
          border-radius: 10px;
          background: var(--bg-surface);
          font-style: italic;
        }
      `}</style>
    </div>
  );
}

/* ─────────── Estilos de tags por convención ─────────── */
// Tags conocidos llevan color semántico; el resto cae a un gris neutro.
const KNOWN_TAGS: Record<string, { bg: string; fg: string; dot: string }> = {
  'sin stock':            { bg: '#fef2f2', fg: '#991b1b', dot: '#ef4444' },
  'sin modelos':          { bg: '#fef2f2', fg: '#991b1b', dot: '#dc2626' },
  'sin reserva':          { bg: '#fef2f2', fg: '#991b1b', dot: '#dc2626' },
  'reserva falló':        { bg: '#fef2f2', fg: '#991b1b', dot: '#dc2626' },
  'sin revisar':          { bg: '#fef3c7', fg: '#92400e', dot: '#f59e0b' },
  'urgente':              { bg: '#fee2e2', fg: '#7f1d1d', dot: '#dc2626' },
  'esperando contratista':{ bg: '#fce7f3', fg: '#9d174d', dot: '#ec4899' },
  'esperando cliente':    { bg: '#dbeafe', fg: '#1e40af', dot: '#3b82f6' },
  'bloqueado':            { bg: '#fef2f2', fg: '#991b1b', dot: '#ef4444' },
  'reservado':            { bg: '#dcfce7', fg: '#166534', dot: '#10b981' },
  'aprobado':             { bg: '#dcfce7', fg: '#166534', dot: '#10b981' },
};
function userTagStyle(tag: string): { bg: string; fg: string; dot: string } {
  return KNOWN_TAGS[tag.toLowerCase()] ?? { bg: '#f1f5f9', fg: '#334155', dot: '#64748b' };
}

// Sugerencias de tags por etapa — el usuario puede tipear cualquier otro.
const TAG_SUGGESTIONS: Record<string, string[]> = {
  dimensionado: ['sin revisar', 'sin modelos', 'sin stock', 'urgente', 'esperando cliente'],
  alistamiento: ['esperando contratista', 'sin stock', 'urgente'],
  instalacion:  ['instalación en pausa', 'esperando puesta en marcha', 'urgente'],
  operativo:    ['legalización pendiente', 'facturar', 'urgente'],
  completado:   [],
};

/** Editor inline de tags: muestra los actuales como chips removibles + dropdown para agregar. */
function TagEditor({ tags, stage, onChange }: {
  tags: string[];
  stage: string;
  onChange: (next: string[]) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const suggestions = (TAG_SUGGESTIONS[stage] ?? []).filter((s) => !tags.includes(s));

  const add = (t: string) => {
    const clean = t.trim().toLowerCase();
    if (!clean) return;
    if (tags.map((x) => x.toLowerCase()).includes(clean)) return;
    onChange([...tags, clean]);
    setCustom('');
    setOpen(false);
  };
  const remove = (t: string) => onChange(tags.filter((x) => x !== t));

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', position: 'relative' }}>
      {tags.map((t) => {
        const { bg, fg, dot } = userTagStyle(t);
        return (
          <span key={t} style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            fontSize: '0.66rem', fontWeight: 700,
            padding: '3px 6px 3px 8px', borderRadius: 12,
            background: bg, color: fg,
            textTransform: 'uppercase', letterSpacing: '0.03em',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot }} />
            {t}
            <button onClick={(e) => { e.stopPropagation(); remove(t); }} title="Quitar tag" style={{ background: 'transparent', border: 'none', color: fg, cursor: 'pointer', padding: 0, marginLeft: 2, lineHeight: 1, fontSize: '0.9rem' }}>×</button>
          </span>
        );
      })}
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        style={{
          fontSize: '0.66rem', fontWeight: 600,
          padding: '3px 8px', borderRadius: 12,
          background: 'transparent', color: 'var(--text-muted)',
          border: '1px dashed var(--border)', cursor: 'pointer',
        }}
      >
        + tag
      </button>
      {open && (
        <div onClick={(e) => e.stopPropagation()} style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 10,
          background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8,
          padding: 8, minWidth: 220, boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        }}>
          {suggestions.length > 0 && (
            <>
              <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4, letterSpacing: '0.05em' }}>Sugerencias</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 8 }}>
                {suggestions.map((s) => (
                  <button key={s} onClick={() => add(s)} style={{ textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '0.78rem', padding: '4px 6px', borderRadius: 4, color: 'var(--text)' }}>{s}</button>
                ))}
              </div>
            </>
          )}
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              type="text"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') add(custom); }}
              placeholder="Tag personalizado…"
              style={{ flex: 1, fontSize: '0.78rem', padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
              autoFocus
            />
            <button onClick={() => add(custom)} disabled={!custom.trim()} style={{ fontSize: '0.78rem', padding: '4px 10px', borderRadius: 4, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', cursor: 'pointer' }}>+</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────── Card de proyecto, look Pipefy ─────────── */
function ProjectCard({ project, onOpen, module, onAdvance, stageColor }: {
  project: CrmProject;
  onOpen: () => void;
  module: 'operations';
  onAdvance: (t: { project: CrmProject; def: TransitionDef }) => void;
  stageColor: string;
}) {
  const stage = project.operations_stage;
  // Solo mostrar la transición forward en el footer del card (el "Volver atrás"
  // se ve solo al abrir el detalle).
  const availableTransitions = transitionsFrom(module, stage).filter((t) => t.direction !== 'backward');

  // Sub-estado / banderas (user-defined o auto-añadidos por el sistema)
  const userTags = project.tags ?? [];

  // Tags derivados (campos del proyecto)
  const tags: Array<{ label: string; bg: string; fg: string }> = [];
  if (project.client_city) tags.push({ label: project.client_city, bg: '#e2e8f0', fg: '#475569' });
  if (project.diseno_kwp) tags.push({ label: `${project.diseno_kwp} kWp`, bg: '#ede9fe', fg: '#6d28d9' });
  if (project.diseno_paneles) tags.push({ label: `${project.diseno_paneles} paneles`, bg: '#fef3c7', fg: '#92400e' });
  if (project.diseno_baterias_cantidad) tags.push({ label: `${project.diseno_baterias_cantidad} bat.`, bg: '#fce7f3', fg: '#9d174d' });
  if (project.diseno_aprobado_por) tags.push({ label: `R: ${project.diseno_aprobado_por.split('@')[0].split(' ')[0]}`, bg: '#dcfce7', fg: '#166534' });
  if (project.installation_date) tags.push({ label: `Inst. ${project.installation_date}`, bg: '#fed7aa', fg: '#9a3412' });
  if (project.contractor_name) tags.push({ label: project.contractor_name, bg: '#fecaca', fg: '#991b1b' });

  const next = availableTransitions[0];

  return (
    <div
      onClick={onOpen}
      style={{
        background: 'var(--bg-surface)',
        borderRadius: 10,
        padding: 12,
        border: '1px solid var(--border)',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        cursor: 'pointer',
        transition: 'transform 0.12s, box-shadow 0.12s, border-color 0.12s',
        position: 'relative',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-1px)';
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.06)';
        e.currentTarget.style.borderColor = stageColor + '60';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = '';
        e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.04)';
        e.currentTarget.style.borderColor = 'var(--border)';
      }}
    >
      {/* Top row: código + indicador de tiempo */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.62rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.02em' }}>{project.code}</span>
        <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>{timeSince(project.updated_at)}</span>
      </div>

      {/* Título */}
      <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3, marginBottom: 10, letterSpacing: '-0.01em' }}>
        {project.title}
      </div>

      {/* Cliente con avatar */}
      {project.client_name && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Avatar name={project.client_name} />
          <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.client_name}</div>
        </div>
      )}

      {/* Sub-estados (user tags / banderas) — visualmente distintos a los tags derivados */}
      {userTags.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
          {userTags.map((t) => {
            const { bg, fg, dot } = userTagStyle(t);
            return (
              <span key={t} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontSize: '0.66rem', fontWeight: 700,
                padding: '3px 8px', borderRadius: 12,
                background: bg, color: fg,
                whiteSpace: 'nowrap',
                textTransform: 'uppercase', letterSpacing: '0.03em',
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot, display: 'inline-block' }} />
                {t}
              </span>
            );
          })}
        </div>
      )}

      {/* Tags row */}
      {tags.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
          {tags.map((t, i) => (
            <span key={i} style={{
              fontSize: '0.66rem', fontWeight: 500,
              padding: '3px 8px', borderRadius: 4,
              background: t.bg, color: t.fg,
              whiteSpace: 'nowrap',
            }}>{t.label}</span>
          ))}
        </div>
      )}

      {/* Footer con acción */}
      {next && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)',
        }}>
          <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 500 }}>
            Siguiente:
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onAdvance({ project, def: next }); }}
            style={{
              padding: '4px 12px',
              background: stageColor,
              color: 'white',
              border: 'none',
              borderRadius: 16,
              fontSize: '0.7rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              transition: 'filter 0.12s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.1)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.filter = ''; }}
          >
            {next.buttonLabel.replace(' →', '')} <ArrowRight size={11} />
          </button>
        </div>
      )}
    </div>
  );
}

/* Avatar circular con inicial y color por hash del nombre */
function Avatar({ name }: { name: string }) {
  const colors = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#ef4444', '#84cc16'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash + name.charCodeAt(i)) % colors.length;
  const initial = (name.trim().charAt(0) || '?').toUpperCase();
  return (
    <div style={{
      width: 24, height: 24, borderRadius: '50%',
      background: colors[hash], color: 'white',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '0.72rem', fontWeight: 700, flexShrink: 0,
    }}>
      {initial}
    </div>
  );
}

function timeSince(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30);
  return `${mo}mo`;
}

/* ─────────────── TABLE VIEW ─────────────── */
function TableView({ projects, stages, module, onOpen, onAdvance }: {
  projects: CrmProject[];
  stages: StageMeta[];
  module: 'operations';
  onOpen: (p: CrmProject) => void;
  onAdvance: (t: { project: CrmProject; def: TransitionDef }) => void;
}) {
  return (
    <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: '0.82rem' }}>
          <thead>
            <tr>
              <th>Código</th>
              <th>Proyecto</th>
              <th>Cliente</th>
              <th>Etapa</th>
              <th>Actualizado</th>
              <th style={{ textAlign: 'right' }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => {
              const stage = p.operations_stage;
              const meta = stages.find((s) => s.key === stage);
              const trans = transitionsFrom(module, stage);
              return (
                <tr key={p.id} style={{ borderLeft: `3px solid ${meta?.color ?? '#94a3b8'}` }}>
                  <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.72rem' }}>{p.code}</td>
                  <td><strong>{p.title}</strong></td>
                  <td style={{ fontSize: '0.78rem' }}>{p.client_name ?? '—'}{p.client_city && <span style={{ color: 'var(--text-muted)' }}> · {p.client_city}</span>}</td>
                  <td>
                    <span style={{ padding: '2px 10px', borderRadius: 10, background: (meta?.color ?? '#94a3b8') + '20', color: meta?.color, fontSize: '0.7rem', fontWeight: 700 }}>{meta?.shortLabel ?? stage}</span>
                  </td>
                  <td style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{new Date(p.updated_at).toLocaleDateString('es-CO')}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => onOpen(p)} className="secondary-btn" style={{ fontSize: '0.72rem', padding: '4px 8px' }}>Ver</button>
                    {trans.length > 0 && (
                      <button onClick={() => onAdvance({ project: p, def: trans[0] })} className="primary-btn" style={{ fontSize: '0.72rem', padding: '4px 8px', marginLeft: 6 }}>
                        {trans[0].buttonLabel}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─────────────── DETAIL MODAL ─────────────── */
function ProjectDetailModal({ project: initial, onClose, onChanged, userEmail, module, onAdvance }: {
  project: CrmProject; onClose: () => void; onChanged: () => void; userEmail: string;
  module: 'operations';
  onAdvance: (t: { project: CrmProject; def: TransitionDef }) => void;
}) {
  const [project, setProject] = useState<CrmProject>(initial);
  const [events, setEvents] = useState<Array<{ id: string; event_type: string; from_module: string | null; to_module: string | null; from_stage: string | null; to_stage: string | null; actor_email: string | null; notes: string | null; created_at: string }>>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  type PlannerTaskLite = { id: string; title: string; status: string; urgency: string; start_date: string | null; due_date: string | null; assigned_to: string | null; team: string | null; tags: string[] | null };
  const [linkedTasks, setLinkedTasks] = useState<PlannerTaskLite[]>([]);

  const reload = () => {
    fetch(`/api/crm/projects/${initial.id}`).then((r) => r.json()).then((j) => {
      if (j.project) setProject(j.project);
      setEvents(j.events ?? []);
    });
    fetch(`/api/planner/tasks?project_id=${initial.id}`).then((r) => r.json()).then((j) => {
      setLinkedTasks(j.tasks ?? []);
    }).catch(() => {});
  };
  useEffect(reload, [initial.id]);

  const stage = project.operations_stage;
  const trans = transitionsFrom(module, stage);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: 760, maxHeight: '90vh', overflowY: 'auto', padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{project.code}</div>
            <h2 style={{ margin: '4px 0 4px', fontSize: '1.15rem' }}>{project.title}</h2>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: '0.74rem' }}>
              <ModuleBadge stage={project.operations_stage} active={project.current_module === 'operations'} />
              <TagEditor
                tags={project.tags ?? []}
                stage={project.operations_stage}
                onChange={async (next) => {
                  await fetch('/api/crm/projects', {
                    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: project.id, tags: next, actor_email: userEmail, note: 'Tags actualizados' }),
                  });
                  reload();
                  onChanged();
                }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => setEditing(true)} className="secondary-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: '0.82rem' }}>
              <Pencil size={12} /> Editar
            </button>
            {!project.cancelled_at && (
              <button onClick={() => setCancelling(true)} className="secondary-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: '0.82rem', borderColor: '#ef4444', color: '#ef4444' }}>
                <Trash2 size={12} /> Cancelar
              </button>
            )}
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.4rem', padding: 0, lineHeight: 1 }}>×</button>
          </div>
        </div>

        {project.cancelled_at && (
          <div style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 8, padding: 10, marginBottom: 12, fontSize: '0.85rem' }}>
            <strong style={{ color: '#ef4444' }}>Proyecto cancelado</strong> el {new Date(project.cancelled_at).toLocaleDateString('es-CO')}.
            {project.cancellation_reason && <> Motivo: {project.cancellation_reason}</>}
          </div>
        )}

        <DetailSection title="Cliente">
          <KV label="Nombre" value={project.client_name} />
          <KV label="Email" value={project.client_email} />
          <KV label="Teléfono" value={project.client_phone} />
          <KV label="Dirección" value={project.client_address} />
          <KV label="Ciudad" value={project.client_city} />
          <KV label="Estrato" value={project.estrato} />
          <KV label="Tipo vivienda" value={project.tipo_vivienda} />
        </DetailSection>

        <DetailSection title="Comercial">
          <KV label="Consumo mensual" value={project.invoice_kwh_mensual ? `${project.invoice_kwh_mensual} kWh` : null} />
          <KV label="Valor mensual" value={project.invoice_valor_cop ? `$${project.invoice_valor_cop.toLocaleString('es-CO')}` : null} />
          <KV label="kWp propuestos" value={project.propuesta_kwp} />
          <KV label="Valor propuesta" value={project.propuesta_valor_cop ? `$${project.propuesta_valor_cop.toLocaleString('es-CO')}` : null} />
          <KV label="URL propuesta" value={project.propuesta_url ? <a href={project.propuesta_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}><ExternalLink size={11} /> Abrir</a> : null} />
          <KV label="URL contrato" value={project.contrato_url ? <a href={project.contrato_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}><ExternalLink size={11} /> Abrir</a> : null} />
          <KV label="Firmado" value={project.contrato_signed_at ? new Date(project.contrato_signed_at).toLocaleDateString('es-CO') : null} />
        </DetailSection>

        <DetailSection title="Ingeniería / Diseño">
          <KV label="kWp diseño" value={project.diseno_kwp} />
          <KV label="Tipo de red" value={project.tipo_red} />
          <KV label="Paneles" value={project.diseno_paneles} />
          <KV label="Marca inversor" value={project.diseno_inversor_marca} />
          <KV label="Potencia inversor (kW)" value={project.diseno_inversor_potencia_kw} />
          <KV label="Baterías (cantidad)" value={project.diseno_baterias_cantidad} />
          <KV label="Marca baterías" value={project.diseno_bateria_marca} />
          <KV label="Capacidad batería (kWh)" value={project.diseno_bateria_capacidad_kwh} />
          <KV label="Yield estimado" value={project.diseno_yield_estimado_kwh_mes ? `${project.diseno_yield_estimado_kwh_mes} kWh/mes` : null} />
          <KV label="Aprobado por" value={project.diseno_aprobado_por} />
          <KV label="Aprobado en" value={project.diseno_aprobado_at ? new Date(project.diseno_aprobado_at).toLocaleString('es-CO') : null} />
          <KV label="Notas diseño" value={project.diseno_notes} />
        </DetailSection>

        <DetailSection title="Operaciones / Instalación">
          <KV label="Visita previa" value={project.visita_previa_id ? <Link href="/visitas" style={{ color: 'var(--accent)' }}>{project.visita_previa_id.slice(0, 8)}…</Link> : null} />
          <KV label="Visita instalación" value={project.visita_instalacion_id ? <Link href="/visitas" style={{ color: 'var(--accent)' }}>{project.visita_instalacion_id.slice(0, 8)}…</Link> : null} />
          <KV label="Reserva inventario" value={project.reservation_id ? <Link href="/inventario" style={{ color: 'var(--accent)' }}>{project.reservation_id.slice(0, 8)}…</Link> : null} />
          <KV label="Contratista" value={project.contractor_name} />
          <KV label="Email contratista" value={project.contractor_email} />
          <KV label="Fecha instalación" value={project.installation_date} />
          <KV label="Lectura inicial" value={project.lectura_inicial_kwh ? `${project.lectura_inicial_kwh} kWh` : null} />
          <KV label="Legalizado" value={project.legalizado_at} />
        </DetailSection>

        <DetailSection title="">
          <KV label="Notas" value={project.notes} />
          <KV label="Asignado a" value={project.assigned_to} />
        </DetailSection>

        {/* Tareas del Planner vinculadas */}
        <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--bg-elevated)', borderRadius: 8, borderLeft: '4px solid #8b5cf6' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <CalendarRange size={14} style={{ color: '#8b5cf6' }} />
            <strong style={{ fontSize: '0.85rem' }}>Actividades del Planner</strong>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>({linkedTasks.length})</span>
            <Link href={`/planner?project_id=${project.id}`} style={{ marginLeft: 'auto', fontSize: '0.74rem', color: 'var(--accent)' }}>
              Abrir en Planner →
            </Link>
          </div>
          {linkedTasks.length === 0 ? (
            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Sin tareas vinculadas. Se crean automáticamente al pasar a Instalación o abrir un ticket de garantía.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {linkedTasks.map((t) => {
                const statusColors: Record<string, string> = {
                  todo: '#94a3b8', in_progress: '#3b82f6', done: '#10b981', blocked: '#ef4444',
                };
                const urgencyColors: Record<string, string> = {
                  low: '#3b82f6', medium: '#f59e0b', high: '#ef4444', critical: '#dc2626',
                };
                return (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem', padding: '6px 8px', background: 'var(--bg-surface)', borderRadius: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: urgencyColors[t.urgency] ?? '#64748b' }} />
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {t.start_date ? `${t.start_date}${t.due_date && t.due_date !== t.start_date ? ' → ' + t.due_date : ''}` : (t.due_date ?? 'sin fecha')}
                    </span>
                    <span style={{ padding: '2px 8px', borderRadius: 10, background: (statusColors[t.status] ?? '#64748b') + '20', color: statusColors[t.status] ?? '#64748b', fontSize: '0.68rem', fontWeight: 700 }}>
                      {t.status}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Audit log */}
        <div style={{ marginTop: 10 }}>
          <button onClick={() => setShowHistory((v) => !v)} className="secondary-btn" style={{ width: '100%', justifyContent: 'space-between', display: 'flex' }}>
            <span><History size={12} /> Historial de eventos ({events.length})</span>
            {showHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {showHistory && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflowY: 'auto' }}>
              {events.map((ev) => (
                <div key={ev.id} style={{ fontSize: '0.74rem', padding: '6px 10px', background: 'var(--bg-elevated)', borderRadius: 6, borderLeft: '3px solid var(--accent)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                    <strong>{ev.event_type}{ev.from_module && ev.to_module && ` · ${ev.from_module}/${ev.from_stage} → ${ev.to_module}/${ev.to_stage}`}</strong>
                    <span style={{ color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace', fontSize: '0.68rem' }}>{new Date(ev.created_at).toLocaleString('es-CO')}</span>
                  </div>
                  {ev.notes && <div style={{ marginTop: 2, color: 'var(--text-secondary)' }}>{ev.notes}</div>}
                  {ev.actor_email && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>por {ev.actor_email}</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Botones de transición — forward primero, backward al final como acciones secundarias */}
        {trans.length > 0 && (() => {
          const forward = trans.filter((t) => t.direction !== 'backward');
          const backward = trans.filter((t) => t.direction === 'backward');
          return (
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              {forward.length > 0 && (
                <>
                  <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: 8, color: 'var(--text-muted)' }}>Próximas acciones disponibles:</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {forward.map((t) => (
                      <button key={t.action} onClick={() => onAdvance({ project, def: t })}
                        className="primary-btn" style={{ justifyContent: 'space-between', textAlign: 'left' }}>
                        <span>{t.buttonLabel}</span>
                        <ArrowRight size={14} />
                      </button>
                    ))}
                  </div>
                </>
              )}
              {backward.length > 0 && (
                <div style={{ marginTop: forward.length > 0 ? 14 : 0 }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 600, marginBottom: 6, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Devolver a etapa anterior</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {backward.map((t) => (
                      <button key={t.action} onClick={() => onAdvance({ project, def: t })}
                        className="secondary-btn" style={{ justifyContent: 'flex-start', textAlign: 'left', fontSize: '0.82rem' }}>
                        <span>{t.buttonLabel}</span>
                      </button>
                    ))}
                  </div>
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '6px 0 0' }}>
                    No se borra ninguna información ya capturada — solo se cambia la etapa.
                  </p>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {editing && (
        <EditProjectModal
          project={project}
          userEmail={userEmail}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); reload(); onChanged(); }}
        />
      )}
      {cancelling && (
        <CancelProjectModal
          project={project}
          userEmail={userEmail}
          onClose={() => setCancelling(false)}
          onSaved={() => { setCancelling(false); reload(); onChanged(); }}
        />
      )}
    </div>
  );
}

/* ─────────────── CANCEL PROJECT MODAL ─────────────── */
/**
 * Cancela el proyecto y recupera los equipos instalados de la casa. Si
 * había reserva activa, también la cancela. El proyecto NO se borra —
 * queda como histórico con cancelled_at y cancellation_reason.
 */
function CancelProjectModal({ project, userEmail, onClose, onSaved }: {
  project: CrmProject; userEmail: string; onClose: () => void; onSaved: () => void;
}) {
  const [reason, setReason] = useState('');
  const [destStatus, setDestStatus] = useState<string>('in_stock');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!reason.trim()) { setErr('Motivo requerido'); return; }
    if (!confirm(`¿Cancelar el proyecto ${project.code}? Esta acción recuperará todos los equipos instalados (si los hay) y marcará el proyecto como cerrado.`)) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/crm/projects/${project.id}/cancel`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim(), destination_status: destStatus, actor_email: userEmail }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Error');
      if (j.recovered_count > 0) {
        alert(`Proyecto cancelado. ${j.recovered_count} equipo(s) recuperado(s) a ${destStatus === 'in_stock' ? 'bodega' : destStatus === 'in_repair' ? 'garantía' : destStatus}.`);
      } else {
        alert('Proyecto cancelado. No había equipos instalados para recuperar.');
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 700, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: 540, padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{project.code} · {project.title}</div>
            <h2 style={{ margin: '4px 0 0', fontSize: '1.05rem' }}>Cancelar proyecto</h2>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.4rem', padding: 0, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 8, padding: 12, marginBottom: 14, fontSize: '0.82rem' }}>
          <strong>⚠ Acción definitiva</strong>
          <p style={{ margin: '6px 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            Al cancelar:<br />
            • La reserva activa de inventario (si la hay) se cancela y los items vuelven a bodega.<br />
            • Los equipos instalados en la casa de este proyecto se recuperan al destino que elijas.<br />
            • El proyecto pasa a estado <strong>Cerrado</strong> con timestamp y motivo.<br />
            • Cada item recuperado queda registrado en facturación_upgrades para auditoría.
          </p>
        </div>

        <div className="input-group" style={{ marginBottom: 10 }}>
          <label className="input-label">Destino de los equipos recuperados *</label>
          <select value={destStatus} onChange={(e) => setDestStatus(e.target.value)}>
            <option value="in_stock">Devolver a bodega</option>
            <option value="in_repair">A garantía / taller (revisar antes de re-stockear)</option>
          </select>
        </div>

        <div className="input-group" style={{ marginBottom: 10 }}>
          <label className="input-label">Motivo de la cancelación *</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Cliente desistió, error de dimensionamiento, etc." rows={3} style={{ width: '100%' }} />
        </div>

        {err && <div className="alert-error" style={{ marginBottom: 10, fontSize: '0.82rem' }}>{err}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} className="secondary-btn" disabled={saving}>Volver</button>
          <button onClick={() => void submit()} className="primary-btn" disabled={saving} style={{ background: '#ef4444' }}>
            {saving ? 'Cancelando…' : 'Cancelar proyecto'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────── EDIT PROJECT MODAL ─────────────── */

// Orden lineal de etapas de Operaciones — fuente única para "stage gating".
const STAGE_INDEX: Record<string, number> = {
  dimensionado: 0,
  alistamiento: 1,
  instalacion: 2,
  operativo: 3,
  completado: 4,
};

// Etiqueta legible por etapa (para el badge de candado)
const STAGE_LABEL: Record<string, string> = {
  dimensionado: 'Dimensionado',
  alistamiento: 'Alistamiento',
  instalacion: 'Instalación',
  operativo: 'Operativo',
  completado: 'Cerrado',
};

const stageIdx = (s: string | null | undefined) => (s ? (STAGE_INDEX[s] ?? 0) : 0);

/**
 * Editor con bloqueo progresivo: solo las secciones de la etapa actual y
 * anteriores son editables. Las secciones de etapas futuras se muestran
 * deshabilitadas con un candado indicando cuándo se van a desbloquear.
 *
 * - Estás en Dimensionado → solo puedes editar campos de Dimensionado.
 * - Estás en Instalación → puedes editar todo lo de Dimensionado, Alistamiento
 *   e Instalación. Los campos de Operativo siguen bloqueados.
 *
 * No cambia de etapa — la transición sigue siendo un botón aparte.
 */
function EditProjectModal({ project, userEmail, onClose, onSaved }: {
  project: CrmProject; userEmail: string; onClose: () => void; onSaved: () => void;
}) {
  const currentIdx = stageIdx(project.operations_stage);
  const canEdit = (sectionStage: string) => stageIdx(sectionStage) <= currentIdx;
  const initial: Record<string, string> = useMemo(() => ({
    title: project.title ?? '',
    client_name: project.client_name ?? '',
    client_email: project.client_email ?? '',
    client_phone: project.client_phone ?? '',
    client_address: project.client_address ?? '',
    client_city: project.client_city ?? '',
    estrato: project.estrato != null ? String(project.estrato) : '',
    tipo_vivienda: project.tipo_vivienda ?? '',
    conjunto: project.conjunto ?? '',
    casa_numero: project.casa_numero ?? '',
    carga_carro_electrico: project.carga_carro_electrico ?? '',
    autosuficiencia_objetivo_pct: project.autosuficiencia_objetivo_pct != null ? String(project.autosuficiencia_objetivo_pct) : '',
    invoice_kwh_mensual: project.invoice_kwh_mensual != null ? String(project.invoice_kwh_mensual) : '',
    diseno_kwp: project.diseno_kwp != null ? String(project.diseno_kwp) : '',
    diseno_paneles: project.diseno_paneles != null ? String(project.diseno_paneles) : '',
    diseno_baterias_cantidad: project.diseno_baterias_cantidad != null ? String(project.diseno_baterias_cantidad) : '',
    diseno_inversor_categoria_id: project.diseno_inversor_categoria_id ?? '',
    diseno_bateria_categoria_id: project.diseno_bateria_categoria_id ?? '',
    diseno_panel_categoria_id: project.diseno_panel_categoria_id ?? '',
    diseno_aprobado_por: project.diseno_aprobado_por ?? '',
    diseno_notes: project.diseno_notes ?? '',
    visita_previa_id: project.visita_previa_id ?? '',
    visita_instalacion_id: project.visita_instalacion_id ?? '',
    contractor_name: project.contractor_name ?? '',
    contractor_email: project.contractor_email ?? '',
    installation_date: project.installation_date ?? '',
    lectura_inicial_kwh: project.lectura_inicial_kwh != null ? String(project.lectura_inicial_kwh) : '',
    house_id: project.house_id ?? '',
    notes: project.notes ?? '',
  }), [project]);

  const [form, setForm] = useState<Record<string, string>>(initial);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  type CatOpt = { id: string; name: string; family: string };
  const [cats, setCats] = useState<CatOpt[]>([]);
  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch('/api/inventory/categories');
        if (!r.ok) return;
        const j = await r.json();
        setCats(((j.categories ?? []) as Array<{ id: string; name: string; family: string; is_serialized: boolean }>)
          .filter((c) => c.is_serialized)
          .map((c) => ({ id: c.id, name: c.name, family: c.family })));
      } catch { /* ignore */ }
    })();
  }, []);
  const catsByFamily = (fam: string) => cats.filter((c) => c.family === fam);

  // Mapeo: cada CAMPO está asociado a la etapa donde se vuelve editable.
  // Si el proyecto está en una etapa ≥ a la del campo, se puede editar.
  const FIELD_STAGE: Record<string, string> = {
    // Dimensionado (etapa inicial — todos los campos del create modal)
    title: 'dimensionado',
    client_name: 'dimensionado', client_email: 'dimensionado', client_phone: 'dimensionado',
    client_address: 'dimensionado', client_city: 'dimensionado',
    estrato: 'dimensionado', tipo_vivienda: 'dimensionado',
    conjunto: 'dimensionado', casa_numero: 'dimensionado', carga_carro_electrico: 'dimensionado',
    autosuficiencia_objetivo_pct: 'dimensionado',
    invoice_kwh_mensual: 'dimensionado',
    diseno_kwp: 'dimensionado', diseno_paneles: 'dimensionado', diseno_baterias_cantidad: 'dimensionado',
    diseno_inversor_categoria_id: 'dimensionado',
    diseno_bateria_categoria_id: 'dimensionado',
    diseno_panel_categoria_id: 'dimensionado',
    diseno_aprobado_por: 'dimensionado',
    diseno_notes: 'dimensionado',
    visita_previa_id: 'dimensionado',
    notes: 'dimensionado',
    // Alistamiento (contratista + fecha de instalación)
    contractor_name: 'alistamiento',
    contractor_email: 'alistamiento',
    installation_date: 'alistamiento',
    // Instalación (lectura inicial + acta de instalación)
    lectura_inicial_kwh: 'instalacion',
    visita_instalacion_id: 'instalacion',
    // Vincular casa (puede hacerse en cualquier etapa pero es obligatorio para Operativo)
    house_id: 'dimensionado',
  };

  const submit = async () => {
    setErr(null);
    setSaving(true);
    try {
      // Construir delta: solo campos cambiados Y que estén desbloqueados en
      // la etapa actual. Cualquier intento de cambiar un campo de etapa
      // futura se ignora silenciosamente (la UI lo deshabilita pero por
      // si acaso lo blindamos).
      const delta: Record<string, unknown> = {};
      const ignored: string[] = [];
      for (const k of Object.keys(form)) {
        const before = initial[k] ?? '';
        const after = form[k] ?? '';
        if (before === after) continue;
        const fieldStage = FIELD_STAGE[k];
        if (fieldStage && !canEdit(fieldStage)) {
          ignored.push(k);
          continue;
        }
        delta[k] = after;
      }
      if (Object.keys(delta).length === 0) {
        if (ignored.length > 0) setErr('No puedes editar campos de etapas futuras todavía.');
        else onClose();
        return;
      }
      const r = await fetch('/api/crm/projects', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: project.id, ...delta, actor_email: userEmail, note: `Campos editados (etapa: ${project.operations_stage})` }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Error');
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 700, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: 760, maxHeight: '92vh', overflowY: 'auto', padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{project.code}</div>
            <h2 style={{ margin: '4px 0 0', fontSize: '1.05rem' }}>Editar campos del proyecto</h2>
            <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              Etapa actual: <strong>{STAGE_LABEL[project.operations_stage] ?? project.operations_stage}</strong>. Puedes editar campos de esta etapa y de etapas anteriores. Las futuras se desbloquearán al avanzar.
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.4rem', padding: 0, lineHeight: 1 }}>×</button>
        </div>

        {err && <div className="alert-error" style={{ marginBottom: 10, fontSize: '0.82rem' }}>{err}</div>}

        <StageSection title="Identificación" stage="dimensionado" canEdit={canEdit('dimensionado')}>
          <FormField label="Título" required value={form.title} onChange={(v) => set('title', v)} fullWidth disabled={!canEdit('dimensionado')} />
        </StageSection>

        <StageSection title="Cliente" stage="dimensionado" canEdit={canEdit('dimensionado')}>
          <FormField label="Nombre" value={form.client_name} onChange={(v) => set('client_name', v)} disabled={!canEdit('dimensionado')} />
          <FormField label="Email"  value={form.client_email} onChange={(v) => set('client_email', v)} disabled={!canEdit('dimensionado')} />
          <FormField label="Teléfono" value={form.client_phone} onChange={(v) => set('client_phone', v)} disabled={!canEdit('dimensionado')} />
          <FormField label="Dirección" value={form.client_address} onChange={(v) => set('client_address', v)} disabled={!canEdit('dimensionado')} />
          <FormField label="Ciudad" value={form.client_city} onChange={(v) => set('client_city', v)} disabled={!canEdit('dimensionado')} />
          <FormField label="Conjunto" value={form.conjunto} onChange={(v) => set('conjunto', v)} disabled={!canEdit('dimensionado')} />
          <FormField label="Casa #" value={form.casa_numero} onChange={(v) => set('casa_numero', v)} disabled={!canEdit('dimensionado')} />
          <FormField label="Estrato" type="number" value={form.estrato} onChange={(v) => set('estrato', v)} disabled={!canEdit('dimensionado')} />
          <FormFieldSelect label="Carga carro eléctrico" value={form.carga_carro_electrico} onChange={(v) => set('carga_carro_electrico', v)}
            options={['No tenemos carro eléctrico', 'Sí - Wallbox 7 kW', 'Sí - Wallbox 11 kW', 'Sí - Wallbox 22 kW', 'Sí - otro']} fullWidth disabled={!canEdit('dimensionado')} />
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="input-label" style={{ fontSize: '0.74rem', display: 'block', marginBottom: 4 }}>
              Casa vinculada (de client_houses)
            </label>
            <HousePicker
              value={form.house_id}
              onChange={(v) => set('house_id', v)}
              casaHint={form.casa_numero || form.conjunto || null}
              disabled={!canEdit('dimensionado')}
            />
            <p style={{ margin: '4px 0 0', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              Vincula el proyecto con su casa física (la que aparece en Metrum). Es obligatorio para pasar a Operativo. El sistema intenta auto-vincular por número de casa al transicionar.
            </p>
          </div>
        </StageSection>

        <StageSection title="Dimensionado" stage="dimensionado" canEdit={canEdit('dimensionado')}>
          <FormField label="Promedio consumo (kWh/mes)" type="number" value={form.invoice_kwh_mensual} onChange={(v) => set('invoice_kwh_mensual', v)} disabled={!canEdit('dimensionado')} />
          <FormField label="Autosuficiencia objetivo (%)" type="number" value={form.autosuficiencia_objetivo_pct} onChange={(v) => set('autosuficiencia_objetivo_pct', v)} disabled={!canEdit('dimensionado')} />
          <FormField label="kWp diseño" type="number" value={form.diseno_kwp} onChange={(v) => set('diseno_kwp', v)} disabled={!canEdit('dimensionado')} />
          <FormField label="Paneles (cantidad)" type="number" value={form.diseno_paneles} onChange={(v) => set('diseno_paneles', v)} disabled={!canEdit('dimensionado')} />
          <FormField label="Baterías (cantidad)" type="number" value={form.diseno_baterias_cantidad} onChange={(v) => set('diseno_baterias_cantidad', v)} disabled={!canEdit('dimensionado')} />
          <FormField label="Responsable diseño" value={form.diseno_aprobado_por} onChange={(v) => set('diseno_aprobado_por', v)} disabled={!canEdit('dimensionado')} />
          <FormField label="Notas del diseño" value={form.diseno_notes} onChange={(v) => set('diseno_notes', v)} fullWidth disabled={!canEdit('dimensionado')} />
        </StageSection>

        <StageSection title="Equipos del diseño (catálogo)" stage="dimensionado" canEdit={canEdit('dimensionado')}>
          <CategoryPicker label="Modelo de inversor" value={form.diseno_inversor_categoria_id} onChange={(v) => set('diseno_inversor_categoria_id', v)} options={catsByFamily('inverter')} disabled={!canEdit('dimensionado')} />
          <CategoryPicker label="Modelo de batería"  value={form.diseno_bateria_categoria_id}  onChange={(v) => set('diseno_bateria_categoria_id', v)}  options={catsByFamily('battery')} disabled={!canEdit('dimensionado')} />
          <CategoryPicker label="Modelo de panel"    value={form.diseno_panel_categoria_id}    onChange={(v) => set('diseno_panel_categoria_id', v)}    options={catsByFamily('panel')} fullWidth disabled={!canEdit('dimensionado')} />
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="input-label" style={{ fontSize: '0.74rem', display: 'block', marginBottom: 4 }}>Acta de visita previa</label>
            <LinkedResourcePicker kind="visita_previa" casaHint={form.casa_numero || form.client_name || null} value={form.visita_previa_id} onChange={(v) => set('visita_previa_id', v)} disabled={!canEdit('dimensionado')} />
          </div>
        </StageSection>

        <StageSection title="Alistamiento (contratista)" stage="alistamiento" canEdit={canEdit('alistamiento')}>
          <FormField label="Contratista" value={form.contractor_name} onChange={(v) => set('contractor_name', v)} disabled={!canEdit('alistamiento')} />
          <FormField label="Email contratista" value={form.contractor_email} onChange={(v) => set('contractor_email', v)} disabled={!canEdit('alistamiento')} />
          <FormField label="Fecha instalación" type="date" value={form.installation_date} onChange={(v) => set('installation_date', v)} disabled={!canEdit('alistamiento')} />
        </StageSection>

        <StageSection title="Instalación (puesta en marcha)" stage="instalacion" canEdit={canEdit('instalacion')}>
          <FormField label="Lectura inicial (kWh)" type="number" value={form.lectura_inicial_kwh} onChange={(v) => set('lectura_inicial_kwh', v)} disabled={!canEdit('instalacion')} />
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="input-label" style={{ fontSize: '0.74rem', display: 'block', marginBottom: 4 }}>Acta de visita de instalación</label>
            <LinkedResourcePicker kind="visita_instalacion" casaHint={form.casa_numero || form.client_name || null} value={form.visita_instalacion_id} onChange={(v) => set('visita_instalacion_id', v)} disabled={!canEdit('instalacion')} />
          </div>
        </StageSection>

        <StageSection title="Otros" stage="dimensionado" canEdit={canEdit('dimensionado')}>
          <FormField label="Notas del proyecto" value={form.notes} onChange={(v) => set('notes', v)} fullWidth disabled={!canEdit('dimensionado')} />
        </StageSection>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} className="secondary-btn" disabled={saving}>Cancelar</button>
          <button onClick={submit} className="primary-btn" disabled={saving}>{saving ? 'Guardando…' : 'Guardar cambios'}</button>
        </div>
      </div>
    </div>
  );
}

/** Sección que se renderiza deshabilitada con candado si la etapa todavía no se alcanzó. */
function StageSection({ title, stage, canEdit, children }: { title: string; stage: string; canEdit: boolean; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16, position: 'relative', opacity: canEdit ? 1 : 0.55 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>{title}</div>
        {!canEdit && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 10, background: 'rgba(148, 163, 184, 0.15)', color: 'var(--text-muted)', fontSize: '0.66rem', fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>
            🔒 Se desbloquea al avanzar a {STAGE_LABEL[stage] ?? stage}
          </span>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, pointerEvents: canEdit ? 'auto' : 'none' }}>
        {children}
      </div>
    </div>
  );
}

function ModuleBadge({ stage, active }: { stage: string; active: boolean }) {
  const meta = OPERATIONS_STAGES.find((s) => s.key === stage);
  const bg = active ? (meta?.color ?? '#94a3b8') : 'var(--bg-elevated)';
  const fg = active ? 'white' : 'var(--text-muted)';
  return (
    <span style={{ padding: '3px 8px', borderRadius: 6, background: bg, color: fg, fontWeight: active ? 700 : 500 }}>
      Operaciones: {meta?.shortLabel ?? stage}
    </span>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 12 }}>
      {title && <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{title}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 6, fontSize: '0.82rem' }}>
        {children}
      </div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div style={{ padding: '4px 8px', background: 'var(--bg-surface)', borderRadius: 4 }}>
      <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: '0.82rem' }}>{value as React.ReactNode}</div>
    </div>
  );
}

/* ─────────────── TRANSITION MODAL ─────────────── */
interface DbField {
  id: string;
  field_key: string;
  field_label: string;
  field_type: 'text' | 'textarea' | 'number' | 'date' | 'datetime' | 'email' | 'url' | 'select';
  options: string[] | null;
  required: boolean;
  placeholder: string | null;
  help: string | null;
  sort_order: number;
}

function TransitionModal({ project, def, userEmail, onClose, onDone }: {
  project: CrmProject; def: TransitionDef; userEmail: string; onClose: () => void; onDone: () => void;
}) {
  const [fields, setFields] = useState<DbField[]>([]);
  const [fieldsLoading, setFieldsLoading] = useState(true);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // Cargar dinámicamente los campos configurados para la etapa destino.
    // Si la BD está vacía, el endpoint siembra automáticamente con los defaults.
    (async () => {
      try {
        const r = await fetch(`/api/crm/stage-fields?module=${def.toModule}&stage=${def.toStage}`);
        const j = await r.json();
        // Filtrar fields deprecados que aún puedan estar persistidos en crm_stage_fields.
        // 'reservation_id' fue retirado del flujo (la reserva se crea automáticamente
        // al pasar a Alistamiento, ya no se pide UUID a mano).
        const DEPRECATED_KEYS = new Set(['reservation_id']);
        const dbFields: DbField[] = (j.fields ?? []).filter((f: DbField) => !DEPRECATED_KEYS.has(f.field_key));
        setFields(dbFields);
        const init: Record<string, string> = {};
        const customDataRaw = (project as unknown as Record<string, unknown>).custom_data as Record<string, unknown> | undefined;
        for (const f of dbFields) {
          const cur = (project as unknown as Record<string, unknown>)[f.field_key] ?? customDataRaw?.[f.field_key];
          init[f.field_key] = cur === null || cur === undefined ? '' : String(cur);
        }
        setValues(init);
      } catch {
        // Fallback al def.requiredFields hardcoded
        const fallback: DbField[] = def.requiredFields.map((f, i) => ({
          id: `default-${f.key}`,
          field_key: f.key,
          field_label: f.label,
          field_type: f.type,
          options: f.options ?? null,
          required: f.required ?? false,
          placeholder: f.placeholder ?? null,
          help: f.help ?? null,
          sort_order: i,
        }));
        setFields(fallback);
      } finally {
        setFieldsLoading(false);
      }
    })();
  }, [def, project]);

  const submit = async () => {
    setErr(null);
    for (const f of fields) {
      if (f.required && !values[f.field_key]) { setErr(`${f.field_label} es requerido`); return; }
    }
    setSaving(true);
    const payload: Record<string, unknown> = { action: def.action, actor_email: userEmail };
    for (const f of fields) {
      const v = values[f.field_key];
      if (v === undefined || v === '') continue;
      payload[f.field_key] = f.field_type === 'number' ? Number(v) : v;
    }
    const r = await fetch(`/api/crm/projects/${project.id}/transition`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    const j = await r.json();
    if (!r.ok) {
      // Error con shortages: armar mensaje legible con bullets
      if (Array.isArray(j.shortages) && j.shortages.length > 0) {
        const bullets = (j.shortages as Array<{ family_label: string; needed: number; available: number }>)
          .map((s) => `  • ${s.family_label}: necesitas ${s.needed}, hay ${s.available} en bodega`)
          .join('\n');
        setErr(`${j.error ?? 'No se puede avanzar'}\n${bullets}`);
      } else {
        setErr(j.error ?? 'Error');
      }
      return;
    }

    // Side effects: mostrar al usuario qué pasó automáticamente
    const sideMessages: string[] = [];
    const se = j.side_effects ?? {};
    if (se.reservation) {
      const r = se.reservation as { reserved: Array<{ family: string; serial: string }>; shortages: Array<{ family: string; needed: number; available: number }> };
      if (r.reserved.length > 0) {
        sideMessages.push(`Reservados ${r.reserved.length} equipos en bodega: ${r.reserved.map((x) => x.serial).join(', ')}`);
      }
      if (r.shortages.length > 0) {
        const lines = r.shortages.map((s) => `${s.family}: necesario ${s.needed}, disponibles ${s.available}`);
        sideMessages.push(`Faltante de stock — ${lines.join(' · ')}`);
      }
    }
    if (se.installation) {
      const inst = se.installation as { installed: string[]; already_installed: string[]; skipped: string[]; reservation_fulfilled: boolean };
      if (inst.installed.length > 0) {
        sideMessages.push(`✅ ${inst.installed.length} equipo(s) marcados como Instalado en la casa: ${inst.installed.join(', ')}`);
      }
      if (inst.already_installed.length > 0) {
        sideMessages.push(`ℹ️ ${inst.already_installed.length} ya estaban instalados (skip): ${inst.already_installed.join(', ')}`);
      }
      if (inst.skipped.length > 0) {
        sideMessages.push(`⚠️ Items no procesados:\n${inst.skipped.join('\n')}`);
      }
      if (inst.reservation_fulfilled) {
        sideMessages.push('Reserva marcada como fulfilled.');
      }
    }
    if (se.facturacion?.created) {
      sideMessages.push('Registro de Facturación inicializado para este proyecto');
    }
    if (sideMessages.length > 0) {
      alert(sideMessages.join('\n\n'));
    }

    onDone();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: 560, padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace' }}>{project.code} · {project.title}</div>
            <h2 style={{ margin: '4px 0 0', fontSize: '1.05rem' }}>{def.label}</h2>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.4rem', padding: 0, lineHeight: 1 }}>×</button>
        </div>

        {err && <div className="alert-error" style={{ marginBottom: 10, fontSize: '0.82rem', whiteSpace: 'pre-line' }}>{err}</div>}

        {fieldsLoading ? (
          <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>Cargando campos…</p>
        ) : fields.length === 0 ? (
          <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>Esta transición no requiere datos adicionales. Confirma para ejecutar.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {fields.map((f) => (
              <div key={f.id}>
                <label className="input-label" style={{ fontSize: '0.78rem' }}>
                  {f.field_label}{f.required && <span style={{ color: '#ef4444', marginLeft: 3 }}>*</span>}
                </label>
                {(() => {
                  // Pickers buscables para campos que enlazan otros recursos
                  // (visitas + reservas de inventario). Reemplazan los inputs
                  // de UUID a mano por una lista filtrable cargada vía API.
                  const pickerKind: 'visita_previa' | 'visita_instalacion' | 'reservation' | null =
                    f.field_key === 'visita_previa_id' ? 'visita_previa'
                    : f.field_key === 'visita_instalacion_id' ? 'visita_instalacion'
                    : f.field_key === 'reservation_id' ? 'reservation'
                    : null;
                  if (pickerKind) {
                    return (
                      <LinkedResourcePicker
                        kind={pickerKind}
                        casaHint={project.casa_numero ?? project.client_name ?? null}
                        value={values[f.field_key] ?? ''}
                        onChange={(v) => setValues({ ...values, [f.field_key]: v })}
                      />
                    );
                  }
                  if (f.field_type === 'textarea') {
                    return <textarea value={values[f.field_key] ?? ''} onChange={(e) => setValues({ ...values, [f.field_key]: e.target.value })} placeholder={f.placeholder ?? undefined} rows={3} style={{ width: '100%' }} />;
                  }
                  if (f.field_type === 'select') {
                    return (
                      <select value={values[f.field_key] ?? ''} onChange={(e) => setValues({ ...values, [f.field_key]: e.target.value })}>
                        <option value="">— Selecciona —</option>
                        {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    );
                  }
                  return (
                    <input type={f.field_type === 'number' ? 'text' : f.field_type === 'date' ? 'date' : f.field_type} inputMode={f.field_type === 'number' ? 'decimal' : undefined}
                      value={values[f.field_key] ?? ''} onChange={(e) => setValues({ ...values, [f.field_key]: e.target.value })} placeholder={f.placeholder ?? undefined} style={{ width: '100%' }} />
                  );
                })()}
                {f.help && <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '3px 0 0' }}>{f.help}</p>}
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} className="secondary-btn" disabled={saving}>Cancelar</button>
          <button onClick={submit} className="primary-btn" disabled={saving}>
            {saving ? 'Procesando…' : def.buttonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────── CREATE PROJECT MODAL ─────────────── */
function CreateProjectModal({ userEmail, module, onClose, onCreated }: {
  userEmail: string;
  module: 'operations';
  onClose: () => void;
  onCreated: (p: CrmProject) => void;
}) {
  const isOps = module === 'operations';
  const [form, setForm] = useState<Record<string, string>>({});
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Cargar catálogo de categorías serializadas para los selectores de diseño
  type CatOpt = {
    id: string; name: string; family: string;
    default_brand: string | null;
    default_capacity_value: number | null;
    default_capacity_unit: string | null;
  };
  const [cats, setCats] = useState<CatOpt[]>([]);
  useEffect(() => {
    if (!isOps) return;
    void (async () => {
      try {
        const r = await fetch('/api/inventory/categories');
        if (!r.ok) return;
        const j = await r.json();
        setCats(((j.categories ?? []) as Array<CatOpt & { is_serialized: boolean }>)
          .filter((c) => c.is_serialized)
          .map((c) => ({
            id: c.id, name: c.name, family: c.family,
            default_brand: c.default_brand,
            default_capacity_value: c.default_capacity_value,
            default_capacity_unit: c.default_capacity_unit,
          })));
      } catch { /* opcional */ }
    })();
  }, [isOps]);
  const catsByFamily = (fam: string) => cats.filter((c) => c.family === fam);
  const catById = (id: string) => cats.find((c) => c.id === id);

  // En operaciones la card de Dimensionado requiere la ficha completa.
  // Para evitar duplicar el endpoint interno, usamos el endpoint externo
  // (que ya acepta module/stage). Pero como aún no hay key configurada por
  // defecto, llamamos al endpoint interno (que ya estaba para sales) y
  // luego — si es operations — hacemos un PATCH para llenar los campos del
  // dimensionado + mover al módulo correcto vía manipulación de stages.
  // Más simple: usar el endpoint POST /api/crm/projects que ya creamos y
  // adjuntar los campos en su body; el endpoint los persiste vía PATCH.

  const submit = async () => {
    setErr(null);
    if (!form.title?.trim()) { setErr('Título obligatorio'); return; }
    if (isOps && !form.client_name?.trim()) { setErr('Nombre del cliente obligatorio para crear en Operaciones'); return; }
    setSaving(true);
    try {
      // Un solo POST con module=operations + stage=dimensionado + todos los campos.
      // El endpoint inserta el proyecto directo en el estado deseado, sin chain de transiciones.
      const body: Record<string, unknown> = {
        title: form.title,
        created_by: userEmail,
      };
      if (isOps) {
        body.module = 'operations';
        body.stage = 'dimensionado';
      }
      // Pasar todos los campos del form al payload (el endpoint los coerce y descarta vacíos)
      for (const [k, v] of Object.entries(form)) {
        if (k === 'title') continue;
        if (v === '' || v === undefined || v === null) continue;
        body[k] = v;
      }

      // Derivar marca/potencia/capacidad desde las categorías elegidas
      // (así no le pedimos al usuario datos redundantes del catálogo).
      if (form.diseno_inversor_categoria_id) {
        const cat = catById(form.diseno_inversor_categoria_id);
        if (cat) {
          if (cat.default_brand && !body.diseno_inversor_marca) body.diseno_inversor_marca = cat.default_brand;
          if (cat.default_capacity_value && !body.diseno_inversor_potencia_kw) body.diseno_inversor_potencia_kw = cat.default_capacity_value;
        }
      }
      if (form.diseno_bateria_categoria_id) {
        const cat = catById(form.diseno_bateria_categoria_id);
        if (cat) {
          if (cat.default_brand && !body.diseno_bateria_marca) body.diseno_bateria_marca = cat.default_brand;
          if (cat.default_capacity_value && !body.diseno_bateria_capacidad_kwh) body.diseno_bateria_capacidad_kwh = cat.default_capacity_value;
        }
      }

      const r = await fetch('/api/crm/projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Error');
      onCreated(j.project as CrmProject);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: isOps ? 720 : 480, maxHeight: '90vh', overflowY: 'auto', padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: 0, fontSize: '1.05rem', marginBottom: 6 }}>
          {isOps ? 'Nuevo proyecto en Operaciones (Dimensionado)' : 'Nuevo proyecto'}
        </h2>
        {isOps && (
          <p style={{ margin: '0 0 14px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            El proyecto entra directo a la etapa de Dimensionado. Las etapas previas (Ventas + Ingeniería) se marcan como completadas automáticamente.
          </p>
        )}
        {err && <div className="alert-error" style={{ marginBottom: 10, fontSize: '0.82rem' }}>{err}</div>}

        {!isOps ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <FormField label="Título" required value={form.title ?? ''} onChange={(v) => set('title', v)} placeholder="Casa Andrés Sánchez - Cali" />
            <FormField label="Cliente (nombre)" value={form.client_name ?? ''} onChange={(v) => set('client_name', v)} />
            <FormField label="Ciudad" value={form.client_city ?? ''} onChange={(v) => set('client_city', v)} />
          </div>
        ) : (
          <>
            <FormSection title="Identificación">
              <FormField label="Título del proyecto" required value={form.title ?? ''} onChange={(v) => set('title', v)} placeholder="CONDOMINIO BOSQUES DE PANCE-1 (NOMBRE-CC)" fullWidth />
            </FormSection>

            <FormSection title="Cliente">
              <FormField label="Cliente (nombre)" required value={form.client_name ?? ''} onChange={(v) => set('client_name', v)} placeholder="ERIKA VANESSA BECERRA" />
              <FormField label="Ciudad" value={form.client_city ?? ''} onChange={(v) => set('client_city', v)} placeholder="Cali" />
              <FormField label="Conjunto" value={form.conjunto ?? ''} onChange={(v) => set('conjunto', v)} placeholder="CONDOMINIO BOSQUES DE PANCE" />
              <FormField label="Dirección" value={form.client_address ?? ''} onChange={(v) => set('client_address', v)} placeholder="Calle 16b 124 80" />
              <FormField label="Estrato" type="number" value={form.estrato ?? ''} onChange={(v) => set('estrato', v)} placeholder="6" />
              <FormField label="Casa #" value={form.casa_numero ?? ''} onChange={(v) => set('casa_numero', v)} placeholder="1" />
              <FormFieldSelect label="Carga carro eléctrico" value={form.carga_carro_electrico ?? ''} onChange={(v) => set('carga_carro_electrico', v)}
                options={['No tenemos carro eléctrico', 'Sí - Wallbox 7 kW', 'Sí - Wallbox 11 kW', 'Sí - Wallbox 22 kW', 'Sí - otro']} fullWidth />
            </FormSection>

            <FormSection title="Dimensionado">
              <FormField label="Promedio consumo (kWh/mes)" type="number" value={form.invoice_kwh_mensual ?? ''} onChange={(v) => set('invoice_kwh_mensual', v)} placeholder="440" />
              <FormField label="Autosuficiencia objetivo (%)" type="number" value={form.autosuficiencia_objetivo_pct ?? ''} onChange={(v) => set('autosuficiencia_objetivo_pct', v)} placeholder="90" />
              <FormField label="kWp diseño" type="number" value={form.diseno_kwp ?? ''} onChange={(v) => set('diseno_kwp', v)} placeholder="6" />
              <FormField label="Paneles (cantidad)" type="number" value={form.diseno_paneles ?? ''} onChange={(v) => set('diseno_paneles', v)} placeholder="6" />
              <FormField label="Baterías (cantidad)" type="number" value={form.diseno_baterias_cantidad ?? ''} onChange={(v) => set('diseno_baterias_cantidad', v)} placeholder="2" />
              <FormFieldSelect label="Tipo de red" value={form.tipo_red ?? ''} onChange={(v) => set('tipo_red', v)}
                options={['monofasica', 'bifasica', 'trifasica']} />
              <FormField label="Responsable" required value={form.diseno_aprobado_por ?? ''} onChange={(v) => set('diseno_aprobado_por', v)} placeholder="Santiago Andrés Osorio Huertas" />
              <FormField label="Notas del diseño" value={form.diseno_notes ?? ''} onChange={(v) => set('diseno_notes', v)} placeholder="Paneles JA Solar 595W · Inversor Livoltek 10K · Baterías Livoltek" fullWidth />
            </FormSection>

            <FormSection title="Equipos del catálogo">
              <CategoryPicker label="Modelo de inversor" value={form.diseno_inversor_categoria_id ?? ''} onChange={(v) => set('diseno_inversor_categoria_id', v)} options={catsByFamily('inverter')} />
              <CategoryPicker label="Modelo de batería"  value={form.diseno_bateria_categoria_id ?? ''} onChange={(v) => set('diseno_bateria_categoria_id', v)} options={catsByFamily('battery')} />
              <CategoryPicker label="Modelo de panel"    value={form.diseno_panel_categoria_id ?? ''}   onChange={(v) => set('diseno_panel_categoria_id', v)}   options={catsByFamily('panel')} fullWidth />
              <p style={{ gridColumn: '1 / -1', margin: 0, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                La marca y la potencia/capacidad se toman de la categoría elegida — no hace falta reescribirlas. Al pasar a <strong>Alistamiento</strong>, el sistema reserva automáticamente los equipos disponibles en bodega usando estos modelos. Si el modelo que necesitás no está en la lista, agrégalo primero en <strong>/inventario</strong>.
              </p>
            </FormSection>

            <FormSection title="Origen del diseño (acta de previa)">
              <div style={{ gridColumn: '1 / -1' }}>
                <label className="input-label" style={{ fontSize: '0.74rem', display: 'block', marginBottom: 4 }}>
                  Visita previa que sirvió de base
                </label>
                <LinkedResourcePicker
                  kind="visita_previa"
                  casaHint={form.casa_numero ?? form.client_name ?? null}
                  value={form.visita_previa_id ?? ''}
                  onChange={(v) => set('visita_previa_id', v)}
                />
                <p style={{ margin: '4px 0 0', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  Selecciona el acta de visita previa (completada en /visitas) que originó este dimensionamiento. Queda registrada para trazabilidad.
                </p>
              </div>
            </FormSection>
          </>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} className="secondary-btn" disabled={saving}>Cancelar</button>
          <button onClick={submit} className="primary-btn" disabled={saving}>{saving ? 'Creando…' : 'Crear proyecto'}</button>
        </div>
      </div>
    </div>
  );
}

/* Helpers de formulario reutilizables (sólo para CreateProjectModal por ahora) */
function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>{children}</div>
    </div>
  );
}
function FormField({ label, value, onChange, required, placeholder, type, fullWidth, disabled }: { label: string; value: string; onChange: (v: string) => void; required?: boolean; placeholder?: string; type?: string; fullWidth?: boolean; disabled?: boolean }) {
  return (
    <div style={{ gridColumn: fullWidth ? '1 / -1' : 'auto' }}>
      <label className="input-label" style={{ fontSize: '0.74rem' }}>{label}{required && <span style={{ color: '#ef4444' }}> *</span>}</label>
      <input type={type === 'number' ? 'text' : (type ?? 'text')} inputMode={type === 'number' ? 'decimal' : undefined} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} disabled={disabled} />
    </div>
  );
}
function FormFieldSelect({ label, value, onChange, options, fullWidth, disabled }: { label: string; value: string; onChange: (v: string) => void; options: string[]; fullWidth?: boolean; disabled?: boolean }) {
  return (
    <div style={{ gridColumn: fullWidth ? '1 / -1' : 'auto' }}>
      <label className="input-label" style={{ fontSize: '0.74rem' }}>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="">— Selecciona —</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

/** Select específico para categorías del inventario: la key es el id, el label es el nombre. */
/** Picker buscable de client_houses para vincular un proyecto. */
function HousePicker({ value, onChange, casaHint, disabled }: {
  value: string; onChange: (v: string) => void;
  casaHint?: string | null; disabled?: boolean;
}) {
  type House = { id: string; casa: string; cliente_id: string; location: string | null; city: string | null };
  const [houses, setHouses] = useState<House[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch('/api/houses')
      .then((r) => r.json())
      .then((j) => setHouses(j.houses ?? []))
      .finally(() => setLoading(false));
  }, []);

  const sorted = useMemo(() => {
    if (!casaHint) return houses;
    const hint = casaHint.toLowerCase();
    const matches = houses.filter((h) => h.casa.toLowerCase().includes(hint));
    const rest = houses.filter((h) => !h.casa.toLowerCase().includes(hint));
    return [...matches, ...rest];
  }, [houses, casaHint]);

  const filtered = useMemo(() => {
    if (!search.trim()) return sorted;
    const s = search.toLowerCase();
    return sorted.filter((h) =>
      h.casa.toLowerCase().includes(s) ||
      (h.location ?? '').toLowerCase().includes(s) ||
      (h.city ?? '').toLowerCase().includes(s)
    );
  }, [sorted, search]);

  const selected = houses.find((h) => h.id === value);

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => { if (!disabled) setOpen((v) => !v); }}
        disabled={disabled}
        style={{
          width: '100%', textAlign: 'left',
          padding: '8px 10px',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          fontSize: '0.82rem',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}
      >
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? `${selected.casa}${selected.city ? ' · ' + selected.city : ''}` : <span style={{ color: 'var(--text-muted)' }}>— Sin casa vinculada —</span>}
        </span>
        <span style={{ color: 'var(--text-muted)', flexShrink: 0, marginLeft: 8 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 60, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', maxHeight: 320, overflow: 'auto' }}>
          <input
            type="text"
            placeholder="Buscar casa, ubicación, ciudad…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
            style={{ width: '100%', padding: '8px 10px', border: 'none', borderBottom: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: '0.82rem' }}
          />
          {value && (
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); setSearch(''); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', border: 'none', borderBottom: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text-muted)' }}
            >
              Quitar vínculo
            </button>
          )}
          {loading ? (
            <div style={{ padding: 12, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Cargando…</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 12, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {houses.length === 0 ? 'No hay casas en client_houses. Créalas con /api/houses/build una vez los devices estén en Metrum.' : 'Sin resultados para esa búsqueda.'}
            </div>
          ) : (
            filtered.slice(0, 100).map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => { onChange(h.id); setOpen(false); setSearch(''); }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '8px 10px', border: 'none', borderBottom: '1px solid var(--border)',
                  background: h.id === value ? 'rgba(7, 197, 168, 0.08)' : 'transparent', cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>{h.casa}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  {[h.city, h.location].filter(Boolean).join(' · ') || h.cliente_id.slice(0, 8)}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function CategoryPicker({ label, value, onChange, options, fullWidth, disabled }: {
  label: string; value: string; onChange: (v: string) => void;
  options: Array<{ id: string; name: string }>; fullWidth?: boolean; disabled?: boolean;
}) {
  return (
    <div style={{ gridColumn: fullWidth ? '1 / -1' : 'auto' }}>
      <label className="input-label" style={{ fontSize: '0.74rem' }}>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="">{options.length === 0 ? '(no hay modelos en /inventario)' : '— Selecciona —'}</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </div>
  );
}

/* ─────────────── STAGE CONFIG MODAL ─────────────── */
function StageConfigModal({ module, stage, onClose }: {
  module: 'operations';
  stage: StageMeta;
  onClose: () => void;
}) {
  const [fields, setFields] = useState<Array<DbField & { is_custom?: boolean }>>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch(`/api/crm/stage-fields?module=${module}&stage=${stage.key}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Error');
      setFields(j.fields ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [module, stage.key]);

  const removeField = async (id: string, label: string) => {
    if (!confirm(`Quitar el campo "${label}"? Ya no se pedirá al avanzar a esta etapa. Los datos ya capturados no se borran.`)) return;
    const r = await fetch(`/api/crm/stage-fields?id=${id}`, { method: 'DELETE' });
    if (!r.ok) { const j = await r.json(); setErr(j.error ?? 'Error'); return; }
    load();
  };

  const toggleRequired = async (id: string, currentRequired: boolean) => {
    const r = await fetch('/api/crm/stage-fields', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, required: !currentRequired }),
    });
    if (r.ok) load();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: 640, maxHeight: '90vh', overflowY: 'auto', padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: stage.color }} />
              <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Campos de la etapa: {stage.shortLabel}</h2>
            </div>
            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              Estos son los datos que se piden al avanzar A esta etapa. Puedes agregar campos personalizados, quitar los que no apliquen, o cambiar si son obligatorios.
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.4rem', padding: 0, lineHeight: 1, marginLeft: 12 }}>×</button>
        </div>

        {err && <div className="alert-error" style={{ marginBottom: 10, fontSize: '0.82rem' }}>{err}</div>}

        {loading ? (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>Cargando…</div>
        ) : fields.length === 0 ? (
          <div className="alert-warning" style={{ fontSize: '0.82rem', marginBottom: 12 }}>
            Sin campos configurados. Esta etapa no pide datos extra al avanzar. Agrega uno si quieres capturar algo aquí.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            {fields.map((f) => (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--bg-elevated)', borderRadius: 8, borderLeft: `3px solid ${f.is_custom ? '#8b5cf6' : stage.color}` }}>
                <GripVertical size={14} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.86rem', fontWeight: 600 }}>
                    {f.field_label}
                    {f.is_custom && <span style={{ marginLeft: 6, fontSize: '0.66rem', padding: '1px 6px', borderRadius: 4, background: '#ede9fe', color: '#6d28d9', fontWeight: 700 }}>CUSTOM</span>}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace' }}>
                    {f.field_key} · {f.field_type}
                    {f.options && f.options.length > 0 && ` · ${f.options.length} opciones`}
                  </div>
                  {f.help && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>{f.help}</div>}
                </div>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.74rem', cursor: 'pointer', userSelect: 'none' }}>
                  <input type="checkbox" checked={f.required} onChange={() => toggleRequired(f.id, f.required)} />
                  Obligatorio
                </label>
                <button onClick={() => removeField(f.id, f.field_label)} title="Quitar"
                  style={{ padding: 6, background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', borderRadius: 4 }}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {!showAdd ? (
          <button onClick={() => setShowAdd(true)} className="secondary-btn" style={{ width: '100%', justifyContent: 'center', padding: '10px' }}>
            <Plus size={14} /> Agregar campo
          </button>
        ) : (
          <AddFieldForm module={module} stageKey={stage.key} onCancel={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); load(); }} />
        )}

        <div style={{ marginTop: 14, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          <strong>Tip:</strong> los campos por defecto se mapean a columnas existentes de la BD. Los campos custom (morados) se guardan en JSON dentro del proyecto.
        </div>
      </div>
    </div>
  );
}

function AddFieldForm({ module, stageKey, onCancel, onAdded }: {
  module: 'operations';
  stageKey: string;
  onCancel: () => void;
  onAdded: () => void;
}) {
  const [fieldKey, setFieldKey] = useState('');
  const [fieldLabel, setFieldLabel] = useState('');
  const [fieldType, setFieldType] = useState<DbField['field_type']>('text');
  const [optionsText, setOptionsText] = useState('');
  const [required, setRequired] = useState(false);
  const [placeholder, setPlaceholder] = useState('');
  const [help, setHelp] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!fieldLabel.trim()) { setErr('Etiqueta requerida'); return; }
    const key = (fieldKey || fieldLabel).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_');
    if (!key) { setErr('Key inválida'); return; }
    setSaving(true);
    const options = fieldType === 'select'
      ? optionsText.split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean)
      : null;
    const r = await fetch('/api/crm/stage-fields', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module, stage: stageKey,
        field_key: key, field_label: fieldLabel, field_type: fieldType,
        options, required, placeholder: placeholder || null, help: help || null,
        is_custom: true,
      }),
    });
    setSaving(false);
    const j = await r.json();
    if (!r.ok) { setErr(j.error ?? 'Error'); return; }
    onAdded();
  };

  return (
    <div style={{ padding: 14, background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border)' }}>
      <h3 style={{ margin: '0 0 10px', fontSize: '0.92rem' }}>Nuevo campo personalizado</h3>
      {err && <div className="alert-error" style={{ marginBottom: 10, fontSize: '0.78rem' }}>{err}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
        <div>
          <label className="input-label" style={{ fontSize: '0.74rem' }}>Etiqueta visible *</label>
          <input type="text" value={fieldLabel} onChange={(e) => setFieldLabel(e.target.value)} placeholder="Nombre del contacto" />
        </div>
        <div>
          <label className="input-label" style={{ fontSize: '0.74rem' }}>Tipo</label>
          <select value={fieldType} onChange={(e) => setFieldType(e.target.value as DbField['field_type'])}>
            <option value="text">Texto corto</option>
            <option value="textarea">Texto largo</option>
            <option value="number">Número</option>
            <option value="date">Fecha</option>
            <option value="email">Email</option>
            <option value="url">URL</option>
            <option value="select">Selección (dropdown)</option>
          </select>
        </div>
        <div>
          <label className="input-label" style={{ fontSize: '0.74rem' }}>Key (opcional)</label>
          <input type="text" value={fieldKey} onChange={(e) => setFieldKey(e.target.value)} placeholder="nombre_contacto" style={{ fontFamily: 'ui-monospace, monospace' }} />
          <p style={{ fontSize: '0.66rem', color: 'var(--text-muted)', margin: '2px 0 0' }}>Se deriva de la etiqueta si lo dejas vacío</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.78rem' }}>
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
            Obligatorio
          </label>
        </div>
      </div>
      {fieldType === 'select' && (
        <div style={{ marginBottom: 8 }}>
          <label className="input-label" style={{ fontSize: '0.74rem' }}>Opciones (una por línea o separadas por coma)</label>
          <textarea value={optionsText} onChange={(e) => setOptionsText(e.target.value)} rows={3} placeholder="Opción A&#10;Opción B&#10;Opción C" />
        </div>
      )}
      <div style={{ marginBottom: 8 }}>
        <label className="input-label" style={{ fontSize: '0.74rem' }}>Placeholder (opcional)</label>
        <input type="text" value={placeholder} onChange={(e) => setPlaceholder(e.target.value)} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label className="input-label" style={{ fontSize: '0.74rem' }}>Texto de ayuda (opcional)</label>
        <input type="text" value={help} onChange={(e) => setHelp(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} className="secondary-btn" disabled={saving}>Cancelar</button>
        <button onClick={submit} className="primary-btn" disabled={saving}>{saving ? 'Guardando…' : 'Crear campo'}</button>
      </div>
    </div>
  );
}

/* ─── ImportCsvModal: carga masiva de proyectos en Operaciones ──────────── */

// Columnas que el endpoint /api/crm/projects/bulk acepta. Las del bloque "obligatorias"
// son las que tienen sentido para una carga típica de Operaciones. El resto se mapea
// si el CSV las incluye, se ignoran si no.
const CSV_HEADERS_OBLIGATORIO = ['title'] as const;
const CSV_HEADERS_RECOMENDADOS = [
  'client_name', 'client_city', 'conjunto', 'casa_numero',
  'diseno_kwp', 'diseno_paneles', 'diseno_baterias_cantidad', 'diseno_aprobado_por',
] as const;
const CSV_HEADERS_OPCIONALES = [
  'client_email', 'client_phone', 'client_address', 'client_doc_type', 'client_doc_number',
  'estrato', 'tipo_vivienda', 'lat', 'lng', 'carga_carro_electrico',
  'autosuficiencia_objetivo_pct', 'invoice_kwh_mensual', 'invoice_valor_cop',
  'propuesta_kwp', 'propuesta_valor_cop', 'propuesta_url', 'contrato_url', 'oferta_url',
  'diseno_yield_estimado_kwh_mes', 'diseno_notes',
  'contractor_name', 'contractor_email', 'installation_date',
  'lectura_inicial_kwh', 'operativo_at',
  'zona',
  'agpe_operador_red', 'agpe_estado', 'agpe_fecha_estimada', 'agpe_fecha_aprobacion',
  'garantia_marca', 'garantia_equipo', 'garantia_falla', 'garantia_estado', 'garantia_retorno_bodega',
  'assigned_to', 'notes', 'stage',
] as const;

function parseCSV(text: string): Record<string, string>[] {
  const records: string[][] = [];
  let cur: string[] = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 2; continue; }
      if (ch === '"') { inQuotes = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { cur.push(cell); cell = ''; i++; continue; }
    if (ch === '\n' || ch === '\r') {
      cur.push(cell); cell = '';
      if (cur.length > 1 || (cur.length === 1 && cur[0] !== '')) records.push(cur);
      cur = [];
      if (ch === '\r' && text[i + 1] === '\n') i += 2; else i++;
      continue;
    }
    cell += ch; i++;
  }
  if (cell.length > 0 || cur.length > 0) { cur.push(cell); records.push(cur); }
  if (records.length < 2) return [];
  // Normalizar headers: trim, strip BOM, minúsculas para matchear sin importar caps
  const headers = records[0].map((h) => h.trim().replace(/^﻿/, '').toLowerCase());
  const rows: Record<string, string>[] = [];
  for (let r = 1; r < records.length; r++) {
    const cells = records[r];
    if (cells.length !== headers.length) continue;
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = (cells[idx] ?? '').trim(); });
    if (obj.title) rows.push(obj);
  }
  return rows;
}

function downloadCsvTemplate() {
  const headers = [...CSV_HEADERS_OBLIGATORIO, ...CSV_HEADERS_RECOMENDADOS, ...CSV_HEADERS_OPCIONALES];
  const exampleRow = [
    'CONDOMINIO BOSQUES DE PANCE-1 (ERIKA BECERRA)',
    'ERIKA VANESSA BECERRA', 'Cali', 'CONDOMINIO BOSQUES DE PANCE', '1',
    '6', '10', '2', 'Santiago Andrés Osorio',
  ];
  while (exampleRow.length < headers.length) exampleRow.push('');
  const lines = [
    headers.join(','),
    exampleRow.map((c) => (/[,"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','),
  ];
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'crm_operaciones_template.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function ImportCsvModal({ userEmail, onClose, onImported }: {
  userEmail: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ inserted: number; total: number; errors: Array<{ row: number; title: string; error: string }> } | null>(null);

  const onFile = async (file: File) => {
    setErr(null);
    setResult(null);
    setFileName(file.name);
    try {
      const text = await file.text();
      const parsed = parseCSV(text);
      if (parsed.length === 0) {
        setErr('No se detectaron filas válidas. Verifica que el CSV tenga encabezado y que cada fila tenga "title".');
        setRows([]);
        return;
      }
      setRows(parsed);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo leer el archivo');
      setRows([]);
    }
  };

  const submit = async () => {
    if (rows.length === 0) return;
    setSubmitting(true);
    setErr(null);
    try {
      const r = await fetch('/api/crm/projects/bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, created_by: userEmail, module: 'operations' }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setResult(j);
      if (j.errors?.length === 0) {
        // Si todo salió bien, dar un beat al usuario para ver el resultado y refrescar
        setTimeout(() => onImported(), 1200);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error');
    } finally {
      setSubmitting(false);
    }
  };

  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const preview = rows.slice(0, 5);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: 820, maxHeight: '90vh', overflowY: 'auto', padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: 0, fontSize: '1.05rem', marginBottom: 4 }}>Importar CSV — Operaciones</h2>
        <p style={{ margin: '0 0 14px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
          Cada fila se crea como un proyecto directo en Operaciones (etapa <strong>Dimensionado</strong> por defecto).
          La única columna obligatoria es <code>title</code>. Para sobreescribir la etapa por fila, incluye una columna <code>stage</code>.
        </p>

        {err && <div className="alert-error" style={{ marginBottom: 10, fontSize: '0.82rem' }}>{err}</div>}

        {!result && (
          <>
            <div style={{ marginBottom: 12, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              <button onClick={downloadCsvTemplate} className="secondary-btn" style={{ padding: '6px 12px', fontSize: '0.78rem', borderRadius: 6 }}>
                Descargar plantilla CSV
              </button>
              <span style={{ marginLeft: 10 }}>
                Encabezados reconocidos: <code>title</code> (requerido) + {CSV_HEADERS_RECOMENDADOS.length + CSV_HEADERS_OPCIONALES.length} opcionales (cliente, dimensionado, instalación, etc.).
              </span>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label className="input-label" style={{ fontSize: '0.78rem' }}>Archivo CSV</label>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
                style={{ display: 'block', fontSize: '0.82rem' }}
              />
              {fileName && rows.length > 0 && (
                <div style={{ marginTop: 6, fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                  <strong>{fileName}</strong> — {rows.length} fila{rows.length === 1 ? '' : 's'} detectada{rows.length === 1 ? '' : 's'} · {headers.length} columna{headers.length === 1 ? '' : 's'}
                </div>
              )}
            </div>

            {preview.length > 0 && (
              <div style={{ marginBottom: 14, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ padding: '8px 12px', fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-muted)', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}>
                  Vista previa (primeras 5 filas)
                </div>
                <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem' }}>
                    <thead>
                      <tr>
                        {headers.map((h) => (
                          <th key={h} style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((r, idx) => (
                        <tr key={idx}>
                          {headers.map((h) => (
                            <td key={h} style={{ padding: '5px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r[h]}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {result && (
          <div style={{ marginBottom: 14 }}>
            <div className={result.errors.length === 0 ? 'alert-success' : 'alert-warning'} style={{ fontSize: '0.86rem', marginBottom: 10 }}>
              <strong>{result.inserted}</strong> de {result.total} proyectos creados.
              {result.errors.length > 0 && <> · <strong>{result.errors.length}</strong> con error.</>}
            </div>
            {result.errors.length > 0 && (
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ padding: '8px 12px', fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-muted)', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}>
                  Filas con error
                </div>
                <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>Fila</th>
                        <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>Título</th>
                        <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.errors.map((e, idx) => (
                        <tr key={idx}>
                          <td style={{ padding: '5px 10px', borderBottom: '1px solid var(--border)' }}>{e.row}</td>
                          <td style={{ padding: '5px 10px', borderBottom: '1px solid var(--border)' }}>{e.title || <em style={{ color: 'var(--text-muted)' }}>(vacío)</em>}</td>
                          <td style={{ padding: '5px 10px', borderBottom: '1px solid var(--border)', color: '#ef4444' }}>{e.error}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          {result ? (
            <button onClick={onImported} className="primary-btn">Cerrar y refrescar</button>
          ) : (
            <>
              <button onClick={onClose} className="secondary-btn" disabled={submitting}>Cancelar</button>
              <button onClick={submit} className="primary-btn" disabled={submitting || rows.length === 0}>
                {submitting ? 'Importando…' : `Importar ${rows.length} fila${rows.length === 1 ? '' : 's'}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── LinkedResourcePicker: combobox buscable para visita_*_id / reservation_id ─── */
// Reemplaza el input de UUID a mano por una lista filtrable cargada por API.
// `casaHint` se usa para resaltar opciones de la misma casa al abrir.
type PickerKind = 'visita_previa' | 'visita_instalacion' | 'reservation';
interface PickerOption {
  id: string;
  label: string;
  meta: string;
  matchKey: string; // string concatenado para filtrar por search
}

function LinkedResourcePicker({ kind, casaHint, value, onChange, disabled }: {
  kind: PickerKind;
  casaHint: string | null;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const [options, setOptions] = useState<PickerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        if (kind === 'visita_previa' || kind === 'visita_instalacion') {
          const type = kind === 'visita_previa' ? 'previa' : 'instalacion';
          // Sin filtro de status → muestra draft + completed. Sin status las
          // visitas recién creadas (que aún no se completaron) también aparecen
          // para vincular ahora y completar después.
          const r = await fetch(`/api/visits?type=${type}&limit=200`);
          const j = await r.json();
          if (!r.ok) throw new Error(j.error ?? 'No se pudieron cargar visitas');
          const visits = (j.visits ?? []) as Array<{
            id: string; casa: string | null; visit_date: string | null;
            technician_name: string | null; status: string;
          }>;
          // Ordenar: completed primero (más relevantes), luego draft
          visits.sort((a, b) => {
            const order = (s: string) => s === 'completed' ? 0 : s === 'draft' ? 1 : 2;
            return order(a.status) - order(b.status);
          });
          const opts: PickerOption[] = visits.map((v) => {
            const statusBadge = v.status === 'completed' ? '✓ completada' : v.status === 'draft' ? '⋯ borrador' : v.status;
            return {
              id: v.id,
              label: `${v.casa ?? '(sin casa)'} · ${v.visit_date ?? '—'}`,
              meta: `${statusBadge}${v.technician_name ? ` · ${v.technician_name}` : ''}`,
              matchKey: `${v.casa ?? ''} ${v.visit_date ?? ''} ${v.technician_name ?? ''} ${v.status}`.toLowerCase(),
            };
          });
          if (!cancelled) setOptions(opts);
        } else {
          const r = await fetch(`/api/inventory/reservations?status=confirmed&limit=200`);
          const j = await r.json();
          if (!r.ok) throw new Error(j.error ?? 'No se pudieron cargar reservas');
          const resvs = (j.reservations ?? []) as Array<{
            id: string; title: string; status: string; created_at: string;
            inventory_reservation_items?: Array<{ id: string }> | null;
          }>;
          const opts: PickerOption[] = resvs.map((rv) => {
            const items = rv.inventory_reservation_items?.length ?? 0;
            return {
              id: rv.id,
              label: `${rv.title} · ${items} items`,
              meta: `${rv.status} · ${rv.created_at?.slice(0, 10) ?? ''}`,
              matchKey: `${rv.title} ${rv.status}`.toLowerCase(),
            };
          });
          if (!cancelled) setOptions(opts);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [kind]);

  // Ordenar: si hay casaHint y la opción coincide, ponerlas arriba
  const sorted = useMemo(() => {
    if (!casaHint) return options;
    const hint = casaHint.toLowerCase();
    const matches = options.filter((o) => o.matchKey.includes(hint));
    const rest = options.filter((o) => !o.matchKey.includes(hint));
    return [...matches, ...rest];
  }, [options, casaHint]);

  const filtered = useMemo(() => {
    if (!search.trim()) return sorted;
    const s = search.toLowerCase();
    return sorted.filter((o) => o.matchKey.includes(s) || o.id.toLowerCase().startsWith(s));
  }, [sorted, search]);

  const selected = options.find((o) => o.id === value);

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => { if (!disabled) setOpen((v) => !v); }}
        disabled={disabled}
        style={{
          width: '100%', textAlign: 'left',
          padding: '8px 10px',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          fontSize: '0.82rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected
            ? selected.label
            : <span style={{ color: 'var(--text-muted)' }}>— Selecciona —</span>}
        </span>
        <span style={{ color: 'var(--text-muted)', flexShrink: 0, marginLeft: 8 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute',
          top: '100%', left: 0, right: 0,
          marginTop: 4,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          maxHeight: 300,
          overflowY: 'auto',
          zIndex: 10,
          boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
        }}>
          <input
            type="text"
            placeholder="Buscar por casa, fecha, técnico…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
            style={{
              width: '100%',
              padding: '8px 10px',
              border: 'none',
              borderBottom: '1px solid var(--border)',
              fontSize: '0.82rem',
              outline: 'none',
              background: 'var(--bg-elevated)',
              borderRadius: 0,
              boxSizing: 'border-box',
            }}
          />
          {loading ? (
            <div style={{ padding: 12, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Cargando…</div>
          ) : error ? (
            <div style={{ padding: 12, fontSize: '0.8rem', color: '#ef4444' }}>{error}</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 12, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {options.length === 0 ? (
                <>
                  Sin opciones disponibles.
                  {(kind === 'visita_previa' || kind === 'visita_instalacion') && (
                    <div style={{ marginTop: 6 }}>
                      <a href="/visitas" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
                        Crear una visita en /visitas →
                      </a>
                    </div>
                  )}
                </>
              ) : 'Sin resultados para esa búsqueda.'}
            </div>
          ) : (
            filtered.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => { onChange(o.id); setOpen(false); setSearch(''); }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 10px',
                  border: 'none',
                  borderBottom: '1px solid var(--border)',
                  background: o.id === value ? 'rgba(7, 197, 168, 0.08)' : 'transparent',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                }}
              >
                <div style={{ fontWeight: 500 }}>{o.label}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  {o.meta} · <code style={{ fontFamily: 'ui-monospace, monospace' }}>{o.id.slice(0, 8)}…</code>
                </div>
              </button>
            ))
          )}
          {value && (
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); setSearch(''); }}
              style={{
                display: 'block', width: '100%',
                textAlign: 'center',
                padding: '6px 10px',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: '0.74rem',
                color: 'var(--text-muted)',
                borderTop: '1px solid var(--border)',
              }}
            >
              Limpiar selección
            </button>
          )}
        </div>
      )}
    </div>
  );
}
