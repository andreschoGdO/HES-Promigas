'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Search, X, ArrowRight, Calculator, ExternalLink, ClipboardList, ChevronDown, ChevronUp, History } from 'lucide-react';
import {
  type CrmModule, type StageMeta, type TransitionDef,
  SALES_STAGES, ENGINEERING_STAGES, OPERATIONS_STAGES,
  TRANSITIONS, transitionsFrom,
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
    <div style={{ maxWidth: 1400, margin: '0 auto', paddingBottom: 40 }}>
      {/* HEADER */}
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0 }}>{title}</h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: 4, fontSize: '0.88rem' }}>{description}</p>
      </div>

      {/* Action bar */}
      <div className="glass-panel" style={{ padding: 14, marginBottom: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {module === 'sales' && (
          <button onClick={() => setShowCreate(true)} className="primary-btn"><Plus size={14} /> Nuevo proyecto</button>
        )}
        <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input type="text" placeholder="Buscar por código, título, cliente, email…"
            value={search} onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%', paddingLeft: 32 }} />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setView('kanban')} className={`chip ${view === 'kanban' ? 'active' : ''}`}>Kanban</button>
          <button onClick={() => setView('tabla')} className={`chip ${view === 'tabla' ? 'active' : ''}`}>Tabla</button>
        </div>
      </div>

      {loading ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Cargando…</div>
      ) : projects.length === 0 ? (
        <div className="alert-warning" style={{ fontSize: '0.85rem' }}>
          {module === 'sales'
            ? 'Aún no hay proyectos. Crea el primero con "Nuevo proyecto" — empezará en la etapa Prospecto.'
            : module === 'engineering'
              ? 'No hay proyectos esperando ingeniería. Aparecen aquí cuando Ventas marca un proyecto como Firmado.'
              : 'No hay proyectos en operaciones. Aparecen aquí cuando Ingeniería solicita visita previa o aprueba un diseño.'}
        </div>
      ) : view === 'kanban' ? (
        <KanbanView stages={stages} projectsByStage={projectsByStage} onOpen={setActiveProject} module={module} onAdvance={setTransition} />
      ) : (
        <TableView projects={projects} stages={stages} module={module} onOpen={setActiveProject} onAdvance={setTransition} />
      )}

      {activeProject && <ProjectDetailModal project={activeProject} onClose={() => setActiveProject(null)} onChanged={() => { setActiveProject(null); load(); }} userEmail={userEmail} module={module} onAdvance={setTransition} />}
      {transition && <TransitionModal project={transition.project} def={transition.def} userEmail={userEmail} onClose={() => setTransition(null)} onDone={() => { setTransition(null); load(); }} />}
      {showCreate && <CreateProjectModal userEmail={userEmail} onClose={() => setShowCreate(false)} onCreated={(p) => { setShowCreate(false); load(); setActiveProject(p); }} />}
    </div>
  );
}

/* ─────────────── KANBAN ─────────────── */
function KanbanView({ stages, projectsByStage, onOpen, module, onAdvance }: {
  stages: StageMeta[];
  projectsByStage: Map<string, CrmProject[]>;
  onOpen: (p: CrmProject) => void;
  module: 'sales' | 'engineering' | 'operations';
  onAdvance: (t: { project: CrmProject; def: TransitionDef }) => void;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${stages.length}, minmax(240px, 1fr))`, gap: 12, overflowX: 'auto' }}>
      {stages.map((s) => {
        const list = projectsByStage.get(s.key) ?? [];
        return (
          <div key={s.key} style={{ minWidth: 240 }}>
            <div style={{ padding: '10px 12px', borderRadius: '8px 8px 0 0', background: 'var(--bg-elevated)', borderTop: `3px solid ${s.color}`, borderLeft: '1px solid var(--border)', borderRight: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 700 }}>{s.shortLabel}</span>
                <span style={{ fontSize: '0.72rem', color: s.color, fontWeight: 700 }}>{list.length}</span>
              </div>
              <p style={{ margin: '4px 0 0', fontSize: '0.68rem', color: 'var(--text-muted)', lineHeight: 1.35 }}>{s.description}</p>
            </div>
            <div style={{ padding: 8, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 8px 8px', minHeight: 200, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {list.length === 0 ? (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'center', padding: 20, fontStyle: 'italic' }}>Vacío</div>
              ) : list.map((p) => (
                <ProjectCard key={p.id} project={p} onOpen={() => onOpen(p)} module={module} onAdvance={onAdvance} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ProjectCard({ project, onOpen, module, onAdvance }: {
  project: CrmProject;
  onOpen: () => void;
  module: 'sales' | 'engineering' | 'operations';
  onAdvance: (t: { project: CrmProject; def: TransitionDef }) => void;
}) {
  const stage = module === 'sales' ? project.sales_stage : module === 'engineering' ? project.engineering_stage : project.operations_stage;
  const availableTransitions = transitionsFrom(module, stage);
  const fmt = (n: number | null) => n === null ? '—' : n.toLocaleString('es-CO');

  return (
    <div className="glass-panel" style={{ padding: 10, cursor: 'pointer', border: '1px solid var(--border)' }} onClick={onOpen}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.66rem', color: 'var(--text-muted)' }}>{project.code}</span>
      </div>
      <div style={{ fontSize: '0.84rem', fontWeight: 600, marginBottom: 4 }}>{project.title}</div>
      {project.client_name && <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>{project.client_name}</div>}
      {project.client_city && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{project.client_city}</div>}

      {/* Mini-stats por módulo */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        {module === 'sales' && project.invoice_kwh_mensual && (
          <span style={{ fontSize: '0.66rem', padding: '2px 6px', background: 'var(--bg-elevated)', borderRadius: 6 }}>{fmt(project.invoice_kwh_mensual)} kWh/mes</span>
        )}
        {module === 'sales' && project.propuesta_valor_cop && (
          <span style={{ fontSize: '0.66rem', padding: '2px 6px', background: 'var(--bg-elevated)', borderRadius: 6 }}>${fmt(project.propuesta_valor_cop)}</span>
        )}
        {module === 'engineering' && project.diseno_kwp && (
          <span style={{ fontSize: '0.66rem', padding: '2px 6px', background: 'var(--bg-elevated)', borderRadius: 6 }}>{project.diseno_kwp} kWp</span>
        )}
        {module === 'engineering' && project.diseno_paneles && (
          <span style={{ fontSize: '0.66rem', padding: '2px 6px', background: 'var(--bg-elevated)', borderRadius: 6 }}>{project.diseno_paneles} paneles</span>
        )}
        {module === 'operations' && project.installation_date && (
          <span style={{ fontSize: '0.66rem', padding: '2px 6px', background: 'var(--bg-elevated)', borderRadius: 6 }}>Inst: {project.installation_date}</span>
        )}
        {module === 'operations' && project.contractor_name && (
          <span style={{ fontSize: '0.66rem', padding: '2px 6px', background: 'var(--bg-elevated)', borderRadius: 6 }}>{project.contractor_name}</span>
        )}
      </div>

      {availableTransitions.length > 0 && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {availableTransitions.map((t) => (
            <button key={t.action} onClick={(e) => { e.stopPropagation(); onAdvance({ project, def: t }); }}
              style={{ fontSize: '0.7rem', padding: '4px 8px', borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--accent)10', color: 'var(--accent)', cursor: 'pointer', textAlign: 'left' }}>
              {t.buttonLabel}
            </button>
          ))}
        </div>
      )}
    </div>
  );
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
function TransitionModal({ project, def, userEmail, onClose, onDone }: {
  project: CrmProject; def: TransitionDef; userEmail: string; onClose: () => void; onDone: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of def.requiredFields) {
      const cur = (project as unknown as Record<string, unknown>)[f.key];
      init[f.key] = cur === null || cur === undefined ? '' : String(cur);
    }
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    for (const f of def.requiredFields) {
      if (f.required && !values[f.key]) { setErr(`${f.label} es requerido`); return; }
    }
    setSaving(true);
    const payload: Record<string, unknown> = { action: def.action, actor_email: userEmail };
    for (const [k, v] of Object.entries(values)) {
      const field = def.requiredFields.find((f) => f.key === k);
      if (!field || v === '') continue;
      if (field.type === 'number') payload[k] = Number(v);
      else payload[k] = v;
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

        {def.requiredFields.length === 0 ? (
          <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>Esta transición no requiere datos adicionales. Confirma para ejecutar.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {def.requiredFields.map((f) => (
              <div key={f.key}>
                <label className="input-label" style={{ fontSize: '0.78rem' }}>
                  {f.label}{f.required && <span style={{ color: '#ef4444', marginLeft: 3 }}>*</span>}
                </label>
                {f.type === 'textarea' ? (
                  <textarea value={values[f.key] ?? ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} placeholder={f.placeholder} rows={3} style={{ width: '100%' }} />
                ) : f.type === 'select' ? (
                  <select value={values[f.key] ?? ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}>
                    <option value="">— Selecciona —</option>
                    {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input type={f.type === 'number' ? 'text' : f.type === 'date' ? 'date' : f.type} inputMode={f.type === 'number' ? 'decimal' : undefined}
                    value={values[f.key] ?? ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} placeholder={f.placeholder} style={{ width: '100%' }} />
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
