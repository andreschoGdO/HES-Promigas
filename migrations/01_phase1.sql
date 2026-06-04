-- =========================================================================
-- FASE 1 — Schema ampliado para cubrir el diccionario de consumos
-- Orientado por "casa/cliente": cada casa agrupa meter_solar + meter_red +
-- inverter + (opcional) battery.
--
-- IDEMPOTENTE: seguro de correr varias veces.
-- =========================================================================

-- 1. Casas (clientes)
create table if not exists client_houses (
  id uuid primary key default gen_random_uuid(),
  cliente_id varchar(255) not null unique,            -- UUID del cliente en Metrum
  casa varchar(255) not null,                         -- "Casa 63", "Casa 76", etc.
  location varchar(255),
  city varchar(255),
  created_at timestamptz default now()
);

create index if not exists idx_houses_casa on client_houses(casa);

-- 2. Devices: agregar relación a casa + subtipo
alter table devices add column if not exists house_id uuid references client_houses(id) on delete set null;
alter table devices add column if not exists subtype varchar(50);   -- 'meter_solar' | 'meter_red' | 'inverter' | 'battery'
create index if not exists idx_devices_house on devices(house_id);
create index if not exists idx_devices_subtype on devices(subtype);

-- 3. Tabla principal de consumo diario por casa (refleja el diccionario)
create table if not exists daily_consumption (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references client_houses(id) on delete cascade,
  dia_consumo date not null,
  fecha_telemetria date not null,                     -- = dia_consumo + 1

  -- ---- Meter Solar ----
  lectura_eai_meter_solar numeric,
  eai_meter_solar numeric,
  lectura_eae_meter_solar numeric,
  eae_meter_solar numeric,
  lectura_eri_meter_solar numeric,
  eri_meter_solar numeric,
  lectura_ere_meter_solar numeric,
  ere_meter_solar numeric,
  meter_solar_estado varchar(50),

  -- ---- Meter Red ----
  lectura_eai_meter_red numeric,
  eai_meter_red numeric,
  lectura_eae_meter_red numeric,
  eae_meter_red numeric,
  lectura_eri_meter_red numeric,
  eri_meter_red numeric,
  lectura_ere_meter_red numeric,
  ere_meter_red numeric,
  meter_red_estado varchar(50),
  usa_phs boolean,

  -- ---- Inverter ----
  generacion_solar_inverter numeric,
  consumo_cliente_inverter numeric,
  energia_importada_inverter numeric,
  energia_exportada_inverter numeric,
  inverter_estado varchar(50),

  -- ---- Battery ----
  energia_entregada_bateria numeric,
  estado_salud_bateria numeric,
  tiempo_entrega_bateria integer,

  -- ---- Derivadas (calculadas en backend) ----
  consumo_solar numeric,
  gen_solar_total numeric,
  ptc_autosuficiencia numeric,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  unique (house_id, dia_consumo)
);

create index if not exists idx_daily_consumption_date on daily_consumption(dia_consumo desc);
create index if not exists idx_daily_consumption_house on daily_consumption(house_id);

-- 4. RLS — habilitar (el backend usa service role, así que pasa libre)
alter table client_houses enable row level security;
alter table daily_consumption enable row level security;

-- Política de lectura pública (frontend lee con anon key)
drop policy if exists "public read houses" on client_houses;
create policy "public read houses" on client_houses for select using (true);

drop policy if exists "public read consumption" on daily_consumption;
create policy "public read consumption" on daily_consumption for select using (true);
