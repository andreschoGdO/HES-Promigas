-- ─────────────────────────────────────────────────────────────────
-- Phase 15 — Planner (gestor de tareas con vistas Lista/Gantt/Calendario)
--
-- Tabla simple de tareas independientes de los CRMs. Cada tarea tiene un
-- responsable (asignado por email/nombre libre), un nivel de urgencia
-- (low/medium/high/critical), fechas de inicio y vencimiento, y un estado.
-- Se puede vincular opcionalmente a un proyecto CRM, pero no es obligatorio.
-- ─────────────────────────────────────────────────────────────────

create table if not exists planner_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  assigned_to text,                          -- email o nombre libre
  urgency text not null default 'medium'
    check (urgency in ('low', 'medium', 'high', 'critical')),
  status text not null default 'todo'
    check (status in ('todo', 'in_progress', 'done', 'blocked')),
  start_date date,
  due_date date,
  tags text[] default '{}'::text[],
  project_id uuid references crm_projects(id) on delete set null,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  completed_at timestamptz
);

create index if not exists idx_planner_tasks_due on planner_tasks (due_date);
create index if not exists idx_planner_tasks_start on planner_tasks (start_date);
create index if not exists idx_planner_tasks_assignee on planner_tasks (assigned_to);
create index if not exists idx_planner_tasks_status on planner_tasks (status);
create index if not exists idx_planner_tasks_urgency on planner_tasks (urgency);

-- Trigger updated_at (reutiliza function set_updated_at definida en fase 10)
drop trigger if exists trg_planner_tasks_updated on planner_tasks;
create trigger trg_planner_tasks_updated before update on planner_tasks
  for each row execute function set_updated_at();
