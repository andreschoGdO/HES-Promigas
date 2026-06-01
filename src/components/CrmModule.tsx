'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Search, ArrowRight, ExternalLink, ChevronDown, ChevronUp, History, Settings, Trash2, GripVertical } from 'lucide-react';
import {
  type CrmModule, type StageMeta, type TransitionDef,
  SALES_STAGES, ENGINEERING_STAGES, OPERATIONS_STAGES,
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
  diseno_inversor_categoria_id: string | null;
  diseno_panel_categoria_id: string | null;
  diseno_bateria_categoria_id: string | null;
  diseno_yield_estimado_kwh_mes: number | null;
  diseno_notes: string | null;
  diseno_aprobado_por: string | null;
  diseno_aprobado_at: string | null;
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
}

const MODULE_STAGES: Record<CrmModule, StageMeta[]> = {
  sales: SALES_STAGES,
  engineering: ENGINEERING_STAGES,
  operations: OPERATIONS_STAGES,
  closed: [],
};

export function CrmModulePage({ module, title, description, color, userEmail }: {
  module: 'sales' | 'engineering' | 'operations';
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
  const [configStage, setConfigStage] = useState<StageMeta | null>(null);
  const stages = MODULE_STAGES[module];

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
      const stage = module === 'sales' ? p.sales_stage : module === 'engineering' ? p.engineering_stage : p.operations_stage;
      if (m.has(stage)) m.get(stage)!.push(p);
    }
    return m;
  }, [projects, stages, module]);

  return (
    <div style={{ maxWidth: 1600, margin: '0 auto', paddingBottom: 40 }}>
      {/* HEADER compacto estilo Pipefy */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 style={{ margin: 0, fontSize: '1.5rem', letterSpacing: '-0.02em' }}>{title}</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: 2, fontSize: '0.82rem' }}>{description}</p>
        </div>
        {module === 'sales' && (
          <button onClick={() => setShowCreate(true)} className="primary-btn" style={{ padding: '10px 16px', fontSize: '0.86rem', borderRadius: 8, fontWeight: 600, background: color, border: 'none' }}>
            <Plus size={15} /> Nuevo proyecto
          </button>
        )}
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
              {module === 'sales'
                ? 'Aún no hay proyectos. Crea el primero con "Nuevo proyecto" — empezará en la etapa Prospecto.'
                : module === 'engineering'
                  ? 'No hay proyectos esperando ingeniería. Aparecen aquí cuando Ventas marca un proyecto como Firmado.'
                  : 'No hay proyectos en operaciones. Aparecen aquí cuando Ingeniería solicita visita previa o aprueba un diseño.'}
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
      {showCreate && <CreateProjectModal userEmail={userEmail} onClose={() => setShowCreate(false)} onCreated={(p) => { setShowCreate(false); load(); setActiveProject(p); }} />}
      {configStage && <StageConfigModal module={module} stage={configStage} onClose={() => setConfigStage(null)} />}
    </div>
  );
}

/* ─────────────── KANBAN — estilo Pipefy ─────────────── */
function KanbanView({ stages, projectsByStage, onOpen, module, onAdvance, onConfigureStage }: {
  stages: StageMeta[];
  projectsByStage: Map<string, CrmProject[]>;
  onOpen: (p: CrmProject) => void;
  module: 'sales' | 'engineering' | 'operations';
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

/* ─────────── Card de proyecto, look Pipefy ─────────── */
function ProjectCard({ project, onOpen, module, onAdvance, stageColor }: {
  project: CrmProject;
  onOpen: () => void;
  module: 'sales' | 'engineering' | 'operations';
  onAdvance: (t: { project: CrmProject; def: TransitionDef }) => void;
  stageColor: string;
}) {
  const stage = module === 'sales' ? project.sales_stage : module === 'engineering' ? project.engineering_stage : project.operations_stage;
  const availableTransitions = transitionsFrom(module, stage);
  const fmt = (n: number | null) => n === null ? '—' : n.toLocaleString('es-CO');

  // Tags por módulo
  const tags: Array<{ label: string; bg: string; fg: string }> = [];
  if (project.client_city) tags.push({ label: project.client_city, bg: '#e2e8f0', fg: '#475569' });
  if (module === 'sales') {
    if (project.invoice_kwh_mensual) tags.push({ label: `${fmt(project.invoice_kwh_mensual)} kWh/mes`, bg: '#dbeafe', fg: '#1e40af' });
    if (project.propuesta_kwp) tags.push({ label: `${project.propuesta_kwp} kWp`, bg: '#ede9fe', fg: '#6d28d9' });
    if (project.propuesta_valor_cop) tags.push({ label: `$${(project.propuesta_valor_cop / 1_000_000).toFixed(1)}M`, bg: '#dcfce7', fg: '#166534' });
  }
  if (module === 'engineering') {
    if (project.diseno_kwp) tags.push({ label: `${project.diseno_kwp} kWp`, bg: '#ede9fe', fg: '#6d28d9' });
    if (project.diseno_paneles) tags.push({ label: `${project.diseno_paneles} paneles`, bg: '#fef3c7', fg: '#92400e' });
    if (project.diseno_yield_estimado_kwh_mes) tags.push({ label: `${Math.round(project.diseno_yield_estimado_kwh_mes)} kWh/m`, bg: '#dbeafe', fg: '#1e40af' });
  }
  if (module === 'operations') {
    if (project.diseno_kwp) tags.push({ label: `${project.diseno_kwp} kWp`, bg: '#ede9fe', fg: '#6d28d9' });
    if (project.diseno_paneles) tags.push({ label: `${project.diseno_paneles} paneles`, bg: '#fef3c7', fg: '#92400e' });
    if (project.diseno_baterias_cantidad) tags.push({ label: `${project.diseno_baterias_cantidad} bat.`, bg: '#fce7f3', fg: '#9d174d' });
    if (project.diseno_aprobado_por) tags.push({ label: `R: ${project.diseno_aprobado_por.split('@')[0].split(' ')[0]}`, bg: '#dcfce7', fg: '#166534' });
    if (project.installation_date) tags.push({ label: `Inst. ${project.installation_date}`, bg: '#fed7aa', fg: '#9a3412' });
    if (project.contractor_name) tags.push({ label: project.contractor_name, bg: '#fecaca', fg: '#991b1b' });
  }

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
  module: 'sales' | 'engineering' | 'operations';
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
              const stage = module === 'sales' ? p.sales_stage : module === 'engineering' ? p.engineering_stage : p.operations_stage;
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
  module: 'sales' | 'engineering' | 'operations';
  onAdvance: (t: { project: CrmProject; def: TransitionDef }) => void;
}) {
  const [project, setProject] = useState<CrmProject>(initial);
  const [events, setEvents] = useState<Array<{ id: string; event_type: string; from_module: string | null; to_module: string | null; from_stage: string | null; to_stage: string | null; actor_email: string | null; notes: string | null; created_at: string }>>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    fetch(`/api/crm/projects/${initial.id}`).then((r) => r.json()).then((j) => {
      if (j.project) setProject(j.project);
      setEvents(j.events ?? []);
    });
  }, [initial.id]);

  const stage = module === 'sales' ? project.sales_stage : module === 'engineering' ? project.engineering_stage : project.operations_stage;
  const trans = transitionsFrom(module, stage);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: 760, maxHeight: '90vh', overflowY: 'auto', padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{project.code}</div>
            <h2 style={{ margin: '4px 0 4px', fontSize: '1.15rem' }}>{project.title}</h2>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: '0.74rem' }}>
              <ModuleBadge module="sales" stage={project.sales_stage} active={project.current_module === 'sales'} />
              <ModuleBadge module="engineering" stage={project.engineering_stage} active={project.current_module === 'engineering'} />
              <ModuleBadge module="operations" stage={project.operations_stage} active={project.current_module === 'operations'} />
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.4rem', padding: 0, lineHeight: 1 }}>×</button>
        </div>

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
          <KV label="Paneles" value={project.diseno_paneles} />
          <KV label="Baterías" value={project.diseno_baterias_cantidad} />
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

        {/* Botones de transición */}
        {trans.length > 0 && (
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: 8, color: 'var(--text-muted)' }}>Próximas acciones disponibles:</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {trans.map((t) => (
                <button key={t.action} onClick={() => onAdvance({ project, def: t })}
                  className="primary-btn" style={{ justifyContent: 'space-between', textAlign: 'left' }}>
                  <span>{t.buttonLabel}</span>
                  <ArrowRight size={14} />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ModuleBadge({ module, stage, active }: { module: 'sales' | 'engineering' | 'operations'; stage: string; active: boolean }) {
  const labels: Record<string, string> = { sales: 'Ventas', engineering: 'Ingeniería', operations: 'Operaciones' };
  const stages = MODULE_STAGES[module];
  const meta = stages.find((s) => s.key === stage);
  const bg = active ? (meta?.color ?? '#94a3b8') : 'var(--bg-elevated)';
  const fg = active ? 'white' : 'var(--text-muted)';
  return (
    <span style={{ padding: '3px 8px', borderRadius: 6, background: bg, color: fg, fontWeight: active ? 700 : 500 }}>
      {labels[module]}: {meta?.shortLabel ?? stage}
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
        const dbFields: DbField[] = j.fields ?? [];
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
    if (!r.ok) { setErr(j.error ?? 'Error'); return; }
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

        {err && <div className="alert-error" style={{ marginBottom: 10, fontSize: '0.82rem' }}>{err}</div>}

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
                {f.field_type === 'textarea' ? (
                  <textarea value={values[f.field_key] ?? ''} onChange={(e) => setValues({ ...values, [f.field_key]: e.target.value })} placeholder={f.placeholder ?? undefined} rows={3} style={{ width: '100%' }} />
                ) : f.field_type === 'select' ? (
                  <select value={values[f.field_key] ?? ''} onChange={(e) => setValues({ ...values, [f.field_key]: e.target.value })}>
                    <option value="">— Selecciona —</option>
                    {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input type={f.field_type === 'number' ? 'text' : f.field_type === 'date' ? 'date' : f.field_type} inputMode={f.field_type === 'number' ? 'decimal' : undefined}
                    value={values[f.field_key] ?? ''} onChange={(e) => setValues({ ...values, [f.field_key]: e.target.value })} placeholder={f.placeholder ?? undefined} style={{ width: '100%' }} />
                )}
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
function CreateProjectModal({ userEmail, onClose, onCreated }: { userEmail: string; onClose: () => void; onCreated: (p: CrmProject) => void }) {
  const [title, setTitle] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientCity, setClientCity] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setErr(null);
    if (!title.trim()) { setErr('Título obligatorio'); return; }
    setSaving(true);
    const r = await fetch('/api/crm/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, client_name: clientName || null, client_city: clientCity || null, created_by: userEmail }),
    });
    setSaving(false);
    const j = await r.json();
    if (!r.ok) { setErr(j.error ?? 'Error'); return; }
    onCreated(j.project as CrmProject);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: 480, padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: 0, fontSize: '1.05rem', marginBottom: 14 }}>Nuevo proyecto</h2>
        {err && <div className="alert-error" style={{ marginBottom: 10, fontSize: '0.82rem' }}>{err}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label className="input-label" style={{ fontSize: '0.78rem' }}>Título <span style={{ color: '#ef4444' }}>*</span></label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Casa Andrés Sánchez - Cali" />
          </div>
          <div>
            <label className="input-label" style={{ fontSize: '0.78rem' }}>Cliente (nombre)</label>
            <input type="text" value={clientName} onChange={(e) => setClientName(e.target.value)} />
          </div>
          <div>
            <label className="input-label" style={{ fontSize: '0.78rem' }}>Ciudad</label>
            <input type="text" value={clientCity} onChange={(e) => setClientCity(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} className="secondary-btn" disabled={saving}>Cancelar</button>
          <button onClick={submit} className="primary-btn" disabled={saving}>{saving ? 'Creando…' : 'Crear proyecto'}</button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────── STAGE CONFIG MODAL ─────────────── */
function StageConfigModal({ module, stage, onClose }: {
  module: 'sales' | 'engineering' | 'operations';
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
  module: 'sales' | 'engineering' | 'operations';
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
