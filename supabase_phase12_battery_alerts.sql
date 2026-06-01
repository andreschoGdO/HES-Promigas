-- ─────────────────────────────────────────────────────────────────
-- Phase 12 — Alertas de ciclo de batería (20-80% como límites)
--
-- Tres reglas:
--   1) Descarga profunda (instantánea): SOC < 20% → severidad alta
--   2) No descargó en 24h (agregada): SOC mínimo > 20% → severidad media
--      → la batería se quedó cargada todo el tiempo, no se está ciclando
--   3) No cargó en 24h (agregada): SOC máximo < 80% → severidad media
--      → la generación solar no llegó a cargar la batería al límite saludable
--
-- Las variables batt_soc_min_24h y batt_soc_max_24h se calculan en vivo en el
-- evaluador (/api/alerts/evaluate) sobre instant_metrics.batt_soc_pct.
-- ─────────────────────────────────────────────────────────────────

insert into alert_rules (variable, operator, threshold, severity, scope, name, enabled)
select * from (values
  ('batt_soc_pct'::text,      'lt'::text, 20::numeric, 'high'::text,   'all'::text, 'Batería en descarga profunda (SOC < 20%)'::text,                          true),
  ('batt_soc_min_24h',         'gt',       20::numeric, 'medium',       'all',       'Batería NO descargó en 24h (SOC mínimo > 20%, no está ciclando)',         true),
  ('batt_soc_max_24h',         'lt',       80::numeric, 'medium',       'all',       'Batería NO cargó en 24h (SOC máximo < 80%, generación no la carga bien)', true)
) as v(variable, operator, threshold, severity, scope, name, enabled)
where not exists (
  select 1 from alert_rules ar
  where ar.variable = v.variable and ar.operator = v.operator and ar.threshold = v.threshold and ar.scope = v.scope
);
