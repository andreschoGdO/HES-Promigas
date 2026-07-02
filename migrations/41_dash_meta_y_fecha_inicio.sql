-- ─────────────────────────────────────────────────────────────────
-- Phase 41 — Dash Construcción: meta anual + fecha inicio proyecto
--
-- 1. Actualiza la meta anual de casas de 230 a 150.
-- 2. Agrega la fecha de inicio del proyecto (2025-10-01) para que la serie
--    mensual del Dash arranque desde ahí (antes eran solo los últimos 6 meses).
-- ─────────────────────────────────────────────────────────────────

update app_settings
   set value = '{"value": 150}'::jsonb
 where key = 'dash_meta_anual_casas';

insert into app_settings (key, value)
values ('dash_project_start', '{"value": "2025-10-01"}'::jsonb)
on conflict (key) do nothing;
