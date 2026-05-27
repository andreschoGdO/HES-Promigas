-- ─────────────────────────────────────────────────────────────────
-- Phase 10 — CRM Ventas + Ingeniería + Operaciones (workflow tri-modular)
--
-- Un proyecto vive su ciclo completo en una sola tabla `crm_projects`.
-- Tres campos de etapa, uno por módulo. El campo `current_module`
-- indica quién es el dueño en este momento. Los handoffs entre módulos
-- se manejan vía /api/crm/projects/[id]/transition.
-- ─────────────────────────────────────────────────────────────────

create table if not exists crm_projects (
  id uuid primary key default gen_random_uuid(),
  code text unique,                                -- PROJ-YYYY-NNNN (autogenerado por trigger)
  title text not null,                             -- "Casa Andrés Sánchez - Cali"

  -- Ownership: quién maneja este proyecto AHORA
  current_module text not null default 'sales'
    check (current_module in ('sales', 'engineering', 'operations', 'closed')),

  -- Etapa por módulo (cada módulo lleva la suya independiente)
  sales_stage text not null default 'prospecto'
    check (sales_stage in ('prospecto', 'levantamiento', 'propuesta', 'contrato', 'firmado', 'completado')),
  engineering_stage text not null default 'pending'
    check (engineering_stage in ('pending', 'prefactibilidad_ok', 'dimensionamiento', 'aprobacion', 'aprobado', 'completado')),
  operations_stage text not null default 'pending'
    check (operations_stage in ('pending', 'visita_previa', 'alistamiento', 'instalacion', 'operativo', 'legalizado', 'completado')),

  -- Cliente (capturado en Ventas)
  client_name text,
  client_email text,
  client_phone text,
  client_address text,
  client_city text,
  client_doc_type text,
  client_doc_number text,
  estrato integer,
  tipo_vivienda text,
  lat numeric,
  lng numeric,

  -- Comercial / Propuesta
  invoice_kwh_mensual numeric,
  invoice_valor_cop numeric,
  propuesta_kwp numeric,
  propuesta_valor_cop numeric,
  propuesta_url text,
  contrato_url text,
  oferta_url text,
  contrato_sent_at timestamptz,
  contrato_signed_at timestamptz,

  -- Dimensionamiento (Ingeniería) — diseno sin ñ para evitar comillas SQL
  diseno_kwp numeric,
  diseno_paneles integer,
  diseno_inversor_categoria_id uuid references inventory_categories(id) on delete set null,
  diseno_panel_categoria_id uuid references inventory_categories(id) on delete set null,
  diseno_bateria_categoria_id uuid references inventory_categories(id) on delete set null,
  diseno_yield_estimado_kwh_mes numeric,
  diseno_notes text,
  diseno_aprobado_por text,
  diseno_aprobado_at timestamptz,

  -- Enlaces a otros módulos
  visita_previa_id uuid references field_visits(id) on delete set null,
  visita_instalacion_id uuid references field_visits(id) on delete set null,
  reservation_id uuid references inventory_reservations(id) on delete set null,
  house_id uuid references client_houses(id) on delete set null,

  -- Instalación
  contractor_name text,
  contractor_email text,
  installation_date date,
  lectura_inicial_kwh numeric,
  operativo_at timestamptz,
  legalizado_at timestamptz,

  -- Metadata
  created_by text,
  assigned_to text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  closed_at timestamptz
);

create index if not exists idx_crm_proj_current_module on crm_projects (current_module, updated_at desc);
create index if not exists idx_crm_proj_sales_stage on crm_projects (sales_stage) where current_module = 'sales';
create index if not exists idx_crm_proj_eng_stage on crm_projects (engineering_stage) where current_module = 'engineering';
create index if not exists idx_crm_proj_ops_stage on crm_projects (operations_stage) where current_module = 'operations';
create index if not exists idx_crm_proj_assigned on crm_projects (assigned_to) where assigned_to is not null;

-- Trigger updated_at
drop trigger if exists trg_crm_proj_updated on crm_projects;
create trigger trg_crm_proj_updated before update on crm_projects
  for each row execute function set_updated_at();

-- Audit log de eventos del proyecto
create table if not exists crm_project_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references crm_projects(id) on delete cascade,
  event_type text not null,                        -- created | stage_change | handoff | field_update | note
  from_module text,
  to_module text,
  from_stage text,
  to_stage text,
  actor_email text,
  notes text,
  data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_crm_evt_project on crm_project_events (project_id, created_at desc);
create index if not exists idx_crm_evt_recent on crm_project_events (created_at desc);

-- Función para autogenerar el código secuencial por año
create or replace function crm_generate_code()
returns text
language plpgsql
as $$
declare
  yr text := to_char(now(), 'YYYY');
  next_seq int;
begin
  select coalesce(max((regexp_match(code, 'PROJ-' || yr || '-(\d+)'))[1]::int), 0) + 1
    into next_seq
    from crm_projects
    where code like 'PROJ-' || yr || '-%';
  return 'PROJ-' || yr || '-' || lpad(next_seq::text, 4, '0');
end;
$$;

create or replace function crm_set_code_trigger()
returns trigger
language plpgsql
as $$
begin
  if new.code is null or new.code = '' then
    new.code := crm_generate_code();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_crm_proj_set_code on crm_projects;
create trigger trg_crm_proj_set_code before insert on crm_projects
  for each row execute function crm_set_code_trigger();
