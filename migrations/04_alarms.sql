-- ─────────────────────────────────────────────────────────────────
-- Phase 4 — Lazo de control 15 min + Alarmas inversor + Batería
--
-- Aplica en Supabase SQL Editor después de phases 1, 2, 3.
-- Idempotente: se puede correr varias veces sin romper nada.
-- ─────────────────────────────────────────────────────────────────

-- 1. Columna JSONB en devices con los flags de alarma capturados de Metrum.
--    Estructura: { "flagEMayor": 0, "flagFSVER": 1, "UIcolorRojo": 0, "TLinvstate": "on", ... }
alter table devices
  add column if not exists alarm_flags jsonb default '{}'::jsonb;

create index if not exists idx_devices_alarm_flags_gin on devices using gin (alarm_flags);

-- 2. Columnas de batería en daily_casa_metrics (copiadas desde daily_consumption en cada cron).
alter table daily_casa_metrics
  add column if not exists batt_soh_pct numeric,
  add column if not exists batt_energy_delivered_wh numeric,
  add column if not exists batt_delivery_time_s numeric;

-- 3. Tabla de métricas instantáneas (15 min) — usada por /api/cron/instant-check
create table if not exists instant_metrics (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references client_houses(id) on delete cascade,
  casa text not null,
  recorded_at timestamptz not null,
  -- meter rojo (potencias y corriente)
  current_a_max numeric,                -- max(currentA, B, C)
  power_active_w numeric,               -- powerAI
  power_reactive_var numeric,           -- powerRI
  cos_phi_now numeric,                  -- P/√(P²+Q²)
  fase_imbalance_pct numeric,           -- |max-min|/max × 100 entre corrientes A/B/C
  -- inversor
  inv_state text,                       -- 'on' / 'off' / null (TLinvstate o derivado de active)
  inv_current_a_max numeric,
  inv_active_power_w numeric,           -- TLpowerAE de DEYE o derivado
  batt_soc_pct numeric,                 -- TLBattSOC instantáneo
  -- gateway
  gateway_online boolean,
  gateway_last_seen timestamptz,
  created_at timestamptz default now(),
  unique (house_id, recorded_at)
);

create index if not exists idx_instant_recent on instant_metrics (recorded_at desc);
create index if not exists idx_instant_house  on instant_metrics (house_id, recorded_at desc);

-- 4. Seed de reglas: batería + alarmas inversor + lazo 15 min
insert into alert_rules (name, description, variable, operator, threshold, severity, scope) values
  -- ───── Batería ─────
  ('Batería — Salud degradada (SOH < 80%)', 'La batería está perdiendo capacidad. Plan de monitoreo y reemplazo a mediano plazo.', 'batt_soh_pct', 'lt', 80, 'medium', 'all'),
  ('Batería — Salud crítica (SOH < 60%)', 'Capacidad de batería menor al 60%. Programar reemplazo.', 'batt_soh_pct', 'lt', 60, 'high', 'all'),
  ('Batería — Sin entrega de energía hoy', 'La batería no entregó energía durante el día. Verificar carga o falla.', 'batt_energy_delivered_wh', 'lt', 100, 'low', 'all'),

  -- ───── Alarmas inversor — voltaje y corriente ─────
  ('Inversor — Sobre-voltaje (FSVER)', 'Voltaje fuera de rango superior. Riesgo de daño a equipos conectados.', 'alarm_FSVER', 'gt', 0, 'high', 'all'),
  ('Inversor — Sobre-corriente (FSCER)', 'Corriente por encima del límite seguro del equipo.', 'alarm_FSCER', 'gt', 0, 'high', 'all'),
  ('Inversor — Voltaje DC fuera de rango (FBVER)', 'Voltaje del bus DC (paneles o batería) fuera de operación normal.', 'alarm_FBVER', 'gt', 0, 'high', 'all'),

  -- ───── Alarmas inversor — temperatura ─────
  ('Inversor — Sobre-temperatura (FFT)', 'Temperatura interna del inversor superando límite. Riesgo de derate o apagado.', 'alarm_FFT', 'gt', 0, 'high', 'all'),
  ('Inversor — Pre-alerta temperatura (ETA)', 'Temperatura interna acercándose al umbral. Posible ventilación obstruida.', 'alarm_ETA', 'gt', 0, 'medium', 'all'),

  -- ───── Alarmas inversor — DC y MPPT ─────
  ('Inversor — Falla DC (FFDC)', 'Problema en el lado DC del inversor (paneles, MPPT o cableado).', 'alarm_FFDC', 'gt', 0, 'high', 'all'),

  -- ───── Alarmas inversor — operación ─────
  ('Inversor — Modo emergencia (FEM)', 'El inversor entró en modo emergencia. Probable reset automático.', 'alarm_FEM', 'gt', 0, 'high', 'all'),
  ('Inversor — Falla feedback (FFB)', 'Lazo de control reporta error de seguimiento.', 'alarm_FFB', 'gt', 0, 'medium', 'all'),
  ('Inversor — Falla sensor CT (FFCT)', 'Sensor de corriente (CT) con lectura inválida.', 'alarm_FFCT', 'gt', 0, 'medium', 'all'),

  -- ───── Estado UI (catch-all visible en Metrum) ─────
  ('Inversor — Estado crítico (UI rojo)', 'Metrum marca el inversor en rojo. Hay alguna falla activa no filtrada.', 'alarm_UIcolorRojo', 'gt', 0, 'high', 'all'),
  ('Inversor — Estado advertencia (UI amarillo)', 'Metrum marca el inversor en amarillo. Atención requerida.', 'alarm_UIcolorAmarillo', 'gt', 0, 'medium', 'all'),

  -- ───── Estado on/off DEYE ─────
  ('Inversor DEYE — Apagado (TLinvstate=off)', 'El inversor DEYE está apagado. Generación detenida.', 'alarm_TLinvstate_off', 'gt', 0, 'high', 'all'),

  -- ───── Lazo 15 min — potencia y reactiva instantáneas ─────
  ('Demanda — Corriente cercana al breaker (≥ 70 A)', 'Algún polo del medidor pasó 70 A. Si el breaker es de 80 A, está al 87%. Recomendar bajar demanda.', 'current_a_max', 'gte', 70, 'medium', 'all'),
  ('Demanda — Corriente sobre breaker (≥ 80 A)', 'Corriente supera 80 A. Riesgo de trip inmediato.', 'current_a_max', 'gte', 80, 'high', 'all'),
  ('Reactiva en vivo — fp < 0.9 instantáneo', 'Factor de potencia instantáneo bajo 0.9. Si se sostiene, hay penalización CREG creciendo.', 'cos_phi_now', 'lt', 0.9, 'medium', 'all'),
  ('Reactiva en vivo — fp < 0.85 (crítico)', 'Factor de potencia muy bajo. Penalización CREG cierta este mes.', 'cos_phi_now', 'lt', 0.85, 'high', 'all'),
  ('Desbalance — Fases con diferencia > 30%', 'Las corrientes entre fases A/B/C están muy desbalanceadas. Daña neutros.', 'fase_imbalance_pct', 'gt', 30, 'medium', 'all'),
  ('Batería en vivo — SOC bajo (< 15%)', 'State of Charge crítico. Sin respaldo si la red cae.', 'batt_soc_pct', 'lt', 15, 'high', 'all'),
  ('Gateway — Offline > 30 min', 'El Pulsar lleva más de 30 minutos sin reportar. Casa muda.', 'gateway_offline_min', 'gt', 30, 'high', 'all')
on conflict do nothing;
