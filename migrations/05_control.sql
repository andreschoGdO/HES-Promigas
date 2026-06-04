-- ─────────────────────────────────────────────────────────────────
-- Phase 5 — Control manual de inversores (sin lazo cerrado todavía)
-- Aplica en Supabase SQL Editor después de phases 1-4.
-- ─────────────────────────────────────────────────────────────────

create table if not exists inverter_control_commands (
  id uuid primary key default gen_random_uuid(),
  house_id uuid references client_houses(id) on delete set null,
  casa text,
  inverter_id uuid references devices(id) on delete set null,
  inverter_name text,
  marca text,                            -- LIVOLTEK | DEYE
  modelo text,
  action text not null,                  -- set_power_factor | set_reactive_power | set_active_power_limit | set_work_mode | read_status
  target_value numeric,
  target_unit text,                      -- 'cos_phi' | 'kvar' | 'kW' | 'mode_code'
  -- Snapshot del estado al momento del comando (auditoría)
  cos_phi_at_send numeric,
  power_active_w_at_send numeric,
  power_reactive_var_at_send numeric,
  -- Resultado
  status text not null default 'pending',-- pending | sent | success | failed | mocked
  response_payload jsonb,
  error_message text,
  -- Quién y cuándo
  sent_by text,                          -- email del usuario
  sent_at timestamptz default now(),
  completed_at timestamptz
);

create index if not exists idx_inverter_cmds_recent on inverter_control_commands (sent_at desc);
create index if not exists idx_inverter_cmds_casa on inverter_control_commands (casa, sent_at desc);
create index if not exists idx_inverter_cmds_status on inverter_control_commands (status, sent_at desc);
