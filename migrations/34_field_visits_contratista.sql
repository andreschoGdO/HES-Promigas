-- ─────────────────────────────────────────────────────────────────
-- Phase 34 — Campo "contratista" en visitas de campo
--
-- field_visits ya tiene technician_name (texto libre del nombre del
-- técnico que firma — quien LLENA el acta). Ahora agregamos un campo
-- separado contratista para registrar la EMPRESA que ejecuta el
-- trabajo (puede ser distinto del técnico individual).
--
-- El historial filtra por ambos por separado (técnico y empresa).
-- ─────────────────────────────────────────────────────────────────

alter table field_visits
  add column if not exists contratista text;

create index if not exists idx_field_visits_contratista
  on field_visits (contratista);

comment on column field_visits.contratista is
  'Empresa contratista que ejecuta la visita (ej. "Energía Solar SAS"). Distinto del technician_name (persona que firma).';
