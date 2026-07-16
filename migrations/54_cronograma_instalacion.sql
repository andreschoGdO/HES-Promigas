-- ─────────────────────────────────────────────────────────────────
-- Phase 54 — Cronograma de instalación + checklist de avance físico
--
-- Habilita el Gantt de obra y la curva S del Dash de Construcción
-- (ver docs/superpowers/specs/2026-07-16-dash-gantt-scurve-design.md):
--
--   - cronograma_fecha_inicio: inicio planeado de instalación. Se pide
--     ahora al crear la tarjeta del proyecto (Dimensionado), junto con
--     el contratista (contractor_name, ya existe) y el fin planeado
--     (installation_date, ya existe — se reutiliza, no se migra).
--
--   - inst_paneles_dc / inst_equipos_ac / inst_config_cierre: checklist
--     de 3 hitos que se marcan durante la etapa Instalación. El % de
--     avance físico se deriva en código (count(true)/3*100) — no se
--     persiste un campo de porcentaje aparte.
-- ─────────────────────────────────────────────────────────────────

alter table crm_projects
  add column if not exists cronograma_fecha_inicio date,
  add column if not exists inst_paneles_dc     boolean not null default false,
  add column if not exists inst_equipos_ac     boolean not null default false,
  add column if not exists inst_config_cierre  boolean not null default false;
