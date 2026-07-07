-- ─────────────────────────────────────────────────────────────────
-- Phase 51 — Meta anual de casas: 150 → 100
--
-- Ajuste operativo. El valor vive en app_settings.dash_meta_anual_casas y
-- se lee al armar el reporte del Dash Construcción (métrica "Avance vs.
-- meta anual" y el hint "X de N casas meta").
-- ─────────────────────────────────────────────────────────────────

begin;

insert into app_settings (key, value)
values ('dash_meta_anual_casas', '{"value": 100}'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();

commit;

-- Verificación:
-- select key, value from app_settings where key = 'dash_meta_anual_casas';
-- Esperado: {"value": 100}
