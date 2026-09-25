-- ─────────────────────────────────────────────────────────────────
-- Phase 71 — Nueva acta en Visitas: "Formato de Comisionamiento"
-- (visit_type = 'comisionamiento').
--
-- Digitaliza "Chek List_Comisionamiento.csv": verificación técnica,
-- funcional y de seguridad previa a la puesta en operación — 45 puntos
-- de verificación en 8 secciones (A-H), cada uno con resultado, Cumple/
-- No cumple/No aplica, valor medido, evidencia y observaciones. Mismo
-- patrón que la migración 68 (abastecimiento): todo el contenido vive en
-- field_visits.form_data (jsonb), el único cambio de BD es permitir el
-- tipo nuevo en el check constraint.
-- ─────────────────────────────────────────────────────────────────

alter table field_visits drop constraint if exists field_visits_visit_type_check;
alter table field_visits add constraint field_visits_visit_type_check
  check (visit_type in ('previa', 'instalacion', 'emergencia', 'normalizacion', 'om', 'abastecimiento', 'comisionamiento'));
