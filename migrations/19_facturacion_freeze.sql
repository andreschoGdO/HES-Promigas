-- ─────────────────────────────────────────────────────────────────
-- Phase 19 — Facturación: congelado por periodo + audit log
--
-- Cuando se "factura" un proyecto, sus costos quedan congelados:
--   - Los valores derivados (calculados desde inventory_items.acquired_cost_cop)
--     se materializan en facturacion_records.
--   - frozen_at indica que ya no se recalculan desde inventario, aunque
--     cambien los precios de compra en órdenes posteriores.
--   - periodo etiqueta el mes facturado para reportería (formato YYYY-MM).
--
-- facturacion_events guarda audit log de cada cambio: quién, cuándo,
-- valor anterior, valor nuevo, origen (user / inventory_snapshot / freeze).
-- ─────────────────────────────────────────────────────────────────

alter table facturacion_records
  add column if not exists frozen_at timestamptz,
  add column if not exists frozen_by text,
  add column if not exists periodo text;  -- 'YYYY-MM' (ej. '2026-06')

create index if not exists idx_facturacion_periodo on facturacion_records (periodo) where periodo is not null;
create index if not exists idx_facturacion_frozen on facturacion_records (frozen_at) where frozen_at is not null;

create table if not exists facturacion_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references crm_projects(id) on delete cascade,
  event_type text not null
    check (event_type in ('cost_change', 'text_change', 'freeze', 'unfreeze', 'snapshot_from_inventory', 'import')),
  field text,                  -- columna afectada (ej. 'costo_inversor')
  old_value text,              -- valor anterior (texto crudo, para no asumir tipo)
  new_value text,              -- valor nuevo
  source text                  -- 'user' | 'inventory_snapshot' | 'csv_import' | 'freeze' | 'unfreeze'
    check (source in ('user', 'inventory_snapshot', 'csv_import', 'freeze', 'unfreeze')),
  actor_email text,
  notes text,
  data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_facturacion_events_project on facturacion_events (project_id, created_at desc);
create index if not exists idx_facturacion_events_recent on facturacion_events (created_at desc);
