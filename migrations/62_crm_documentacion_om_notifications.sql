-- ─────────────────────────────────────────────────────────────────
-- Phase 62 — Cambios varios en el CRM de Construcción:
--   1. Registro de cambio de modelo de equipos en Dimensionado
--   2. Etapas nuevas: Documentación y O&M (entre Operativo y Legalización)
--   3. Adicionales (otrosí): permitir asignar Valor directo por casa
--      además del % (columna `valor`, `porcentaje` pasa a ser opcional)
--   4. field_visits: nuevo visit_type 'om' para el historial de O&M
--   5. Sistema de notificaciones in-app
--   6. Deja registrada en migración la constraint de `zona` que ya
--      incluye Valle/Costa en producción (se había aplicado directo por SQL)
-- ─────────────────────────────────────────────────────────────────

-- 1) Cambio de modelo de equipos en Dimensionado
alter table crm_projects
  add column if not exists diseno_modelo_cambiado boolean not null default false,
  add column if not exists diseno_modelo_cambio_log text;

-- 2) Etapas nuevas: 'documentacion' y 'o_m'
alter table crm_projects drop constraint if exists crm_projects_operations_stage_check;
alter table crm_projects add constraint crm_projects_operations_stage_check
  check (operations_stage in (
    'pending',
    'visita_previa',
    'dimensionamiento',
    'dimensionado',
    'alistamiento',
    'instalacion',
    'operativo',
    'documentacion',   -- NUEVO
    'o_m',             -- NUEVO
    'legalizacion',
    'logistica_inversa',
    'desistido',
    'sin_renovacion',
    'legalizado',
    'completado'
  ));

alter table crm_projects
  add column if not exists dossier_proyecto_url text,
  add column if not exists dossier_equipos_url text;

-- 3) Adicionales: Valor directo por casa (alternativa al %)
alter table purchase_order_addendum_house_assignments
  add column if not exists valor numeric check (valor is null or valor >= 0);
alter table purchase_order_addendum_house_assignments
  drop constraint if exists purchase_order_addendum_house_assignments_porcentaje_check;
alter table purchase_order_addendum_house_assignments
  alter column porcentaje drop not null;
alter table purchase_order_addendum_house_assignments
  add constraint purchase_order_addendum_house_assignments_porcentaje_check
    check (porcentaje is null or (porcentaje > 0 and porcentaje <= 100));
alter table purchase_order_addendum_house_assignments
  add constraint purchase_order_addendum_house_assignments_valor_or_pct
    check (valor is not null or porcentaje is not null);

-- 4) field_visits: nuevo tipo 'om' (visitas de Operación y Mantenimiento)
alter table field_visits drop constraint if exists field_visits_visit_type_check;
alter table field_visits add constraint field_visits_visit_type_check
  check (visit_type in ('previa', 'instalacion', 'emergencia', 'normalizacion', 'om'));

-- 5) Notificaciones in-app
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  type text not null default 'general',
  title text not null,
  body text,
  link text,
  project_id uuid references crm_projects(id) on delete set null,
  read boolean not null default false,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists idx_notifications_user on notifications (user_email, read, created_at desc);

-- 6) zona: deja documentada en migraciones la constraint ya vigente en prod
alter table crm_projects drop constraint if exists crm_projects_zona_check;
alter table crm_projects add constraint crm_projects_zona_check
  check (zona is null or zona in ('Norte', 'Interior', 'Sur', 'Valle', 'Costa'));
