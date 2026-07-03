'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { Package, Plus, Upload, ScanLine, Search, Trash2, Pencil, History, AlertTriangle, Boxes, Tags, Cpu, Battery, Sun, Cable, MapPin, ClipboardList, CheckCircle2, XCircle, Truck, Building2, Wrench, ArrowRight, Repeat, Undo2, PowerOff } from 'lucide-react';
import { BarcodeScanner } from '@/components/BarcodeScanner';

const supa = () => createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

type Tab = 'equipos' | 'consumibles' | 'ubicaciones' | 'reservas' | 'movimientos' | 'categorias' | 'panorama' | 'inversa' | 'transferencias' | 'kits';

interface Category {
  id: string;
  code: string;
  name: string;
  family: string;
  default_brand: string | null;
  default_model: string | null;
  default_capacity_value: number | null;
  default_capacity_unit: string | null;
  default_warranty_months: number | null;
  default_cost_cop: number | null;
  provider: string | null;
  is_serialized: boolean;
}

interface InvItem {
  id: string;
  category_id: string | null;
  serial_number: string;
  brand: string | null;
  model: string | null;
  capacity_value: number | null;
  capacity_unit: string | null;
  status: 'in_stock' | 'reserved' | 'installed' | 'in_repair' | 'decommissioned';
  current_location: string | null;
  current_house_id: string | null;
  acquired_at: string | null;
  supplier: string | null;
  warranty_expires_at: string | null;
  notes: string | null;
  created_at: string;
  inventory_categories?: { code: string; name: string; family: string } | null;
  client_houses?: { casa: string } | null;
  // Reservas vinculadas (filtramos en frontend a la activa: draft o confirmed).
  inventory_reservation_items?: Array<{ inventory_reservations?: { id: string; title: string; status: string } | null }>;
  warehouse_id?: string | null;
  warehouses?: { id: string; code: string; name: string } | null;
}

interface Consumable {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  stock_quantity: number;
  min_threshold: number;
  supplier: string | null;
  cost_per_unit_cop: number | null;
  description: string | null;
}

interface Movement {
  id: string;
  type: string;
  from_status: string | null;
  to_status: string | null;
  from_location: string | null;
  to_location: string | null;
  quantity: number | null;
  responsible_email: string | null;
  notes: string | null;
  created_at: string;
  inventory_items?: { serial_number: string; brand: string | null; model: string | null } | null;
  inventory_consumables?: { name: string; sku: string | null; unit: string } | null;
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  in_stock:       { label: 'En stock',    color: '#10b981' },
  reserved:       { label: 'Reservado',   color: '#3b82f6' },
  installed:      { label: 'Instalado',   color: '#07c5a8' },
  in_repair:      { label: 'En garantía', color: '#f59e0b' },
  decommissioned: { label: 'Decomisado',  color: '#64748b' },
};

/**
 * Muestra el destino actual del item dependiendo de su estado:
 *   - reserved  → "Reservado para: <título de la reserva activa>"
 *   - installed → "Instalado en: Casa X" (con su barrio si aplica)
 *   - in_repair → "En garantía — taller / proveedor"
 *   - rma       → "RMA proveedor"
 *   - in_stock  → "Bodega" (o current_location)
 */
function ItemDestination({ item }: { item: InvItem }) {
  // Buscar reserva activa (draft o confirmed) entre las vinculadas
  const activeResv = item.inventory_reservation_items
    ?.map((l) => l.inventory_reservations)
    .find((r) => r && (r.status === 'draft' || r.status === 'confirmed')) ?? null;

  if (item.status === 'reserved' && activeResv) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#3b82f6' }} />
        <span style={{ color: 'var(--text)' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginRight: 4 }}>RESV →</span>
          {activeResv.title}
        </span>
      </span>
    );
  }
  if (item.status === 'installed' && item.client_houses?.casa) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#07c5a8' }} />
        <span style={{ color: 'var(--text)' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginRight: 4 }}>EN →</span>
          {item.client_houses.casa}
        </span>
      </span>
    );
  }
  if (item.status === 'in_repair') {
    return <span style={{ color: '#f59e0b' }}>En garantía / taller</span>;
  }
  // in_stock o cualquier otro
  return <span>{item.current_location ?? 'Bodega'}</span>;
}

const FAMILY_ICONS: Record<string, typeof Cpu> = {
  inverter: Cpu, battery: Battery, bms: Cpu, panel: Sun, gateway: Cpu, meter: Cpu, cable: Cable, breaker: Cable, tool: Package, other: Package,
  mano_obra: Wrench, desmantelamiento: Wrench, puesta_en_marcha: Wrench, servicio: Wrench,
};

const FAMILY_LABELS: Record<string, string> = {
  inverter: 'Inversores', battery: 'Baterías', bms: 'BMS / Control Box', panel: 'Paneles', gateway: 'Gateways',
  meter: 'Medidores', cable: 'Cableado', breaker: 'Breakers', tool: 'Herramientas', other: 'Otros',
  mano_obra: 'Mano de obra', desmantelamiento: 'Desmantelamiento', puesta_en_marcha: 'Puesta en marcha', servicio: 'Servicios',
};

// Familias que NO son equipos físicos — servicios cuyo precio alimenta Facturación.
const SERVICE_FAMILIES = new Set(['mano_obra', 'desmantelamiento', 'puesta_en_marcha', 'servicio']);
const isServiceFamily = (f: string) => SERVICE_FAMILIES.has(f);

const TAB_META: Record<Tab, { label: string; color: string; Icon: typeof Cpu }> = {
  equipos:     { label: 'Equipos',     color: '#3b82f6', Icon: Cpu },
  consumibles: { label: 'Consumibles', color: '#8b5cf6', Icon: Cable },
  ubicaciones: { label: 'Ubicaciones', color: '#0ea5e9', Icon: MapPin },
  reservas:    { label: 'Reservas',    color: '#ec4899', Icon: ClipboardList },
  movimientos: { label: 'Movimientos', color: '#f59e0b', Icon: History },
  categorias:     { label: 'Categorías',          color: '#10b981', Icon: Tags },
  transferencias: { label: 'Transferencias',       color: '#0ea5e9', Icon: Truck },
  panorama:       { label: 'Panorama',             color: '#07c5a8', Icon: Boxes },
  inversa:        { label: 'Logística inversa',    color: '#ef4444', Icon: Repeat },
  kits:           { label: 'Kits',                  color: '#f59e0b', Icon: Package },
};

const LOCATION_TYPE_META: Record<string, { label: string; color: string; Icon: typeof Cpu }> = {
  warehouse:    { label: 'Bodega',        color: '#0ea5e9', Icon: Building2 },
  workshop:     { label: 'Taller',        color: '#f59e0b', Icon: Wrench },
  vehicle:      { label: 'Vehículo',      color: '#8b5cf6', Icon: Truck },
  site:         { label: 'Sitio cliente', color: '#10b981', Icon: MapPin },
  supplier_rma: { label: 'Garantía con proveedor', color: '#ec4899', Icon: ArrowRight },
  in_transit:   { label: 'En tránsito',   color: '#94a3b8', Icon: Truck },
  other:        { label: 'Otro',          color: '#64748b', Icon: Package },
};

export default function InventarioPage() {
  const [tab, setTab] = useState<Tab>('equipos');
  const [userEmail, setUserEmail] = useState<string>('');
  const [headerStats, setHeaderStats] = useState<HeaderStats | null>(null);

  useEffect(() => {
    supa().auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email); });
  }, []);

  // Fetch resumen stats al cargar la página, persisten arriba sin importar el tab.
  // Usa /api/inventory/stats (COUNT queries) en vez de fetchear todos los items —
  // así evitamos el cap de 1000 filas de PostgREST que truncaba los in_stock.
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/inventory/stats');
        if (!r.ok) throw new Error('stats fetch fallo');
        const j = await r.json();
        setHeaderStats({
          totalItems: j.totalItems ?? 0,
          totalConsumables: j.totalConsumables ?? 0,
          inStock: j.inStock ?? 0,
          reserved: j.reserved ?? 0,
          installed: j.installed ?? 0,
          inRepair: j.inRepair ?? 0,
          lowStockCount: j.lowStockCount ?? 0,
          warrantyExpiring: j.warrantyExpiring ?? 0,
        });
      } catch {
        setHeaderStats({ totalItems: 0, totalConsumables: 0, inStock: 0, reserved: 0, installed: 0, inRepair: 0, lowStockCount: 0, warrantyExpiring: 0 });
      }
    })();
  }, []);

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', paddingBottom: 40 }}>
      {/* HEADER */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Package size={24} style={{ color: 'var(--accent)' }} />
          <h1 style={{ margin: 0 }}>Inventario</h1>
        </div>
        <p style={{ color: 'var(--text-secondary)', marginTop: 4, fontSize: '0.88rem' }}>
          Trazabilidad de equipos por serial del fabricante y consumibles, con audit log completo de cada movimiento.
        </p>
      </div>

      {/* KPI cards: breakdown por estado */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 12, marginBottom: 14 }}>
        <KpiCard label="En stock"    value={headerStats?.inStock    ?? 0} sub="Listos para instalar"                                        color="#10b981" Icon={Boxes} />
        <KpiCard label="En reserva"  value={headerStats?.reserved   ?? 0} sub="Apartados para una visita"                                  color="#3b82f6" Icon={ClipboardList} />
        <KpiCard label="En garantía" value={headerStats?.inRepair   ?? 0} sub={(headerStats?.inRepair ?? 0) === 0 ? 'Todo operando' : 'En taller / proveedor'} color="#f59e0b" Icon={AlertTriangle} />
        <KpiCard label="Instalado"   value={headerStats?.installed  ?? 0} sub="Operando en campo"                                          color="#07c5a8" Icon={Cpu} />
        <KpiCard label="Consumibles" value={headerStats?.totalConsumables ?? 0} sub={`${headerStats?.lowStockCount ?? 0} con stock bajo`} color="#8b5cf6" Icon={Cable} />
      </div>

      {/* TABS — primary navigation */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {(Object.keys(TAB_META) as Tab[]).map((k) => {
          const m = TAB_META[k];
          return (
            <button key={k} onClick={() => setTab(k)} className={`chip ${tab === k ? 'active' : ''}`}
              style={{ fontSize: '0.85rem', padding: '10px 14px', borderLeft: `4px solid ${m.color}`, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <m.Icon size={14} /> {m.label}
            </button>
          );
        })}
      </div>

      {tab === 'equipos' && <EquiposTab userEmail={userEmail} />}
      {tab === 'consumibles' && <ConsumiblesTab userEmail={userEmail} />}
      {tab === 'ubicaciones' && <BodegasTab userEmail={userEmail} />}
      {tab === 'reservas' && <ReservasTab userEmail={userEmail} />}
      {tab === 'movimientos' && <MovimientosTab />}
      {tab === 'categorias' && <CategoriasTab />}
      {tab === 'transferencias' && <TransferenciasTab userEmail={userEmail} />}
      {tab === 'panorama' && <PanoramaTab />}
      {tab === 'inversa' && <LogisticaInversaTab />}
      {tab === 'kits' && <KitsTab />}
    </div>
  );
}

interface HeaderStats {
  totalItems: number;
  totalConsumables: number;
  inStock: number;
  reserved: number;
  installed: number;
  inRepair: number;
  lowStockCount: number;
  warrantyExpiring: number;
}

/* ═════════════ Helpers de KPIs (usados en el header) ═════════════ */

function KpiCard({ label, value, color, sub, Icon }: { label: string; value: number; color: string; sub?: string; Icon?: typeof Cpu }) {
  return (
    <div className="glass-panel" style={{ padding: 16, borderLeft: `4px solid ${color}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>{label}</div>
        {Icon && <Icon size={16} style={{ color, opacity: 0.6 }} />}
      </div>
      <div style={{ fontSize: '1.8rem', fontWeight: 700, color, marginTop: 6, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}


/* ═════════════ EQUIPOS ═════════════ */
function EquiposTab({ userEmail }: { userEmail: string }) {
  const [items, setItems] = useState<InvItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterWarehouse, setFilterWarehouse] = useState<string>('all');
  const [filterWarranty, setFilterWarranty] = useState<string>('all');
  const [filterCategories, setFilterCategories] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [filterWarehouses, setFilterWarehouses] = useState<Array<{ id: string; name: string }>>([]);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [statusItem, setStatusItem] = useState<InvItem | null>(null);
  const [historyItem, setHistoryItem] = useState<InvItem | null>(null);
  const [swapItem, setSwapItem] = useState<InvItem | null>(null);
  const [returnItem, setReturnItem] = useState<InvItem | null>(null);
  const [decommItem, setDecommItem] = useState<InvItem | null>(null);
  // Multi-select para transferencia masiva entre bodegas
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showTransfer, setShowTransfer] = useState(false);
  const toggleSelect = (id: string) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const clearSelection = () => setSelectedIds(new Set());

  const load = async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '500' });
    if (filterStatus !== 'all') params.set('status', filterStatus);
    if (filterCategory !== 'all') params.set('category', filterCategory);
    if (filterWarehouse !== 'all') params.set('warehouse', filterWarehouse);
    if (filterWarranty !== 'all') params.set('warranty', filterWarranty);
    if (search) params.set('q', search);
    const r = await fetch(`/api/inventory/items?${params}`);
    const j = await r.json();
    setItems(j.items ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filterStatus, filterCategory, filterWarehouse, filterWarranty, search]);

  // Cargar catálogos de categorías y bodegas para los dropdowns (una sola vez)
  useEffect(() => {
    fetch('/api/inventory/categories').then((r) => r.json()).then((j) => setFilterCategories(j.categories ?? []));
    fetch('/api/inventory/warehouses?active=true').then((r) => r.json()).then((j) => setFilterWarehouses(j.warehouses ?? []));
  }, []);

  const removeItem = async (id: string) => {
    if (!confirm('¿Eliminar este equipo del inventario? Esta acción no se puede deshacer.')) return;
    await fetch(`/api/inventory/items/${id}`, { method: 'DELETE' });
    load();
  };

  return (
    <>
      <div className="glass-panel" style={{ marginBottom: 14, padding: 14 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <button onClick={() => setShowAdd(true)} className="primary-btn"><Plus size={14} /> Nuevo equipo</button>
          <button onClick={() => setShowBulk(true)} className="secondary-btn"><Upload size={14} /> Cargar CSV</button>
          <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input type="text" placeholder="Buscar por serial, marca, modelo, proveedor…"
              value={search} onChange={(e) => setSearch(e.target.value)}
              style={{ width: '100%', paddingLeft: 32 }} />
          </div>
        </div>
        {/* Filtros dropdown: Categoría · Bodega · Garantía */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Categoría</div>
            <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} style={{ width: '100%' }}>
              <option value="all">Todas</option>
              {filterCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Bodega</div>
            <select value={filterWarehouse} onChange={(e) => setFilterWarehouse(e.target.value)} style={{ width: '100%' }}>
              <option value="all">Todas</option>
              {filterWarehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Garantía</div>
            <select value={filterWarranty} onChange={(e) => setFilterWarranty(e.target.value)} style={{ width: '100%' }}>
              <option value="all">Todas</option>
              <option value="active">Activa (&gt; 30 días)</option>
              <option value="expiring">Por vencer (&lt; 30 días)</option>
              <option value="expired">Vencida</option>
            </select>
          </div>
        </div>

        <div style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Filtrar por estado</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className={`chip ${filterStatus === 'all' ? 'active' : ''}`} onClick={() => setFilterStatus('all')}>Todos</button>
          {Object.entries(STATUS_META).map(([key, meta]) => (
            <button key={key} className={`chip ${filterStatus === key ? 'active' : ''}`} onClick={() => setFilterStatus(key)} style={{ borderLeft: `3px solid ${meta.color}` }}>
              {meta.label}
            </button>
          ))}
        </div>

        {!loading && items.length > 0 && (
          <div style={{ marginTop: 10, fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span>Mostrando <strong style={{ color: 'var(--text-primary)' }}>{items.length}</strong> equipo{items.length === 1 ? '' : 's'}</span>
            {(filterStatus !== 'all' || filterCategory !== 'all' || filterWarehouse !== 'all' || filterWarranty !== 'all' || search) && (
              <button
                onClick={() => { setFilterStatus('all'); setFilterCategory('all'); setFilterWarehouse('all'); setFilterWarranty('all'); setSearch(''); }}
                className="chip"
                style={{ fontSize: '0.72rem', padding: '2px 8px' }}
              >
                Limpiar filtros
              </button>
            )}
          </div>
        )}
      </div>

      {/* Barra de acciones bulk — visible solo con ≥1 seleccionado */}
      {selectedIds.size > 0 && (
        <div style={{ marginBottom: 14, padding: 12, borderRadius: 10, background: 'rgba(14,165,233,0.10)', border: '1px solid rgba(14,165,233,0.3)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.84rem', fontWeight: 600, color: '#0ea5e9' }}>
            {selectedIds.size} equipo{selectedIds.size === 1 ? '' : 's'} seleccionado{selectedIds.size === 1 ? '' : 's'}
          </span>
          <button onClick={() => setShowTransfer(true)} className="primary-btn" style={{ background: '#0ea5e9' }}>
            <Truck size={14} /> Transferir entre bodegas
          </button>
          <button onClick={clearSelection} className="secondary-btn">
            Limpiar selección
          </button>
        </div>
      )}

      {loading ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Cargando…</div>
      ) : items.length === 0 ? (
        <div className="alert-warning" style={{ fontSize: '0.85rem' }}>
          {(filterStatus !== 'all' || search)
            ? 'Sin equipos para los filtros actuales. Prueba quitando los filtros.'
            : 'Aún no hay equipos registrados. Usa "Nuevo equipo" para añadir uno manualmente o con cámara/pistola, o "Cargar CSV" para subir varios de una vez.'}
        </div>
      ) : (
        <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '0.82rem' }}>
              <thead>
                <tr>
                  <th style={{ width: 32, textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      title="Seleccionar todos los items en stock visibles"
                      checked={items.length > 0 && items.filter((it) => it.status === 'in_stock').every((it) => selectedIds.has(it.id))}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedIds(new Set(items.filter((it) => it.status === 'in_stock').map((it) => it.id)));
                        } else {
                          clearSelection();
                        }
                      }}
                    />
                  </th>
                  <th>Serial</th>
                  <th>Categoría</th>
                  <th>Marca / Modelo</th>
                  <th>Estado</th>
                  <th>Bodega</th>
                  <th>Destino / ubicación</th>
                  <th>Garantía</th>
                  <th style={{ textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const meta = STATUS_META[it.status];
                  const canSelect = it.status === 'in_stock';
                  return (
                    <tr key={it.id} style={{ background: selectedIds.has(it.id) ? 'rgba(14,165,233,0.06)' : undefined }}>
                      <td style={{ textAlign: 'center' }}>
                        {canSelect ? (
                          <input
                            type="checkbox"
                            checked={selectedIds.has(it.id)}
                            onChange={() => toggleSelect(it.id)}
                            title="Seleccionar para transferir"
                          />
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.62rem' }}>—</span>
                        )}
                      </td>
                      <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem', fontWeight: 600 }}>{it.serial_number}</td>
                      <td style={{ fontSize: '0.78rem' }}>{it.inventory_categories?.name ?? '—'}</td>
                      <td style={{ fontSize: '0.78rem' }}>{[it.brand, it.model].filter(Boolean).join(' · ') || '—'}</td>
                      <td>
                        <span style={{ padding: '2px 10px', borderRadius: 10, background: meta.color + '20', color: meta.color, fontSize: '0.7rem', fontWeight: 700 }}>{meta.label}</span>
                      </td>
                      <td style={{ fontSize: '0.76rem' }}>
                        {it.warehouses ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Building2 size={11} style={{ color: '#0ea5e9' }} />
                            <span>{it.warehouses.name}</span>
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>—</span>
                        )}
                      </td>
                      <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        <ItemDestination item={it} />
                      </td>
                      <td style={{ fontSize: '0.78rem', fontFamily: 'ui-monospace, monospace' }}>
                        {it.warranty_expires_at ?? '—'}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {it.status === 'installed' && (
                          <>
                            <button onClick={() => setSwapItem(it)} title="Reemplazar (swap)"
                              style={{ padding: 6, background: 'transparent', border: 'none', color: '#0ea5e9', cursor: 'pointer', borderRadius: 4 }}>
                              <Repeat size={16} />
                            </button>
                            <button onClick={() => setReturnItem(it)} title="Devolver a bodega"
                              style={{ padding: 6, background: 'transparent', border: 'none', color: '#f59e0b', cursor: 'pointer', borderRadius: 4 }}>
                              <Undo2 size={16} />
                            </button>
                          </>
                        )}
                        {it.status !== 'decommissioned' && (
                          <button onClick={() => setDecommItem(it)} title="Decomisar (fin de vida)"
                            style={{ padding: 6, background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', borderRadius: 4 }}>
                            <PowerOff size={16} />
                          </button>
                        )}
                        <button onClick={() => setStatusItem(it)} title="Cambiar estado / ubicación"
                          style={{ padding: 6, background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', borderRadius: 4 }}>
                          <Pencil size={16} />
                        </button>
                        <button onClick={() => setHistoryItem(it)} title="Ver historial"
                          style={{ padding: 6, background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', borderRadius: 4 }}>
                          <History size={16} />
                        </button>
                        <button onClick={() => removeItem(it.id)} title="Eliminar"
                          style={{ padding: 6, background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', borderRadius: 4 }}>
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showAdd && <NewItemModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} userEmail={userEmail} />}
      {showBulk && <BulkUploadModal onClose={() => setShowBulk(false)} onSaved={() => { setShowBulk(false); load(); }} userEmail={userEmail} />}
      {statusItem && <ChangeStatusModal item={statusItem} userEmail={userEmail} onClose={() => setStatusItem(null)} onSaved={() => { setStatusItem(null); load(); }} />}
      {historyItem && <ItemHistoryModal item={historyItem} onClose={() => setHistoryItem(null)} />}
      {swapItem && <SwapItemModal item={swapItem} userEmail={userEmail} onClose={() => setSwapItem(null)} onSaved={() => { setSwapItem(null); load(); }} />}
      {returnItem && <ReturnItemModal item={returnItem} userEmail={userEmail} onClose={() => setReturnItem(null)} onSaved={() => { setReturnItem(null); load(); }} />}
      {decommItem && <DecommissionItemModal item={decommItem} userEmail={userEmail} onClose={() => setDecommItem(null)} onSaved={() => { setDecommItem(null); load(); }} />}
      {showTransfer && (
        <BulkTransferModal
          items={items.filter((it) => selectedIds.has(it.id))}
          userEmail={userEmail}
          onClose={() => setShowTransfer(false)}
          onSaved={() => { setShowTransfer(false); clearSelection(); load(); }}
        />
      )}
    </>
  );
}

/* ─── Modal nuevo equipo ─── */
function NewItemModal({ onClose, onSaved, userEmail }: { onClose: () => void; onSaved: () => void; userEmail: string }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [serial, setSerial] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [capacity, setCapacity] = useState('');
  const [capacityUnit, setCapacityUnit] = useState('');
  const [acquiredAt, setAcquiredAt] = useState('');
  const [supplier, setSupplier] = useState('');
  const [invoice, setInvoice] = useState('');
  const [warrantyMonths, setWarrantyMonths] = useState('');
  const [notes, setNotes] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/inventory/categories').then((r) => r.json()).then((j) => setCategories(j.categories ?? []));
  }, []);

  useEffect(() => {
    if (!categoryId) return;
    const cat = categories.find((c) => c.id === categoryId);
    if (!cat) return;
    if (!brand) setBrand(cat.default_brand ?? '');
    if (!model) setModel(cat.default_model ?? '');
    if (!capacity && cat.default_capacity_value !== null) setCapacity(String(cat.default_capacity_value));
    if (!capacityUnit && cat.default_capacity_unit) setCapacityUnit(cat.default_capacity_unit);
    if (!warrantyMonths && cat.default_warranty_months) setWarrantyMonths(String(cat.default_warranty_months));
    // eslint-disable-next-line
  }, [categoryId]);

  const save = async () => {
    setErr(null);
    if (!serial.trim()) { setErr('Serial requerido'); return; }
    setSaving(true);
    const r = await fetch('/api/inventory/items', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category_id: categoryId || null,
        serial_number: serial.trim(),
        brand: brand || null,
        model: model || null,
        capacity_value: capacity ? Number(capacity) : null,
        capacity_unit: capacityUnit || null,
        acquired_at: acquiredAt || null,
        supplier: supplier || null,
        invoice_number: invoice || null,
        warranty_months: warrantyMonths ? Number(warrantyMonths) : null,
        notes: notes || null,
        created_by: userEmail,
      }),
    });
    setSaving(false);
    const j = await r.json();
    if (!r.ok) { setErr(j.error ?? 'Error'); return; }
    onSaved();
  };

  return (
    <ModalShell onClose={onClose} title="Registrar nuevo equipo">
      {err && <div className="alert-error" style={{ marginBottom: 10, fontSize: '0.82rem' }}>{err}</div>}
      <FieldsGrid>
        <Field label="Categoría" fullWidth>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">— Selecciona —</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
          </select>
        </Field>
        <Field label="Serial del fabricante" required fullWidth>
          <div style={{ display: 'flex', gap: 6 }}>
            <input type="text" autoFocus value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="Ej: HP310K2HWC290002"
              style={{ flex: 1, fontFamily: 'ui-monospace, monospace' }} />
            <button type="button" onClick={() => setShowScanner(true)} className="secondary-btn" title="Escanear con cámara">
              <ScanLine size={16} />
            </button>
          </div>
          <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>Pega desde una pistola USB, escanea con cámara, o teclea manualmente.</p>
        </Field>
        <Field label="Marca"><input type="text" value={brand} onChange={(e) => setBrand(e.target.value)} /></Field>
        <Field label="Modelo"><input type="text" value={model} onChange={(e) => setModel(e.target.value)} /></Field>
        <Field label="Capacidad"><input type="text" inputMode="decimal" value={capacity} onChange={(e) => setCapacity(e.target.value)} /></Field>
        <Field label="Unidad capacidad">
          <select value={capacityUnit} onChange={(e) => setCapacityUnit(e.target.value)}>
            <option value="">—</option>
            <option value="kW">kW</option>
            <option value="kWh">kWh</option>
            <option value="Wp">Wp</option>
            <option value="A">A</option>
            <option value="V">V</option>
          </select>
        </Field>
        <Field label="Fecha de recepción"><input type="date" value={acquiredAt} onChange={(e) => setAcquiredAt(e.target.value)} /></Field>
        <Field label="Garantía (meses)"><input type="text" inputMode="numeric" value={warrantyMonths} onChange={(e) => setWarrantyMonths(e.target.value)} /></Field>
        <Field label="Proveedor"><input type="text" value={supplier} onChange={(e) => setSupplier(e.target.value)} /></Field>
        <Field label="Factura"><input type="text" value={invoice} onChange={(e) => setInvoice(e.target.value)} /></Field>
        <Field label="Notas" fullWidth><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </FieldsGrid>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 }}>
        <button onClick={onClose} className="secondary-btn" disabled={saving}>Cancelar</button>
        <button onClick={save} className="primary-btn" disabled={saving}>{saving ? 'Guardando…' : 'Registrar equipo'}</button>
      </div>
      <BarcodeScanner open={showScanner} onClose={() => setShowScanner(false)} onDetect={(v) => setSerial(v)} />
    </ModalShell>
  );
}

/* ─── Modal carga CSV ─── */
function BulkUploadModal({ onClose, onSaved, userEmail }: { onClose: () => void; onSaved: () => void; userEmail: string }) {
  const [csvText, setCsvText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<{ inserted: number; total: number; errors: Array<{ row: number; serial: string; error: string }> } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const downloadTemplate = () => {
    const template = 'serial_number,category_code,brand,model,capacity_value,capacity_unit,acquired_at,supplier,invoice_number,warranty_months,notes\n' +
      'HP310K2HWC290999,LIVOLTEK_HP3_10K,LIVOLTEK,HP3-10KL2,10,kW,2026-05-27,DistribuidorXYZ,FAC-001234,60,\n' +
      'EAST22230056XX,EASTRON_DTSY23,Eastron,DTSY23-3P,,,,,,24,Medidor solar\n';
    const blob = new Blob(['﻿' + template], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'inventario-plantilla.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const onFile = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
  };

  // Parser CSV mínimo con soporte para comillas dobles (RFC 4180-light):
  // - Campos pueden ir entre " "; comillas escapadas como ""
  // - Saltos de línea dentro de comillas se respetan
  const parseCSV = (text: string): Record<string, string>[] => {
    const records: string[][] = [];
    let cur: string[] = [];
    let cell = '';
    let inQuotes = false;
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 2; continue; }
        if (ch === '"') { inQuotes = false; i++; continue; }
        cell += ch; i++; continue;
      }
      if (ch === '"') { inQuotes = true; i++; continue; }
      if (ch === ',') { cur.push(cell); cell = ''; i++; continue; }
      if (ch === '\n' || ch === '\r') {
        cur.push(cell); cell = '';
        if (cur.length > 1 || (cur.length === 1 && cur[0] !== '')) records.push(cur);
        cur = [];
        if (ch === '\r' && text[i + 1] === '\n') i += 2; else i++;
        continue;
      }
      cell += ch; i++;
    }
    if (cell.length > 0 || cur.length > 0) { cur.push(cell); records.push(cur); }
    if (records.length < 2) return [];
    const headers = records[0].map((h) => h.trim().replace(/^﻿/, ''));
    const rows: Record<string, string>[] = [];
    for (let r = 1; r < records.length; r++) {
      const cells = records[r];
      // Rechazar filas con número incorrecto de columnas — evita corrupción silenciosa
      if (cells.length !== headers.length) continue;
      const obj: Record<string, string> = {};
      headers.forEach((h, idx) => { obj[h] = (cells[idx] ?? '').trim(); });
      if (obj.serial_number) rows.push(obj);
    }
    return rows;
  };

  const upload = async () => {
    setErr(null); setResult(null);
    const rows = parseCSV(csvText);
    if (rows.length === 0) { setErr('No hay filas válidas (verifica que tengas serial_number)'); return; }
    setParsing(true);
    const r = await fetch('/api/inventory/items/bulk', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows, created_by: userEmail }),
    });
    setParsing(false);
    const j = await r.json();
    if (!r.ok) { setErr(j.error ?? 'Error'); return; }
    setResult(j);
  };

  return (
    <ModalShell onClose={onClose} title="Cargar inventario desde CSV">
      <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
        Sube un CSV con los seriales recibidos. Columnas requeridas: <code>serial_number</code>. Opcionales: <code>category_code, brand, model, capacity_value, capacity_unit, acquired_at, supplier, invoice_number, warranty_months, notes</code>.
      </p>
      <button onClick={downloadTemplate} className="secondary-btn" style={{ marginBottom: 12, fontSize: '0.82rem' }}>
        Descargar plantilla
      </button>

      <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0] ?? null)} style={{ display: 'none' }} />
      <button onClick={() => fileInputRef.current?.click()} className="primary-btn" style={{ width: '100%', justifyContent: 'center', marginBottom: 10 }}>
        <Upload size={14} /> Elegir archivo CSV
      </button>

      <textarea value={csvText} onChange={(e) => setCsvText(e.target.value)} rows={8}
        style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem' }}
        placeholder="O pega el contenido del CSV aquí…" />

      {err && <div className="alert-error" style={{ marginTop: 10, fontSize: '0.82rem' }}>{err}</div>}
      {result && (
        <div className={result.errors.length > 0 ? 'alert-warning' : 'alert-success'} style={{ marginTop: 10, fontSize: '0.82rem' }}>
          <strong>Procesado:</strong> {result.inserted} de {result.total} insertados correctamente.
          {result.errors.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary>{result.errors.length} errores</summary>
              <ul style={{ margin: '6px 0 0 18px', fontSize: '0.78rem' }}>
                {result.errors.map((e, i) => <li key={i}>Fila {e.row} ({e.serial}): {e.error}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 }}>
        <button onClick={onClose} className="secondary-btn">Cerrar</button>
        <button onClick={upload} className="primary-btn" disabled={parsing || !csvText.trim()}>
          {parsing ? 'Cargando…' : 'Cargar al inventario'}
        </button>
      </div>
    </ModalShell>
  );
}

/* ═════════════ CONSUMIBLES ═════════════ */
function ConsumiblesTab({ userEmail }: { userEmail: string }) {
  const [items, setItems] = useState<Consumable[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [adjustId, setAdjustId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const r = await fetch('/api/inventory/consumables');
    const j = await r.json();
    setItems(j.consumables ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const remove = async (id: string) => {
    if (!confirm('¿Eliminar este consumible?')) return;
    await fetch(`/api/inventory/consumables?id=${id}`, { method: 'DELETE' });
    load();
  };

  const lowStockCount = items.filter((c) => c.stock_quantity <= c.min_threshold).length;

  return (
    <>
      <div className="glass-panel" style={{ marginBottom: 14, padding: 14, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => setShowAdd(true)} className="primary-btn"><Plus size={14} /> Nuevo consumible</button>
        {items.length > 0 && (
          <div style={{ display: 'flex', gap: 14, marginLeft: 'auto', fontSize: '0.82rem' }}>
            <div><span style={{ color: 'var(--text-muted)' }}>Total: </span><strong>{items.length}</strong></div>
            {lowStockCount > 0 && (
              <div style={{ color: '#ef4444', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <AlertTriangle size={14} /> <strong>{lowStockCount}</strong> con stock bajo
              </div>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Cargando…</div>
      ) : items.length === 0 ? (
        <div className="alert-warning" style={{ fontSize: '0.85rem' }}>
          Aún no hay consumibles. Registra cables, conectores, breakers, tornillería y demás material que se gasta para que el sistema te alerte cuando estés por debajo del umbral mínimo.
        </div>
      ) : (
        <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', fontSize: '0.82rem' }}>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Nombre</th>
                <th>Stock</th>
                <th>Umbral mínimo</th>
                <th>Estado</th>
                <th>Proveedor</th>
                <th style={{ textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => {
                const low = c.stock_quantity <= c.min_threshold;
                return (
                  <tr key={c.id} style={low ? { background: 'rgba(239, 68, 68, 0.04)' } : undefined}>
                    <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem' }}>{c.sku ?? '—'}</td>
                    <td>{c.name}</td>
                    <td style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{c.stock_quantity} {c.unit}</td>
                    <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{c.min_threshold} {c.unit}</td>
                    <td>
                      {low ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 10, background: '#ef444420', color: '#ef4444', fontSize: '0.7rem', fontWeight: 700 }}>
                          <AlertTriangle size={12} /> Bajo
                        </span>
                      ) : (
                        <span style={{ padding: '2px 8px', borderRadius: 10, background: '#10b98120', color: '#10b981', fontSize: '0.7rem', fontWeight: 700 }}>OK</span>
                      )}
                    </td>
                    <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{c.supplier ?? '—'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button onClick={() => setAdjustId(c.id)} title="Ajustar stock" className="secondary-btn" style={{ fontSize: '0.72rem', padding: '4px 8px' }}>
                        Ajustar
                      </button>
                      <button onClick={() => remove(c.id)} title="Eliminar" style={{ padding: 6, background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', borderRadius: 4, marginLeft: 4 }}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && <NewConsumableModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />}
      {adjustId && <AdjustStockModal consumable={items.find((c) => c.id === adjustId)!} onClose={() => setAdjustId(null)} onSaved={() => { setAdjustId(null); load(); }} userEmail={userEmail} />}
    </>
  );
}

function NewConsumableModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [unit, setUnit] = useState('ud');
  const [stockQty, setStockQty] = useState('0');
  const [minThreshold, setMinThreshold] = useState('0');
  const [supplier, setSupplier] = useState('');
  const [cost, setCost] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setErr(null);
    if (!name) { setErr('Nombre requerido'); return; }
    setSaving(true);
    const r = await fetch('/api/inventory/consumables', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, sku: sku || null, unit, stock_quantity: Number(stockQty), min_threshold: Number(minThreshold), supplier: supplier || null, cost_per_unit_cop: cost ? Number(cost) : null }),
    });
    setSaving(false);
    const j = await r.json();
    if (!r.ok) { setErr(j.error ?? 'Error'); return; }
    onSaved();
  };

  return (
    <ModalShell onClose={onClose} title="Nuevo consumible">
      {err && <div className="alert-error" style={{ marginBottom: 10, fontSize: '0.82rem' }}>{err}</div>}
      <FieldsGrid>
        <Field label="Nombre" required fullWidth><input type="text" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="SKU"><input type="text" value={sku} onChange={(e) => setSku(e.target.value)} /></Field>
        <Field label="Unidad">
          <select value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option value="ud">unidades</option>
            <option value="m">metros</option>
            <option value="m²">m²</option>
            <option value="kg">kg</option>
            <option value="l">litros</option>
          </select>
        </Field>
        <Field label="Stock inicial"><input type="text" inputMode="decimal" value={stockQty} onChange={(e) => setStockQty(e.target.value)} /></Field>
        <Field label="Umbral mínimo"><input type="text" inputMode="decimal" value={minThreshold} onChange={(e) => setMinThreshold(e.target.value)} /></Field>
        <Field label="Proveedor"><input type="text" value={supplier} onChange={(e) => setSupplier(e.target.value)} /></Field>
        <Field label="Costo unitario (COP)"><input type="text" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
      </FieldsGrid>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 }}>
        <button onClick={onClose} className="secondary-btn" disabled={saving}>Cancelar</button>
        <button onClick={save} className="primary-btn" disabled={saving}>{saving ? 'Guardando…' : 'Registrar'}</button>
      </div>
    </ModalShell>
  );
}

function AdjustStockModal({ consumable, onClose, onSaved, userEmail }: { consumable: Consumable; onClose: () => void; onSaved: () => void; userEmail: string }) {
  const [adjustment, setAdjustment] = useState('');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setErr(null);
    const n = Number(adjustment);
    if (!n || !Number.isFinite(n)) { setErr('Ingresa un valor numérico distinto de cero'); return; }
    setSaving(true);
    const r = await fetch('/api/inventory/consumables', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: consumable.id, adjust_quantity: n, notes: notes || null, responsible_email: userEmail }),
    });
    setSaving(false);
    const j = await r.json();
    if (!r.ok) { setErr(j.error ?? 'Error'); return; }
    onSaved();
  };

  return (
    <ModalShell onClose={onClose} title={`Ajustar stock — ${consumable.name}`}>
      <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
        Stock actual: <strong>{consumable.stock_quantity} {consumable.unit}</strong>
      </p>
      {err && <div className="alert-error" style={{ marginBottom: 10, fontSize: '0.82rem' }}>{err}</div>}
      <div style={{ marginBottom: 12 }}>
        <label className="input-label">Cantidad a sumar (negativo para restar)</label>
        <input type="text" inputMode="decimal" value={adjustment} onChange={(e) => setAdjustment(e.target.value)} placeholder="Ej: +50 (entrada) o -10 (salida)" />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label className="input-label">Motivo / nota</label>
        <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej: Compra a proveedor X / Salida para casa Y" />
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button onClick={onClose} className="secondary-btn" disabled={saving}>Cancelar</button>
        <button onClick={save} className="primary-btn" disabled={saving}>{saving ? 'Guardando…' : 'Confirmar ajuste'}</button>
      </div>
    </ModalShell>
  );
}

/* ═════════════ MOVIMIENTOS ═════════════ */
const MOVEMENT_TYPES: Array<{ key: string; label: string; color: string }> = [
  { key: 'receive',          label: 'Recepción',       color: '#3b82f6' },
  { key: 'install',          label: 'Instalación',     color: '#07c5a8' },
  { key: 'uninstall',        label: 'Desinstalación',  color: '#94a3b8' },
  { key: 'transfer',         label: 'Traslado',        color: '#10b981' },
  { key: 'repair_start',     label: 'A garantía',      color: '#f59e0b' },
  { key: 'repair_end',       label: 'Garantía cerrada', color: '#10b981' },
  { key: 'rma_send',         label: 'RMA enviado',     color: '#8b5cf6' },
  { key: 'rma_return',       label: 'RMA retorno',     color: '#8b5cf6' },
  { key: 'decommission',     label: 'Decomiso',        color: '#94a3b8' },
  { key: 'adjust_quantity',  label: 'Ajuste stock',    color: '#ec4899' },
  { key: 'reserve',          label: 'Reserva',         color: '#3b82f6' },
  { key: 'unreserve',        label: 'Libera reserva',  color: '#94a3b8' },
];

function MovimientosTab() {
  const [items, setItems] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('all');

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    const params = new URLSearchParams({ limit: '300' });
    if (filterType !== 'all') params.set('type', filterType);
    fetch(`/api/inventory/movements?${params}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((j) => {
        if (ac.signal.aborted) return;
        setItems(j.movements ?? []);
        setLoading(false);
      })
      .catch((e) => {
        if (e.name !== 'AbortError') {
          console.error(e);
          setLoading(false);
        }
      });
    return () => ac.abort();
  }, [filterType]);

  const movementMeta = (type: string) => MOVEMENT_TYPES.find((m) => m.key === type) ?? { label: type, color: '#94a3b8' };

  return (
    <>
      <div className="glass-panel" style={{ marginBottom: 14, padding: 14 }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Filtrar por tipo de movimiento</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className={`chip ${filterType === 'all' ? 'active' : ''}`} onClick={() => setFilterType('all')}>Todos</button>
          {MOVEMENT_TYPES.map((m) => (
            <button key={m.key} className={`chip ${filterType === m.key ? 'active' : ''}`} onClick={() => setFilterType(m.key)} style={{ borderLeft: `3px solid ${m.color}` }}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Cargando…</div>
      ) : items.length === 0 ? (
        <div className="alert-warning" style={{ fontSize: '0.85rem' }}>
          {filterType === 'all' ? 'No hay movimientos registrados aún. Cualquier cambio de estado, recepción o ajuste de stock aparecerá aquí.' : 'Sin movimientos de este tipo.'}
        </div>
      ) : (
        <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '0.82rem' }}>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Equipo / Consumible</th>
                  <th>De → A</th>
                  <th>Cantidad</th>
                  <th>Responsable</th>
                  <th>Notas</th>
                </tr>
              </thead>
              <tbody>
                {items.map((m) => {
                  const mm = movementMeta(m.type);
                  return (
                    <tr key={m.id} style={{ borderLeft: `3px solid ${mm.color}` }}>
                      <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.72rem' }}>{new Date(m.created_at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}</td>
                      <td>
                        <span style={{ padding: '2px 10px', borderRadius: 10, background: mm.color + '20', color: mm.color, fontSize: '0.7rem', fontWeight: 700 }}>{mm.label}</span>
                      </td>
                      <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem' }}>
                        {m.inventory_items?.serial_number ?? m.inventory_consumables?.name ?? '—'}
                      </td>
                      <td style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                        {m.from_status && <>{m.from_status}</>}{m.from_status && m.to_status && ' → '}{m.to_status}
                        {m.from_location && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{m.from_location} → {m.to_location}</div>}
                      </td>
                      <td style={{ fontFamily: 'ui-monospace, monospace' }}>{m.quantity ?? '—'}</td>
                      <td style={{ fontSize: '0.74rem' }}>{m.responsible_email ?? '—'}</td>
                      <td style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{m.notes ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

/* ═════════════ CATEGORÍAS ═════════════ */
function CategoriasTab() {
  const [items, setItems] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const load = async () => {
    setLoading(true);
    const r = await fetch('/api/inventory/categories');
    const j = await r.json();
    setItems(j.categories ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const remove = async (id: string) => {
    if (!confirm('¿Eliminar esta categoría? Los equipos asociados quedarán sin categoría.')) return;
    await fetch(`/api/inventory/categories?id=${id}`, { method: 'DELETE' });
    load();
  };

  const byFamily = useMemo(() => {
    const groups: Record<string, Category[]> = {};
    for (const c of items) {
      const fam = c.family || 'other';
      (groups[fam] ??= []).push(c);
    }
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  }, [items]);

  const header = (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
      <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
        Las categorías son plantillas: cuando das de alta un equipo y lo asocias a una categoría, los campos marca / modelo / capacidad / garantía se autocompletan.
      </p>
      <button className="primary-btn" onClick={() => setShowAdd(true)} style={{ fontSize: '0.82rem' }}>
        <Plus size={14} /> Nueva categoría
      </button>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {header}
      {msg && <div className={msg.kind === 'success' ? 'alert-success' : 'alert-error'} style={{ fontSize: '0.82rem' }}>{msg.text}</div>}
      {showAdd && (
        <CategoryModal
          mode="create"
          onClose={() => setShowAdd(false)}
          onSaved={(c) => {
            setItems((cur) => [...cur, c]);
            setMsg({ kind: 'success', text: `Categoría "${c.name}" creada (código ${c.code}).` });
            setShowAdd(false);
          }}
        />
      )}
      {editing && (
        <CategoryModal
          mode="edit"
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={(c) => {
            setItems((cur) => cur.map((it) => (it.id === c.id ? c : it)));
            setMsg({ kind: 'success', text: `Categoría "${c.name}" actualizada.` });
            setEditing(null);
          }}
        />
      )}
      {loading ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Cargando…</div>
      ) : items.length === 0 ? (
        <div className="alert-warning" style={{ fontSize: '0.85rem' }}>
          No hay categorías registradas. Crea la primera con el botón &quot;Nueva categoría&quot; arriba.
        </div>
      ) : byFamily.map(([family, cats]) => {
        const Icon = FAMILY_ICONS[family] ?? Package;
        return (
          <div key={family} className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 18px', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--border)' }}>
              <Icon size={18} style={{ color: 'var(--accent)' }} />
              <h3 style={{ margin: 0, fontSize: '0.92rem' }}>{FAMILY_LABELS[family] ?? family}</h3>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                {cats.length} modelo{cats.length === 1 ? '' : 's'}
              </span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: '0.82rem' }}>
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Nombre</th>
                    <th>{isServiceFamily(family) ? 'Proveedor / Marca' : 'Marca / Modelo default'}</th>
                    {!isServiceFamily(family) && <th>Capacidad</th>}
                    {!isServiceFamily(family) && <th>Garantía</th>}
                    <th style={{ textAlign: 'right' }}>Costo unitario (COP)</th>
                    <th style={{ textAlign: 'right', width: 60 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {cats.map((c) => (
                    <tr key={c.id}>
                      <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.76rem', fontWeight: 600 }}>{c.code}</td>
                      <td style={{ fontSize: '0.82rem' }}>{c.name}</td>
                      <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        {isServiceFamily(family)
                          ? [c.provider, c.default_brand].filter(Boolean).join(' · ') || <span style={{ color: 'var(--text-muted)' }}>aplica a todos</span>
                          : ([c.default_brand, c.default_model].filter(Boolean).join(' · ') || '—')}
                      </td>
                      {!isServiceFamily(family) && (
                        <td style={{ fontSize: '0.78rem', fontFamily: 'ui-monospace, monospace' }}>{c.default_capacity_value ? `${c.default_capacity_value} ${c.default_capacity_unit ?? ''}` : '—'}</td>
                      )}
                      {!isServiceFamily(family) && (
                        <td style={{ fontSize: '0.78rem' }}>{c.default_warranty_months ? `${c.default_warranty_months} m` : '—'}</td>
                      )}
                      <td style={{ fontSize: '0.78rem', textAlign: 'right', fontFamily: 'ui-monospace, monospace', color: c.default_cost_cop ? 'var(--text)' : 'var(--text-muted)' }}>
                        {c.default_cost_cop != null ? new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(c.default_cost_cop) : '—'}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button onClick={() => setEditing(c)} title="Editar" style={{ padding: 6, background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', borderRadius: 4, marginRight: 2 }}>
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => remove(c.id)} title="Eliminar" style={{ padding: 6, background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', borderRadius: 4 }}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Modal: crear o editar categoría ─── */
function CategoryModal({ mode, initial, onClose, onSaved }: {
  mode: 'create' | 'edit';
  initial?: Category;
  onClose: () => void;
  onSaved: (c: Category) => void;
}) {
  const [form, setForm] = useState({
    code: initial?.code ?? '',
    name: initial?.name ?? '',
    family: initial?.family ?? 'inverter',
    default_brand: initial?.default_brand ?? '',
    default_model: initial?.default_model ?? '',
    default_capacity_value: initial?.default_capacity_value != null ? String(initial.default_capacity_value) : '',
    default_capacity_unit: initial?.default_capacity_unit ?? '',
    default_warranty_months: initial?.default_warranty_months != null ? String(initial.default_warranty_months) : '',
    default_cost_cop: initial?.default_cost_cop != null ? String(initial.default_cost_cop) : '',
    provider: initial?.provider ?? '',
    is_serialized: initial?.is_serialized ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = <K extends keyof typeof form>(k: K, v: typeof form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setErr(null);
    if (mode === 'create' && !form.code.trim()) return setErr('Código requerido (ej. INV_LIVOLTEK_HP3_10K)');
    if (!form.name.trim()) return setErr('Nombre requerido');
    if (!form.family) return setErr('Familia requerida');
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        family: form.family,
        default_brand: form.default_brand.trim() || null,
        default_model: form.default_model.trim() || null,
        default_capacity_value: form.default_capacity_value ? Number(form.default_capacity_value) : null,
        default_capacity_unit: form.default_capacity_unit.trim() || null,
        default_warranty_months: form.default_warranty_months ? Number(form.default_warranty_months) : null,
        default_cost_cop: form.default_cost_cop ? Number(form.default_cost_cop) : null,
        provider: form.provider.trim() || null,
        is_serialized: isServiceFamily(form.family) ? false : form.is_serialized,
      };
      let r: Response;
      if (mode === 'edit' && initial) {
        // En edit el código no se cambia (es la clave de negocio, lo bloquea el endpoint).
        r = await fetch('/api/inventory/categories', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: initial.id, ...payload }),
        });
      } else {
        r = await fetch('/api/inventory/categories', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: form.code.trim(), ...payload }),
        });
      }
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Error');
      onSaved(j.category as Category);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title={mode === 'edit' ? 'Editar categoría' : 'Nueva categoría'} onClose={onClose}>
      {err && <div className="alert-error" style={{ marginBottom: 10, fontSize: '0.82rem' }}>{err}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 10 }}>
        <div className="input-group" style={{ margin: 0 }}>
          <label className="input-label">Código {mode === 'create' && <span style={{ color: '#ef4444' }}>*</span>}</label>
          <input
            value={form.code}
            onChange={(e) => set('code', e.target.value)}
            placeholder="INV_LIVOLTEK_HP3_10K"
            autoFocus={mode === 'create'}
            disabled={mode === 'edit'}
            style={mode === 'edit' ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
          />
          <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>
            {mode === 'edit'
              ? 'El código es clave única y no puede modificarse.'
              : 'Se normaliza a MAYÚSCULAS, A-Z 0-9 _ — clave única.'}
          </p>
        </div>
        <div className="input-group" style={{ margin: 0 }}>
          <label className="input-label">Nombre <span style={{ color: '#ef4444' }}>*</span></label>
          <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Livoltek HP3-10KL2 trifásico" />
        </div>
        <div className="input-group" style={{ margin: 0 }}>
          <label className="input-label">Familia <span style={{ color: '#ef4444' }}>*</span></label>
          <select value={form.family} onChange={(e) => set('family', e.target.value)}>
            {Object.entries(FAMILY_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </div>
        {!isServiceFamily(form.family) && (
          <div className="input-group" style={{ margin: 0 }}>
            <label className="input-label">¿Serializado?</label>
            <select value={form.is_serialized ? '1' : '0'} onChange={(e) => set('is_serialized', e.target.value === '1')}>
              <option value="1">Sí (cada unidad lleva serial individual)</option>
              <option value="0">No (es consumible / cantidad)</option>
            </select>
          </div>
        )}
      </div>

      {isServiceFamily(form.family) ? (
        <>
          <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 6, marginTop: 8 }}>
            Servicio — usado en Facturación para auto-llenar Mano de Obra / Desmantelamiento
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div className="input-group" style={{ margin: 0 }}>
              <label className="input-label">Proveedor / contratista</label>
              <input value={form.provider} onChange={(e) => set('provider', e.target.value)} placeholder="Cuadrilla GdO Cali" />
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>Match exacto contra contractor_name del proyecto.</p>
            </div>
            <div className="input-group" style={{ margin: 0 }}>
              <label className="input-label">Marca asociada (opcional)</label>
              <input value={form.default_brand} onChange={(e) => set('default_brand', e.target.value)} placeholder="Livoltek" />
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>Si el servicio solo aplica a una marca específica.</p>
            </div>
            <div className="input-group" style={{ margin: 0, gridColumn: '1 / -1' }}>
              <label className="input-label">Costo unitario (COP) <span style={{ color: '#ef4444' }}>*</span></label>
              <input type="number" value={form.default_cost_cop} onChange={(e) => set('default_cost_cop', e.target.value)} placeholder="2500000" />
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                Se aplicará automáticamente al campo correspondiente en Facturación cuando el proyecto matchee proveedor o marca.
              </p>
            </div>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 6, marginTop: 8 }}>
            Valores por defecto (autocompletado al crear equipos)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div className="input-group" style={{ margin: 0 }}>
              <label className="input-label">Marca default</label>
              <input value={form.default_brand} onChange={(e) => set('default_brand', e.target.value)} placeholder="Livoltek" />
            </div>
            <div className="input-group" style={{ margin: 0 }}>
              <label className="input-label">Modelo default</label>
              <input value={form.default_model} onChange={(e) => set('default_model', e.target.value)} placeholder="HP3-10KL2" />
            </div>
            <div className="input-group" style={{ margin: 0 }}>
              <label className="input-label">Capacidad</label>
              <input type="number" value={form.default_capacity_value} onChange={(e) => set('default_capacity_value', e.target.value)} placeholder="10" />
            </div>
            <div className="input-group" style={{ margin: 0 }}>
              <label className="input-label">Unidad capacidad</label>
              <input value={form.default_capacity_unit} onChange={(e) => set('default_capacity_unit', e.target.value)} placeholder="kW · Ah · W · cm" />
            </div>
            <div className="input-group" style={{ margin: 0 }}>
              <label className="input-label">Garantía (meses)</label>
              <input type="number" value={form.default_warranty_months} onChange={(e) => set('default_warranty_months', e.target.value)} placeholder="60" />
            </div>
            <div className="input-group" style={{ margin: 0, gridColumn: '1 / -1' }}>
              <label className="input-label">Costo unitario (COP)</label>
              <input type="number" value={form.default_cost_cop} onChange={(e) => set('default_cost_cop', e.target.value)} placeholder="5200000" />
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                Precio por equipo de este modelo. Facturación lo suma automáticamente por cada item instalado en una casa. Si un serial tiene precio diferente en su registro individual, ese prevalece.
              </p>
            </div>
          </div>
        </>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button onClick={onClose} className="secondary-btn" disabled={saving}>Cancelar</button>
        <button onClick={submit} className="primary-btn" disabled={saving}>
          {saving
            ? (mode === 'edit' ? 'Guardando…' : 'Creando…')
            : (mode === 'edit' ? 'Guardar cambios' : 'Crear categoría')}
        </button>
      </div>
    </ModalShell>
  );
}

/* ─── Tab Panorama: visión agregada del inventario ─── */
function PanoramaTab() {
  type FamilyStats = {
    family: string;
    total: number;
    byStatus: Record<string, number>;
    totalCostCop: number;
    avgCostCop: number | null;
  };
  type HouseStat = { house_id: string; casa: string; count: number; brands: Set<string> };
  type RecentItem = { id: string; serial_number: string; brand: string | null; model: string | null; acquired_at: string | null; acquired_cost_cop: number | null; supplier: string | null; inventory_categories?: { name: string; family: string } | null };
  type BrandStat = {
    brand: string;
    total: number;
    byStatus: Record<string, number>;
    byFamily: Record<string, number>;
    installed: number;
    totalCostCop: number;
  };

  const [loading, setLoading] = useState(true);
  const [familyStats, setFamilyStats] = useState<FamilyStats[]>([]);
  const [brandStats, setBrandStats] = useState<BrandStat[]>([]);
  const [topHouses, setTopHouses] = useState<HouseStat[]>([]);
  const [recentItems, setRecentItems] = useState<RecentItem[]>([]);
  const [consumiblesValue, setConsumiblesValue] = useState<number>(0);
  const [grandTotal, setGrandTotal] = useState<number>(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // Endpoint dedicado que agrega en el server paginando los items —
        // así no sufre el cap default de 1000 filas de PostgREST que hacía
        // que Panorama subestimara familias, marcas y costos.
        const r = await fetch('/api/inventory/panorama');
        if (!r.ok) throw new Error('panorama fetch fallo');
        const j = await r.json();
        setFamilyStats(j.familyStats ?? []);
        setBrandStats(j.brandStats ?? []);
        // El endpoint devuelve brands como array; convertir a Set para la UI
        setTopHouses(((j.topHouses ?? []) as Array<{ house_id: string; casa: string; count: number; brands: string[] }>)
          .map((h) => ({ ...h, brands: new Set(h.brands ?? []) })));
        setRecentItems(j.recentItems ?? []);
        setConsumiblesValue(j.consumablesValue ?? 0);
        setGrandTotal(j.grandTotal ?? 0);
      } catch (err) {
        console.error('[panorama] fetch fallo', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const fmtMoney = (n: number) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {loading ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Cargando panorama…</div>
      ) : (
        <>
          {/* KPI macro */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
            <PanoramaKpi label="Familias activas" value={String(familyStats.length)} sub="modelos distintos en inventario" color="#07c5a8" Icon={Tags} />
            <PanoramaKpi label="Total equipos" value={String(familyStats.reduce((a, b) => a + b.total, 0))} sub="serializados activos" color="#3b82f6" Icon={Cpu} />
            <PanoramaKpi label="Capital en bodega" value={fmtMoney(grandTotal)} sub={`COP · equipos + consumibles`} color="#10b981" Icon={Boxes} />
            <PanoramaKpi label="Casas atendidas" value={String(topHouses.length)} sub="con equipos instalados" color="#f59e0b" Icon={MapPin} />
          </div>

          {/* Tarjetas por familia */}
          <div className="glass-panel" style={{ padding: 16 }}>
            <h3 style={{ margin: 0, fontSize: '0.95rem', marginBottom: 12 }}>Por tipo de equipo</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
              {familyStats.map((fs) => {
                const Icon = FAMILY_ICONS[fs.family] ?? Package;
                const familyLabel = FAMILY_LABELS[fs.family] ?? fs.family;
                return (
                  <div key={fs.family} style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 14, borderLeft: '4px solid var(--accent)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <Icon size={18} style={{ color: 'var(--accent)' }} />
                      <h4 style={{ margin: 0, fontSize: '0.92rem' }}>{familyLabel}</h4>
                      <span style={{ marginLeft: 'auto', fontFamily: 'ui-monospace, monospace', fontSize: '1.2rem', fontWeight: 700, color: 'var(--text)' }}>{fs.total}</span>
                    </div>
                    {/* Stack de estados */}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                      {Object.entries(fs.byStatus).map(([status, count]) => {
                        const m = STATUS_META[status];
                        if (!m) return null;
                        return (
                          <span key={status} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.7rem', fontWeight: 600, padding: '3px 8px', borderRadius: 10, background: m.color + '20', color: m.color }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: m.color }} />
                            {m.label}: {count}
                          </span>
                        );
                      })}
                    </div>
                    {/* Costos */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: '0.78rem', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                      <div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Costo acumulado</div>
                        <div style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>${fmtMoney(fs.totalCostCop)}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Promedio / unidad</div>
                        <div style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>{fs.avgCostCop != null ? '$' + fmtMoney(fs.avgCostCop) : '—'}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tarjetas por marca */}
          <div className="glass-panel" style={{ padding: 16 }}>
            <h3 style={{ margin: 0, fontSize: '0.95rem', marginBottom: 12 }}>Por marca de fabricante</h3>
            {brandStats.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Aún no hay equipos con marca registrada.</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                {brandStats.map((bs) => (
                  <div key={bs.brand} style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 14, borderLeft: '4px solid #f59e0b' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                      <h4 style={{ margin: 0, fontSize: '0.92rem' }}>{bs.brand}</h4>
                      <span style={{ marginLeft: 'auto', fontFamily: 'ui-monospace, monospace', fontSize: '1.2rem', fontWeight: 700 }}>{bs.total}</span>
                    </div>
                    {/* Estados */}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                      {Object.entries(bs.byStatus).map(([status, count]) => {
                        const m = STATUS_META[status];
                        if (!m || count === 0) return null;
                        return (
                          <span key={status} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.66rem', fontWeight: 600, padding: '2px 7px', borderRadius: 10, background: m.color + '20', color: m.color }}>
                            <span style={{ width: 5, height: 5, borderRadius: '50%', background: m.color }} />
                            {m.label}: {count}
                          </span>
                        );
                      })}
                    </div>
                    {/* Familias */}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                      {Object.entries(bs.byFamily).map(([fam, count]) => (
                        <span key={fam} style={{ fontSize: '0.66rem', fontWeight: 500, padding: '2px 6px', borderRadius: 6, background: 'rgba(255,255,255,0.04)', color: 'var(--text-secondary)' }}>
                          {FAMILY_LABELS[fam] ?? fam}: <strong>{count}</strong>
                        </span>
                      ))}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: '0.78rem', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                      <div>
                        <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Instalados</div>
                        <div style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>{bs.installed}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Inversión</div>
                        <div style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>${fmtMoney(bs.totalCostCop)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Top casas por equipos instalados */}
          <div className="glass-panel" style={{ padding: 16 }}>
            <h3 style={{ margin: 0, fontSize: '0.95rem', marginBottom: 12 }}>Casas con más equipos instalados</h3>
            {topHouses.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Aún no hay equipos instalados.</p>
            ) : (
              <table style={{ width: '100%', fontSize: '0.82rem' }}>
                <thead>
                  <tr>
                    <th>Casa</th>
                    <th style={{ textAlign: 'left' }}>Marcas</th>
                    <th style={{ textAlign: 'right' }}>Equipos</th>
                  </tr>
                </thead>
                <tbody>
                  {topHouses.map((h) => (
                    <tr key={h.house_id}>
                      <td style={{ fontWeight: 600 }}>{h.casa}</td>
                      <td style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>{Array.from(h.brands).join(' · ') || '—'}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>{h.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Adquisiciones recientes */}
          <div className="glass-panel" style={{ padding: 16 }}>
            <h3 style={{ margin: 0, fontSize: '0.95rem', marginBottom: 12 }}>Últimas adquisiciones</h3>
            {recentItems.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Sin recepciones registradas (revisa el campo "Fecha de adquisición" al crear equipos).</p>
            ) : (
              <table style={{ width: '100%', fontSize: '0.82rem' }}>
                <thead>
                  <tr>
                    <th>Serial</th>
                    <th>Modelo</th>
                    <th>Proveedor</th>
                    <th style={{ textAlign: 'right' }}>Costo</th>
                    <th style={{ textAlign: 'right' }}>Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {recentItems.map((it) => (
                    <tr key={it.id}>
                      <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.76rem', fontWeight: 600 }}>{it.serial_number}</td>
                      <td style={{ fontSize: '0.78rem' }}>{[it.brand, it.model].filter(Boolean).join(' ') || it.inventory_categories?.name || '—'}</td>
                      <td style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>{it.supplier ?? '—'}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>{it.acquired_cost_cop != null ? '$' + fmtMoney(Number(it.acquired_cost_cop)) : '—'}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: '0.76rem' }}>{it.acquired_at ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Valor consumibles */}
          <div className="glass-panel" style={{ padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Valor consumibles en bodega</div>
              <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '1.3rem', fontWeight: 700, marginTop: 4 }}>${fmtMoney(consumiblesValue)}</div>
            </div>
            <Cable size={32} style={{ color: '#8b5cf6' }} />
          </div>
        </>
      )}
    </div>
  );
}

function PanoramaKpi({ label, value, sub, color, Icon }: { label: string; value: string; sub: string; color: string; Icon: typeof Cpu }) {
  return (
    <div className="glass-panel" style={{ padding: '14px 16px', borderLeft: `4px solid ${color}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
        <Icon size={13} style={{ color }} /> {label}
      </div>
      <div style={{ fontSize: '1.4rem', fontWeight: 700, fontFamily: 'ui-monospace, monospace', color: 'var(--text)', lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{sub}</div>
    </div>
  );
}

/* ─── Tab Transferencias: documentos formales draft → in_transit → received ─── */

type Transfer = {
  id: string;
  code: string;
  status: 'draft' | 'in_transit' | 'received' | 'cancelled';
  shipped_at: string | null;
  received_at: string | null;
  cancelled_at: string | null;
  shipped_by: string | null;
  received_by: string | null;
  carrier: string | null;
  tracking_number: string | null;
  notes: string | null;
  created_at: string;
  from_warehouse: { id: string; code: string; name: string } | null;
  to_warehouse: { id: string; code: string; name: string } | null;
  inventory_transfer_items?: Array<{ id: string; picked: boolean; received: boolean; inventory_items: { id: string; serial_number: string; brand: string | null; model: string | null; inventory_categories?: { name: string; family: string } | null } | null }>;
  inventory_transfer_consumables?: Array<{ id: string; quantity: number; received_quantity: number | null; inventory_consumables: { id: string; name: string; sku: string | null; unit: string; stock_quantity: number } | null }>;
};

const TRANSFER_STATUS_META: Record<string, { label: string; color: string }> = {
  draft:      { label: 'Borrador',    color: '#94a3b8' },
  in_transit: { label: 'En tránsito', color: '#f59e0b' },
  received:   { label: 'Recibida',    color: '#10b981' },
  cancelled:  { label: 'Cancelada',   color: '#ef4444' },
};

function TransferenciasTab({ userEmail }: { userEmail: string }) {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [showCreate, setShowCreate] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params = filterStatus !== 'all' ? `?status=${filterStatus}` : '';
      const r = await fetch(`/api/inventory/transfers${params}`);
      const j = await r.json();
      setTransfers(j.transfers ?? []);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filterStatus]);

  const doAction = async (id: string, action: 'ship' | 'receive' | 'cancel') => {
    const confirmMsg = action === 'ship' ? 'Marcar como ENVIADA? Los consumibles se descontarán de la bodega origen.'
      : action === 'receive' ? 'Confirmar RECEPCIÓN en destino? Los items y stock pasan a la bodega destino.'
      : 'Cancelar la transferencia? Si estaba en tránsito, el stock vuelve a origen.';
    if (!confirm(confirmMsg)) return;
    const r = await fetch(`/api/inventory/transfers/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, actor_email: userEmail }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(j.error ?? 'Error');
      return;
    }
    load();
  };

  const remove = async (id: string) => {
    if (!confirm('¿Eliminar esta transferencia? Solo se borran en draft o canceladas.')) return;
    const r = await fetch(`/api/inventory/transfers/${id}`, { method: 'DELETE' });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(j.error ?? 'Error');
      return;
    }
    load();
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Transferencias entre bodegas</h2>
        <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
          Documentos formales con tracking. Borrador → Enviada → Recibida.
        </span>
        <button onClick={() => setShowCreate(true)} className="primary-btn" style={{ marginLeft: 'auto', background: '#0ea5e9' }}>
          <Plus size={14} /> Nueva transferencia
        </button>
      </div>

      <div style={{ marginBottom: 14, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className={`chip ${filterStatus === 'all' ? 'active' : ''}`} onClick={() => setFilterStatus('all')}>Todas</button>
        {(Object.keys(TRANSFER_STATUS_META) as Array<keyof typeof TRANSFER_STATUS_META>).map((k) => (
          <button key={k} className={`chip ${filterStatus === k ? 'active' : ''}`} onClick={() => setFilterStatus(k)} style={{ borderLeft: `3px solid ${TRANSFER_STATUS_META[k].color}` }}>
            {TRANSFER_STATUS_META[k].label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Cargando…</div>
      ) : transfers.length === 0 ? (
        <div className="alert-warning" style={{ fontSize: '0.85rem' }}>
          Sin transferencias para este filtro. Crea una para mover equipos masivamente entre bodegas con tracking formal.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {transfers.map((t) => {
            const meta = TRANSFER_STATUS_META[t.status];
            const itemCount = t.inventory_transfer_items?.length ?? 0;
            const consCount = t.inventory_transfer_consumables?.length ?? 0;
            return (
              <div key={t.id} className="glass-panel" style={{ padding: 14, borderLeft: `4px solid ${meta.color}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <h3 style={{ margin: 0, fontSize: '0.98rem', fontFamily: 'ui-monospace, monospace' }}>{t.code}</h3>
                      <span style={{ padding: '2px 10px', borderRadius: 10, background: meta.color + '20', color: meta.color, fontSize: '0.7rem', fontWeight: 700 }}>{meta.label}</span>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text)' }}>
                      <strong>{t.from_warehouse?.name ?? '?'}</strong>
                      <span style={{ color: 'var(--text-muted)', margin: '0 6px' }}>→</span>
                      <strong>{t.to_warehouse?.name ?? '?'}</strong>
                    </div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 2 }}>
                      {itemCount > 0 && <>{itemCount} equipo{itemCount === 1 ? '' : 's'}</>}
                      {itemCount > 0 && consCount > 0 && ' · '}
                      {consCount > 0 && <>{consCount} consumible{consCount === 1 ? '' : 's'}</>}
                      {t.carrier && <> · {t.carrier}</>}
                      {t.tracking_number && <> · {t.tracking_number}</>}
                      <> · creada {new Date(t.created_at).toLocaleDateString('es-CO')}</>
                      {t.shipped_at && <> · enviada {new Date(t.shipped_at).toLocaleDateString('es-CO')}</>}
                      {t.received_at && <> · recibida {new Date(t.received_at).toLocaleDateString('es-CO')}</>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {t.status === 'draft' && (
                      <>
                        <button onClick={() => doAction(t.id, 'ship')} className="primary-btn" disabled={itemCount === 0 && consCount === 0} style={{ fontSize: '0.78rem', padding: '6px 12px', background: '#f59e0b' }}>
                          Enviar →
                        </button>
                        <button onClick={() => doAction(t.id, 'cancel')} className="secondary-btn" style={{ fontSize: '0.78rem', padding: '6px 12px', color: '#ef4444' }}>
                          Cancelar
                        </button>
                      </>
                    )}
                    {t.status === 'in_transit' && (
                      <>
                        <button onClick={() => doAction(t.id, 'receive')} className="primary-btn" style={{ fontSize: '0.78rem', padding: '6px 12px', background: '#10b981' }}>
                          Confirmar recepción →
                        </button>
                        <button onClick={() => doAction(t.id, 'cancel')} className="secondary-btn" style={{ fontSize: '0.78rem', padding: '6px 12px', color: '#ef4444' }}>
                          Cancelar (restituir stock)
                        </button>
                      </>
                    )}
                    {(t.status === 'draft' || t.status === 'cancelled') && (
                      <button onClick={() => remove(t.id)} title="Eliminar" style={{ padding: 6, background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', borderRadius: 4 }}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Líneas */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {t.inventory_transfer_items?.map((line) => {
                    const it = line.inventory_items;
                    if (!it) return null;
                    return (
                      <div key={line.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: 'var(--bg-elevated)', borderRadius: 8, fontSize: '0.74rem', borderLeft: '3px solid #3b82f6' }}>
                        <Cpu size={11} style={{ color: '#3b82f6' }} />
                        <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{it.serial_number}</span>
                        <span style={{ color: 'var(--text-muted)' }}>·</span>
                        <span>{it.inventory_categories?.name ?? [it.brand, it.model].filter(Boolean).join(' ')}</span>
                        {line.received && <CheckCircle2 size={11} style={{ color: '#10b981' }} />}
                      </div>
                    );
                  })}
                  {t.inventory_transfer_consumables?.map((line) => {
                    const c = line.inventory_consumables;
                    if (!c) return null;
                    return (
                      <div key={line.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: 'var(--bg-elevated)', borderRadius: 8, fontSize: '0.74rem', borderLeft: '3px solid #8b5cf6' }}>
                        <Cable size={11} style={{ color: '#8b5cf6' }} />
                        <span>{c.name}</span>
                        <span style={{ color: 'var(--text-muted)' }}>·</span>
                        <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>{line.quantity} {c.unit}</span>
                        {line.received_quantity != null && Number(line.received_quantity) !== Number(line.quantity) && (
                          <span style={{ color: '#f59e0b' }}>(rec: {line.received_quantity})</span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {t.notes && (
                  <div style={{ marginTop: 8, fontSize: '0.74rem', color: 'var(--text-muted)' }}>{t.notes}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showCreate && <NewTransferModal userEmail={userEmail} onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); load(); }} />}
    </>
  );
}

function NewTransferModal({ userEmail, onClose, onSaved }: { userEmail: string; onClose: () => void; onSaved: () => void }) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [items, setItems] = useState<InvItem[]>([]);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [consumibles, setConsumibles] = useState<ConsumableOpt[]>([]);
  const [consQty, setConsQty] = useState<Record<string, string>>({});
  const [carrier, setCarrier] = useState('');
  const [tracking, setTracking] = useState('');
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/inventory/warehouses?active=true').then((r) => r.json()).then((j) => setWarehouses(j.warehouses ?? []));
    fetch('/api/inventory/consumables').then((r) => r.json()).then((j) => setConsumibles(j.consumables ?? []));
  }, []);

  useEffect(() => {
    // Cargar items in_stock de la bodega origen
    if (!fromId) { setItems([]); return; }
    fetch(`/api/inventory/items?status=in_stock&limit=500`)
      .then((r) => r.json())
      .then((j) => {
        const filtered = ((j.items ?? []) as InvItem[]).filter((it) => it.warehouse_id === fromId);
        setItems(filtered);
      });
  }, [fromId]);

  const filteredItems = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return items;
    return items.filter((it) =>
      it.serial_number.toLowerCase().includes(q) ||
      (it.brand ?? '').toLowerCase().includes(q) ||
      (it.model ?? '').toLowerCase().includes(q) ||
      (it.inventory_categories?.name ?? '').toLowerCase().includes(q),
    );
  }, [items, search]);

  const submit = async () => {
    setErr(null);
    if (!fromId || !toId) { setErr('Selecciona origen y destino'); return; }
    if (fromId === toId) { setErr('Origen y destino no pueden ser la misma bodega'); return; }
    const consLines = Object.entries(consQty)
      .map(([id, q]) => ({ id, quantity: Number(q) }))
      .filter((c) => Number.isFinite(c.quantity) && c.quantity > 0);
    if (selectedItemIds.size === 0 && consLines.length === 0) {
      setErr('Selecciona al menos un equipo o consumible'); return;
    }
    setSaving(true);
    try {
      const r = await fetch('/api/inventory/transfers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_warehouse_id: fromId,
          to_warehouse_id: toId,
          item_ids: Array.from(selectedItemIds),
          consumables: consLines,
          carrier: carrier.trim() || null,
          tracking_number: tracking.trim() || null,
          notes: notes.trim() || null,
          created_by: userEmail,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Error');
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Nueva transferencia" onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        <div className="input-group" style={{ margin: 0 }}>
          <label className="input-label">Bodega origen *</label>
          <select value={fromId} onChange={(e) => { setFromId(e.target.value); setSelectedItemIds(new Set()); }}>
            <option value="">— Selecciona —</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div className="input-group" style={{ margin: 0 }}>
          <label className="input-label">Bodega destino *</label>
          <select value={toId} onChange={(e) => setToId(e.target.value)}>
            <option value="">— Selecciona —</option>
            {warehouses.filter((w) => w.id !== fromId).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div className="input-group" style={{ margin: 0 }}>
          <label className="input-label">Transportadora</label>
          <input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="Servientrega, propio, etc." />
        </div>
        <div className="input-group" style={{ margin: 0 }}>
          <label className="input-label">Nº guía / tracking</label>
          <input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="GU-2026-001" />
        </div>
      </div>

      {fromId && (
        <>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            Equipos disponibles en la bodega origen ({filteredItems.length})
          </div>
          <div style={{ position: 'relative', marginBottom: 8 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input type="text" placeholder="Buscar serial, marca, modelo…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: '100%', paddingLeft: 32 }} />
          </div>
          <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12 }}>
            {filteredItems.length === 0 ? (
              <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                {items.length === 0 ? 'Sin items in_stock en esta bodega' : 'Ningún item coincide'}
              </div>
            ) : filteredItems.map((it) => (
              <label key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: selectedItemIds.has(it.id) ? 'rgba(14,165,233,0.06)' : 'transparent' }}>
                <input type="checkbox" checked={selectedItemIds.has(it.id)} onChange={() => {
                  setSelectedItemIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(it.id)) next.delete(it.id); else next.add(it.id);
                    return next;
                  });
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.76rem', fontWeight: 600 }}>{it.serial_number}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{it.inventory_categories?.name ?? '—'} · {[it.brand, it.model].filter(Boolean).join(' ')}</div>
                </div>
              </label>
            ))}
          </div>

          {consumibles.length > 0 && (
            <>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                Consumibles a transferir
              </div>
              <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12 }}>
                {consumibles.map((c) => {
                  const qty = consQty[c.id] ?? '';
                  const qtyNum = Number(qty);
                  const overStock = Number.isFinite(qtyNum) && qtyNum > c.stock_quantity;
                  return (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: 500 }}>{c.name}</div>
                        <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>Stock: <strong>{c.stock_quantity} {c.unit}</strong></div>
                      </div>
                      <input type="number" min={0} placeholder="0" value={qty} onChange={(e) => setConsQty((p) => ({ ...p, [c.id]: e.target.value }))} style={{ width: 70, padding: '4px 6px', borderRadius: 4, border: `1px solid ${overStock ? '#ef4444' : 'var(--border)'}`, background: 'var(--bg)', color: 'var(--text)', fontSize: '0.78rem', textAlign: 'right' }} />
                      <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', width: 24 }}>{c.unit}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      <div className="input-group" style={{ marginBottom: 10 }}>
        <label className="input-label">Notas</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={{ width: '100%' }} />
      </div>

      {err && <div className="alert-error" style={{ marginBottom: 10, fontSize: '0.82rem', whiteSpace: 'pre-line' }}>{err}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button onClick={onClose} className="secondary-btn" disabled={saving}>Cancelar</button>
        <button onClick={() => void submit()} className="primary-btn" disabled={saving} style={{ background: '#0ea5e9' }}>
          {saving ? 'Creando…' : 'Crear borrador'}
        </button>
      </div>
    </ModalShell>
  );
}

/* ─── Tab Logística inversa: tabla de operaciones reversas ─── */

const REVERSE_MOVE_TYPES = ['uninstall', 'decommission', 'rma_send', 'unreserve'] as const;

const REVERSE_TYPE_META: Record<string, { label: string; color: string }> = {
  uninstall:     { label: 'Retirada / Swap', color: '#0ea5e9' },
  decommission:  { label: 'Decomisado',      color: '#64748b' },
  rma_send:      { label: 'Garantía',        color: '#f59e0b' },
  unreserve:     { label: 'Reserva cancel.', color: '#94a3b8' },
};

function LogisticaInversaTab() {
  type Movement = {
    id: string;
    type: string;
    from_status: string | null;
    to_status: string | null;
    from_house_id: string | null;
    related_visit_id: string | null;
    quantity: number | null;
    responsible_email: string | null;
    notes: string | null;
    created_at: string;
    inventory_items?: { serial_number: string; brand: string | null; model: string | null; inventory_categories?: { name: string; family: string } | null } | null;
    inventory_consumables?: { name: string; sku: string | null; unit: string } | null;
    client_houses?: { casa: string } | null;
  };
  const [moves, setMoves] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await fetch('/api/inventory/movements?limit=500');
        const j = await r.json();
        const all = (j.movements ?? []) as Movement[];
        const reverse = all.filter((m) => REVERSE_MOVE_TYPES.includes(m.type as typeof REVERSE_MOVE_TYPES[number]));
        setMoves(reverse);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    let list = moves;
    if (filterType !== 'all') list = list.filter((m) => m.type === filterType);
    const q = search.toLowerCase().trim();
    if (q) {
      list = list.filter((m) =>
        (m.inventory_items?.serial_number ?? '').toLowerCase().includes(q) ||
        (m.inventory_items?.brand ?? '').toLowerCase().includes(q) ||
        (m.inventory_items?.model ?? '').toLowerCase().includes(q) ||
        (m.notes ?? '').toLowerCase().includes(q) ||
        (m.responsible_email ?? '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [moves, filterType, search]);

  // Resumen por tipo
  const summary = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const m of moves) acc[m.type] = (acc[m.type] ?? 0) + 1;
    return acc;
  }, [moves]);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Logística inversa</h2>
        <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
          Movimientos de retorno: retiradas, decomisiones, garantías, cancelaciones de reserva.
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
            <input
              type="text"
              placeholder="Buscar serial, marca, notas, técnico…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ padding: '6px 8px 6px 28px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text)', fontSize: '0.82rem', width: 280 }}
            />
          </div>
        </div>
      </div>

      {/* KPIs por tipo */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 14 }}>
        <button
          onClick={() => setFilterType('all')}
          className={`chip ${filterType === 'all' ? 'active' : ''}`}
          style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, fontSize: '0.78rem' }}
        >
          <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Todos</span>
          <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '1.1rem', fontWeight: 700 }}>{moves.length}</span>
        </button>
        {REVERSE_MOVE_TYPES.map((t) => {
          const m = REVERSE_TYPE_META[t];
          return (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`chip ${filterType === t ? 'active' : ''}`}
              style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, borderLeft: `3px solid ${m.color}`, fontSize: '0.78rem' }}
            >
              <span style={{ color: m.color, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>{m.label}</span>
              <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '1.1rem', fontWeight: 700 }}>{summary[t] ?? 0}</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Cargando…</div>
      ) : filtered.length === 0 ? (
        <div className="alert-warning" style={{ fontSize: '0.85rem' }}>
          {moves.length === 0 ? 'Sin operaciones de logística inversa registradas todavía.' : 'No hay operaciones que coincidan con los filtros.'}
        </div>
      ) : (
        <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '0.82rem' }}>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Equipo</th>
                  <th>Categoría</th>
                  <th>Origen → Destino</th>
                  <th>Notas</th>
                  <th>Técnico</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => {
                  const meta = REVERSE_TYPE_META[m.type] ?? { label: m.type, color: '#94a3b8' };
                  return (
                    <tr key={m.id}>
                      <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.74rem', whiteSpace: 'nowrap' }}>
                        {new Date(m.created_at).toLocaleDateString('es-CO')} {new Date(m.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td>
                        <span style={{ padding: '2px 8px', borderRadius: 10, background: meta.color + '20', color: meta.color, fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {meta.label}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.78rem' }}>
                        {m.inventory_items ? (
                          <div>
                            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.76rem', fontWeight: 600 }}>{m.inventory_items.serial_number}</div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{[m.inventory_items.brand, m.inventory_items.model].filter(Boolean).join(' ')}</div>
                          </div>
                        ) : m.inventory_consumables ? (
                          <div>
                            <div style={{ fontSize: '0.76rem', fontWeight: 600 }}>{m.inventory_consumables.name}</div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{m.quantity ?? 0} {m.inventory_consumables.unit}</div>
                          </div>
                        ) : '—'}
                      </td>
                      <td style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>{m.inventory_items?.inventory_categories?.name ?? '—'}</td>
                      <td style={{ fontSize: '0.74rem', whiteSpace: 'nowrap' }}>
                        <span style={{ color: 'var(--text-muted)' }}>{m.from_status ?? '—'}</span>
                        {' → '}
                        <span style={{ fontWeight: 600 }}>{m.to_status ?? '—'}</span>
                      </td>
                      <td style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', maxWidth: 320 }}>{m.notes ?? '—'}</td>
                      <td style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{m.responsible_email ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

/* ─── Tab Bodegas: CRUD de almacenes ─── */

type Warehouse = {
  id: string;
  code: string;
  name: string;
  type: string;
  city: string | null;
  address: string | null;
  manager_email: string | null;
  notes: string | null;
  is_active: boolean;
  counts: { in_stock: number; reserved: number; installed: number; in_repair: number; decommissioned: number; total: number };
  consumables_total: number;
};

const WAREHOUSE_TYPES = [
  { value: 'central',   label: 'Bodega central' },
  { value: 'cuadrilla', label: 'Bodega de cuadrilla' },
  { value: 'vehiculo',  label: 'Vehículo / camioneta' },
  { value: 'taller',    label: 'Taller / mantenimiento' },
  { value: 'transito',  label: 'Tránsito (en ruta)' },
  { value: 'proveedor', label: 'Proveedor externo' },
  { value: 'otro',      label: 'Otro' },
];

function BodegasTab({ userEmail: _userEmail }: { userEmail: string }) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Warehouse | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/inventory/warehouses');
      const j = await r.json();
      setWarehouses(j.warehouses ?? []);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const remove = async (id: string, name: string) => {
    if (!confirm(`¿Eliminar bodega "${name}"? Solo se puede borrar si no tiene items ni consumibles vinculados.`)) return;
    const r = await fetch(`/api/inventory/warehouses?id=${id}`, { method: 'DELETE' });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(j.error ?? 'No se pudo eliminar');
      return;
    }
    load();
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Bodegas</h2>
        <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
          Almacenes físicos donde viven equipos y consumibles. Cuadrillas, vehículos, taller, etc.
        </span>
        <button onClick={() => setShowAdd(true)} className="primary-btn" style={{ marginLeft: 'auto' }}>
          <Plus size={14} /> Nueva bodega
        </button>
      </div>

      {loading ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Cargando…</div>
      ) : warehouses.length === 0 ? (
        <div className="alert-warning" style={{ fontSize: '0.85rem' }}>
          Aún no hay bodegas. Crea al menos una para asignar items y consumibles.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
          {warehouses.map((w) => {
            const typeLabel = WAREHOUSE_TYPES.find((t) => t.value === w.type)?.label ?? w.type;
            return (
              <div key={w.id} className="glass-panel" style={{ padding: 16, borderLeft: '4px solid #0ea5e9', position: 'relative', opacity: w.is_active ? 1 : 0.55 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <Building2 size={18} style={{ color: '#0ea5e9' }} />
                  <h3 style={{ margin: 0, fontSize: '0.95rem' }}>{w.name}</h3>
                  {!w.is_active && (
                    <span style={{ padding: '2px 6px', borderRadius: 6, background: 'rgba(100,116,139,0.2)', color: '#64748b', fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase' }}>Inactiva</span>
                  )}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'ui-monospace, monospace', marginBottom: 4 }}>{w.code}</div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
                  {typeLabel}{w.city && ` · ${w.city}`}
                </div>
                {w.manager_email && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 8 }}>Encargado: {w.manager_email}</div>
                )}

                {/* Conteos */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                  {Object.entries(w.counts).filter(([k]) => k !== 'total').map(([status, count]) => {
                    if (count === 0) return null;
                    const m = STATUS_META[status];
                    if (!m) return null;
                    return (
                      <span key={status} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.66rem', fontWeight: 600, padding: '2px 7px', borderRadius: 10, background: m.color + '20', color: m.color }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: m.color }} />
                        {m.label}: {count}
                      </span>
                    );
                  })}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: '0.78rem', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  <div>
                    <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Equipos</div>
                    <div style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>{w.counts.total}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Consumibles</div>
                    <div style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>{w.consumables_total}</div>
                  </div>
                </div>

                {/* Acciones */}
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 10 }}>
                  <button onClick={() => setEditing(w)} title="Editar" style={{ padding: 6, background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', borderRadius: 4 }}>
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => remove(w.id, w.name)} title="Eliminar" style={{ padding: 6, background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', borderRadius: 4 }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAdd && <WarehouseModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />}
      {editing && <WarehouseModal warehouse={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </>
  );
}

function WarehouseModal({ warehouse, onClose, onSaved }: { warehouse?: Warehouse; onClose: () => void; onSaved: () => void }) {
  const editing = !!warehouse;
  const [form, setForm] = useState({
    code: warehouse?.code ?? '',
    name: warehouse?.name ?? '',
    type: warehouse?.type ?? 'central',
    city: warehouse?.city ?? '',
    address: warehouse?.address ?? '',
    manager_email: warehouse?.manager_email ?? '',
    notes: warehouse?.notes ?? '',
    is_active: warehouse?.is_active ?? true,
  });
  const set = <K extends keyof typeof form>(k: K, v: typeof form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!form.name.trim()) { setErr('Nombre requerido'); return; }
    if (!editing && !form.code.trim()) { setErr('Código requerido'); return; }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        type: form.type,
        city: form.city.trim() || null,
        address: form.address.trim() || null,
        manager_email: form.manager_email.trim() || null,
        notes: form.notes.trim() || null,
        is_active: form.is_active,
      };
      if (editing) {
        payload.id = warehouse!.id;
        const r = await fetch('/api/inventory/warehouses', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? 'Error');
      } else {
        payload.code = form.code.trim();
        const r = await fetch('/api/inventory/warehouses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? 'Error');
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title={editing ? `Editar bodega — ${warehouse!.name}` : 'Nueva bodega'} onClose={onClose}>
      {err && <div className="alert-error" style={{ marginBottom: 10, fontSize: '0.82rem' }}>{err}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="input-group" style={{ margin: 0 }}>
          <label className="input-label">Código {!editing && <span style={{ color: '#ef4444' }}>*</span>}</label>
          <input value={form.code} onChange={(e) => set('code', e.target.value)} placeholder="CALI_CUADRILLA_1" disabled={editing} />
          {!editing && <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>Mayúsculas, A-Z 0-9 _ — clave única.</p>}
        </div>
        <div className="input-group" style={{ margin: 0 }}>
          <label className="input-label">Nombre <span style={{ color: '#ef4444' }}>*</span></label>
          <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Cuadrilla Cali #1" />
        </div>
        <div className="input-group" style={{ margin: 0 }}>
          <label className="input-label">Tipo</label>
          <select value={form.type} onChange={(e) => set('type', e.target.value)}>
            {WAREHOUSE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div className="input-group" style={{ margin: 0 }}>
          <label className="input-label">Ciudad</label>
          <input value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="Cali" />
        </div>
        <div className="input-group" style={{ margin: 0, gridColumn: '1 / -1' }}>
          <label className="input-label">Dirección</label>
          <input value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Calle 16b 124 80" />
        </div>
        <div className="input-group" style={{ margin: 0 }}>
          <label className="input-label">Encargado (email)</label>
          <input value={form.manager_email} onChange={(e) => set('manager_email', e.target.value)} placeholder="responsable@bia.app" />
        </div>
        <div className="input-group" style={{ margin: 0 }}>
          <label className="input-label">Activa</label>
          <select value={form.is_active ? '1' : '0'} onChange={(e) => set('is_active', e.target.value === '1')}>
            <option value="1">Sí — operativa</option>
            <option value="0">No — archivada</option>
          </select>
        </div>
        <div className="input-group" style={{ margin: 0, gridColumn: '1 / -1' }}>
          <label className="input-label">Notas</label>
          <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} style={{ width: '100%' }} />
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
        <button onClick={onClose} className="secondary-btn" disabled={saving}>Cancelar</button>
        <button onClick={submit} className="primary-btn" disabled={saving}>{saving ? 'Guardando…' : (editing ? 'Guardar cambios' : 'Crear bodega')}</button>
      </div>
    </ModalShell>
  );
}

/* ─── Modal: Bulk Transfer (transferir N items entre bodegas) ─── */
function BulkTransferModal({ items, userEmail, onClose, onSaved }: { items: InvItem[]; userEmail: string; onClose: () => void; onSaved: () => void }) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [toId, setToId] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/inventory/warehouses?active=true').then((r) => r.json()).then((j) => setWarehouses(j.warehouses ?? []));
  }, []);

  const submit = async () => {
    setErr(null);
    if (!toId) { setErr('Selecciona la bodega destino'); return; }
    setSaving(true);
    try {
      const r = await fetch('/api/inventory/items/bulk-transfer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to_warehouse_id: toId,
          item_ids: items.map((it) => it.id),
          reason: reason.trim() || null,
          actor_email: userEmail,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Error');
      const msg = [
        `Transferidos: ${j.items_moved ?? 0} equipos`,
        ...(Array.isArray(j.items_skipped) && j.items_skipped.length > 0 ? [`Omitidos:\n${j.items_skipped.join('\n')}`] : []),
      ].join('\n\n');
      alert(msg);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Transferir equipos entre bodegas" onClose={onClose}>
      <div style={{ background: 'rgba(14,165,233,0.08)', border: '1px solid rgba(14,165,233,0.3)', borderRadius: 8, padding: 12, marginBottom: 14, fontSize: '0.82rem' }}>
        <strong>{items.length} equipo(s) seleccionado(s)</strong>
        <div style={{ maxHeight: 100, overflowY: 'auto', marginTop: 6, fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
          {items.map((it) => (
            <div key={it.id} style={{ fontFamily: 'ui-monospace, monospace' }}>
              {it.serial_number} · {[it.brand, it.model].filter(Boolean).join(' ')}
              {it.warehouses && <span style={{ color: 'var(--text-muted)' }}> · desde {it.warehouses.name}</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="input-group" style={{ marginBottom: 10 }}>
        <label className="input-label">Bodega destino *</label>
        <select value={toId} onChange={(e) => setToId(e.target.value)}>
          <option value="">— Selecciona —</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
        </select>
        {warehouses.length === 0 && (
          <p style={{ fontSize: '0.72rem', color: '#ef4444', margin: '4px 0 0' }}>
            No hay bodegas activas. Crea una en el tab "Bodegas" primero.
          </p>
        )}
      </div>

      <div className="input-group" style={{ marginBottom: 10 }}>
        <label className="input-label">Motivo / orden de transporte</label>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej: Despacho semanal Cuadrilla 2, OT-2026-045" />
      </div>

      {err && <div className="alert-error" style={{ marginBottom: 10, fontSize: '0.82rem' }}>{err}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button onClick={onClose} className="secondary-btn" disabled={saving}>Cancelar</button>
        <button onClick={() => void submit()} className="primary-btn" disabled={saving || !toId} style={{ background: '#0ea5e9' }}>
          {saving ? 'Transfiriendo…' : `Transferir ${items.length} equipo(s)`}
        </button>
      </div>
    </ModalShell>
  );
}

/* ─── Modales de logística inversa ─── */

const SWAP_MOTIVOS = [
  { value: 'upgrade',     label: 'Upgrade tecnológico (cambio de marca/modelo)' },
  { value: 'warranty',    label: 'Reemplazo por garantía' },
  { value: 'damage',      label: 'Daño irreparable' },
  { value: 'replacement', label: 'Reposición preventiva' },
  { value: 'other',       label: 'Otro' },
] as const;

const SWAP_DESTINATIONS = [
  { value: 'in_stock',        label: 'Devolver a bodega (volver a stock)' },
  { value: 'in_repair',       label: 'Mandar a garantía / taller' },
  { value: 'decommissioned',  label: 'Decomisar (fin de vida útil)' },
] as const;

function SwapItemModal({ item, userEmail, onClose, onSaved }: { item: InvItem; userEmail: string; onClose: () => void; onSaved: () => void }) {
  const [candidates, setCandidates] = useState<InvItem[]>([]);
  const [search, setSearch] = useState('');
  const [newItemId, setNewItemId] = useState('');
  const [motivo, setMotivo] = useState<string>('upgrade');
  const [destStatus, setDestStatus] = useState<string>('in_stock');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // Cargar items en stock. Priorizar la misma familia.
    fetch('/api/inventory/items?status=in_stock&limit=500')
      .then((r) => r.json())
      .then((j) => setCandidates(j.items ?? []));
  }, []);

  const sameFamily = item.inventory_categories?.family;
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const matchesQuery = (it: InvItem) =>
      !q ||
      it.serial_number.toLowerCase().includes(q) ||
      (it.brand ?? '').toLowerCase().includes(q) ||
      (it.model ?? '').toLowerCase().includes(q) ||
      (it.inventory_categories?.name ?? '').toLowerCase().includes(q);
    const same = candidates.filter((it) => it.inventory_categories?.family === sameFamily && matchesQuery(it));
    const other = candidates.filter((it) => it.inventory_categories?.family !== sameFamily && matchesQuery(it));
    return { same, other };
  }, [candidates, search, sameFamily]);

  const submit = async () => {
    setErr(null);
    if (!newItemId) { setErr('Selecciona el equipo de reemplazo'); return; }
    setSaving(true);
    try {
      const r = await fetch('/api/inventory/items/swap', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          old_item_id: item.id,
          new_item_id: newItemId,
          motivo,
          destination_status: destStatus,
          notes: notes.trim() || null,
          actor_email: userEmail,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Error');
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Reemplazar equipo (swap)" onClose={onClose}>
      <div style={{ background: 'rgba(14, 165, 233, 0.08)', border: '1px solid rgba(14, 165, 233, 0.3)', borderRadius: 8, padding: 12, marginBottom: 14, fontSize: '0.85rem' }}>
        <strong>Equipo a retirar:</strong>
        <div style={{ marginTop: 4, fontFamily: 'ui-monospace, monospace', fontSize: '0.82rem' }}>{item.serial_number}</div>
        <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
          {item.inventory_categories?.name ?? '—'} · {[item.brand, item.model].filter(Boolean).join(' ')}
          {item.client_houses?.casa && <> · en <strong>{item.client_houses.casa}</strong></>}
        </div>
      </div>

      <div className="input-group" style={{ marginBottom: 10 }}>
        <label className="input-label">Motivo del swap *</label>
        <select value={motivo} onChange={(e) => setMotivo(e.target.value)}>
          {SWAP_MOTIVOS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>

      <div className="input-group" style={{ marginBottom: 10 }}>
        <label className="input-label">¿A dónde va el equipo retirado? *</label>
        <select value={destStatus} onChange={(e) => setDestStatus(e.target.value)}>
          {SWAP_DESTINATIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
      </div>

      <div className="input-group" style={{ marginBottom: 10 }}>
        <label className="input-label">Equipo de reemplazo *</label>
        <div style={{ position: 'relative', marginBottom: 8 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input type="text" placeholder="Buscar serial, marca, modelo, categoría…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: '100%', paddingLeft: 32 }} />
        </div>
        <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
          {filtered.same.length > 0 && (
            <>
              <div style={{ padding: '6px 10px', fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--text-muted)', background: 'var(--bg-elevated)', letterSpacing: '0.05em' }}>
                Misma familia ({sameFamily ?? '—'})
              </div>
              {filtered.same.map((it) => (
                <label key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: newItemId === it.id ? 'rgba(14,165,233,0.08)' : 'transparent' }}>
                  <input type="radio" name="newItem" checked={newItemId === it.id} onChange={() => setNewItemId(it.id)} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem', fontWeight: 600 }}>{it.serial_number}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{it.inventory_categories?.name ?? '—'} · {[it.brand, it.model].filter(Boolean).join(' ')}</div>
                  </div>
                </label>
              ))}
            </>
          )}
          {filtered.other.length > 0 && (
            <>
              <div style={{ padding: '6px 10px', fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--text-muted)', background: 'var(--bg-elevated)', letterSpacing: '0.05em' }}>
                Otras familias (cambio de tecnología)
              </div>
              {filtered.other.map((it) => (
                <label key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: newItemId === it.id ? 'rgba(14,165,233,0.08)' : 'transparent' }}>
                  <input type="radio" name="newItem" checked={newItemId === it.id} onChange={() => setNewItemId(it.id)} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem', fontWeight: 600 }}>{it.serial_number}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{it.inventory_categories?.name ?? '—'} · {[it.brand, it.model].filter(Boolean).join(' ')}</div>
                  </div>
                </label>
              ))}
            </>
          )}
          {filtered.same.length === 0 && filtered.other.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
              No hay equipos en stock con esos filtros.
            </div>
          )}
        </div>
      </div>

      <div className="input-group" style={{ marginBottom: 10 }}>
        <label className="input-label">Notas</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Detalle, número de OT, etc." rows={2} style={{ width: '100%' }} />
      </div>

      {err && <div className="alert-error" style={{ marginBottom: 10, fontSize: '0.82rem' }}>{err}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button onClick={onClose} className="secondary-btn" disabled={saving}>Cancelar</button>
        <button onClick={() => void submit()} className="primary-btn" disabled={saving || !newItemId} style={{ background: '#0ea5e9' }}>
          {saving ? 'Procesando…' : 'Ejecutar swap'}
        </button>
      </div>
    </ModalShell>
  );
}

function ReturnItemModal({ item, userEmail, onClose, onSaved }: { item: InvItem; userEmail: string; onClose: () => void; onSaved: () => void }) {
  const [destStatus, setDestStatus] = useState<string>('in_stock');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!reason.trim()) { setErr('Motivo del retiro requerido'); return; }
    setSaving(true);
    try {
      const r = await fetch('/api/inventory/items/return', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: item.id,
          destination_status: destStatus,
          reason: reason.trim(),
          actor_email: userEmail,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Error');
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Retirar equipo (sin reemplazo)" onClose={onClose}>
      <div style={{ background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: 8, padding: 12, marginBottom: 14, fontSize: '0.85rem' }}>
        <strong>Equipo a retirar:</strong>
        <div style={{ marginTop: 4, fontFamily: 'ui-monospace, monospace', fontSize: '0.82rem' }}>{item.serial_number}</div>
        <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
          {item.inventory_categories?.name ?? '—'} · {[item.brand, item.model].filter(Boolean).join(' ')}
          {item.client_houses?.casa && <> · en <strong>{item.client_houses.casa}</strong></>}
        </div>
      </div>

      <div className="input-group" style={{ marginBottom: 10 }}>
        <label className="input-label">Destino *</label>
        <select value={destStatus} onChange={(e) => setDestStatus(e.target.value)}>
          <option value="in_stock">Devolver a bodega</option>
          <option value="in_repair">A garantía / taller</option>
        </select>
      </div>

      <div className="input-group" style={{ marginBottom: 10 }}>
        <label className="input-label">Motivo *</label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Cancelación del proyecto, equipo defectuoso, error de instalación, etc." rows={3} style={{ width: '100%' }} />
      </div>

      {err && <div className="alert-error" style={{ marginBottom: 10, fontSize: '0.82rem' }}>{err}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button onClick={onClose} className="secondary-btn" disabled={saving}>Cancelar</button>
        <button onClick={() => void submit()} className="primary-btn" disabled={saving} style={{ background: '#f59e0b' }}>
          {saving ? 'Procesando…' : 'Retirar de campo'}
        </button>
      </div>
    </ModalShell>
  );
}

function DecommissionItemModal({ item, userEmail, onClose, onSaved }: { item: InvItem; userEmail: string; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!reason.trim()) { setErr('Motivo de la decomisión requerido'); return; }
    if (!confirm(`¿Decomisar definitivamente ${item.serial_number}? Esta acción es permanente.`)) return;
    setSaving(true);
    try {
      const r = await fetch('/api/inventory/items/decommission', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id, reason: reason.trim(), actor_email: userEmail }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Error');
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Decomisar equipo (fin de vida útil)" onClose={onClose}>
      <div style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 8, padding: 12, marginBottom: 14, fontSize: '0.85rem' }}>
        <strong>⚠ Acción permanente</strong>
        <div style={{ marginTop: 4, fontFamily: 'ui-monospace, monospace', fontSize: '0.82rem' }}>{item.serial_number}</div>
        <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
          {item.inventory_categories?.name ?? '—'} · {[item.brand, item.model].filter(Boolean).join(' ')}
        </div>
        <p style={{ marginTop: 8, fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
          El equipo quedará marcado como decomisado y no será reutilizable. Histórico se conserva para auditoría.
        </p>
      </div>

      <div className="input-group" style={{ marginBottom: 10 }}>
        <label className="input-label">Motivo *</label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Fin de vida útil, daño irreparable, pérdida, robo, etc." rows={3} style={{ width: '100%' }} />
      </div>

      {err && <div className="alert-error" style={{ marginBottom: 10, fontSize: '0.82rem' }}>{err}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button onClick={onClose} className="secondary-btn" disabled={saving}>Cancelar</button>
        <button onClick={() => void submit()} className="primary-btn" disabled={saving} style={{ background: '#ef4444' }}>
          {saving ? 'Procesando…' : 'Decomisar definitivamente'}
        </button>
      </div>
    </ModalShell>
  );
}

/* ─── Helpers ─── */
function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: 640, maxHeight: '90vh', overflowY: 'auto', padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.4rem', padding: 0, lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FieldsGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="fields-grid">
      {children}
      <style jsx>{`
        .fields-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        @media (max-width: 600px) { .fields-grid { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}

function Field({ label, required, fullWidth, children }: { label: string; required?: boolean; fullWidth?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ gridColumn: fullWidth ? '1 / -1' : 'auto' }}>
      <label className="input-label" style={{ fontSize: '0.76rem', fontWeight: 600, marginBottom: 4, display: 'block' }}>
        {label}{required && <span style={{ color: '#ef4444', marginLeft: 3 }}>*</span>}
      </label>
      {children}
    </div>
  );
}

/* ─── Modal cambiar estado / ubicación ─── */
function ChangeStatusModal({ item, userEmail, onClose, onSaved }: { item: InvItem; userEmail: string; onClose: () => void; onSaved: () => void }) {
  const [status, setStatus] = useState<InvItem['status']>(item.status);
  const [houses, setHouses] = useState<Array<{ id: string; casa: string }>>([]);
  const [houseId, setHouseId] = useState<string>(item.current_house_id ?? '');
  const [location, setLocation] = useState<string>(item.current_location ?? '');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supa().from('client_houses').select('id, casa').order('casa').then(({ data }) => {
      setHouses((data ?? []) as Array<{ id: string; casa: string }>);
    });
  }, []);

  const needsHouse = status === 'installed';
  const meta = STATUS_META[status];

  const save = async () => {
    setErr(null);
    if (needsHouse && !houseId) { setErr('Selecciona la casa donde queda instalado'); return; }
    setSaving(true);
    const payload: Record<string, unknown> = {
      status,
      current_location: status === 'installed' ? 'house'
        : status === 'in_stock' ? 'warehouse'
        : status === 'in_repair' ? 'workshop'
        : location || null,
      current_house_id: needsHouse ? houseId : null,
      responsible_email: userEmail,
      movement_notes: notes || null,
    };
    const r = await fetch(`/api/inventory/items/${item.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    const j = await r.json();
    if (!r.ok) { setErr(j.error ?? 'Error'); return; }
    onSaved();
  };

  return (
    <ModalShell title={`Cambiar estado — ${item.serial_number}`} onClose={onClose}>
      <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
        Estado actual: <strong style={{ color: STATUS_META[item.status].color }}>{STATUS_META[item.status].label}</strong>
        {item.client_houses?.casa && <> · en <strong>{item.client_houses.casa}</strong></>}
      </p>
      {err && <div className="alert-error" style={{ marginBottom: 10, fontSize: '0.82rem' }}>{err}</div>}

      <Field label="Nuevo estado" required>
        <select value={status} onChange={(e) => setStatus(e.target.value as InvItem['status'])} style={{ width: '100%' }}>
          {Object.entries(STATUS_META).map(([key, m]) => (
            <option key={key} value={key}>{m.label}</option>
          ))}
        </select>
      </Field>

      <div style={{ marginTop: 12 }}>
        <span style={{ display: 'inline-block', padding: '4px 10px', borderRadius: 10, background: meta.color + '20', color: meta.color, fontSize: '0.74rem', fontWeight: 700 }}>
          Quedará como: {meta.label}
        </span>
      </div>

      {needsHouse && (
        <div style={{ marginTop: 12 }}>
          <Field label="Casa donde se instala" required>
            <select value={houseId} onChange={(e) => setHouseId(e.target.value)} style={{ width: '100%' }}>
              <option value="">— Selecciona casa —</option>
              {houses.map((h) => <option key={h.id} value={h.id}>{h.casa}</option>)}
            </select>
          </Field>
        </div>
      )}

      {!needsHouse && status !== 'in_stock' && status !== 'in_repair' && (
        <div style={{ marginTop: 12 }}>
          <Field label="Ubicación física (opcional)">
            <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Ej: bodega, taller, en tránsito" />
          </Field>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <Field label="Nota del movimiento (queda en el audit log)">
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej: Reemplaza inversor anterior; viene de proveedor X" />
        </Field>
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
        <button onClick={onClose} className="secondary-btn" disabled={saving}>Cancelar</button>
        <button onClick={save} className="primary-btn" disabled={saving || status === item.status && houseId === (item.current_house_id ?? '')}>
          {saving ? 'Guardando…' : 'Confirmar cambio'}
        </button>
      </div>
    </ModalShell>
  );
}

/* ─── Modal historial de un equipo ─── */
function ItemHistoryModal({ item, onClose }: { item: InvItem; onClose: () => void }) {
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/inventory/items/${item.id}`).then((r) => r.json()).then((j) => {
      setMovements(j.movements ?? []);
      setLoading(false);
    });
  }, [item.id]);

  return (
    <ModalShell title={`Historial — ${item.serial_number}`} onClose={onClose}>
      <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
        {item.inventory_categories?.name ?? '—'} · {[item.brand, item.model].filter(Boolean).join(' · ') || '—'}
      </p>
      {loading ? (
        <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-muted)' }}>Cargando…</div>
      ) : movements.length === 0 ? (
        <div className="alert-warning" style={{ fontSize: '0.85rem' }}>Sin movimientos registrados.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {movements.map((m) => (
            <div key={m.id} style={{ padding: 10, borderRadius: 8, background: 'var(--bg-elevated)', borderLeft: '3px solid var(--accent)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '0.82rem', textTransform: 'capitalize' }}>{m.type.replace('_', ' ')}</strong>
                <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  {new Date(m.created_at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
              </div>
              {(m.from_status || m.to_status) && (
                <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                  {m.from_status ?? '—'} → <strong>{m.to_status ?? '—'}</strong>
                </div>
              )}
              {(m.from_location || m.to_location) && (
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  {m.from_location ?? '—'} → {m.to_location ?? '—'}
                </div>
              )}
              {m.responsible_email && (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>por {m.responsible_email}</div>
              )}
              {m.notes && (
                <div style={{ fontSize: '0.78rem', marginTop: 4 }}>{m.notes}</div>
              )}
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <button onClick={onClose} className="secondary-btn">Cerrar</button>
      </div>
    </ModalShell>
  );
}

/* ═════════════ UBICACIONES (LEGACY) ═════════════ */
// Tab "Ubicaciones" ahora renderiza BodegasTab (warehouses, FK en items).
// Este código queda como dead code mientras migramos completamente.
interface InvLocation {
  id: string;
  code: string;
  name: string;
  type: keyof typeof LOCATION_TYPE_META;
  parent_id: string | null;
  address: string | null;
  contact_email: string | null;
  notes: string | null;
  is_active: boolean;
  item_count: number;
}

function UbicacionesTab() {
  const [locations, setLocations] = useState<InvLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const load = async () => {
    setLoading(true);
    const r = await fetch('/api/inventory/locations');
    const j = await r.json();
    setLocations(j.locations ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const remove = async (id: string, hasItems: boolean) => {
    const msg = hasItems
      ? '¿Desactivar esta ubicación? Tiene items asignados — quedarán huérfanos pero el histórico se preserva.'
      : '¿Desactivar esta ubicación?';
    if (!confirm(msg)) return;
    await fetch(`/api/inventory/locations?id=${id}`, { method: 'DELETE' });
    load();
  };

  const byType = useMemo(() => {
    const groups: Record<string, InvLocation[]> = {};
    for (const l of locations) {
      (groups[l.type] ??= []).push(l);
    }
    return groups;
  }, [locations]);

  if (loading) return <div className="glass-panel" style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Cargando…</div>;

  return (
    <>
      <div className="glass-panel" style={{ marginBottom: 14, padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <button onClick={() => setShowAdd(true)} className="primary-btn"><Plus size={14} /> Nueva ubicación</button>
        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          {locations.length} ubicación{locations.length === 1 ? '' : 'es'} activas
        </div>
      </div>

      {locations.length === 0 ? (
        <div className="alert-warning" style={{ fontSize: '0.85rem' }}>
          No hay ubicaciones. Las ubicaciones permiten saber dónde físicamente vive cada equipo: bodega central, taller, camioneta de cuadrilla, etc.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {(Object.keys(LOCATION_TYPE_META) as Array<keyof typeof LOCATION_TYPE_META>).map((type) => {
            const list = byType[type] ?? [];
            if (list.length === 0) return null;
            const meta = LOCATION_TYPE_META[type];
            return (
              <div key={type} className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '12px 18px', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--border)' }}>
                  <meta.Icon size={18} style={{ color: meta.color }} />
                  <h3 style={{ margin: 0, fontSize: '0.92rem' }}>{meta.label}</h3>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                    {list.length} {list.length === 1 ? 'ubicación' : 'ubicaciones'}
                  </span>
                </div>
                <table style={{ width: '100%', fontSize: '0.82rem' }}>
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Nombre</th>
                      <th>Dirección / Notas</th>
                      <th style={{ textAlign: 'right' }}>Items</th>
                      <th style={{ textAlign: 'right' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((l) => (
                      <tr key={l.id}>
                        <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.76rem', fontWeight: 600 }}>{l.code}</td>
                        <td style={{ fontWeight: 500 }}>{l.name}</td>
                        <td style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                          {l.address ?? l.notes ?? '—'}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: l.item_count > 0 ? meta.color : 'var(--text-muted)' }}>
                          {l.item_count}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button onClick={() => remove(l.id, l.item_count > 0)} title="Desactivar"
                            style={{ padding: 6, background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', borderRadius: 4 }}>
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}

      {showAdd && <NewLocationModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />}
    </>
  );
}

function NewLocationModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<keyof typeof LOCATION_TYPE_META>('warehouse');
  const [address, setAddress] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setErr(null);
    if (!code.trim() || !name.trim()) { setErr('Código y nombre son obligatorios'); return; }
    setSaving(true);
    const r = await fetch('/api/inventory/locations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, name, type, address: address || null, contact_email: contactEmail || null, notes: notes || null }),
    });
    setSaving(false);
    const j = await r.json();
    if (!r.ok) { setErr(j.error ?? 'Error'); return; }
    onSaved();
  };

  return (
    <ModalShell onClose={onClose} title="Nueva ubicación">
      {err && <div className="alert-error" style={{ marginBottom: 10, fontSize: '0.82rem' }}>{err}</div>}
      <FieldsGrid>
        <Field label="Código" required>
          <input type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder="VEHICLE_CUAD_3" style={{ fontFamily: 'ui-monospace, monospace' }} />
        </Field>
        <Field label="Tipo" required>
          <select value={type} onChange={(e) => setType(e.target.value as keyof typeof LOCATION_TYPE_META)}>
            {Object.entries(LOCATION_TYPE_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
          </select>
        </Field>
        <Field label="Nombre" required fullWidth>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Camioneta Cuadrilla 3" />
        </Field>
        <Field label="Dirección" fullWidth>
          <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <Field label="Email contacto">
          <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
        </Field>
        <Field label="Notas" fullWidth>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>
      </FieldsGrid>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 }}>
        <button onClick={onClose} className="secondary-btn" disabled={saving}>Cancelar</button>
        <button onClick={save} className="primary-btn" disabled={saving}>{saving ? 'Guardando…' : 'Crear ubicación'}</button>
      </div>
    </ModalShell>
  );
}

/* ═════════════ RESERVAS ═════════════ */
interface Reservation {
  id: string;
  visit_id: string | null;
  status: 'draft' | 'confirmed' | 'fulfilled' | 'cancelled';
  title: string;
  requested_by: string | null;
  notes: string | null;
  created_at: string;
  confirmed_at: string | null;
  fulfilled_at: string | null;
  cancelled_at: string | null;
  field_visits?: { visit_type: string; casa: string | null; visit_date: string } | null;
  inventory_reservation_items?: Array<{
    id: string;
    picked_at: string | null;
    inventory_items: {
      id: string;
      serial_number: string;
      brand: string | null;
      model: string | null;
      status: string;
      inventory_categories?: { name: string; family: string } | null;
    } | null;
  }>;
  inventory_reservation_consumables?: Array<{
    id: string;
    quantity: number;
    fulfilled_at: string | null;
    inventory_consumables: {
      id: string;
      name: string;
      sku: string | null;
      unit: string;
      stock_quantity: number;
    } | null;
  }>;
}

const RESV_STATUS_META: Record<string, { label: string; color: string; Icon: typeof Cpu }> = {
  draft:     { label: 'Borrador',  color: '#94a3b8', Icon: Pencil },
  confirmed: { label: 'Confirmada', color: '#3b82f6', Icon: CheckCircle2 },
  fulfilled: { label: 'Cumplida',   color: '#10b981', Icon: CheckCircle2 },
  cancelled: { label: 'Cancelada',  color: '#ef4444', Icon: XCircle },
};

function ReservasTab({ userEmail }: { userEmail: string }) {
  const [items, setItems] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterStatus !== 'all') params.set('status', filterStatus);
    const r = await fetch(`/api/inventory/reservations?${params}`);
    const j = await r.json();
    setItems(j.reservations ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filterStatus]);

  const doAction = async (id: string, action: 'confirm' | 'fulfill' | 'cancel' | 'reopen') => {
    const r = await fetch('/api/inventory/reservations', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action, responsible_email: userEmail }),
    });
    const j = await r.json();
    if (!r.ok) { alert(j.error ?? 'Error'); return; }
    if (j.not_available && j.not_available > 0) {
      alert(`Confirmada con advertencia: ${j.not_available} item(s) no estaban en stock y fueron omitidos. Revisa la reserva.`);
    }
    load();
  };

  const remove = async (id: string) => {
    if (!confirm('¿Eliminar esta reserva? (solo para draft/cancelled)')) return;
    const r = await fetch(`/api/inventory/reservations?id=${id}`, { method: 'DELETE' });
    if (!r.ok) { const j = await r.json(); alert(j.error ?? 'Error'); return; }
    load();
  };

  return (
    <>
      <div className="glass-panel" style={{ marginBottom: 14, padding: 14 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <button onClick={() => setShowAdd(true)} className="primary-btn"><Plus size={14} /> Nueva reserva</button>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className={`chip ${filterStatus === 'all' ? 'active' : ''}`} onClick={() => setFilterStatus('all')}>Todas</button>
          {(Object.keys(RESV_STATUS_META) as Array<keyof typeof RESV_STATUS_META>).map((k) => (
            <button key={k} className={`chip ${filterStatus === k ? 'active' : ''}`} onClick={() => setFilterStatus(k)} style={{ borderLeft: `3px solid ${RESV_STATUS_META[k].color}` }}>
              {RESV_STATUS_META[k].label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Cargando…</div>
      ) : items.length === 0 ? (
        <div className="alert-warning" style={{ fontSize: '0.85rem' }}>
          Sin reservas. Crea una para apartar equipos serializados antes de una visita planeada — así los items quedan bloqueados con status reservado y nadie más los puede tomar.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((r) => {
            const meta = RESV_STATUS_META[r.status];
            const lines = r.inventory_reservation_items ?? [];
            return (
              <div key={r.id} className="glass-panel" style={{ padding: 14, borderLeft: `4px solid ${meta.color}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <h3 style={{ margin: 0, fontSize: '0.98rem' }}>{r.title}</h3>
                      <span style={{ padding: '2px 10px', borderRadius: 10, background: meta.color + '20', color: meta.color, fontSize: '0.7rem', fontWeight: 700 }}>{meta.label}</span>
                    </div>
                    <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                      {r.field_visits ? (
                        <>Visita instalación: <strong>{r.field_visits.casa ?? 'sin casa'}</strong> · {r.field_visits.visit_date}</>
                      ) : r.status === 'fulfilled' ? (
                        <em>visita ya cumplida</em>
                      ) : (
                        <em>visita de instalación pendiente — se enlaza al completarla</em>
                      )}
                      {r.requested_by && <> · solicitada por {r.requested_by}</>}
                      <> · creada {new Date(r.created_at).toLocaleDateString('es-CO')}</>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {r.status === 'draft' && (
                      <>
                        <button onClick={() => setEditId(r.id)} className="secondary-btn" style={{ fontSize: '0.78rem', padding: '6px 12px' }}>
                          <Pencil size={12} /> Editar items
                        </button>
                        <button onClick={() => doAction(r.id, 'confirm')} className="primary-btn" style={{ fontSize: '0.78rem', padding: '6px 12px' }} disabled={lines.length === 0}>
                          Confirmar
                        </button>
                      </>
                    )}
                    {r.status === 'confirmed' && (
                      <>
                        <button onClick={() => doAction(r.id, 'fulfill')} className="primary-btn" style={{ fontSize: '0.78rem', padding: '6px 12px' }}>
                          Marcar cumplida
                        </button>
                        <button onClick={() => doAction(r.id, 'cancel')} className="secondary-btn" style={{ fontSize: '0.78rem', padding: '6px 12px', color: '#ef4444' }}>
                          Cancelar
                        </button>
                      </>
                    )}
                    {(r.status === 'cancelled') && (
                      <button onClick={() => doAction(r.id, 'reopen')} className="secondary-btn" style={{ fontSize: '0.78rem', padding: '6px 12px' }}>
                        Reabrir
                      </button>
                    )}
                    {(r.status === 'draft' || r.status === 'cancelled') && (
                      <button onClick={() => remove(r.id)} title="Eliminar"
                        style={{ padding: 6, background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', borderRadius: 4 }}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
                {lines.length === 0 && (r.inventory_reservation_consumables?.length ?? 0) === 0 ? (
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Sin items asignados.</div>
                ) : (
                  <>
                    {lines.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {lines.map((line) => {
                          const it = line.inventory_items;
                          if (!it) return null;
                          const itemMeta = STATUS_META[it.status];
                          return (
                            <div key={line.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: 'var(--bg-elevated)', borderRadius: 8, fontSize: '0.74rem', borderLeft: `3px solid ${itemMeta?.color ?? '#94a3b8'}` }}>
                              <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{it.serial_number}</span>
                              <span style={{ color: 'var(--text-muted)' }}>·</span>
                              <span>{it.inventory_categories?.name ?? [it.brand, it.model].filter(Boolean).join(' ')}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {(r.inventory_reservation_consumables?.length ?? 0) > 0 && (
                      <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {(r.inventory_reservation_consumables ?? []).map((cl) => {
                          const c = cl.inventory_consumables;
                          if (!c) return null;
                          return (
                            <div key={cl.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: 'var(--bg-elevated)', borderRadius: 8, fontSize: '0.74rem', borderLeft: '3px solid #8b5cf6' }}>
                              <Cable size={11} style={{ color: '#8b5cf6' }} />
                              <span>{c.name}</span>
                              <span style={{ color: 'var(--text-muted)' }}>·</span>
                              <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>{cl.quantity} {c.unit}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showAdd && <NewReservationModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} userEmail={userEmail} />}
      {editId && <EditReservationItemsModal reservationId={editId} onClose={() => setEditId(null)} onSaved={() => { setEditId(null); load(); }} />}
    </>
  );
}

interface VisitOption { id: string; visit_type: string; casa: string | null; visit_date: string; status: string }

function NewReservationModal({ onClose, onSaved, userEmail }: { onClose: () => void; onSaved: () => void; userEmail: string }) {
  const [title, setTitle] = useState('');
  const [visits, setVisits] = useState<VisitOption[]>([]);
  const [visitId, setVisitId] = useState('');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Cargar últimas 50 visitas (draft o completed) para vincular
    fetch('/api/visits?limit=50').then((r) => r.json()).then((j) => setVisits((j.visits ?? []) as VisitOption[]));
  }, []);

  const save = async () => {
    setErr(null);
    if (!title.trim()) { setErr('Título es obligatorio'); return; }
    setSaving(true);
    const r = await fetch('/api/inventory/reservations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, visit_id: visitId || null, requested_by: userEmail, notes: notes || null }),
    });
    setSaving(false);
    const j = await r.json();
    if (!r.ok) { setErr(j.error ?? 'Error'); return; }
    onSaved();
  };

  return (
    <ModalShell onClose={onClose} title="Nueva reserva">
      {err && <div className="alert-error" style={{ marginBottom: 10, fontSize: '0.82rem' }}>{err}</div>}
      <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
        Crea la reserva primero (vacía, en draft). Después le agregas los items específicos desde "Editar items".
      </p>
      <FieldsGrid>
        <Field label="Título" required fullWidth>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Instalación Casa 30 — viernes" />
        </Field>
        <Field label="Visita vinculada (opcional)" fullWidth>
          <select value={visitId} onChange={(e) => setVisitId(e.target.value)}>
            <option value="">— Sin visita —</option>
            {visits.map((v) => (
              <option key={v.id} value={v.id}>
                {v.visit_date} · {v.visit_type} · {v.casa ?? 'sin casa'} ({v.status})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Notas" fullWidth>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>
      </FieldsGrid>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 }}>
        <button onClick={onClose} className="secondary-btn" disabled={saving}>Cancelar</button>
        <button onClick={save} className="primary-btn" disabled={saving}>{saving ? 'Guardando…' : 'Crear reserva'}</button>
      </div>
    </ModalShell>
  );
}

interface ConsumableOpt { id: string; name: string; sku: string | null; unit: string; stock_quantity: number; }

function EditReservationItemsModal({ reservationId, onClose, onSaved }: { reservationId: string; onClose: () => void; onSaved: () => void }) {
  const [availableItems, setAvailableItems] = useState<InvItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [existingIds, setExistingIds] = useState<Set<string>>(new Set());
  const [consumables, setConsumables] = useState<ConsumableOpt[]>([]);
  const [consQty, setConsQty] = useState<Record<string, string>>({});  // consumable_id → qty (str)
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      // Cargar items en stock + los ya en la reserva + consumibles + líneas de consumibles en la reserva
      const [stockR, resvR, consR, resvConsR] = await Promise.all([
        fetch('/api/inventory/items?status=in_stock&limit=500').then((r) => r.json()),
        fetch(`/api/inventory/reservations?status=draft&limit=200`).then((r) => r.json()),
        fetch('/api/inventory/consumables').then((r) => r.json()).catch(() => ({ consumables: [] })),
        fetch(`/api/inventory/reservations/${reservationId}/consumables`).then((r) => r.json()).catch(() => ({ lines: [] })),
      ]);
      const thisResv: Reservation | undefined = (resvR.reservations ?? []).find((r: Reservation) => r.id === reservationId);
      const resvLines = thisResv?.inventory_reservation_items ?? [];
      const alreadyIn = new Set<string>(resvLines.map((l) => l.inventory_items?.id ?? '').filter(Boolean));
      const inStock: InvItem[] = stockR.items ?? [];
      const alreadyInItems: InvItem[] = resvLines
        .map((l) => l.inventory_items)
        .filter((x): x is NonNullable<typeof x> => Boolean(x))
        .map((x) => ({ ...x } as unknown as InvItem));
      const dedup = new Map<string, InvItem>();
      for (const it of [...inStock, ...alreadyInItems]) dedup.set(it.id, it);
      setAvailableItems(Array.from(dedup.values()));
      setSelectedIds(new Set(alreadyIn));
      setExistingIds(new Set(alreadyIn));

      // Consumibles disponibles + cantidades ya seleccionadas
      setConsumables((consR.consumables ?? []) as ConsumableOpt[]);
      const initialQty: Record<string, string> = {};
      type ConsLine = { consumable_id: string; quantity: number; inventory_consumables: ConsumableOpt | ConsumableOpt[] | null };
      for (const raw of (resvConsR.lines ?? []) as ConsLine[]) {
        initialQty[raw.consumable_id] = String(raw.quantity);
      }
      setConsQty(initialQty);

      setLoading(false);
    })();
  }, [reservationId]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return availableItems;
    return availableItems.filter((it) =>
      it.serial_number.toLowerCase().includes(q) ||
      (it.brand ?? '').toLowerCase().includes(q) ||
      (it.model ?? '').toLowerCase().includes(q) ||
      (it.inventory_categories?.name ?? '').toLowerCase().includes(q),
    );
  }, [availableItems, search]);

  const save = async () => {
    setSaving(true);
    try {
      const toAdd = Array.from(selectedIds).filter((id) => !existingIds.has(id));
      const toRemove = Array.from(existingIds).filter((id) => !selectedIds.has(id));
      if (toAdd.length > 0) {
        await fetch(`/api/inventory/reservations/${reservationId}/items`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item_ids: toAdd }),
        });
      }
      for (const id of toRemove) {
        await fetch(`/api/inventory/reservations/${reservationId}/items?item_id=${id}`, { method: 'DELETE' });
      }
      // Persistir consumibles (replace-all): solo entradas con qty > 0
      const consLines = Object.entries(consQty)
        .map(([consumable_id, qty]) => ({ consumable_id, quantity: Number(qty) }))
        .filter((l) => Number.isFinite(l.quantity) && l.quantity > 0);
      await fetch(`/api/inventory/reservations/${reservationId}/consumables`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines: consLines }),
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <ModalShell onClose={onClose} title="Editar items de la reserva">
      <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 10 }}>
        Selecciona equipos en stock para apartar. {selectedIds.size} item{selectedIds.size === 1 ? '' : 's'} seleccionado{selectedIds.size === 1 ? '' : 's'}.
      </p>
      <div style={{ position: 'relative', marginBottom: 12 }}>
        <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        <input type="text" placeholder="Buscar por serial, marca, modelo, categoría…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: '100%', paddingLeft: 32 }} />
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>Cargando…</div>
      ) : filtered.length === 0 ? (
        <div className="alert-warning" style={{ fontSize: '0.82rem' }}>No hay items disponibles con esos filtros.</div>
      ) : (
        <div style={{ maxHeight: 350, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
          {filtered.map((it) => {
            const selected = selectedIds.has(it.id);
            return (
              <label key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: selected ? 'var(--bg-elevated)' : 'transparent' }}>
                <input type="checkbox" checked={selected} onChange={() => toggle(it.id)} style={{ width: 16, height: 16 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8rem', fontWeight: 600 }}>{it.serial_number}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    {it.inventory_categories?.name ?? '—'} · {[it.brand, it.model].filter(Boolean).join(' ') || '—'}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      )}

      {/* Consumibles */}
      {!loading && consumables.length > 0 && (
        <>
          <div style={{ marginTop: 18, marginBottom: 8, fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Consumibles a reservar
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            {consumables.map((c) => {
              const qty = consQty[c.id] ?? '';
              const qtyNum = Number(qty);
              const overStock = Number.isFinite(qtyNum) && qtyNum > c.stock_quantity;
              return (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 500 }}>{c.name}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {c.sku ?? '—'} · Stock: <strong style={{ color: c.stock_quantity > 0 ? 'var(--text)' : '#ef4444' }}>{c.stock_quantity} {c.unit}</strong>
                    </div>
                  </div>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="0"
                    value={qty}
                    onChange={(e) => setConsQty((prev) => ({ ...prev, [c.id]: e.target.value }))}
                    style={{
                      width: 80, padding: '4px 8px', borderRadius: 6,
                      border: `1px solid ${overStock ? '#ef4444' : 'var(--border)'}`,
                      background: 'var(--bg-surface)', color: 'var(--text)',
                      fontSize: '0.82rem', textAlign: 'right',
                    }}
                  />
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', width: 26 }}>{c.unit}</span>
                </div>
              );
            })}
          </div>
          <p style={{ marginTop: 6, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            El stock se descontará al <strong>confirmar</strong> la reserva. Si cancelas la reserva, el stock se restituye.
          </p>
        </>
      )}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 }}>
        <button onClick={onClose} className="secondary-btn" disabled={saving}>Cancelar</button>
        <button onClick={save} className="primary-btn" disabled={saving}>{saving ? 'Guardando…' : 'Guardar cambios'}</button>
      </div>
    </ModalShell>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Tab KITS — cuántos kits solares se pueden armar con el stock actual
 *
 * Es meramente informativo. Toma el stock disponible por bodega (consumables +
 * items con status='in_stock') y calcula cuántos kits completos se podrían
 * ensamblar sin reutilizar equipos.
 *
 * Reglas:
 *   - Cali        prioriza Tipo 2 (60% / 25% / 15% para T2 / T3 / T4)
 *   - Cartagena   prioriza Tipo 3 y 4 (15% / 42.5% / 42.5%)
 *   - Barranquilla prioriza Tipo 3 y 4 (15% / 42.5% / 42.5%)
 *   - Solo Livoltek acepta Top Cover — para Tipo 4 con 6 baterías (Kit 4C)
 *   - Los equipos NO se reutilizan (una vez asignados a un kit, no vuelven al pool)
 * ═══════════════════════════════════════════════════════════════════════════ */

// Códigos de categoría que necesitamos leer del catálogo
const KIT_COMPONENT_CODES = {
  INV_LIVOLTEK_10K: 'LIVOLTEK_INV_10KW',
  INV_LIVOLTEK_15K: 'LIVOLTEK_INV_15KW',
  INV_DEYE_15K:     'DEYE_INV_15KW_HV',
  INV_DEYE_6K:      'DEYE_INV_6KW_LV',
  BAT_LIVOLTEK:     'LIVOLTEK_BAT_HV',
  BAT_DEYE:         'DEYE_BAT_HV_4KWH',
  BAT_PYLONTECH:    'PYLONTECH_BAT_LV',
  BMS_LIVOLTEK:     'LIVOLTEK_BMS',
  BMS_DEYE:         'DEYE_BMS',
  BMS_PYLONTECH:    'PYLONTECH_BMS',
  TOP_LIVOLTEK:     'LIVOLTEK_TOP_COVER',
} as const;

interface KitReq { code: string; qty: number; }
interface KitDef {
  id: string;
  tipo: 2 | 3 | 4;
  label: string;
  descripcion: string;
  requiere: KitReq[];
}

const KIT_DEFS: KitDef[] = [
  { id: 'K2A', tipo: 2, label: 'Kit 2A · Deye 6kw + Pylontech (2 bat)',
    descripcion: '1× Inversor Deye 6kW LV · 2× Batería Pylontech LV · 1× BMS Pylontech',
    requiere: [
      { code: KIT_COMPONENT_CODES.INV_DEYE_6K, qty: 1 },
      { code: KIT_COMPONENT_CODES.BAT_PYLONTECH, qty: 2 },
      { code: KIT_COMPONENT_CODES.BMS_PYLONTECH, qty: 1 },
    ] },
  { id: 'K2B', tipo: 2, label: 'Kit 2B · Livoltek 10kw + Livoltek (2 bat)',
    descripcion: '1× Inversor Livoltek 10kW · 2× Batería Livoltek HV · 1× BMS Livoltek',
    requiere: [
      { code: KIT_COMPONENT_CODES.INV_LIVOLTEK_10K, qty: 1 },
      { code: KIT_COMPONENT_CODES.BAT_LIVOLTEK, qty: 2 },
      { code: KIT_COMPONENT_CODES.BMS_LIVOLTEK, qty: 1 },
    ] },
  { id: 'K2C', tipo: 2, label: 'Kit 2C · Deye 6kw + Pylontech (3 bat)',
    descripcion: '1× Inversor Deye 6kW LV · 3× Batería Pylontech LV · 1× BMS Pylontech',
    requiere: [
      { code: KIT_COMPONENT_CODES.INV_DEYE_6K, qty: 1 },
      { code: KIT_COMPONENT_CODES.BAT_PYLONTECH, qty: 3 },
      { code: KIT_COMPONENT_CODES.BMS_PYLONTECH, qty: 1 },
    ] },
  { id: 'K3A', tipo: 3, label: 'Kit 3A · Livoltek 10kw + Livoltek (3 bat)',
    descripcion: '1× Inversor Livoltek 10kW · 3× Batería Livoltek HV · 1× BMS Livoltek',
    requiere: [
      { code: KIT_COMPONENT_CODES.INV_LIVOLTEK_10K, qty: 1 },
      { code: KIT_COMPONENT_CODES.BAT_LIVOLTEK, qty: 3 },
      { code: KIT_COMPONENT_CODES.BMS_LIVOLTEK, qty: 1 },
    ] },
  { id: 'K3B', tipo: 3, label: 'Kit 3B · Deye 15kw + Deye HV (3 bat)',
    descripcion: '1× Inversor Deye 15kW HV · 3× Batería Deye HV · 1× BMS Deye',
    requiere: [
      { code: KIT_COMPONENT_CODES.INV_DEYE_15K, qty: 1 },
      { code: KIT_COMPONENT_CODES.BAT_DEYE, qty: 3 },
      { code: KIT_COMPONENT_CODES.BMS_DEYE, qty: 1 },
    ] },
  { id: 'K4A', tipo: 4, label: 'Kit 4A · Livoltek 15kw + Livoltek (4 bat)',
    descripcion: '1× Inversor Livoltek 15kW · 4× Batería Livoltek HV · 1× BMS Livoltek',
    requiere: [
      { code: KIT_COMPONENT_CODES.INV_LIVOLTEK_15K, qty: 1 },
      { code: KIT_COMPONENT_CODES.BAT_LIVOLTEK, qty: 4 },
      { code: KIT_COMPONENT_CODES.BMS_LIVOLTEK, qty: 1 },
    ] },
  { id: 'K4B', tipo: 4, label: 'Kit 4B · Deye 15kw + Deye HV (4 bat)',
    descripcion: '1× Inversor Deye 15kW HV · 4× Batería Deye HV · 1× BMS Deye',
    requiere: [
      { code: KIT_COMPONENT_CODES.INV_DEYE_15K, qty: 1 },
      { code: KIT_COMPONENT_CODES.BAT_DEYE, qty: 4 },
      { code: KIT_COMPONENT_CODES.BMS_DEYE, qty: 1 },
    ] },
  { id: 'K4C', tipo: 4, label: 'Kit 4C · Livoltek 15kw + Livoltek (6 bat) + Top Cover',
    descripcion: '1× Inversor Livoltek 15kW · 6× Batería Livoltek HV · 1× BMS Livoltek · 1× Top Cover Livoltek',
    requiere: [
      { code: KIT_COMPONENT_CODES.INV_LIVOLTEK_15K, qty: 1 },
      { code: KIT_COMPONENT_CODES.BAT_LIVOLTEK, qty: 6 },
      { code: KIT_COMPONENT_CODES.BMS_LIVOLTEK, qty: 1 },
      { code: KIT_COMPONENT_CODES.TOP_LIVOLTEK, qty: 1 },
    ] },
];

// % de prioridad por tipo, por ciudad (bodega)
const PRIORITY_BY_CITY: Record<string, { 2: number; 3: number; 4: number }> = {
  'Cali':         { 2: 0.60, 3: 0.35, 4: 0.05 },
  'Barranquilla': { 2: 0.15, 3: 0.425, 4: 0.425 },
  'Cartagena':    { 2: 0.15, 3: 0.425, 4: 0.425 },
};
const DEFAULT_PRIORITY = { 2: 0.34, 3: 0.33, 4: 0.33 };

interface KitStock { [categoryCode: string]: number; }
interface KitResult {
  warehouseName: string;
  city: string;
  priority: { 2: number; 3: number; 4: number };
  initialStock: KitStock;
  kitsBuilt: Record<string, number>;   // { K2A: 5, K2B: 3, ... }
  remaining: KitStock;
  totalKits: number;
  byTipo: { 2: number; 3: number; 4: number };
}

/** Cuántos kits del tipo se pueden armar con el stock disponible (upper bound) */
function maxKitsFor(kit: KitDef, stock: KitStock): number {
  let m = Infinity;
  for (const req of kit.requiere) {
    const have = stock[req.code] ?? 0;
    m = Math.min(m, Math.floor(have / req.qty));
  }
  return m === Infinity ? 0 : m;
}

/** Descuenta el consumo de N kits del stock */
function consumeKits(kit: KitDef, n: number, stock: KitStock) {
  for (const req of kit.requiere) {
    stock[req.code] = (stock[req.code] ?? 0) - req.qty * n;
  }
}

/**
 * Weighted round-robin sobre KITS individuales.
 *
 * Este algoritmo mantiene el ratio T2/T3/T4 en tiempo real:
 *   1. En cada iteración, calcula el "déficit" de cada tipo:
 *        déficit = target% − (kits_actuales_del_tipo / total_kits_construidos)
 *   2. Elige el tipo con el mayor déficit y intenta armar un kit de ese tipo,
 *      alternando entre sus sub-kits (round-robin equitativo dentro del tipo).
 *   3. Si no puede armar de ese tipo por falta de stock, prueba el siguiente
 *      tipo con más déficit — así el algoritmo NUNCA se estanca mientras haya
 *      combinación viable en stock.
 *   4. Termina cuando ningún tipo puede armar más kits.
 *
 * Ventaja vs "presupuesto upfront": no sobreestima capacidad y respeta el
 * ratio real a medida que el stock se consume. Un cambio de T4 15%→5% SÍ se
 * refleja porque cada slot decide en tiempo real qué tipo va.
 */
function computeKits(city: string, warehouseName: string, initialStock: KitStock): KitResult {
  const prio = PRIORITY_BY_CITY[city] ?? DEFAULT_PRIORITY;
  const stock: KitStock = { ...initialStock };
  const kitsBuilt: Record<string, number> = {};
  const countByTipo: Record<2 | 3 | 4, number> = { 2: 0, 3: 0, 4: 0 };

  const attempt = (tipo: 2 | 3 | 4): boolean => {
    // Sub-kits del tipo, ordenados por menos-usado (round-robin equitativo)
    const kitsDelTipo = KIT_DEFS
      .filter((k) => k.tipo === tipo)
      .slice()
      .sort((a, b) => (kitsBuilt[a.id] ?? 0) - (kitsBuilt[b.id] ?? 0));
    for (const kit of kitsDelTipo) {
      if (maxKitsFor(kit, stock) >= 1) {
        consumeKits(kit, 1, stock);
        kitsBuilt[kit.id] = (kitsBuilt[kit.id] ?? 0) + 1;
        countByTipo[tipo]++;
        return true;
      }
    }
    return false;
  };

  // FASE 1 — Weighted round-robin respetando el ratio
  let total = 0;
  let progreso = true;
  while (progreso) {
    progreso = false;
    // Ordenar tipos por déficit descendente (el más atrás del target va primero)
    const denom = total + 1; // "si armo uno más, ¿cómo queda el ratio?"
    const ordenPorDeficit: Array<2 | 3 | 4> = ([2, 3, 4] as const)
      .slice()
      .sort((a, b) => {
        const deficitA = prio[a] - (countByTipo[a] / denom);
        const deficitB = prio[b] - (countByTipo[b] / denom);
        return deficitB - deficitA;
      });
    for (const tipo of ordenPorDeficit) {
      // Solo intentamos si este tipo aún tiene "target" > 0
      if (prio[tipo] <= 0) continue;
      if (attempt(tipo)) {
        total++;
        progreso = true;
        break;
      }
    }
  }

  // FASE 2 (deshabilitada): antes se aprovechaba el stock sobrante armando
  // todo lo que aún cupiera, pero eso distorsionaba el ratio pedido — en Cali
  // sobran ~10 Livoltek 15k y la fase 2 los volcaba a T4, subiendo su % a 50%+
  // aunque el target era 5%.
  //
  // Ahora el algoritmo respeta ESTRICTAMENTE el ratio de la ciudad, aunque
  // queden equipos sin asignar. Los equipos "sobrantes" siguen contando como
  // stock disponible en la tabla de detalle (columna 'Restante') para que
  // operaciones sepa cuánto queda.

  let totalKits = 0;
  for (const kit of KIT_DEFS) totalKits += kitsBuilt[kit.id] ?? 0;

  return { warehouseName, city, priority: prio, initialStock, kitsBuilt, remaining: stock, totalKits, byTipo: countByTipo };
}

interface WarehouseStock { id: string; code: string; name: string; city: string | null; stock: KitStock; }

function KitsTab() {
  const [results, setResults] = useState<KitResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        // Traer categorías, bodegas, consumables e items en paralelo
        const [rCats, rWh, rCons, rItems] = await Promise.all([
          fetch('/api/inventory/categories').then((r) => r.json()),
          fetch('/api/inventory/warehouses').then((r) => r.json()),
          fetch('/api/inventory/consumables').then((r) => r.json()),
          fetch('/api/inventory/items?status=in_stock&limit=5000').then((r) => r.json()),
        ]);

        const cats: Array<{ id: string; code: string }> = rCats.categories ?? [];
        const catCodeById = new Map(cats.map((c) => [c.id, c.code]));

        const warehouses: Array<{ id: string; code: string; name: string; city: string | null }> = rWh.warehouses ?? [];
        const stocksByWh = new Map<string, WarehouseStock>();
        for (const w of warehouses) {
          stocksByWh.set(w.id, { id: w.id, code: w.code, name: w.name, city: w.city, stock: {} });
        }

        // Consumables: sumar por (warehouse × categoría)
        const consumables: Array<{ warehouse_id: string | null; category_id: string | null; stock_quantity: number }> = rCons.consumables ?? [];
        for (const c of consumables) {
          if (!c.warehouse_id || !c.category_id) continue;
          const wh = stocksByWh.get(c.warehouse_id);
          const code = catCodeById.get(c.category_id);
          if (!wh || !code) continue;
          wh.stock[code] = (wh.stock[code] ?? 0) + Number(c.stock_quantity ?? 0);
        }

        // Items en status 'in_stock': +1 por unidad
        const items: Array<{ warehouse_id: string | null; category_id: string | null; status: string }> = rItems.items ?? [];
        for (const it of items) {
          if (it.status !== 'in_stock' || !it.warehouse_id || !it.category_id) continue;
          const wh = stocksByWh.get(it.warehouse_id);
          const code = catCodeById.get(it.category_id);
          if (!wh || !code) continue;
          wh.stock[code] = (wh.stock[code] ?? 0) + 1;
        }

        // Calcular kits para cada bodega. Derivar "city" del name si city no está seteado.
        const rs: KitResult[] = [];
        for (const wh of stocksByWh.values()) {
          const cityGuess = wh.city ?? (wh.name.includes('Cali') ? 'Cali'
            : wh.name.includes('Barranquilla') ? 'Barranquilla'
            : wh.name.includes('Cartagena') ? 'Cartagena' : 'Otro');
          rs.push(computeKits(cityGuess, wh.name, wh.stock));
        }
        // Ordenar Cali, Barranquilla, Cartagena, otros
        const order = ['Cali', 'Barranquilla', 'Cartagena'];
        rs.sort((a, b) => {
          const ia = order.indexOf(a.city); const ib = order.indexOf(b.city);
          return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        });
        setResults(rs);
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Error');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const COMPONENT_LABELS: Record<string, string> = {
    [KIT_COMPONENT_CODES.INV_LIVOLTEK_10K]: 'Inv. Livoltek 10kW',
    [KIT_COMPONENT_CODES.INV_LIVOLTEK_15K]: 'Inv. Livoltek 15kW',
    [KIT_COMPONENT_CODES.INV_DEYE_15K]:     'Inv. Deye 15kW HV',
    [KIT_COMPONENT_CODES.INV_DEYE_6K]:      'Inv. Deye 6kW LV',
    [KIT_COMPONENT_CODES.BAT_LIVOLTEK]:     'Bat. Livoltek HV',
    [KIT_COMPONENT_CODES.BAT_DEYE]:         'Bat. Deye HV',
    [KIT_COMPONENT_CODES.BAT_PYLONTECH]:    'Bat. Pylontech LV',
    [KIT_COMPONENT_CODES.BMS_LIVOLTEK]:     'BMS Livoltek',
    [KIT_COMPONENT_CODES.BMS_DEYE]:         'BMS Deye',
    [KIT_COMPONENT_CODES.BMS_PYLONTECH]:    'BMS Pylontech',
    [KIT_COMPONENT_CODES.TOP_LIVOLTEK]:     'Top Cover Livoltek',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Notas */}
      <div className="glass-panel" style={{ padding: 18, borderLeft: '4px solid #f59e0b' }}>
        <h3 style={{ margin: 0, fontSize: '0.95rem', color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Package size={16} /> Kits solares — simulación
        </h3>
        <p style={{ margin: '8px 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          Meramente informativo. Muestra cuántos kits completos se podrían armar con el stock actual de cada bodega,
          <strong> sin reutilizar equipos</strong>.
        </p>
        <ul style={{ margin: '10px 0 0', paddingLeft: 20, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          <li>Cali prioriza <strong>Tipo 2</strong> (60% / 35% / 5%). Barranquilla y Cartagena priorizan <strong>Tipo 3 y 4</strong> (15% / 42.5% / 42.5%).</li>
          <li>Solo las soluciones <strong>Livoltek</strong> se pueden poner Top Cover para hacer paralelo con baterías, y solo en <strong>Tipo 4</strong>.</li>
          <li>Cada kit lleva: <strong>1 Inversor + 1 BMS + Baterías según categoría</strong>.</li>
        </ul>
        <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-elevated)', borderRadius: 8, borderLeft: '3px solid var(--accent)' }}>
          <div style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6, letterSpacing: '0.03em' }}>
            ¿CÓMO SE ASIGNAN LOS KITS?
          </div>
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            <li><strong>Ratio como brújula.</strong> En cada iteración se calcula qué tipo está más lejos de su target (ej: si el target es 60% para T2 pero llevas 40%, tiene un déficit alto). El algoritmo elige el tipo con mayor déficit.</li>
            <li><strong>Round-robin dentro del tipo.</strong> Dentro del tipo elegido rota entre sus sub-kits (K2A → K2B → K2C → K2A…) armando el que menos veces se haya construido. Descuenta los componentes del stock. Los <strong>equipos no se reutilizan</strong>.</li>
            <li><strong>Fallback si no hay stock.</strong> Si el tipo con más déficit no puede armar ningún kit (falta un inversor, batería o BMS), prueba con el siguiente tipo con déficit. Nunca se estanca mientras haya algún kit viable.</li>
            <li><strong>Fin cuando ningún tipo puede armar.</strong> El algoritmo respeta <strong>estrictamente el % de la ciudad</strong>. Si tras terminar sobra stock (ej: 10 Livoltek 15k sin usar), se queda en stock — se ve en la columna "Restante" del detalle. No se fuerza a armar T4 solo para gastar equipos.</li>
          </ol>
        </div>
      </div>

      {/* Definición de kits (referencia visual) */}
      <div className="glass-panel" style={{ padding: 18 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: '0.95rem' }}>Categorías de kits</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
          {([2, 3, 4] as const).map((tipo) => (
            <div key={tipo} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#f59e0b', marginBottom: 6 }}>
                Solución Tipo {tipo}
              </div>
              {KIT_DEFS.filter((k) => k.tipo === tipo).map((kit) => (
                <div key={kit.id} style={{ marginBottom: 8, fontSize: '0.78rem' }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{kit.label}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: 2 }}>{kit.descripcion}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {loading && <div className="glass-panel" style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>Calculando kits…</div>}
      {err && <div className="alert-error">{err}</div>}

      {/* Resultados por bodega */}
      {!loading && results.map((r) => (
        <div key={r.warehouseName} className="glass-panel" style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Building2 size={18} style={{ color: '#0ea5e9' }} /> {r.warehouseName}
              </h3>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 3 }}>
                Ciudad: <strong>{r.city}</strong> · Prioridad:
                {' '}T2 {(r.priority[2] * 100).toFixed(0)}% · T3 {(r.priority[3] * 100).toFixed(0)}% · T4 {(r.priority[4] * 100).toFixed(0)}%
              </div>
            </div>
            <div style={{ background: '#f59e0b15', color: '#f59e0b', padding: '10px 16px', borderRadius: 10, fontWeight: 700 }}>
              <div style={{ fontSize: '0.72rem', letterSpacing: '0.05em' }}>KITS POSIBLES</div>
              <div style={{ fontSize: '1.6rem', lineHeight: 1 }}>{r.totalKits}</div>
            </div>
          </div>

          {/* Breakdown por tipo */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
            {([2, 3, 4] as const).map((tipo) => {
              const total = r.byTipo[tipo];
              const pct = r.totalKits > 0 ? Math.round((total / r.totalKits) * 100) : 0;
              return (
                <div key={tipo} style={{ padding: 12, background: 'var(--bg-elevated)', borderRadius: 10, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>Tipo {tipo}</div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 700, lineHeight: 1.1 }}>{total}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{pct}% del total</div>
                </div>
              );
            })}
          </div>

          {/* Desglose por sub-kit */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: 6 }}>
              DESGLOSE POR KIT
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
              {KIT_DEFS.map((kit) => {
                const built = r.kitsBuilt[kit.id] ?? 0;
                return (
                  <div key={kit.id} style={{ padding: 10, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '0.76rem', fontWeight: 600 }}>{kit.id} — Tipo {kit.tipo}</div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{kit.label.replace(/^Kit \w+ · /, '')}</div>
                    </div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: built > 0 ? '#f59e0b' : 'var(--text-muted)' }}>
                      {built}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Stock inicial vs consumido */}
          <details>
            <summary style={{ cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
              STOCK: INICIAL / CONSUMIDO / RESTANTE
            </summary>
            <table style={{ width: '100%', marginTop: 10, borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>Componente</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }}>Inicial</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }}>Usado</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }}>Restante</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(COMPONENT_LABELS).map(([code, label]) => {
                  const ini = r.initialStock[code] ?? 0;
                  const rem = r.remaining[code] ?? 0;
                  const usa = ini - rem;
                  if (ini === 0 && rem === 0) return null;
                  return (
                    <tr key={code} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '6px 8px' }}>{label}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{ini}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', color: usa > 0 ? '#f59e0b' : 'var(--text-muted)' }}>{usa}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>{rem}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </details>
        </div>
      ))}
    </div>
  );
}
