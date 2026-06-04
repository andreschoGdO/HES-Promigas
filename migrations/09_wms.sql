-- ─────────────────────────────────────────────────────────────────
-- Phase 9 — Upgrade hacia WMS
--   1. Ubicaciones como entidad de primera clase (bodega, taller,
--      vehículo, sitio cliente, proveedor RMA, en tránsito)
--   2. Reservas para visitas (pick lists serial-level)
--
-- Backwards-compatible: las columnas legacy `current_location` /
-- `location` (texto) se mantienen; las nuevas `*_location_id` (uuid)
-- son el modelo correcto a partir de ahora. El backfill al final del
-- script migra automáticamente los valores conocidos.
-- ─────────────────────────────────────────────────────────────────

-- 1. Tabla de ubicaciones
create table if not exists inventory_locations (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,                  -- WAREHOUSE_MAIN, VEHICLE_CUAD_1, etc.
  name text not null,
  type text not null check (type in (
    'warehouse',       -- bodega física
    'workshop',        -- taller (banco de pruebas / reparación in-house)
    'vehicle',         -- camioneta / móvil de cuadrilla
    'site',            -- en sitio cliente (genérico, distinto del current_house_id)
    'supplier_rma',    -- proveedor por garantía
    'in_transit',      -- moviéndose entre ubicaciones
    'other'
  )),
  parent_id uuid references inventory_locations(id) on delete set null,  -- jerarquía
  address text,
  contact_email text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_inv_loc_type on inventory_locations (type) where is_active;
create index if not exists idx_inv_loc_parent on inventory_locations (parent_id);

drop trigger if exists trg_inv_loc_updated on inventory_locations;
create trigger trg_inv_loc_updated before update on inventory_locations
  for each row execute function set_updated_at();

-- 2. Agregar location_id a items, consumibles y movimientos
alter table inventory_items
  add column if not exists current_location_id uuid references inventory_locations(id) on delete set null;

alter table inventory_consumables
  add column if not exists location_id uuid references inventory_locations(id) on delete set null;

alter table inventory_movements
  add column if not exists from_location_id uuid references inventory_locations(id) on delete set null,
  add column if not exists to_location_id uuid references inventory_locations(id) on delete set null;

create index if not exists idx_inv_items_loc on inventory_items (current_location_id);
create index if not exists idx_inv_cons_loc on inventory_consumables (location_id);

-- 3. Reservas (pick lists serial-level)
create table if not exists inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid references field_visits(id) on delete set null,
  status text not null default 'draft'
    check (status in (
      'draft',       -- en armado, todavía editable
      'confirmed',   -- items asignados (status 'reserved'), esperando visita
      'fulfilled',   -- visita completada, items pasaron a installed
      'cancelled'    -- liberada sin usar, items regresan a in_stock
    )),
  title text not null,                       -- "Instalación Casa 30 — viernes"
  requested_by text,                         -- email del solicitante
  notes text,
  created_at timestamptz default now(),
  confirmed_at timestamptz,
  fulfilled_at timestamptz,
  cancelled_at timestamptz
);

create index if not exists idx_inv_resv_visit on inventory_reservations (visit_id);
create index if not exists idx_inv_resv_status on inventory_reservations (status, created_at desc);

create table if not exists inventory_reservation_items (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references inventory_reservations(id) on delete cascade,
  item_id uuid not null references inventory_items(id) on delete restrict,
  picked_at timestamptz,
  created_at timestamptz default now(),
  unique (reservation_id, item_id)
);

create index if not exists idx_inv_resv_items_resv on inventory_reservation_items (reservation_id);
create index if not exists idx_inv_resv_items_item on inventory_reservation_items (item_id);

-- 4. Seed: ubicaciones por defecto
insert into inventory_locations (code, name, type, notes) values
  ('WAREHOUSE_MAIN', 'Bodega principal',       'warehouse',    'Bodega central HES Promigas'),
  ('WORKSHOP',       'Taller',                 'workshop',     'Mesa de trabajo para pruebas y reparaciones'),
  ('IN_TRANSIT',     'En tránsito',            'in_transit',   'Items en movimiento entre ubicaciones'),
  ('SUPPLIER_RMA',   'RMA — Proveedor',        'supplier_rma', 'Equipos enviados a proveedor por garantía'),
  ('VEHICLE_CUAD_1', 'Camioneta Cuadrilla 1',  'vehicle',      'Inventario móvil cuadrilla 1'),
  ('VEHICLE_CUAD_2', 'Camioneta Cuadrilla 2',  'vehicle',      'Inventario móvil cuadrilla 2')
on conflict (code) do nothing;

-- 5. Backfill: convertir texto legacy a location_id por mapeo conocido
update inventory_items i set current_location_id = (select id from inventory_locations where code = 'WAREHOUSE_MAIN')
  where i.current_location_id is null and lower(i.current_location) in ('warehouse', 'bodega');
update inventory_items i set current_location_id = (select id from inventory_locations where code = 'WORKSHOP')
  where i.current_location_id is null and lower(i.current_location) in ('workshop', 'taller');
update inventory_items i set current_location_id = (select id from inventory_locations where code = 'IN_TRANSIT')
  where i.current_location_id is null and lower(i.current_location) in ('in_transit', 'transito');
update inventory_items i set current_location_id = (select id from inventory_locations where code = 'SUPPLIER_RMA')
  where i.current_location_id is null and lower(i.current_location) in ('supplier_rma', 'rma');

update inventory_consumables c set location_id = (select id from inventory_locations where code = 'WAREHOUSE_MAIN')
  where c.location_id is null and (c.location is null or lower(c.location) in ('warehouse', 'bodega', ''));
