'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { Package, Plus, Upload, ScanLine, Search, Trash2, Pencil, History, AlertTriangle, Boxes, Tags, Cpu, Battery, Sun, Cable } from 'lucide-react';
import { BarcodeScanner } from '@/components/BarcodeScanner';

const supa = () => createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

type Tab = 'resumen' | 'equipos' | 'consumibles' | 'movimientos' | 'categorias';

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
  status: 'in_stock' | 'reserved' | 'installed' | 'in_repair' | 'rma' | 'decommissioned' | 'lost';
  current_location: string | null;
  current_house_id: string | null;
  acquired_at: string | null;
  supplier: string | null;
  warranty_expires_at: string | null;
  notes: string | null;
  created_at: string;
  inventory_categories?: { code: string; name: string; family: string } | null;
  client_houses?: { casa: string } | null;
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
  in_stock:        { label: 'En stock',       color: '#10b981' },
  reserved:        { label: 'Reservado',      color: '#3b82f6' },
  installed:       { label: 'Instalado',      color: '#07c5a8' },
  in_repair:       { label: 'En reparación',  color: '#f59e0b' },
  rma:             { label: 'RMA',            color: '#8b5cf6' },
  decommissioned:  { label: 'Decomisado',     color: '#94a3b8' },
  lost:            { label: 'Perdido',        color: '#ef4444' },
};

const FAMILY_ICONS: Record<string, typeof Cpu> = {
  inverter: Cpu, battery: Battery, panel: Sun, gateway: Cpu, meter: Cpu, cable: Cable, breaker: Cable, tool: Package, other: Package,
};

const FAMILY_LABELS: Record<string, string> = {
  inverter: 'Inversores', battery: 'Baterías', panel: 'Paneles', gateway: 'Gateways',
  meter: 'Medidores', cable: 'Cableado', breaker: 'Breakers', tool: 'Herramientas', other: 'Otros',
};

const TAB_META: Record<Tab, { label: string; color: string; Icon: typeof Cpu; description: string }> = {
  resumen:     { label: 'Resumen',     color: '#07c5a8', Icon: Boxes,    description: 'Indicadores y atención requerida del inventario.' },
  equipos:     { label: 'Equipos',     color: '#3b82f6', Icon: Cpu,      description: 'Catálogo de equipos serializados por número de fabricante.' },
  consumibles: { label: 'Consumibles', color: '#8b5cf6', Icon: Cable,    description: 'Cantidad disponible, umbrales de stock mínimo y ajustes.' },
  movimientos: { label: 'Movimientos', color: '#f59e0b', Icon: History,  description: 'Audit log de cada cambio: recepción, instalación, reparación, RMA.' },
  categorias:  { label: 'Categorías',  color: '#10b981', Icon: Tags,     description: 'Catálogo de modelos con valores por defecto (marca, capacidad, garantía).' },
};

export default function InventarioPage() {
  const [tab, setTab] = useState<Tab>('resumen');
  const [userEmail, setUserEmail] = useState<string>('');

  useEffect(() => {
    supa().auth.getUser().then(({ data }) => { if (data.user?.email) setUserEmail(data.user.email); });
  }, []);

  const meta = TAB_META[tab];

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', paddingBottom: 40 }}>
      {/* HEADER */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Package size={24} style={{ color: 'var(--accent)' }} />
          <h1 style={{ margin: 0 }}>Inventario</h1>
        </div>
        <p style={{ color: 'var(--text-secondary)', marginTop: 4, fontSize: '0.88rem' }}>
          Trazabilidad de equipos por serial del fabricante y consumibles, con audit log completo de cada movimiento.
        </p>
      </div>

      {/* TABS — primary navigation */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
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

      {/* Strip de identidad del tab activo */}
      <div className="glass-panel" style={{ padding: 16, borderLeft: `4px solid ${meta.color}`, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <meta.Icon size={26} style={{ color: meta.color, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{meta.label}</h2>
            <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>{meta.description}</p>
          </div>
        </div>
      </div>

      {tab === 'resumen' && <ResumenTab onJump={setTab} />}
      {tab === 'equipos' && <EquiposTab userEmail={userEmail} />}
      {tab === 'consumibles' && <ConsumiblesTab userEmail={userEmail} />}
      {tab === 'movimientos' && <MovimientosTab />}
      {tab === 'categorias' && <CategoriasTab />}
    </div>
  );
}

/* ═════════════ RESUMEN ═════════════ */
function ResumenTab({ onJump }: { onJump: (t: Tab) => void }) {
  const [items, setItems] = useState<InvItem[]>([]);
  const [consumables, setConsumables] = useState<Consumable[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [r1, r2] = await Promise.all([
        fetch('/api/inventory/items?limit=2000').then((r) => r.json()),
        fetch('/api/inventory/consumables').then((r) => r.json()),
      ]);
      setItems(r1.items ?? []);
      setConsumables(r2.consumables ?? []);
      setLoading(false);
    })();
  }, []);

  const stats = useMemo(() => {
    const byStatus: Record<string, number> = {};
    const byFamily: Record<string, number> = {};
    let warrantyExpiring = 0;
    const nowPlus60 = new Date(Date.now() + 60 * 86400000);
    for (const it of items) {
      byStatus[it.status] = (byStatus[it.status] ?? 0) + 1;
      const fam = it.inventory_categories?.family ?? 'other';
      byFamily[fam] = (byFamily[fam] ?? 0) + 1;
      if (it.warranty_expires_at && new Date(it.warranty_expires_at) < nowPlus60) warrantyExpiring++;
    }
    const lowStockList = consumables.filter((c) => c.stock_quantity <= c.min_threshold);
    return {
      byStatus, byFamily, warrantyExpiring,
      lowStockCount: lowStockList.length,
      lowStockList,
      inRepair: (byStatus.in_repair ?? 0) + (byStatus.rma ?? 0),
      totalItems: items.length,
      totalConsumables: consumables.length,
      maxFamilyCount: Math.max(1, ...Object.values(byFamily)),
      maxStatusCount: Math.max(1, ...Object.values(byStatus)),
    };
  }, [items, consumables]);

  if (loading) return <div className="glass-panel" style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Cargando…</div>;

  const empty = stats.totalItems === 0 && stats.totalConsumables === 0;
  const attentionItems = [
    stats.lowStockCount > 0 && { label: `${stats.lowStockCount} consumible${stats.lowStockCount === 1 ? '' : 's'} con stock bajo`, color: '#ef4444', tab: 'consumibles' as Tab, hint: 'Revisar y reponer' },
    stats.warrantyExpiring > 0 && { label: `${stats.warrantyExpiring} garantía${stats.warrantyExpiring === 1 ? '' : 's'} próxima${stats.warrantyExpiring === 1 ? '' : 's'} a vencer (≤ 60 días)`, color: '#ec4899', tab: 'equipos' as Tab, hint: 'Revisar antes que expiren' },
    stats.inRepair > 0 && { label: `${stats.inRepair} equipo${stats.inRepair === 1 ? '' : 's'} en reparación o RMA`, color: '#f59e0b', tab: 'equipos' as Tab, hint: 'Hacer seguimiento al taller' },
  ].filter(Boolean) as Array<{ label: string; color: string; tab: Tab; hint: string }>;

  return (
    <>
      {empty && (
        <div className="glass-panel" style={{ padding: 20, marginBottom: 14, borderLeft: '4px solid #f59e0b' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
            <AlertTriangle size={20} style={{ color: '#f59e0b' }} />
            <h3 style={{ margin: 0, fontSize: '1rem' }}>Inventario vacío</h3>
          </div>
          <p style={{ margin: '0 0 14px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            Aún no hay equipos ni consumibles registrados. Empieza dando de alta tu primer equipo serializado o cargando un CSV con varios.
          </p>
          <button onClick={() => onJump('equipos')} className="primary-btn">
            <Plus size={14} /> Ir a Equipos para registrar el primero
          </button>
        </div>
      )}

      {/* 1. Atención requerida — solo si hay algo accionable */}
      {attentionItems.length > 0 && (
        <div className="glass-panel" style={{ marginBottom: 14, borderLeft: '4px solid #ef4444', padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <AlertTriangle size={18} style={{ color: '#ef4444' }} />
            <h3 style={{ margin: 0, fontSize: '0.98rem' }}>Atención requerida</h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {attentionItems.map((a, i) => (
              <button key={i} onClick={() => onJump(a.tab)}
                style={{ background: 'var(--bg-elevated)', border: 'none', borderLeft: `3px solid ${a.color}`, borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', color: 'var(--text-primary)', textAlign: 'left' }}>
                <div>
                  <div style={{ fontSize: '0.88rem', fontWeight: 600 }}>{a.label}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>{a.hint}</div>
                </div>
                <span style={{ fontSize: '0.74rem', color: a.color, fontWeight: 600 }}>Ir a {TAB_META[a.tab].label} →</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 2. KPIs principales — vista de portafolio en 4 cards iguales */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 14 }}>
        <KpiCard label="Equipos totales" value={stats.totalItems} sub={`${stats.byStatus.installed ?? 0} instalados`} color="#07c5a8" Icon={Cpu} />
        <KpiCard label="En stock (bodega)" value={stats.byStatus.in_stock ?? 0} sub="Listos para instalar" color="#10b981" Icon={Boxes} />
        <KpiCard label="En reparación / RMA" value={stats.inRepair} sub={stats.inRepair === 0 ? 'Todo operando' : 'Fuera de servicio'} color="#f59e0b" Icon={AlertTriangle} />
        <KpiCard label="Consumibles" value={stats.totalConsumables} sub={`${stats.lowStockCount} con stock bajo`} color="#8b5cf6" Icon={Cable} />
      </div>

      {/* 3. Distribución por estado y por familia, lado a lado */}
      {stats.totalItems > 0 && (
        <div className="dist-grid" style={{ marginBottom: 14 }}>
          <div className="glass-panel">
            <h3 style={{ margin: 0, marginBottom: 14, fontSize: '0.95rem' }}>Equipos por estado</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Object.entries(STATUS_META).map(([key, meta]) => {
                const count = stats.byStatus[key] ?? 0;
                if (count === 0) return null;
                const pct = (count / stats.maxStatusCount) * 100;
                return (
                  <div key={key}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{meta.label}</span>
                      <span style={{ fontSize: '0.78rem', fontWeight: 700, color: meta.color, fontFamily: 'ui-monospace, monospace' }}>{count}</span>
                    </div>
                    <div style={{ height: 8, background: 'var(--bg-elevated)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: meta.color, borderRadius: 4, transition: 'width 0.3s' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="glass-panel">
            <h3 style={{ margin: 0, marginBottom: 14, fontSize: '0.95rem' }}>Equipos por familia</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {Object.entries(stats.byFamily).sort((a, b) => b[1] - a[1]).map(([fam, count]) => {
                const Icon = FAMILY_ICONS[fam] ?? Package;
                const pct = (count / stats.maxFamilyCount) * 100;
                return (
                  <div key={fam}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4, gap: 8 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', fontWeight: 600 }}>
                        <Icon size={14} style={{ color: 'var(--accent)' }} /> {FAMILY_LABELS[fam] ?? fam}
                      </span>
                      <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--accent)', fontFamily: 'ui-monospace, monospace' }}>{count}</span>
                    </div>
                    <div style={{ height: 8, background: 'var(--bg-elevated)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', borderRadius: 4 }} />
                    </div>
                  </div>
                );
              })}
              {Object.keys(stats.byFamily).length === 0 && (
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Aún sin equipos clasificados por familia.</div>
              )}
            </div>
          </div>

          <style jsx>{`
            .dist-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
            @media (max-width: 768px) { .dist-grid { grid-template-columns: 1fr; } }
          `}</style>
        </div>
      )}

      {/* 4. Acciones rápidas — el siguiente paso natural */}
      <div className="glass-panel" style={{ padding: 18 }}>
        <h3 style={{ margin: 0, marginBottom: 4, fontSize: '0.95rem' }}>Siguientes acciones</h3>
        <p style={{ margin: '0 0 14px', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
          Lo más común que vas a hacer aquí:
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          <ActionLink onClick={() => onJump('equipos')} color="#3b82f6" Icon={Plus} label="Registrar un equipo" hint="Manual, CSV, cámara o pistola" />
          <ActionLink onClick={() => onJump('consumibles')} color="#8b5cf6" Icon={Cable} label="Ajustar stock de consumibles" hint="Entradas, salidas, ajustes" />
          <ActionLink onClick={() => onJump('movimientos')} color="#f59e0b" Icon={History} label="Ver audit log" hint="Cada cambio queda registrado" />
        </div>
      </div>
    </>
  );
}

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

function ActionLink({ onClick, color, Icon, label, hint }: { onClick: () => void; color: string; Icon: typeof Cpu; label: string; hint: string }) {
  return (
    <button onClick={onClick}
      style={{ background: 'var(--bg-elevated)', border: 'none', borderLeft: `3px solid ${color}`, borderRadius: 8, padding: 14, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, color: 'var(--text-primary)' }}>
      <Icon size={18} style={{ color, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.86rem', fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 2 }}>{hint}</div>
      </div>
    </button>
  );
}

/* ═════════════ EQUIPOS ═════════════ */
function EquiposTab({ userEmail }: { userEmail: string }) {
  const [items, setItems] = useState<InvItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [statusItem, setStatusItem] = useState<InvItem | null>(null);
  const [historyItem, setHistoryItem] = useState<InvItem | null>(null);

  const load = async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '500' });
    if (filterStatus !== 'all') params.set('status', filterStatus);
    if (search) params.set('q', search);
    const r = await fetch(`/api/inventory/items?${params}`);
    const j = await r.json();
    setItems(j.items ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filterStatus, search]);

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
          <div style={{ marginTop: 10, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Mostrando <strong style={{ color: 'var(--text-primary)' }}>{items.length}</strong> equipo{items.length === 1 ? '' : 's'}
            {(filterStatus !== 'all' || search) && ' (con filtros aplicados)'}
          </div>
        )}
      </div>

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
                  <th>Serial</th>
                  <th>Categoría</th>
                  <th>Marca / Modelo</th>
                  <th>Estado</th>
                  <th>Ubicación</th>
                  <th>Garantía</th>
                  <th style={{ textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const meta = STATUS_META[it.status];
                  return (
                    <tr key={it.id}>
                      <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem', fontWeight: 600 }}>{it.serial_number}</td>
                      <td style={{ fontSize: '0.78rem' }}>{it.inventory_categories?.name ?? '—'}</td>
                      <td style={{ fontSize: '0.78rem' }}>{[it.brand, it.model].filter(Boolean).join(' · ') || '—'}</td>
                      <td>
                        <span style={{ padding: '2px 10px', borderRadius: 10, background: meta.color + '20', color: meta.color, fontSize: '0.7rem', fontWeight: 700 }}>{meta.label}</span>
                      </td>
                      <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        {it.client_houses?.casa ?? it.current_location ?? '—'}
                      </td>
                      <td style={{ fontSize: '0.78rem', fontFamily: 'ui-monospace, monospace' }}>
                        {it.warranty_expires_at ?? '—'}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
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
  { key: 'repair_start',     label: 'A reparación',    color: '#f59e0b' },
  { key: 'repair_end',       label: 'Repar. cerrada',  color: '#10b981' },
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

  if (loading) return <div className="glass-panel" style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Cargando…</div>;
  if (items.length === 0) return <div className="alert-warning" style={{ fontSize: '0.85rem' }}>No hay categorías registradas. Las categorías sirven como plantilla para autocompletar marca, modelo, capacidad y garantía al dar de alta un equipo.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {byFamily.map(([family, cats]) => {
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
                    <th>Marca / Modelo default</th>
                    <th>Capacidad</th>
                    <th>Garantía</th>
                    <th style={{ textAlign: 'right', width: 60 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {cats.map((c) => (
                    <tr key={c.id}>
                      <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.76rem', fontWeight: 600 }}>{c.code}</td>
                      <td style={{ fontSize: '0.82rem' }}>{c.name}</td>
                      <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{[c.default_brand, c.default_model].filter(Boolean).join(' · ') || '—'}</td>
                      <td style={{ fontSize: '0.78rem', fontFamily: 'ui-monospace, monospace' }}>{c.default_capacity_value ? `${c.default_capacity_value} ${c.default_capacity_unit ?? ''}` : '—'}</td>
                      <td style={{ fontSize: '0.78rem' }}>{c.default_warranty_months ? `${c.default_warranty_months} m` : '—'}</td>
                      <td style={{ textAlign: 'right' }}>
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
        : status === 'rma' ? 'supplier_rma'
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

      {!needsHouse && status !== 'in_stock' && status !== 'rma' && status !== 'in_repair' && (
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
