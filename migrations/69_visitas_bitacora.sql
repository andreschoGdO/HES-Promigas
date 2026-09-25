-- ─────────────────────────────────────────────────────────────────
-- Phase 69 — Nueva acta en Visitas: "Bitácora de Construcción"
-- (visit_type = 'bitacora').
--
-- Registro diario del avance de obra por casa: etapa del día, clima,
-- descripción del avance y notas/pendientes, con fotos de evidencia.
-- Reusa field_visits tal cual: `visit_date` = día de la obra que describe
-- la entrada, `created_at` = momento real de digitación — no hace falta
-- ninguna columna nueva para separar esas dos fechas, ya existen.
-- Mismo patrón que la migración 62 (tipo 'om') y 68 (tipo 'abastecimiento').
-- ─────────────────────────────────────────────────────────────────

alter table field_visits drop constraint if exists field_visits_visit_type_check;
alter table field_visits add constraint field_visits_visit_type_check
  check (visit_type in ('previa', 'instalacion', 'emergencia', 'normalizacion', 'om', 'abastecimiento', 'bitacora'));
