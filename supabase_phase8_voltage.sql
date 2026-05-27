-- ─────────────────────────────────────────────────────────────────
-- Phase 8 — Monitoreo de voltaje de red eléctrica
-- Agrega columnas de voltaje al instant_metrics + reglas seed
-- para detectar caídas, sobre-voltajes y desbalance entre fases.
--
-- IMPORTANTE: estas columnas dependen de que Metrum exponga las keys
--   voltageA / voltageB / voltageC (o equivalentes) en el meter_red.
-- Si Metrum no las expone, las columnas quedan NULL y las reglas no
-- disparan — pero el sistema no se rompe. Probar:
--   GET /api/metrum/keys?metrumId={meter_red_id}
-- para confirmar qué keys voltage* expone el Eastron.
-- ─────────────────────────────────────────────────────────────────

-- 1. Columnas de voltaje en instant_metrics
alter table instant_metrics
  add column if not exists voltage_a_v numeric,           -- voltaje fase A−N
  add column if not exists voltage_b_v numeric,           -- voltaje fase B−N
  add column if not exists voltage_c_v numeric,           -- voltaje fase C−N
  add column if not exists voltage_min_v numeric,         -- min(A, B, C) — caída de fase
  add column if not exists voltage_max_v numeric,         -- max(A, B, C) — sobre-voltaje
  add column if not exists voltage_imbalance_pct numeric, -- |max−min|/max × 100
  add column if not exists frequency_hz numeric;          -- frecuencia de red (~60 Hz Colombia)

create index if not exists idx_instant_vmin on instant_metrics (voltage_min_v) where voltage_min_v is not null;
create index if not exists idx_instant_vmax on instant_metrics (voltage_max_v) where voltage_max_v is not null;

-- 2. Reglas seed para alertas de tensión
-- En Colombia residencial el voltaje L−N nominal es ~120 V (sistema 120/208 V trifásico)
-- o ~127 V (sistema 127/220 V). Las normas RETIE y NTC 1340 permiten ±10% de tolerancia.
-- Para 120 V: rango aceptable 108−132 V. Para 127 V: rango 114−140 V.
-- Vamos a usar los valores de 127 V como base por ser más común en residencial nuevo.

-- Insert idempotente: solo crea reglas que no existan ya con el mismo (variable, operator, threshold, scope).
-- Útil si re-ejecutas este SQL.
insert into alert_rules (variable, operator, threshold, severity, scope, name, enabled)
select * from (values
  ('voltage_min_v'::text,          'lt'::text,   108::numeric, 'high'::text,   'all'::text, 'Caída crítica de tensión (< 108 V en alguna fase)'::text,    true),
  ('voltage_min_v',                'lt',         114::numeric, 'medium',       'all',       'Bajo voltaje (< 114 V en alguna fase)',                       true),
  ('voltage_max_v',                'gt',         140::numeric, 'high',         'all',       'Sobre-voltaje crítico (> 140 V en alguna fase)',              true),
  ('voltage_max_v',                'gt',         135::numeric, 'medium',       'all',       'Sobre-voltaje (> 135 V en alguna fase)',                      true),
  ('voltage_imbalance_pct',        'gt',         5::numeric,   'medium',       'all',       'Desbalance de voltaje entre fases (> 5%)',                    true),
  ('voltage_imbalance_pct',        'gt',         10::numeric,  'high',         'all',       'Desbalance crítico de voltaje entre fases (> 10%)',           true),
  ('frequency_hz',                 'lt',         59::numeric,  'high',         'all',       'Subfrecuencia de red (< 59 Hz)',                              true),
  ('frequency_hz',                 'gt',         61::numeric,  'high',         'all',       'Sobrefrecuencia de red (> 61 Hz)',                            true)
) as v(variable, operator, threshold, severity, scope, name, enabled)
where not exists (
  select 1 from alert_rules ar
  where ar.variable = v.variable and ar.operator = v.operator and ar.threshold = v.threshold and ar.scope = v.scope
);
