-- ─────────────────────────────────────────────────────────────────
-- Phase 27 — Bodegas formales + warehouse_id en items y consumibles
--
-- Hasta ahora `current_location` era texto libre ('warehouse', 'workshop',
-- 'vehicle', ...). Esto funciona pero no permite distinguir Cuadrilla Cali
-- vs Cuadrilla Bogotá ni mantener responsables y direcciones por sitio.
--
-- Creamos `warehouses` como entidad de primera clase con su propio FK.
-- `current_location` se mantiene por compatibilidad histórica pero
-- `warehouse_id` queda como la fuente de verdad para nuevos movimientos.
-- ─────────────────────────────────────────────────────────────────

create table if not exists warehouses (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,         -- 'BOG_CENTRAL', 'CALI_CUADRILLA_1'
  name text not null,
  type text not null default 'central'
    check (type in ('central', 'cuadrilla', 'vehiculo', 'taller', 'transito', 'proveedor', 'otro')),
  address text,
  city text,
  manager_email text,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_warehouses_active on warehouses (is_active) where is_active = true;
create index if not exists idx_warehouses_type on warehouses (type);

drop trigger if exists trg_warehouses_updated on warehouses;
create trigger trg_warehouses_updated before update on warehouses
  for each row execute function set_updated_at();

-- FK en items y consumibles. current_location queda para compatibilidad.
alter table inventory_items
  add column if not exists warehouse_id uuid references warehouses(id) on delete set null;

alter table inventory_consumables
  add column if not exists warehouse_id uuid references warehouses(id) on delete set null;

create index if not exists idx_inv_items_warehouse on inventory_items (warehouse_id);
create index if not exists idx_inv_cons_warehouse on inventory_consumables (warehouse_id);

-- Seed inicial: una bodega central. Los usuarios crean las demás vía UI.
insert into warehouses (code, name, type, city, notes)
  values ('BODEGA_CENTRAL', 'Bodega Central', 'central', 'Cali', 'Bodega principal — creada automáticamente al instalar phase 27')
  on conflict (code) do nothing;

-- Migración suave: items con current_location='warehouse' apuntan a la
-- bodega central. Items en otros estados quedan sin warehouse_id (NULL)
-- y los usuarios los re-asignan cuando los muevan.
update inventory_items
   set warehouse_id = (select id from warehouses where code = 'BODEGA_CENTRAL')
 where warehouse_id is null
   and (current_location = 'warehouse' or current_location is null)
   and status = 'in_stock';

update inventory_consumables
   set warehouse_id = (select id from warehouses where code = 'BODEGA_CENTRAL')
 where warehouse_id is null;

-- Nuevos tipos de movimiento permitidos en inventory_movements para
-- transferencias entre bodegas. Mantenemos los tipos existentes intactos.
alter table inventory_movements drop constraint if exists inventory_movements_type_check;
alter table inventory_movements add constraint inventory_movements_type_check
  check (type in (
    'receive', 'install', 'uninstall', 'transfer', 'repair_start', 'repair_end',
    'rma_send', 'rma_return', 'decommission', 'adjust_quantity',
    'reserve', 'unreserve', 'transfer_out', 'transfer_in'
  ));

-- Columnas opcionales en movements para tracking de bodegas (origen/destino)
alter table inventory_movements
  add column if not exists from_warehouse_id uuid references warehouses(id) on delete set null,
  add column if not exists to_warehouse_id uuid references warehouses(id) on delete set null;
