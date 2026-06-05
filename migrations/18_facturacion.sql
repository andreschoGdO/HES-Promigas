-- ─────────────────────────────────────────────────────────────────
-- Phase 18 — Facturación (Billing)
--
-- Tabla con UN registro por proyecto CRM para capturar los costos finales
-- del despliegue. Los campos derivables (ciudad, conjunto, casa, paneles,
-- kwp, baterías, kwh, contractor, marcas de equipos) se calculan al vuelo
-- en /api/facturacion uniendo crm_projects + inventory_items+categories.
--
-- Aquí solo guardamos lo que no vive en otra parte: costos por componente,
-- mano de obra, desmantelamiento, capex y OR (operador de red).
-- ─────────────────────────────────────────────────────────────────

create table if not exists facturacion_records (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references crm_projects(id) on delete cascade,

  -- Descripción comercial (texto libre — no derivable de otras tablas)
  solucion text,                          -- ej. "Sistema híbrido + respaldo"
  plan text,                              -- ej. "Plan Básico" / "Plan Premium"

  -- Costos por componente (COP)
  costo_inversor numeric,
  costo_bateria numeric,
  costo_control_box numeric,              -- BMS
  costo_top_cover numeric,
  costo_panel_solar numeric,
  costo_medidor_solar numeric,
  costo_medidor_generacion numeric,
  costo_modem numeric,

  -- Servicios
  mano_de_obra numeric,
  desmantelamiento_mo numeric,            -- desmantelamiento × mano de obra

  -- Totales / regulatorio
  capex numeric,                          -- inversión total del proyecto
  operador_red text,                      -- "OR" — EPSA, Celsia, EMCALI, etc.

  notes text,
  created_by text,
  updated_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_facturacion_project on facturacion_records (project_id);

drop trigger if exists trg_facturacion_updated on facturacion_records;
create trigger trg_facturacion_updated before update on facturacion_records
  for each row execute function set_updated_at();
