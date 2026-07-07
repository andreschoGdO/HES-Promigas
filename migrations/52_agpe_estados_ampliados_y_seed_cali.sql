-- ─────────────────────────────────────────────────────────────────
-- Phase 52 — Ampliar agpe_estado + mover casas de Cali a legalización
--
-- 1. Extender check constraint de agpe_estado para incluir:
--      - 'Aprobado sin visita'
--      - 'Aprobado visitado'
-- 2. Actualizar options del dropdown en crm_stage_fields.
-- 3. Mover las 13 casas de RESERVA DE PANCE (Cali) que aparecen en el listado
--    del operador de red a operations_stage='legalizacion' con el estado
--    correspondiente. Se conserva el "pendiente" en las notas.
-- ─────────────────────────────────────────────────────────────────

begin;

-- 1. Extender check constraint
alter table crm_projects drop constraint if exists crm_projects_agpe_estado_check;
alter table crm_projects add constraint crm_projects_agpe_estado_check
  check (agpe_estado is null or agpe_estado in (
    'Con visita', 'Radicado', 'En revisión', 'Legalizada',
    'Aprobado sin visita', 'Aprobado visitado',
    'Aprobado', 'Rechazado'
  ));

-- 2. Actualizar options del dropdown
update crm_stage_fields
   set options = '["Con visita", "Radicado", "En revisión", "Aprobado sin visita", "Aprobado visitado", "Legalizada"]'::jsonb
 where module = 'operations'
   and stage = 'legalizacion'
   and field_key = 'agpe_estado';

-- 3. Mover las casas al estado 'legalizacion' con el agpe_estado del listado
--    y agregar el "pendiente" al final de las notas.
with target(casa_n, estado, pendiente) as (values
  ('70',  'Aprobado sin visita', 'Programar visita'),
  ('63',  'Aprobado sin visita', 'Programar visita'),
  ('57',  'Aprobado sin visita', 'Programar visita'),
  ('56',  'Aprobado visitado',   'Cargue de documentos'),
  ('48',  'Aprobado sin visita', 'Programar visita'),
  ('42',  'Aprobado sin visita', 'Programar visita'),
  ('30',  'Aprobado visitado',   'Cargue de documentos'),
  ('29',  'Aprobado visitado',   'Cargue de documentos'),
  ('23',  'Aprobado visitado',   'Cargue de documentos'),
  ('18',  'Aprobado visitado',   'Cargue de documentos'),
  ('11',  'Aprobado visitado',   'Cargue de documentos'),
  ('10',  'Aprobado visitado',   'Cargue de documentos'),
  ('2',   'Aprobado visitado',   'Cargue de documentos')
)
update crm_projects p
   set operations_stage = 'legalizacion',
       agpe_estado = t.estado,
       notes = coalesce(p.notes, '') ||
               chr(10) || '[mig 52] AGPE — pendiente: ' || t.pendiente,
       updated_at = now()
  from target t
 where p.conjunto = 'RESERVA DE PANCE'
   and p.casa_numero = t.casa_n;

-- 4. Registrar el cambio en el audit log
insert into crm_project_events (project_id, event_type, to_module, to_stage, actor_email, notes)
select p.id, 'stage_change', 'operations', 'legalizacion', 'mig-52',
       'Movida a Legalización desde el listado del operador de red (mig 52). Estado: ' || p.agpe_estado
  from crm_projects p
 where p.conjunto = 'RESERVA DE PANCE'
   and p.casa_numero in ('70','63','57','56','48','42','30','29','23','18','11','10','2')
   and p.operations_stage = 'legalizacion';

commit;

-- Verificación:
-- select casa_numero, operations_stage, agpe_estado, right(notes, 60) as ultimas_notas
--   from crm_projects
--  where conjunto = 'RESERVA DE PANCE'
--    and casa_numero in ('70','63','57','56','48','42','30','29','23','18','11','10','2')
--  order by casa_numero::integer;
-- Esperado: 13 rows, operations_stage='legalizacion', agpe_estado poblado
