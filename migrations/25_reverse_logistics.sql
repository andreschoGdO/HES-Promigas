-- ─────────────────────────────────────────────────────────────────
-- Phase 25 — Logística inversa
--
-- Cubre los flujos de retorno de equipos desde campo:
--   - Swap atómico (sacar un equipo + instalar otro en la misma casa)
--   - Devolución a bodega (sin reemplazo)
--   - Decomisión (fin de vida)
--   - Devolución total por cancelación del proyecto
--
-- Para mantener la integridad contable de los proyectos ya congelados,
-- los cambios post-Operativo se registran en `facturacion_upgrades` en
-- lugar de modificar el snapshot original en `facturacion_records`.
-- ─────────────────────────────────────────────────────────────────

-- 1. Tabla facturacion_upgrades: registra cambios de equipo post-instalación
--    que afectan el Capex acumulado pero no tocan el snapshot original.
create table if not exists facturacion_upgrades (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references crm_projects(id) on delete cascade,
  facturacion_record_id uuid references facturacion_records(id) on delete set null,
  event_date date not null default current_date,
  motivo text not null
    check (motivo in ('upgrade', 'warranty', 'damage', 'cancel', 'replacement', 'other')),
  costo_neto numeric,                              -- positivo = costo adicional, negativo = recuperación
  notas text,
  item_removed_id uuid references inventory_items(id) on delete set null,
  item_installed_id uuid references inventory_items(id) on delete set null,
  created_by text,
  created_at timestamptz default now()
);

create index if not exists idx_fact_upgrades_project on facturacion_upgrades (project_id, event_date desc);
create index if not exists idx_fact_upgrades_record on facturacion_upgrades (facturacion_record_id);

-- 2. Restaurar el estado 'decommissioned' (dado de baja) en items, para
--    que se pueda decomisar definitivamente un equipo (fin de vida útil,
--    pérdida total, etc.). El estado 'lost' no se restaura — si necesitan
--    marcar perdido, usen 'rma' o 'decommissioned' según el caso.
alter table inventory_items drop constraint if exists inventory_items_status_check;
alter table inventory_items add constraint inventory_items_status_check
  check (status in ('in_stock', 'reserved', 'installed', 'in_repair', 'rma', 'decommissioned'));

-- 3. Nueva columna en crm_projects para registrar proyectos cancelados con
--    devolución total de equipos. NO se borra el proyecto — queda como
--    histórico con su evento en crm_project_events.
alter table crm_projects
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text;

create index if not exists idx_crm_proj_cancelled on crm_projects (cancelled_at) where cancelled_at is not null;
