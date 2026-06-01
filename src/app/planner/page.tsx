'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CalendarRange, ListTodo, BarChartHorizontal, Calendar as CalendarIcon, LayoutGrid,
  Plus, Upload, Download, Trash2, Pencil, Search, AlertCircle, AlertTriangle, Zap, Info,
  ChevronLeft, ChevronRight, X, CheckCircle2, Clock, Circle, MinusCircle,
} from 'lucide-react';

type Urgency = 'low' | 'medium' | 'high' | 'critical';
type Status = 'todo' | 'in_progress' | 'done' | 'blocked';

interface PlannerTask {
  id: string;
  title: string;
  description: string | null;
  assigned_to: string | null;
  urgency: Urgency;
  status: Status;
  start_date: string | null;
  due_date: string | null;
  tags: string[] | null;
  project_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface AppUser {
  id: string;
  email: string;
  name: string | null;
}

type ViewMode = 'kanban' | 'lista' | 'gantt' | 'calendario';

const URGENCY_META: Record<Urgency, { label: string; color: string; icon: typeof AlertCircle }> = {
  critical: { label: 'Crítica', color: '#dc2626', icon: Zap },
  high:     { label: 'Alta',    color: '#ef4444', icon: AlertCircle },
  medium:   { label: 'Media',   color: '#f59e0b', icon: AlertTriangle },
  low:      { label: 'Baja',    color: '#3b82f6', icon: Info },
};

const STATUS_META: Record<Status, { label: string; color: string; icon: typeof Circle }> = {
  todo:        { label: 'Por hacer',   color: '#94a3b8', icon: Circle },
  in_progress: { label: 'En progreso', color: '#3b82f6', icon: Clock },
  done:        { label: 'Completada',  color: '#10b981', icon: CheckCircle2 },
  blocked:     { label: 'Bloqueada',   color: '#ef4444', icon: MinusCircle },
};

const URGENCY_ORDER: Urgency[] = ['critical', 'high', 'medium', 'low'];
const STATUS_ORDER: Status[] = ['todo', 'in_progress', 'blocked', 'done'];

const toIsoDate = (d: Date): string => d.toISOString().slice(0, 10);
const todayIso = (): string => toIsoDate(new Date());

export default function PlannerPage() {
  const [tasks, setTasks] = useState<PlannerTask[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>('kanban');
  const [editing, setEditing] = useState<PlannerTask | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  // Filtros
  const [filterUrgency, setFilterUrgency] = useState<Urgency | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<Status | 'all'>('all');
  const [filterAssignee, setFilterAssignee] = useState<string>('');
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    const r = await fetch('/api/planner/tasks');
    const j = await r.json();
    setTasks(j.tasks ?? []);
    setLoading(false);
  };

  const loadUsers = async () => {
    try {
      const r = await fetch('/api/users');
      const j = await r.json();
      if (j.users) setUsers(j.users);
    } catch {
      // Si falla, el dropdown muestra solo lo que viene del campo libre — no bloqueamos
    }
  };

  useEffect(() => { load(); loadUsers(); }, []);

  // Lista de asignados únicos para el dropdown de filtro
  const assignees = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) if (t.assigned_to) set.add(t.assigned_to);
    return Array.from(set).sort();
  }, [tasks]);

  // Aplicar filtros
  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (filterUrgency !== 'all' && t.urgency !== filterUrgency) return false;
      if (filterStatus !== 'all' && t.status !== filterStatus) return false;
      if (filterAssignee && t.assigned_to !== filterAssignee) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hit = (t.title?.toLowerCase().includes(q))
          || (t.description?.toLowerCase().includes(q))
          || (t.assigned_to?.toLowerCase().includes(q))
          || (t.tags ?? []).some((tg) => tg.toLowerCase().includes(q));
        if (!hit) return false;
      }
      return true;
    });
  }, [tasks, filterUrgency, filterStatus, filterAssignee, search]);

  // Stats
  const stats = useMemo(() => {
    const today = todayIso();
    let pending = 0, inProgress = 0, overdue = 0, doneToday = 0;
    for (const t of tasks) {
      if (t.status === 'done') {
        if (t.completed_at && t.completed_at.slice(0, 10) === today) doneToday++;
      } else if (t.status === 'in_progress') {
        inProgress++;
        if (t.due_date && t.due_date < today) overdue++;
      } else if (t.status === 'todo' || t.status === 'blocked') {
        pending++;
        if (t.due_date && t.due_date < today) overdue++;
      }
    }
    return { pending, inProgress, overdue, doneToday, total: tasks.length };
  }, [tasks]);

  const onDelete = async (id: string) => {
    if (!confirm('¿Eliminar esta tarea?')) return;
    const r = await fetch(`/api/planner/tasks?id=${id}`, { method: 'DELETE' });
    if (!r.ok) {
      const j = await r.json();
      setMsg({ kind: 'error', text: j.error ?? 'Error al eliminar' });
      return;
    }
    setTasks((cur) => cur.filter((t) => t.id !== id));
  };

  const onCycleStatus = async (task: PlannerTask) => {
    // todo -> in_progress -> done -> todo (blocked se cambia manualmente)
    const next: Status = task.status === 'todo' ? 'in_progress'
      : task.status === 'in_progress' ? 'done'
      : task.status === 'done' ? 'todo'
      : 'todo';
    const r = await fetch('/api/planner/tasks', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: task.id, status: next }),
    });
    if (!r.ok) {
      const j = await r.json();
      setMsg({ kind: 'error', text: j.error ?? 'Error' });
      return;
    }
    const j = await r.json();
    setTasks((cur) => cur.map((t) => (t.id === task.id ? j.task : t)));
  };

  const exportCsv = () => {
    const header = ['title', 'description', 'assigned_to', 'urgency', 'status', 'start_date', 'due_date', 'tags'];
    const lines = [header.join(',')];
    for (const t of filtered) {
      const row = [
        t.title, t.description ?? '', t.assigned_to ?? '', t.urgency, t.status,
        t.start_date ?? '', t.due_date ?? '', (t.tags ?? []).join(';'),
      ].map((v) => {
        const s = String(v);
        return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      });
      lines.push(row.join(','));
    }
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `planner-tasks-${todayIso()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <CalendarRange size={22} style={{ color: 'var(--accent)' }} />
            <h1 style={{ margin: 0 }}>Planner</h1>
          </div>
          <p style={{ color: 'var(--text-secondary)', marginTop: 4, fontSize: '0.88rem' }}>
            Gestor de tareas: crea manualmente o importa por CSV, asigna a una persona, marca urgencia y visualiza en lista, Gantt o calendario.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="secondary-btn" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download size={14} /> Exportar CSV
          </button>
          <button className="secondary-btn" onClick={() => setImporting(true)}>
            <Upload size={14} /> Importar CSV
          </button>
          <button className="primary-btn" onClick={() => setCreating(true)}>
            <Plus size={14} /> Nueva tarea
          </button>
        </div>
      </div>

      {msg && <div className={msg.kind === 'success' ? 'alert-success' : 'alert-error'} style={{ marginTop: 12 }}>{msg.text}</div>}

      {/* STATS compactas (una sola fila) */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <StatCard color="#94a3b8" label="Pendientes" value={stats.pending} />
        <StatCard color="#3b82f6" label="En progreso" value={stats.inProgress} />
        <StatCard color="#ef4444" label="Vencidas"   value={stats.overdue}    highlight={stats.overdue > 0} />
        <StatCard color="#10b981" label="Hechas hoy" value={stats.doneToday}  />
        <StatCard color="#64748b" label="Total"      value={stats.total} />
      </div>

      {/* FILTROS — una sola fila, todo inline */}
      <div className="glass-panel" style={{ marginTop: 10, padding: '8px 10px' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 180 }}>
            <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', zIndex: 1 }} />
            <input
              type="text"
              placeholder="Buscar…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: 26, paddingTop: 5, paddingBottom: 5, fontSize: '0.8rem' }}
            />
          </div>
          <div style={{ width: 200, flexShrink: 0 }}>
            <select value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)}
              style={{ fontSize: '0.8rem', paddingTop: 5, paddingBottom: 5 }}>
              <option value="">Todos los responsables</option>
              {assignees.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div style={{ width: 170, flexShrink: 0 }}>
            <select value={filterUrgency} onChange={(e) => setFilterUrgency(e.target.value as Urgency | 'all')}
              style={{ fontSize: '0.8rem', paddingTop: 5, paddingBottom: 5 }}>
              <option value="all">Urgencia: todas</option>
              {URGENCY_ORDER.map((u) => <option key={u} value={u}>{URGENCY_META[u].label}</option>)}
            </select>
          </div>
          <div style={{ width: 170, flexShrink: 0 }}>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as Status | 'all')}
              style={{ fontSize: '0.8rem', paddingTop: 5, paddingBottom: 5 }}>
              <option value="all">Estado: todos</option>
              {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
          </div>
          {(filterUrgency !== 'all' || filterStatus !== 'all' || filterAssignee !== '' || search !== '') && (
            <button onClick={() => { setFilterUrgency('all'); setFilterStatus('all'); setFilterAssignee(''); setSearch(''); }}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.74rem', padding: '2px 6px', whiteSpace: 'nowrap' }}>
              Limpiar · {filtered.length}/{tasks.length}
            </button>
          )}
        </div>
      </div>

      {/* VIEW TABS */}
      <div style={{ display: 'flex', gap: 6, marginTop: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        {([
          { key: 'kanban' as const, label: 'Kanban', icon: LayoutGrid, color: '#ef4444' },
          { key: 'lista' as const, label: 'Lista', icon: ListTodo, color: '#07c5a8' },
          { key: 'gantt' as const, label: 'Gantt', icon: BarChartHorizontal, color: '#8b5cf6' },
          { key: 'calendario' as const, label: 'Calendario', icon: CalendarIcon, color: '#f59e0b' },
        ]).map((v) => (
          <button key={v.key} onClick={() => setView(v.key)} className={`chip ${view === v.key ? 'active' : ''}`}
            style={{ fontSize: '0.8rem', padding: '6px 10px', borderLeft: `3px solid ${v.color}`, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <v.icon size={13} /> {v.label}
          </button>
        ))}
      </div>

      {/* VIEW CONTENT */}
      {loading ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>Cargando…</div>
      ) : filtered.length === 0 ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
          {tasks.length === 0 ? 'No hay tareas. Crea la primera con "Nueva tarea" o importa un CSV.' : 'Ninguna tarea coincide con los filtros actuales.'}
        </div>
      ) : view === 'kanban' ? (
        <KanbanView tasks={filtered} onEdit={setEditing} onStatusChange={async (task, next) => {
          const r = await fetch('/api/planner/tasks', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: task.id, status: next }),
          });
          if (!r.ok) { const j = await r.json(); setMsg({ kind: 'error', text: j.error ?? 'Error' }); return; }
          const j = await r.json();
          setTasks((cur) => cur.map((t) => (t.id === task.id ? j.task : t)));
        }} />
      ) : view === 'lista' ? (
        <TaskListView tasks={filtered} onEdit={setEditing} onDelete={onDelete} onCycleStatus={onCycleStatus} />
      ) : view === 'gantt' ? (
        <GanttView tasks={filtered} onEdit={setEditing} />
      ) : (
        <CalendarView tasks={filtered} onEdit={setEditing} />
      )}

      {/* MODALS */}
      {creating && (
        <TaskFormModal
          mode="create"
          users={users}
          onClose={() => setCreating(false)}
          onSaved={(t) => { setTasks((cur) => [t, ...cur]); setCreating(false); }}
        />
      )}
      {editing && (
        <TaskFormModal
          mode="edit"
          initial={editing}
          users={users}
          onClose={() => setEditing(null)}
          onSaved={(t) => { setTasks((cur) => cur.map((x) => x.id === t.id ? t : x)); setEditing(null); }}
          onDeleted={(id) => { setTasks((cur) => cur.filter((x) => x.id !== id)); setEditing(null); }}
        />
      )}
      {importing && (
        <CsvImportModal
          onClose={() => setImporting(false)}
          onDone={(count, errors) => {
            setImporting(false);
            const txt = errors > 0
              ? `Importadas ${count} tareas, ${errors} fila(s) con error`
              : `Importadas ${count} tareas`;
            setMsg({ kind: errors > 0 ? 'error' : 'success', text: txt });
            load();
          }}
        />
      )}
    </>
  );
}

/* ─────────────── StatCard (compacto) ─────────────── */
function StatCard({ color, label, value, highlight }: { color: string; label: string; value: number; highlight?: boolean }) {
  return (
    <div className="glass-panel" style={{ padding: '6px 10px', borderLeft: `3px solid ${color}`, background: highlight ? `${color}08` : undefined, display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: '1.15rem', fontWeight: 700, color: highlight ? color : 'var(--text-primary)', lineHeight: 1, minWidth: 28 }}>{value}</span>
      <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', lineHeight: 1.2 }}>{label}</span>
    </div>
  );
}

/* ─────────────── Vista Kanban ─────────────── */
function KanbanView({ tasks, onEdit, onStatusChange }: {
  tasks: PlannerTask[];
  onEdit: (t: PlannerTask) => void;
  onStatusChange: (t: PlannerTask, next: Status) => void;
}) {
  // Agrupar tareas por status; dentro de cada columna ordenar por urgencia y luego due_date
  const urgencyRank: Record<Urgency, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const grouped = useMemo(() => {
    const m: Record<Status, PlannerTask[]> = { todo: [], in_progress: [], blocked: [], done: [] };
    for (const t of tasks) m[t.status].push(t);
    for (const s of STATUS_ORDER) {
      m[s].sort((a, b) => {
        const u = urgencyRank[a.urgency] - urgencyRank[b.urgency];
        if (u !== 0) return u;
        return (a.due_date ?? 'zzzz').localeCompare(b.due_date ?? 'zzzz');
      });
    }
    return m;
  }, [tasks]);

  const [dragOver, setDragOver] = useState<Status | null>(null);
  const today = todayIso();

  const onDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData('text/plain', taskId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDrop = (e: React.DragEvent, target: Status) => {
    e.preventDefault();
    setDragOver(null);
    const taskId = e.dataTransfer.getData('text/plain');
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === target) return;
    onStatusChange(task, target);
  };

  return (
    <div style={{ width: '100%', maxWidth: '100%', overflowX: 'auto', overflowY: 'visible', paddingBottom: 8 }}>
      <div style={{ display: 'flex', gap: 12, minWidth: 'min-content' }}>
      {STATUS_ORDER.map((s) => {
        const sm = STATUS_META[s];
        const SIcon = sm.icon;
        const list = grouped[s];
        const isDropping = dragOver === s;
        return (
          <div key={s}
            onDragOver={(e) => { e.preventDefault(); setDragOver(s); }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => onDrop(e, s)}
            className="glass-panel"
            style={{
              padding: 12,
              borderTop: `4px solid ${sm.color}`,
              minHeight: 820,
              width: 280,
              minWidth: 280,
              maxWidth: 280,
              flexShrink: 0,
              flexGrow: 0,
              background: isDropping ? `${sm.color}10` : undefined,
              outline: isDropping ? `2px dashed ${sm.color}` : undefined,
              outlineOffset: -2,
              display: 'flex',
              flexDirection: 'column',
            }}>
            {/* Header de columna */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px 10px', borderBottom: '1px solid var(--border)', marginBottom: 10 }}>
              <SIcon size={14} style={{ color: sm.color }} />
              <strong style={{ fontSize: '0.88rem' }}>{sm.label}</strong>
              <span style={{ marginLeft: 'auto', fontSize: '0.72rem', padding: '1px 8px', borderRadius: 10, background: sm.color + '20', color: sm.color, fontWeight: 700 }}>
                {list.length}
              </span>
            </div>

            {/* Cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {list.length === 0 ? (
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>
                  Sin tareas
                </div>
              ) : list.map((t) => {
                const um = URGENCY_META[t.urgency];
                const UIcon = um.icon;
                const overdue = t.due_date && t.due_date < today && t.status !== 'done';
                return (
                  <div key={t.id}
                    draggable
                    onDragStart={(e) => onDragStart(e, t.id)}
                    onClick={() => onEdit(t)}
                    style={{
                      padding: 10,
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border)',
                      borderLeft: `3px solid ${um.color}`,
                      borderRadius: 6,
                      cursor: 'grab',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                      display: 'flex', flexDirection: 'column', gap: 6,
                    }}>
                    {/* Urgencia + título */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, justifyContent: 'space-between' }}>
                      <strong style={{
                        fontSize: '0.86rem',
                        textDecoration: t.status === 'done' ? 'line-through' : undefined,
                        color: t.status === 'done' ? 'var(--text-muted)' : 'var(--text-primary)',
                        lineHeight: 1.35,
                        flex: 1,
                      }}>
                        {t.title}
                      </strong>
                      <span title={um.label} style={{ flexShrink: 0, padding: 2, borderRadius: 4, background: um.color + '20', display: 'inline-flex' }}>
                        <UIcon size={11} style={{ color: um.color }} />
                      </span>
                    </div>

                    {t.description && (
                      <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {t.description}
                      </span>
                    )}

                    {/* Tags */}
                    {t.tags && t.tags.length > 0 && (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {t.tags.slice(0, 4).map((tag) => (
                          <span key={tag} style={{ fontSize: '0.62rem', padding: '1px 5px', borderRadius: 6, background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Footer: responsable + fecha */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, fontSize: '0.72rem', marginTop: 2 }}>
                      <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {t.assigned_to ?? <em style={{ opacity: 0.6 }}>sin asignar</em>}
                      </span>
                      {t.due_date && (
                        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.7rem', color: overdue ? '#ef4444' : 'var(--text-secondary)', fontWeight: overdue ? 700 : 400 }}>
                          {t.due_date.slice(5)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}

/* ─────────────── Vista Lista ─────────────── */
function TaskListView({ tasks, onEdit, onDelete, onCycleStatus }: {
  tasks: PlannerTask[];
  onEdit: (t: PlannerTask) => void;
  onDelete: (id: string) => void;
  onCycleStatus: (t: PlannerTask) => void;
}) {
  type SortKey = 'due_date' | 'urgency' | 'title' | 'assignee' | 'status';
  const [sortKey, setSortKey] = useState<SortKey>('due_date');
  const [sortAsc, setSortAsc] = useState(true);

  const urgencyRank: Record<Urgency, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const statusRank: Record<Status, number> = { todo: 0, in_progress: 1, blocked: 2, done: 3 };

  const sorted = useMemo(() => {
    const arr = [...tasks];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'due_date':
          cmp = (a.due_date ?? 'zzzz').localeCompare(b.due_date ?? 'zzzz');
          break;
        case 'urgency':
          cmp = urgencyRank[a.urgency] - urgencyRank[b.urgency];
          break;
        case 'title':
          cmp = a.title.localeCompare(b.title);
          break;
        case 'assignee':
          cmp = (a.assigned_to ?? 'zzzz').localeCompare(b.assigned_to ?? 'zzzz');
          break;
        case 'status':
          cmp = statusRank[a.status] - statusRank[b.status];
          break;
      }
      return sortAsc ? cmp : -cmp;
    });
    return arr;
  }, [tasks, sortKey, sortAsc]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortAsc((v) => !v);
    else { setSortKey(k); setSortAsc(true); }
  };

  const Th = ({ k, children, width }: { k: SortKey; children: React.ReactNode; width?: number }) => (
    <th onClick={() => toggleSort(k)} style={{ cursor: 'pointer', userSelect: 'none', width }}>
      {children} {sortKey === k && (sortAsc ? '▲' : '▼')}
    </th>
  );

  const today = todayIso();

  return (
    <div className="glass-panel" style={{ padding: 0 }}>
      <div className="table-container" style={{ border: 'none' }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 38 }}></th>
              <Th k="urgency" width={110}>Urgencia</Th>
              <Th k="title">Tarea</Th>
              <Th k="assignee" width={160}>Responsable</Th>
              <Th k="due_date" width={120}>Vencimiento</Th>
              <Th k="status" width={130}>Estado</Th>
              <th style={{ width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => {
              const um = URGENCY_META[t.urgency];
              const sm = STATUS_META[t.status];
              const UrgIcon = um.icon;
              const StaIcon = sm.icon;
              const overdue = t.due_date && t.due_date < today && t.status !== 'done';
              return (
                <tr key={t.id} style={{ opacity: t.status === 'done' ? 0.6 : 1, borderLeft: `3px solid ${um.color}` }}>
                  <td>
                    <button
                      onClick={() => onCycleStatus(t)}
                      title="Cambiar estado (todo → en progreso → completado)"
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}
                    >
                      <StaIcon size={18} style={{ color: sm.color }} />
                    </button>
                  </td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 10, background: um.color + '20', color: um.color, fontSize: '0.72rem', fontWeight: 700 }}>
                      <UrgIcon size={11} /> {um.label}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <strong style={{ fontSize: '0.88rem', textDecoration: t.status === 'done' ? 'line-through' : undefined }}>{t.title}</strong>
                      {t.description && <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{t.description}</span>}
                      {t.tags && t.tags.length > 0 && (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 3 }}>
                          {t.tags.map((tag) => (
                            <span key={tag} style={{ fontSize: '0.66rem', padding: '1px 6px', borderRadius: 8, background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>#{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </td>
                  <td style={{ fontSize: '0.82rem' }}>{t.assigned_to ?? <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                  <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8rem', color: overdue ? '#ef4444' : undefined, fontWeight: overdue ? 700 : 400 }}>
                    {t.due_date ?? <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    {overdue && <div style={{ fontSize: '0.66rem', color: '#ef4444' }}>vencida</div>}
                  </td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 10, background: sm.color + '20', color: sm.color, fontSize: '0.72rem', fontWeight: 600 }}>
                      <StaIcon size={11} /> {sm.label}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 2 }}>
                      <button onClick={() => onEdit(t)} title="Editar" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-muted)' }}>
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => onDelete(t.id)} title="Eliminar" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-muted)' }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
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

/* ─────────────── Vista Gantt ─────────────── */
function GanttView({ tasks, onEdit }: { tasks: PlannerTask[]; onEdit: (t: PlannerTask) => void }) {
  const dayWidth = 56; // px por día
  const rowHeight = 48;
  const labelWidth = 280;
  const headerHeight = 56;

  const dayDiff = (a: Date, b: Date): number => Math.round((b.getTime() - a.getTime()) / 86400000);
  const isoToDate = (s: string): Date => new Date(s + 'T00:00:00Z');

  // Filtrar tasks sin fechas — Gantt necesita al menos due_date (asume start = due si no hay start)
  const dated = useMemo(() => tasks.filter((t) => t.due_date !== null), [tasks]);

  // Calcular rango (mínimo 14 días, padding 2 días a cada lado). Si no hay tareas dated,
  // devolvemos un rango por defecto para mantener hooks consistentes — la UI hace early return después.
  const { rangeStart, totalDays } = useMemo(() => {
    if (dated.length === 0) {
      const minD = new Date();
      minD.setUTCDate(minD.getUTCDate() - 7);
      return { rangeStart: minD, totalDays: 14 };
    }
    let minDate = '9999-12-31';
    let maxDate = '1970-01-01';
    const today = todayIso();
    for (const t of dated) {
      const s = t.start_date ?? t.due_date!;
      const e = t.due_date!;
      if (s < minDate) minDate = s;
      if (e > maxDate) maxDate = e;
    }
    if (today < minDate) minDate = today;
    if (today > maxDate) maxDate = today;
    const padDays = 2;
    const minD = new Date(minDate); minD.setUTCDate(minD.getUTCDate() - padDays);
    const maxD = new Date(maxDate); maxD.setUTCDate(maxD.getUTCDate() + padDays);
    const ms = maxD.getTime() - minD.getTime();
    const days = Math.max(14, Math.round(ms / 86400000) + 1);
    return { rangeStart: minD, totalDays: days };
  }, [dated]);

  const sorted = useMemo(() => {
    return [...dated].sort((a, b) => {
      const sa = a.start_date ?? a.due_date!;
      const sb = b.start_date ?? b.due_date!;
      return sa.localeCompare(sb);
    });
  }, [dated]);

  const headerMarks = useMemo(() => {
    const marks: Array<{ x: number; label: string; isMonth: boolean }> = [];
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(rangeStart);
      d.setUTCDate(d.getUTCDate() + i);
      const isMon = d.getUTCDay() === 1;
      const isFirstOfMonth = d.getUTCDate() === 1;
      if (isMon || isFirstOfMonth || i === 0) {
        marks.push({
          x: i * dayWidth,
          label: isFirstOfMonth || i === 0
            ? d.toLocaleDateString('es-CO', { month: 'short', day: 'numeric', timeZone: 'UTC' })
            : d.toLocaleDateString('es-CO', { day: 'numeric', timeZone: 'UTC' }),
          isMonth: isFirstOfMonth || i === 0,
        });
      }
    }
    return marks;
  }, [rangeStart, totalDays]);

  const todayX = useMemo(() => {
    const today = new Date(todayIso() + 'T00:00:00Z');
    return dayDiff(rangeStart, today) * dayWidth;
  }, [rangeStart]);

  if (dated.length === 0) {
    return (
      <div className="glass-panel" style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
        Ninguna tarea tiene fecha de vencimiento. Edita las tareas y agrega un vencimiento para verlas en el Gantt.
      </div>
    );
  }

  const totalWidth = totalDays * dayWidth;
  const PANEL_MIN_HEIGHT = 820; // mismo alto que la vista Calendario
  const innerHeight = Math.max(PANEL_MIN_HEIGHT - 60 /* legend bottom */, headerHeight + sorted.length * rowHeight);

  return (
    <div className="glass-panel" style={{ padding: 0, overflow: 'hidden', minHeight: PANEL_MIN_HEIGHT, display: 'flex', flexDirection: 'column' }}>
      <div style={{ overflowX: 'auto', overflowY: 'auto', flex: 1, minHeight: innerHeight }}>
        <div style={{ display: 'flex', minWidth: labelWidth + totalWidth, minHeight: innerHeight }}>
          {/* Columna de etiquetas */}
          <div style={{ width: labelWidth, flexShrink: 0, borderRight: '1px solid var(--border)' }}>
            <div style={{ height: headerHeight, padding: '0 14px', display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Tarea
            </div>
            {sorted.map((t) => {
              const um = URGENCY_META[t.urgency];
              return (
                <div key={t.id} onClick={() => onEdit(t)}
                  style={{ height: rowHeight, padding: '0 14px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2, borderBottom: '1px solid var(--border)', cursor: 'pointer', borderLeft: `3px solid ${um.color}` }}>
                  <span style={{ fontSize: '0.86rem', fontWeight: t.status === 'done' ? 400 : 600, textDecoration: t.status === 'done' ? 'line-through' : undefined, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.title}
                  </span>
                  {t.assigned_to && (
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.assigned_to}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Área de timeline */}
          <div style={{ position: 'relative', width: totalWidth }}>
            {/* Header con marcas */}
            <div style={{ height: headerHeight, position: 'relative', borderBottom: '1px solid var(--border)' }}>
              {headerMarks.map((m, i) => (
                <div key={i} style={{ position: 'absolute', left: m.x, top: 0, bottom: 0, borderLeft: m.isMonth ? '2px solid var(--border)' : '1px solid var(--border)', paddingLeft: 6, paddingTop: 6, fontSize: '0.74rem', color: m.isMonth ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: m.isMonth ? 700 : 500, whiteSpace: 'nowrap' }}>
                  {m.label}
                </div>
              ))}
            </div>

            {/* Líneas verticales de día */}
            {Array.from({ length: totalDays }).map((_, i) => {
              const d = new Date(rangeStart);
              d.setUTCDate(d.getUTCDate() + i);
              const isWeekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
              return (
                <div key={i} style={{ position: 'absolute', left: i * dayWidth, top: headerHeight, bottom: 0, width: dayWidth, background: isWeekend ? 'rgba(148, 163, 184, 0.04)' : undefined, borderLeft: '1px solid rgba(148, 163, 184, 0.08)' }} />
              );
            })}

            {/* Línea de "hoy" */}
            {todayX >= 0 && todayX <= totalWidth && (
              <div style={{ position: 'absolute', left: todayX, top: headerHeight, bottom: 0, width: 2, background: '#ef4444', zIndex: 2 }}>
                <div style={{ position: 'absolute', top: -18, left: -20, fontSize: '0.7rem', color: '#ef4444', fontWeight: 700, background: 'var(--bg-surface)', padding: '0 5px' }}>HOY</div>
              </div>
            )}

            {/* Barras de tareas */}
            {sorted.map((t, idx) => {
              const um = URGENCY_META[t.urgency];
              const start = t.start_date ?? t.due_date!;
              const end = t.due_date!;
              const startOffset = dayDiff(rangeStart, isoToDate(start));
              const endOffset = dayDiff(rangeStart, isoToDate(end));
              const left = startOffset * dayWidth;
              const width = Math.max(dayWidth, (endOffset - startOffset + 1) * dayWidth);
              const barHeight = 30;
              const y = headerHeight + idx * rowHeight + (rowHeight - barHeight) / 2;
              const isDone = t.status === 'done';
              return (
                <div key={t.id}
                  onClick={() => onEdit(t)}
                  title={`${t.title}\n${start} → ${end}\n${t.assigned_to ?? 'sin asignar'} · ${URGENCY_META[t.urgency].label} · ${STATUS_META[t.status].label}`}
                  style={{
                    position: 'absolute', left, top: y, width, height: barHeight,
                    background: isDone ? `${um.color}40` : um.color,
                    borderRadius: 5,
                    cursor: 'pointer',
                    boxShadow: isDone ? 'none' : '0 1px 3px rgba(0,0,0,0.18)',
                    display: 'flex', alignItems: 'center', paddingLeft: 8, paddingRight: 8,
                    overflow: 'hidden', whiteSpace: 'nowrap',
                    zIndex: 1,
                  }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color: isDone ? um.color : '#fff', textDecoration: isDone ? 'line-through' : undefined, textShadow: isDone ? 'none' : '0 1px 2px rgba(0,0,0,0.25)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {t.title}
                  </span>
                </div>
              );
            })}

            {/* Background para filas */}
            {sorted.map((_, idx) => (
              <div key={`row-bg-${idx}`} style={{ position: 'absolute', left: 0, top: headerHeight + idx * rowHeight, width: totalWidth, height: rowHeight, borderBottom: '1px solid var(--border)' }} />
            ))}

            {/* Spacer para mantener altura total */}
            <div style={{ height: headerHeight + sorted.length * rowHeight }} />
          </div>
        </div>
      </div>

      {/* Leyenda */}
      <div style={{ borderTop: '1px solid var(--border)', padding: '10px 14px', display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
        <span>Leyenda:</span>
        {URGENCY_ORDER.map((u) => (
          <span key={u} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 12, height: 12, background: URGENCY_META[u].color, borderRadius: 2 }} /> {URGENCY_META[u].label}
          </span>
        ))}
        <span style={{ marginLeft: 'auto' }}>Click en una barra para editar</span>
      </div>
    </div>
  );
}

/* ─────────────── Vista Calendario ─────────────── */
function CalendarView({ tasks, onEdit }: { tasks: PlannerTask[]; onEdit: (t: PlannerTask) => void }) {
  const [cursor, setCursor] = useState<Date>(() => {
    const d = new Date();
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1));
  });

  const monthLabel = cursor.toLocaleDateString('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const monthStart = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));

  // Empezamos el grid en el lunes anterior (es-CO normalmente usa lunes como primer día)
  const firstDow = monthStart.getUTCDay(); // 0=Sun, 1=Mon ...
  const offset = (firstDow + 6) % 7; // días que retrocedemos para llegar al lunes
  const gridStart = new Date(monthStart);
  gridStart.setUTCDate(gridStart.getUTCDate() - offset);

  const daysToShow = 42; // 6 semanas para grid estable

  const tasksByDay = useMemo(() => {
    const map = new Map<string, PlannerTask[]>();
    for (const t of tasks) {
      if (!t.due_date) continue;
      // Una tarea cae en cada día del rango start_date..due_date (o solo due_date si no hay start)
      const startStr = t.start_date && t.start_date <= t.due_date ? t.start_date : t.due_date;
      const startD = new Date(startStr + 'T00:00:00Z');
      const endD = new Date(t.due_date + 'T00:00:00Z');
      for (let d = new Date(startD); d.getTime() <= endD.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
        const key = d.toISOString().slice(0, 10);
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(t);
      }
    }
    return map;
  }, [tasks]);

  const today = todayIso();

  const goPrev = () => setCursor(new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - 1, 1)));
  const goNext = () => setCursor(new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1)));
  const goToday = () => {
    const d = new Date();
    setCursor(new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1)));
  };

  return (
    <div className="glass-panel" style={{ padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: '1.05rem', textTransform: 'capitalize' }}>{monthLabel}</h3>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="chip" onClick={goPrev} title="Mes anterior"><ChevronLeft size={14} /></button>
          <button className="chip" onClick={goToday}>Hoy</button>
          <button className="chip" onClick={goNext} title="Mes siguiente"><ChevronRight size={14} /></button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => (
          <div key={d} style={{ padding: '8px 10px', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)', textAlign: 'center' }}>
            {d}
          </div>
        ))}
        {Array.from({ length: daysToShow }).map((_, i) => {
          const d = new Date(gridStart);
          d.setUTCDate(d.getUTCDate() + i);
          const key = d.toISOString().slice(0, 10);
          const inMonth = d.getUTCMonth() === cursor.getUTCMonth();
          const isToday = key === today;
          const isPast = key < today;
          const dayTasks = tasksByDay.get(key) ?? [];
          // Mostrar máx 4 tareas, agrupar resto en "+N más"
          const visible = dayTasks.slice(0, 4);
          const hidden = dayTasks.length - visible.length;

          return (
            <div key={i} style={{
              minHeight: 130,
              padding: 6,
              borderRight: (i % 7 !== 6) ? '1px solid var(--border)' : undefined,
              borderTop: i >= 7 ? '1px solid var(--border)' : undefined,
              background: !inMonth ? 'var(--bg-elevated)' : isToday ? 'rgba(7, 197, 168, 0.06)' : undefined,
              opacity: !inMonth ? 0.55 : 1,
              display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              <div style={{ fontSize: '0.74rem', fontWeight: isToday ? 700 : 500, color: isToday ? 'var(--accent)' : 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{d.getUTCDate()}</span>
                {dayTasks.length > 0 && (
                  <span style={{ fontSize: '0.6rem', padding: '0 5px', borderRadius: 8, background: 'var(--bg-elevated)', color: 'var(--text-muted)', fontWeight: 600 }}>
                    {dayTasks.length}
                  </span>
                )}
              </div>
              {visible.map((t) => {
                const um = URGENCY_META[t.urgency];
                const isOverdue = isPast && t.status !== 'done' && t.due_date === key;
                return (
                  <button key={t.id} onClick={() => onEdit(t)} title={`${t.title}${t.assigned_to ? ' · ' + t.assigned_to : ''}`}
                    style={{
                      textAlign: 'left',
                      padding: '3px 6px',
                      borderRadius: 4,
                      border: 'none',
                      background: t.status === 'done' ? `${um.color}20` : `${um.color}30`,
                      color: t.status === 'done' ? 'var(--text-muted)' : 'var(--text-primary)',
                      borderLeft: `3px solid ${um.color}`,
                      cursor: 'pointer',
                      overflow: 'hidden',
                      display: 'flex', flexDirection: 'column', gap: 0,
                      lineHeight: 1.25,
                    }}>
                    <span style={{
                      fontSize: '0.7rem',
                      fontWeight: isOverdue ? 700 : 600,
                      textDecoration: t.status === 'done' ? 'line-through' : undefined,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {t.title}
                    </span>
                    {t.assigned_to && (
                      <span style={{
                        fontSize: '0.62rem',
                        color: 'var(--text-muted)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {t.assigned_to}
                      </span>
                    )}
                  </button>
                );
              })}
              {hidden > 0 && (
                <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', padding: '1px 5px' }}>+{hidden} más</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────── Modal crear/editar tarea ─────────────── */
function TaskFormModal({ mode, initial, users, onClose, onSaved, onDeleted }: {
  mode: 'create' | 'edit';
  initial?: PlannerTask;
  users: AppUser[];
  onClose: () => void;
  onSaved: (t: PlannerTask) => void;
  onDeleted?: (id: string) => void;
}) {
  const [form, setForm] = useState({
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    assigned_to: initial?.assigned_to ?? '',
    urgency: initial?.urgency ?? ('medium' as Urgency),
    status: initial?.status ?? ('todo' as Status),
    start_date: initial?.start_date ?? '',
    due_date: initial?.due_date ?? '',
    tags: (initial?.tags ?? []).join(', '),
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = <K extends keyof typeof form>(k: K, v: typeof form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setErr(null);
    if (!form.title.trim()) { setErr('Título obligatorio'); return; }
    if (form.start_date && form.due_date && form.start_date > form.due_date) {
      setErr('La fecha de inicio debe ser anterior o igual al vencimiento');
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        assigned_to: form.assigned_to.trim() || null,
        urgency: form.urgency,
        status: form.status,
        start_date: form.start_date || null,
        due_date: form.due_date || null,
        tags: form.tags.split(',').map((s) => s.trim()).filter(Boolean),
      };
      const url = '/api/planner/tasks';
      const method = mode === 'create' ? 'POST' : 'PATCH';
      if (mode === 'edit' && initial) body.id = initial.id;
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Error');
      onSaved(j.task as PlannerTask);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!initial || !onDeleted) return;
    if (!confirm(`¿Eliminar la tarea "${initial.title}"?`)) return;
    const r = await fetch(`/api/planner/tasks?id=${initial.id}`, { method: 'DELETE' });
    if (!r.ok) {
      const j = await r.json();
      setErr(j.error ?? 'Error');
      return;
    }
    onDeleted(initial.id);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', padding: 22 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{mode === 'create' ? 'Nueva tarea' : 'Editar tarea'}</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
        </div>

        {err && <div className="alert-error" style={{ marginBottom: 10, fontSize: '0.82rem' }}>{err}</div>}

        <div className="input-group" style={{ marginBottom: 12 }}>
          <label className="input-label">Título <span style={{ color: '#ef4444' }}>*</span></label>
          <input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Ej: Llamar al cliente Casa 12 para coordinar visita" autoFocus />
        </div>

        <div className="input-group" style={{ marginBottom: 12 }}>
          <label className="input-label">Descripción</label>
          <textarea value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Contexto adicional (opcional)" rows={3} style={{ width: '100%', resize: 'vertical' }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div className="input-group" style={{ margin: 0 }}>
            <label className="input-label">Responsable</label>
            {users.length > 0 ? (
              <>
                <input
                  list="planner-user-list"
                  value={form.assigned_to}
                  onChange={(e) => set('assigned_to', e.target.value)}
                  placeholder="Seleccionar usuario o escribir nombre"
                />
                <datalist id="planner-user-list">
                  {users.map((u) => (
                    <option key={u.id} value={u.email}>
                      {u.name ? `${u.name} — ${u.email}` : u.email}
                    </option>
                  ))}
                </datalist>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                  {users.length} usuario{users.length === 1 ? '' : 's'} disponible{users.length === 1 ? '' : 's'} en la cuenta
                </p>
              </>
            ) : (
              <input value={form.assigned_to} onChange={(e) => set('assigned_to', e.target.value)} placeholder="email@dominio o nombre" />
            )}
          </div>
          <div className="input-group" style={{ margin: 0 }}>
            <label className="input-label">Urgencia</label>
            <select value={form.urgency} onChange={(e) => set('urgency', e.target.value as Urgency)}>
              {URGENCY_ORDER.map((u) => <option key={u} value={u}>{URGENCY_META[u].label}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div className="input-group" style={{ margin: 0 }}>
            <label className="input-label">Inicio</label>
            <input type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} />
          </div>
          <div className="input-group" style={{ margin: 0 }}>
            <label className="input-label">Vencimiento</label>
            <input type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} />
          </div>
          <div className="input-group" style={{ margin: 0 }}>
            <label className="input-label">Estado</label>
            <select value={form.status} onChange={(e) => set('status', e.target.value as Status)}>
              {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
          </div>
        </div>

        <div className="input-group" style={{ marginBottom: 16 }}>
          <label className="input-label">Etiquetas (separadas por coma)</label>
          <input value={form.tags} onChange={(e) => set('tags', e.target.value)} placeholder="instalación, urgente, casa-12" />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          {mode === 'edit' && onDeleted ? (
            <button onClick={doDelete} className="secondary-btn" style={{ color: '#ef4444' }} disabled={saving}>
              <Trash2 size={13} /> Eliminar
            </button>
          ) : <span />}
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onClose} className="secondary-btn" disabled={saving}>Cancelar</button>
            <button onClick={submit} className="primary-btn" disabled={saving}>
              {saving ? 'Guardando…' : (mode === 'create' ? 'Crear tarea' : 'Guardar cambios')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────── Modal import CSV ─────────────── */
function CsvImportModal({ onClose, onDone }: { onClose: () => void; onDone: (inserted: number, errors: number) => void }) {
  const [csv, setCsv] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ rows: number; errors: number } | null>(null);

  const sample = `titulo,descripcion,responsable,urgencia,estado,inicio,vencimiento,etiquetas
"Llamar cliente Casa 12","Coordinar visita previa","juan@empresa.co",alta,por hacer,2026-06-02,2026-06-03,"instalacion;visita"
"Revisar diseño Casa 14",,"ana@empresa.co",media,en progreso,,2026-06-08,
"Cotizar inversor 8kW","Cotización para condominio Pance","carlos@empresa.co",critica,por hacer,2026-06-01,2026-06-05,"compras"`;

  const submit = async () => {
    setErr(null);
    if (!csv.trim()) { setErr('Pega un CSV con encabezado'); return; }
    setSaving(true);
    try {
      const r = await fetch('/api/planner/tasks/bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv }),
      });
      const j = await r.json();
      if (!r.ok) {
        setErr(j.error ?? 'Error');
        if (j.errors && Array.isArray(j.errors)) {
          setPreview({ rows: 0, errors: j.errors.length });
        }
        return;
      }
      onDone(j.inserted ?? 0, (j.errors ?? []).length);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: 680, maxHeight: '90vh', overflowY: 'auto', padding: 22 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Importar tareas desde CSV</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
        </div>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0 0 12px' }}>
          Pega el contenido de un CSV con encabezado en la primera fila. Acepta separador <code>,</code> o <code>;</code>.
        </p>

        <details style={{ marginBottom: 10 }}>
          <summary style={{ cursor: 'pointer', fontSize: '0.82rem', color: 'var(--accent)', fontWeight: 600 }}>Ver formato esperado y ejemplo</summary>
          <div style={{ marginTop: 8, fontSize: '0.76rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            <p style={{ margin: '0 0 6px' }}>Columnas reconocidas (case-insensitive, español o inglés):</p>
            <ul style={{ margin: '0 0 8px', paddingLeft: 18 }}>
              <li><code>title</code> / <code>titulo</code> — <strong>requerida</strong></li>
              <li><code>description</code> / <code>descripcion</code></li>
              <li><code>assigned_to</code> / <code>responsable</code> / <code>asignado</code></li>
              <li><code>urgency</code> / <code>urgencia</code> — baja | media | alta | crítica</li>
              <li><code>status</code> / <code>estado</code> — por hacer | en progreso | completado | bloqueado</li>
              <li><code>start_date</code> / <code>inicio</code> — YYYY-MM-DD o DD/MM/YYYY</li>
              <li><code>due_date</code> / <code>vencimiento</code> — YYYY-MM-DD o DD/MM/YYYY</li>
              <li><code>tags</code> / <code>etiquetas</code> — separadas por <code>;</code></li>
            </ul>
            <pre style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, padding: 10, fontSize: '0.7rem', fontFamily: 'ui-monospace, monospace', overflow: 'auto', margin: 0 }}>{sample}</pre>
            <button onClick={() => setCsv(sample)} className="secondary-btn" style={{ fontSize: '0.74rem', marginTop: 6 }}>Usar este ejemplo</button>
          </div>
        </details>

        {err && <div className="alert-error" style={{ marginBottom: 10, fontSize: '0.82rem' }}>
          {err}
          {preview && preview.errors > 0 && <div style={{ marginTop: 4 }}>{preview.errors} fila(s) tienen problemas. Revisa el formato.</div>}
        </div>}

        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder="Pega aquí el contenido del CSV…"
          rows={12}
          style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem', resize: 'vertical', minHeight: 200 }}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
          <button onClick={onClose} className="secondary-btn" disabled={saving}>Cancelar</button>
          <button onClick={submit} className="primary-btn" disabled={saving || !csv.trim()}>
            {saving ? 'Importando…' : 'Importar tareas'}
          </button>
        </div>
      </div>
    </div>
  );
}
