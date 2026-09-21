-- ─────────────────────────────────────────────────────────────────
-- Phase 68 — Nueva acta en Visitas: "Checklist de Abastecimiento y
-- Herramientas" (visit_type = 'abastecimiento').
--
-- Digitaliza el formato "Chek List_Abastecimiento y herramientas.xlsx":
-- verificación SI/NO de materiales y herramientas en sitio antes de
-- arrancar la obra. Todo el contenido vive en field_visits.form_data
-- (jsonb) — el único cambio de BD es permitir el tipo nuevo en el check
-- constraint (mismo patrón que la migración 62 con 'om').
-- ─────────────────────────────────────────────────────────────────

alter table field_visits drop constraint if exists field_visits_visit_type_check;
alter table field_visits add constraint field_visits_visit_type_check
  check (visit_type in ('previa', 'instalacion', 'emergencia', 'normalizacion', 'om', 'abastecimiento'));
