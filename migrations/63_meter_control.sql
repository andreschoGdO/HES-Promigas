-- ─────────────────────────────────────────────────────────────────
-- Phase 63 — Corte y reconexión remota de medidores (auditoría)
--
-- Metrum expone, por medidor (device type='meter'), un atributo
-- `latch_state`/`latch_output` ("close"/"open") que refleja el relé de
-- corte físico del medidor (protocolo DLMS/COSEM — modelos dds23y-1p,
-- dtsy23-3p), y un atributo `command` (SERVER_SCOPE) por el que Metrum
-- despacha acciones (se observó "updateCosem" en un medidor real).
--
-- Todavía NO se confirmó con Metrum el string exacto de comando para
-- disparar el corte/reconexión remota — por eso el envío queda MOCKEADO
-- por defecto (ver src/lib/metrum-meter-control.ts) hasta que se confirme
-- y se configuren METRUM_METER_DISCONNECT_COMMAND / _RECONNECT_COMMAND +
-- METRUM_METER_CONTROL_LIVE=true. Mismo patrón que inverter_control_commands.
-- ─────────────────────────────────────────────────────────────────

create table if not exists meter_control_commands (
  id uuid primary key default gen_random_uuid(),
  house_id uuid references client_houses(id) on delete set null,
  casa text,
  meter_id uuid references devices(id) on delete set null,
  meter_name text,
  metrum_id text,                        -- entity id del medidor en Metrum/ThingsBoard
  action text not null check (action in ('disconnect', 'reconnect')),
  latch_state_at_send text,              -- snapshot de latch_state/latch_output al momento del comando
  status text not null default 'pending', -- pending | sent | success | failed | mocked
  response_payload jsonb,
  error_message text,
  sent_by text,
  sent_at timestamptz default now(),
  completed_at timestamptz
);

create index if not exists idx_meter_cmds_recent on meter_control_commands (sent_at desc);
create index if not exists idx_meter_cmds_meter on meter_control_commands (meter_id);
