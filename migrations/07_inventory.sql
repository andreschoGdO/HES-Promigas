-- ─────────────────────────────────────────────────────────────────
-- Phase 7 — Módulo de Inventario
-- Equipos serializados + consumibles + log de movimientos
-- Aplicar en Supabase SQL Editor después de phases 1-6
-- ─────────────────────────────────────────────────────────────────

-- 1. Catálogo de categorías de equipo
create table if not exists inventory_categories (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,         -- ej: 'LIVOLTEK_HP3_10K', 'PANEL_550W'
  name text not null,                -- ej: 'Livoltek HP3-10KL2'
  family text not null,              -- 'inverter' | 'battery' | 'panel' | 'gateway' | 'meter' | 'cable' | 'breaker' | 'tool' | 'other'
  description text,
  default_brand text,
  default_model text,
  default_capacity_value numeric,
  default_capacity_unit text,        -- 'kW' | 'kWh' | 'Wp' | 'A' | 'V'
  default_warranty_months integer,
  is_serialized boolean not null default true,
  created_at timestamptz default now()
);

create index if not exists idx_inv_cat_family on inventory_categories (family);

-- 2. Equipos serializados (unidades individuales)
create table if not exists inventory_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references inventory_categories(id) on delete set null,
  serial_number text unique not null,
  brand text,
  model text,
  capacity_value numeric,
  capacity_unit text,
  status text not null default 'in_stock'
    check (status in ('in_stock', 'reserved', 'installed', 'in_repair', 'rma', 'decommissioned', 'lost')),
  current_location text,             -- 'warehouse' | 'casa:Casa 10' | 'workshop' | 'in_transit' | 'supplier_rma'
  current_house_id uuid references client_houses(id) on delete set null,
  current_device_id uuid references devices(id) on delete set null,  -- vincula con el device de Metrum
  acquired_at date,
  acquired_cost_cop numeric,
  supplier text,
  invoice_number text,
  warranty_months integer,
  warranty_expires_at date,
  qr_payload text,                    -- el contenido crudo del QR escaneado
  notes text,
  photo_urls jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by text
);

create index if not exists idx_inv_items_status on inventory_items (status);
create index if not exists idx_inv_items_house on inventory_items (current_house_id);
create index if not exists idx_inv_items_cat on inventory_items (category_id);
create index if not exists idx_inv_items_serial on inventory_items (serial_number);
create index if not exists idx_inv_items_warranty on inventory_items (warranty_expires_at);

-- 3. Consumibles (cantidad, no serializado)
create table if not exists inventory_consumables (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references inventory_categories(id) on delete set null,
  name text not null,
  sku text unique,
  description text,
  unit text not null default 'ud',       -- ud, m, kg, l, m²
  stock_quantity numeric not null default 0,
  min_threshold numeric default 0,       -- para alertas de low stock
  supplier text,
  cost_per_unit_cop numeric,
  location text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_inv_cons_stock on inventory_consumables (stock_quantity);

-- 4. Log de movimientos (auditoría completa)
create table if not exists inventory_movements (
  id uuid primary key default gen_random_uuid(),
  -- O bien un item serializado, O bien un consumable, no ambos:
  item_id uuid references inventory_items(id) on delete cascade,
  consumable_id uuid references inventory_consumables(id) on delete cascade,
  type text not null
    check (type in ('receive', 'install', 'uninstall', 'transfer', 'repair_start', 'repair_end', 'rma_send', 'rma_return', 'decommission', 'adjust_quantity', 'reserve', 'unreserve')),
  -- Estado antes y después
  from_status text,
  to_status text,
  from_location text,
  to_location text,
  from_house_id uuid references client_houses(id) on delete set null,
  to_house_id uuid references client_houses(id) on delete set null,
  -- Solo para consumibles
  quantity numeric,
  -- Trazabilidad
  related_visit_id uuid references field_visits(id) on delete set null,
  responsible_email text,
  notes text,
  created_at timestamptz default now()
);

create index if not exists idx_inv_mov_recent on inventory_movements (created_at desc);
create index if not exists idx_inv_mov_item on inventory_movements (item_id, created_at desc);
create index if not exists idx_inv_mov_consumable on inventory_movements (consumable_id, created_at desc);
create index if not exists idx_inv_mov_type on inventory_movements (type, created_at desc);

-- Trigger updated_at
drop trigger if exists trg_inv_items_updated on inventory_items;
create trigger trg_inv_items_updated before update on inventory_items
  for each row execute function set_updated_at();

drop trigger if exists trg_inv_cons_updated on inventory_consumables;
create trigger trg_inv_cons_updated before update on inventory_consumables
  for each row execute function set_updated_at();

-- 5. Seed de categorías comunes (basado en flota actual HES Promigas)
insert into inventory_categories (code, name, family, default_brand, default_model, default_capacity_value, default_capacity_unit, default_warranty_months) values
  ('LIVOLTEK_HP3_10K', 'Livoltek HP3-10KL2', 'inverter', 'LIVOLTEK', 'HP3-10KL2', 10, 'kW', 60),
  ('LIVOLTEK_HP3_15K', 'Livoltek HP3-15KL2', 'inverter', 'LIVOLTEK', 'HP3-15KL2', 15, 'kW', 60),
  ('DEYE_SUN_15K', 'DEYE SUN-15K-SG01HP3', 'inverter', 'DEYE', 'SUN-15K-SG01HP3 HV trifásico', 15, 'kW', 60),
  ('DEYE_SUN_6K', 'DEYE SUN-6K', 'inverter', 'DEYE', 'SUN-6K-SG03LP1', 6, 'kW', 60),
  ('EASTRON_DTSY23', 'Eastron DTSY23-3P trifásico', 'meter', 'Eastron', 'DTSY23-3P', null, null, 24),
  ('PULSAR_IN4242', 'Pulsar IN4242 gateway 4G', 'gateway', 'Pulsar', 'IN4242', null, null, 36),
  ('BATT_DEYE_5K', 'Batería DEYE 5kWh', 'battery', 'DEYE', 'SH5K', 5, 'kWh', 60),
  ('PANEL_550W', 'Panel solar 550 Wp', 'panel', 'Jinko / Trina', '550W monocristalino', 550, 'Wp', 120),
  ('PANEL_400W', 'Panel solar 400 Wp', 'panel', 'Jinko / Trina', '400W monocristalino', 400, 'Wp', 120)
on conflict (code) do nothing;

insert into inventory_consumables (name, sku, unit, stock_quantity, min_threshold, description) values
  ('Cable solar fotovoltaico 6mm² rojo', 'CABLE-PV-6-RED', 'm', 0, 100, 'Cable PV1-F 6mm² rojo para strings DC'),
  ('Cable solar fotovoltaico 6mm² negro', 'CABLE-PV-6-BLACK', 'm', 0, 100, 'Cable PV1-F 6mm² negro para strings DC'),
  ('Conector MC4 macho', 'CON-MC4-M', 'ud', 0, 50, 'Conector MC4 macho para paneles'),
  ('Conector MC4 hembra', 'CON-MC4-F', 'ud', 0, 50, 'Conector MC4 hembra para paneles'),
  ('Breaker bipolar 32A', 'BRK-2P-32A', 'ud', 0, 10, 'Interruptor automático bipolar 32A curva C'),
  ('Breaker tetrapolar 63A', 'BRK-4P-63A', 'ud', 0, 5, 'Interruptor automático tetrapolar 63A para conexión a red'),
  ('Tornillo autoperforante 5/16" x 2"', 'TORN-5-16', 'ud', 0, 200, 'Para fijación de estructura sobre teja metálica'),
  ('Cinta dieléctrica vinílica', 'TAPE-VINIL', 'ud', 0, 10, 'Rollo de cinta aislante 3M Super 33+')
on conflict (sku) do nothing;
