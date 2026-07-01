'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Server, Key, CheckCircle2, AlertCircle, Clock, RefreshCw, EyeOff, Eye, Copy, Code, ChevronDown, ChevronUp } from 'lucide-react';
import { classifyDevice } from '@/lib/classify-device';
import { readVisibility, fetchVisibility, writeVisibility, MENU_ITEM_CATALOG, ALWAYS_VISIBLE_IDS, type SidebarVisibility } from '@/lib/sidebar-visibility';

export default function Configuracion() {
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>Configuración del Sistema</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>
            Administración de credenciales, sincronización con Metrum y visibilidad del menú lateral.
          </p>
        </div>
      </div>

      <ConexionTab />
      <SidebarVisibilityCard />
      <ApiDocsCard />
    </>
  );
}

/* ============================================================
 *  Documentación de APIs y arquitectura
 * ============================================================ */

interface EndpointDef {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  auth: 'none' | 'session' | 'key';
  desc: string;
  notes?: string;
  /** ID del módulo del menú lateral al que pertenece este endpoint.
   *  Si está oculto en la sidebar, este endpoint se omite del listado. */
  module?: keyof SidebarVisibility;
}

const ENDPOINTS_INTERNAL: EndpointDef[] = [
  { method: 'GET',  path: '/api/sync/status',                   auth: 'none', module: 'dashboard',     desc: 'Timestamps de la última escritura de cada cron (15min, daily, devices).' },
  { method: 'POST', path: '/api/cron/sync?quick=1',             auth: 'key',  module: 'dashboard',     desc: 'Disparo manual de sincronización rápida (devices + lazo instantáneo). Auth: header Authorization: Bearer $CRON_SECRET.' },
  { method: 'POST', path: '/api/cron/instant-check',            auth: 'key',  module: 'dashboard',     desc: 'Lazo de 15 min: lee Metrum, escribe instant_metrics, evalúa alertas.' },
  { method: 'GET',  path: '/api/crm/projects',                  auth: 'session', module: 'operaciones', desc: 'Lista proyectos CRM (filtro por module/stage/q).' },
  { method: 'POST', path: '/api/crm/projects',                  auth: 'session', module: 'operaciones', desc: 'Crea un proyecto directo en Operaciones (etapa por defecto: dimensionado).' },
  { method: 'POST', path: '/api/crm/projects/bulk',             auth: 'session', module: 'operaciones', desc: 'Import masivo CSV — recibe { rows, created_by, module }. Devuelve { inserted, total, errors }.' },
  { method: 'POST', path: '/api/crm/projects/[id]/transition',  auth: 'session', module: 'operaciones', desc: 'Avanza etapa de un proyecto con campos requeridos.' },
  { method: 'GET',  path: '/api/crm/stage-fields',              auth: 'session', module: 'operaciones', desc: 'Configuración de campos por etapa (con seed automático en primer uso).' },
  { method: 'GET',  path: '/api/reports?type=...',              auth: 'session', module: 'reportes',   desc: 'Genera reportes (operacion, reactiva, alertas, inventario, pipeline, ejecutivo).' },
  { method: 'GET',  path: '/api/inventory/items',               auth: 'session', module: 'inventario', desc: 'Catálogo de equipos serializados con filtros.' },
  { method: 'GET',  path: '/api/inventory/movements',           auth: 'session', module: 'inventario', desc: 'Audit log de movimientos de inventario.' },
  { method: 'POST', path: '/api/inventory/reservations',        auth: 'session', module: 'inventario', desc: 'Crear reserva de equipos para una visita planeada.' },
  { method: 'GET',  path: '/api/alerts/events',                 auth: 'session', module: 'dashboard',  desc: 'Eventos de alertas disparadas (NAR vive dentro del dashboard).' },
  { method: 'GET',  path: '/api/alerts/top?days=N',             auth: 'session', module: 'dashboard',  desc: 'Top alertas más frecuentes en N días por regla+casa.' },
  { method: 'GET',  path: '/api/alerts/rules',                  auth: 'session', module: 'dashboard',  desc: 'CRUD de reglas de alerta.' },
  { method: 'GET',  path: '/api/visits',                        auth: 'session', module: 'visitas',    desc: 'CRUD de visitas en campo (previa, instalación, emergencia, normalización).' },
  { method: 'GET',  path: '/api/metrum/devices',                auth: 'session', module: 'dashboard',  desc: 'Listado raw de devices desde Metrum (proxy).' },
  { method: 'GET',  path: '/api/metrum/timeseries',             auth: 'session', module: 'dashboard',  desc: 'Series de tiempo crudas desde Metrum para granular charts.' },
  { method: 'GET',  path: '/api/metrum/keys',                   auth: 'session', module: 'dashboard',  desc: 'Lista las keys de timeseries disponibles para un device.' },
];

function methodColor(m: string): string {
  return m === 'GET' ? '#3b82f6' : m === 'POST' ? '#10b981' : m === 'PATCH' ? '#f59e0b' : '#ef4444';
}

function ApiDocsCard() {
  const [expanded, setExpanded] = useState(true);
  const [vis, setVis] = useState<SidebarVisibility>({});
  useEffect(() => {
    setVis(readVisibility());
    const handler = () => setVis(readVisibility());
    window.addEventListener('sidebar-visibility-change', handler);
    return () => window.removeEventListener('sidebar-visibility-change', handler);
  }, []);
  // Función que decide si un endpoint/módulo está activo
  const isModuleVisible = (id: keyof SidebarVisibility | undefined): boolean => {
    if (!id) return true; // sin tag = neutral, no filtrar
    if (ALWAYS_VISIBLE_IDS.has(id as string)) return true;
    return vis[id] !== false;
  };

  return (
    <div className="glass-panel" style={{ marginTop: 20 }}>
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-primary)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Code size={18} style={{ color: 'var(--text-secondary)' }} />
          <h2 className="card-title" style={{ margin: 0 }}>API y documentación del sistema</h2>
        </div>
        {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>
      {!expanded && (
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '8px 0 0' }}>
          Cómo integrar otras apps, qué endpoints están disponibles, y qué hace cada módulo de SUNNY APP.
        </p>
      )}

      {expanded && (
        <>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '8px 0 16px' }}>
            Endpoints internos de SUNNY APP + listado de módulos activos.
          </p>
          <InternalApiSection isModuleVisible={isModuleVisible} />
          <div style={{ marginTop: 20 }}>
            <ModulesSection isModuleVisible={isModuleVisible} />
          </div>
        </>
      )}
    </div>
  );
}
/* ───── Lista de endpoints internos ───── */
function InternalApiSection({ isModuleVisible }: { isModuleVisible: (id: keyof SidebarVisibility | undefined) => boolean }) {
  const filteredInternal = ENDPOINTS_INTERNAL.filter((e) => isModuleVisible(e.module));
  const totalHidden = ENDPOINTS_INTERNAL.length - filteredInternal.length;

  return (
    <div>
      <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '0 0 12px' }}>
        Endpoints internos de SUNNY APP. <strong>session</strong> = requiere sesión de usuario activa. <strong>key</strong> = requiere env var como <code>CRON_SECRET</code>. <strong>none</strong> = público.
      </p>
      {totalHidden > 0 && (
        <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', margin: '0 0 12px', fontStyle: 'italic' }}>
          Filtrado por menús activos: {totalHidden} endpoint{totalHidden === 1 ? '' : 's'} oculto{totalHidden === 1 ? '' : 's'} (pertenece{totalHidden === 1 ? '' : 'n'} a módulos deshabilitados en la sidebar).
        </p>
      )}

      {filteredInternal.length > 0 ? (
        <EndpointTable endpoints={filteredInternal} />
      ) : (
        <div className="alert-warning" style={{ fontSize: '0.82rem' }}>
          Todos los endpoints están ocultos porque sus módulos están deshabilitados en la sidebar. Vuelve a activar módulos en &quot;Visibilidad del menú lateral&quot;.
        </div>
      )}

      <div className="alert-warning" style={{ fontSize: '0.78rem', marginTop: 14 }}>
        <strong>Nota:</strong> los endpoints internos usan cookies de sesión Supabase. No se pueden llamar desde otra app sin un usuario autenticado.
      </div>
    </div>
  );
}

function EndpointTable({ endpoints }: { endpoints: EndpointDef[] }) {
  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
      <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--bg-elevated)' }}>
            <th style={{ textAlign: 'left', padding: '8px 10px', width: 70 }}>Method</th>
            <th style={{ textAlign: 'left', padding: '8px 10px' }}>Ruta</th>
            <th style={{ textAlign: 'left', padding: '8px 10px', width: 90 }}>Auth</th>
            <th style={{ textAlign: 'left', padding: '8px 10px' }}>Qué hace</th>
          </tr>
        </thead>
        <tbody>
          {endpoints.map((e, i) => (
            <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '8px 10px' }}>
                <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.7rem', fontWeight: 700, color: methodColor(e.method), background: methodColor(e.method) + '20', padding: '2px 8px', borderRadius: 4 }}>{e.method}</span>
              </td>
              <td style={{ padding: '8px 10px', fontFamily: 'ui-monospace, monospace', fontSize: '0.74rem' }}>{e.path}</td>
              <td style={{ padding: '8px 10px' }}>
                <span style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: 4, background: e.auth === 'none' ? '#dcfce7' : e.auth === 'key' ? '#fef3c7' : '#dbeafe', color: e.auth === 'none' ? '#166534' : e.auth === 'key' ? '#92400e' : '#1e40af', fontWeight: 600 }}>
                  {e.auth}
                </span>
              </td>
              <td style={{ padding: '8px 10px', color: 'var(--text-secondary)' }}>
                {e.desc}
                {e.notes && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>{e.notes}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ───── Sección 3: módulos y arquitectura ───── */
function ModulesSection({ isModuleVisible }: { isModuleVisible: (id: keyof SidebarVisibility | undefined) => boolean }) {
  const allModules: Array<{ id: keyof SidebarVisibility; path: string; name: string; desc: string }> = [
    { id: 'dashboard',     path: '/dashboard',     name: 'Head End System',         desc: 'Operación diaria de la flota: vista granular multi-device, CREG mensual, alertas por casa, control manual de inversor.' },
    { id: 'operaciones',   path: '/operaciones',   name: 'Construcción',            desc: 'Dimensionado, alistamiento de inventario (reserva auto), instalación con contratista, operativo. Import masivo vía CSV.' },
    { id: 'visitas',       path: '/visitas',       name: 'Visitas en Campo',        desc: '4 tipos de acta (previa, instalación, emergencia, normalización) con fotos, GPS, PDF y handoff bidireccional con inventario.' },
    { id: 'inventario',    path: '/inventario',    name: 'Inventario (WMS-lite)',   desc: 'Equipos por serial, consumibles con stock bajo, ubicaciones jerárquicas, reservas por visita, audit log completo.' },
    { id: 'reportes',      path: '/reportes',      name: 'Reportes',                desc: 'Reportes operativos con descarga CSV + vista imprimible.' },
    { id: 'configuracion', path: '/configuracion', name: 'Configuración API',       desc: 'Conexión Metrum, visibilidad del menú, esta documentación.' },
  ];
  const visibleModules = allModules.filter((m) => isModuleVisible(m.id));
  const totalHidden = allModules.length - visibleModules.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <DocBlock title="Stack">
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.82rem', lineHeight: 1.7 }}>
          <li><strong>Frontend:</strong> Next.js 16 (App Router) + React 19 + TypeScript</li>
          <li><strong>Base de datos:</strong> Supabase Postgres (13+ tablas, audit log completo)</li>
          <li><strong>Auth:</strong> Supabase Auth (email + password, dominio @gdo.com.co / @promigas.com)</li>
          <li><strong>Storage:</strong> Supabase Storage (bucket privado <code>visit-photos</code> + signed URLs)</li>
          <li><strong>Backend de datos:</strong> Metrum (ThingsBoard) — 28 casas × 4 devices = 112 dispositivos</li>
          <li><strong>Crons:</strong> Vercel Cron diario (06:00 UTC) + GitHub Actions cada 15 min (lazo instantáneo)</li>
          <li><strong>Hosting:</strong> Vercel (auto-deploy desde main)</li>
        </ul>
      </DocBlock>

      <DocBlock title={`Módulos (${visibleModules.length} activos${totalHidden > 0 ? ` · ${totalHidden} ocultos` : ''})`}>
        {totalHidden > 0 && (
          <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', margin: '0 0 8px', fontStyle: 'italic' }}>
            Solo se muestran los módulos visibles en la sidebar. Para ver todos, activa más en "Visibilidad del menú lateral".
          </p>
        )}
        <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg-elevated)' }}>
              <th style={{ textAlign: 'left', padding: '8px 10px' }}>Módulo</th>
              <th style={{ textAlign: 'left', padding: '8px 10px' }}>Ruta</th>
              <th style={{ textAlign: 'left', padding: '8px 10px' }}>Qué hace</th>
            </tr>
          </thead>
          <tbody>
            {visibleModules.map((m) => (
              <ModRow key={m.id} path={m.path} name={m.name}>{m.desc}</ModRow>
            ))}
          </tbody>
        </table>
      </DocBlock>

      <DocBlock title="Flujos de datos">
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.82rem', lineHeight: 1.7 }}>
          <li><strong>06:00 UTC diario:</strong> Vercel Cron → /api/cron/sync → trae cierres del día anterior, recalcula daily_casa_metrics, evalúa reglas diarias y mensuales (CREG).</li>
          <li><strong>Cada 15 min:</strong> GitHub Actions → /api/cron/instant-check → trae powerAI/RI, corrientes, voltajes, SOC batería; calcula cos φ y desbalances; evalúa reglas instantáneas + agregadas 24h.</li>
          <li><strong>Visita instalación completada:</strong> el evaluador busca seriales del form, los marca como installed en la casa + crea movimiento en inventory_movements.</li>
          <li><strong>Reserva confirmada + visita instalación:</strong> al cerrar la visita, los items reservados pasan directo a installed (no hay que tipear seriales).</li>
          <li><strong>Sales firmado:</strong> handoff automático a Engineering. Engineering aprueba → Operations dimensionado → alistamiento → instalación → operativo → cerrado.</li>
        </ul>
      </DocBlock>
    </div>
  );
}

/* ───── Helpers de presentación ───── */
function DocBlock({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ padding: 14, background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        {icon}
        <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 700 }}>{title}</h3>
      </div>
      <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>{children}</div>
    </div>
  );
}

function CodeBlock({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  const copy = () => {
    if (typeof children === 'string') {
      navigator.clipboard?.writeText(children).catch(() => {});
    }
  };
  return (
    <div style={{ position: 'relative', ...style }}>
      <pre style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '12px 14px', fontSize: '0.74rem', fontFamily: 'ui-monospace, monospace', overflow: 'auto', margin: 0, lineHeight: 1.5, color: 'var(--text-primary)' }}>{children}</pre>
      {typeof children === 'string' && (
        <button onClick={copy} title="Copiar" style={{ position: 'absolute', top: 8, right: 8, padding: 4, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', color: 'var(--text-muted)' }}>
          <Copy size={12} />
        </button>
      )}
    </div>
  );
}

function FieldRow({ name, type, required, children }: { name: string; type: string; required?: boolean; children: React.ReactNode }) {
  return (
    <tr style={{ borderTop: '1px solid var(--border)' }}>
      <td style={{ padding: '6px 10px', fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>
        {name}{required && <span style={{ color: '#ef4444', marginLeft: 3 }}>*</span>}
      </td>
      <td style={{ padding: '6px 10px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{type}</td>
      <td style={{ padding: '6px 10px', fontSize: '0.76rem' }}>{children}</td>
    </tr>
  );
}

function ModRow({ path, name, children }: { path: string; name: string; children: React.ReactNode }) {
  return (
    <tr style={{ borderTop: '1px solid var(--border)' }}>
      <td style={{ padding: '6px 10px', fontWeight: 600, fontSize: '0.8rem' }}>{name}</td>
      <td style={{ padding: '6px 10px', fontFamily: 'ui-monospace, monospace', fontSize: '0.74rem', color: 'var(--accent)' }}>{path}</td>
      <td style={{ padding: '6px 10px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{children}</td>
    </tr>
  );
}

/* ---------------- Visibility del menú lateral ---------------- */
function SidebarVisibilityCard() {
  const [vis, setVis] = useState<SidebarVisibility>({});

  useEffect(() => {
    setVis(readVisibility());
    void fetchVisibility().then(setVis);
  }, []);

  const toggle = (id: keyof SidebarVisibility) => {
    if (ALWAYS_VISIBLE_IDS.has(id)) return;
    const cur = (vis[id] !== false);
    const next = { ...vis, [id]: !cur };
    setVis(next);
    writeVisibility(next);
  };

  const resetAll = () => {
    const empty: SidebarVisibility = {};
    setVis(empty);
    writeVisibility(empty);
  };

  const general = MENU_ITEM_CATALOG.filter((i) => i.group === 'general');
  const sistema = MENU_ITEM_CATALOG.filter((i) => i.group === 'sistema');

  return (
    <div className="glass-panel" style={{ marginTop: 20 }}>
      <div className="card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Eye size={18} style={{ color: 'var(--text-secondary)' }} />
          <h2 className="card-title">Visibilidad del menú lateral</h2>
        </div>
      </div>
      <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', marginBottom: 14 }}>
        Oculta secciones que no usas para tener un menú más limpio. <strong>Esta configuración es global</strong> — se aplica a todos los usuarios de la cuenta. Inicio y Configuración API siempre quedan visibles (escape hatch).
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 18 }}>
        <VisibilityGroup label="General" items={general} vis={vis} onToggle={toggle} />
        <VisibilityGroup label="Sistema" items={sistema} vis={vis} onToggle={toggle} />
      </div>

      <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={resetAll} className="secondary-btn" style={{ fontSize: '0.78rem', padding: '6px 12px' }}>
          <RefreshCw size={12} /> Mostrar todos
        </button>
      </div>
    </div>
  );
}

function VisibilityGroup({ label, items, vis, onToggle }: {
  label: string;
  items: typeof MENU_ITEM_CATALOG;
  vis: SidebarVisibility;
  onToggle: (id: keyof SidebarVisibility) => void;
}) {
  return (
    <div>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((it) => {
          const locked = ALWAYS_VISIBLE_IDS.has(it.id);
          const visible = vis[it.id] !== false;
          return (
            <label key={it.id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 12px',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              cursor: locked ? 'not-allowed' : 'pointer',
              opacity: locked ? 0.6 : 1,
            }}>
              <input
                type="checkbox"
                checked={visible}
                disabled={locked}
                onChange={() => onToggle(it.id)}
                style={{ width: 16, height: 16 }}
              />
              <span style={{ flex: 1, fontSize: '0.86rem', fontWeight: visible ? 600 : 500, color: visible ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                {it.label}
              </span>
              {locked ? (
                <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 600 }}>Siempre visible</span>
              ) : visible ? (
                <Eye size={14} style={{ color: 'var(--accent)' }} />
              ) : (
                <EyeOff size={14} style={{ color: 'var(--text-muted)' }} />
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- TAB: Conexión ---------------- */

interface SyncStats {
  total: number;
  inverters: number;
  meters: number;
  gateways: number;
  lastSeen: string | null;
}

const formatDateTime = (iso: string | null): string => {
  if (!iso) return 'Sin datos';
  const d = new Date(iso);
  return d.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
};

const relativeTime = (iso: string | null): string => {
  if (!iso) return '';
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return 'hace instantes';
  if (diffMin < 60) return `hace ${diffMin} min`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} día${d > 1 ? 's' : ''}`;
};

function ConexionTab() {
  const [stats, setStats] = useState<SyncStats | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [connectionOk, setConnectionOk] = useState<boolean | null>(null);

  const loadStats = async () => {
    const { data, error } = await supabase
      .from('devices')
      .select('type, name, marca, modelo, last_seen_at');
    if (error) {
      console.error(error);
      return;
    }
    const rows = data ?? [];
    let inverters = 0, meters = 0, gateways = 0;
    let lastSeen: string | null = null;
    for (const r of rows) {
      const cat = classifyDevice(r as { type: string | null; name: string | null; marca: string | null; modelo: string | null });
      if (cat === 'inverter') inverters++;
      else if (cat === 'meter') meters++;
      else if (cat === 'gateway') gateways++;
      if (r.last_seen_at && (!lastSeen || r.last_seen_at > lastSeen)) lastSeen = r.last_seen_at;
    }
    setStats({ total: rows.length, inverters, meters, gateways, lastSeen });
  };

  useEffect(() => {
    loadStats();
  }, []);

  const handleTest = async () => {
    setTesting(true);
    setMsg(null);
    try {
      const res = await fetch('/api/metrum/devices');
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setConnectionOk(true);
      setMsg({ kind: 'success', text: `Conexión OK · ${json.raw?.totalElements ?? 0} entidades visibles en Metrum.` });
    } catch (e) {
      setConnectionOk(false);
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Error' });
    } finally {
      setTesting(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setMsg(null);
    try {
      const res = await fetch('/api/devices/sync');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Error');
      setMsg({ kind: 'success', text: `Sincronización completa · ${json.inserted ?? 0} dispositivos.` });
      await loadStats();
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Error' });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
      <div className="glass-panel">
        <div className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Server size={18} className="text-accent" />
            <h2 className="card-title">Conexión API Metrum</h2>
          </div>
        </div>

        <div className="input-group">
          <label className="input-label">URL Base</label>
          <input type="text" readOnly value="https://monitoreo-metrum.com" />
        </div>

        <div className="input-group">
          <label className="input-label">Usuario (Email)</label>
          <input type="email" readOnly value="davider@gdo.com.co" />
        </div>

        <div className="input-group">
          <label className="input-label">Contraseña</label>
          <input type="password" readOnly value="••••••••••••••" />
        </div>

        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
          Las credenciales se configuran vía variables de entorno (<code>METRUM_USERNAME</code> / <code>METRUM_PASSWORD</code>) en el servidor.
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button className="secondary-btn" onClick={handleTest} disabled={testing}>
            <Key size={14} /> {testing ? 'Probando...' : 'Probar conexión'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {connectionOk === true && (
          <div className="alert-success">
            <CheckCircle2 size={18} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong style={{ display: 'block', marginBottom: '2px' }}>Conexión establecida</strong>
              <span style={{ fontSize: '0.8rem', fontWeight: 400 }}>
                El token JWT actual es válido. La comunicación con la API REST de Metrum está operativa.
              </span>
            </div>
          </div>
        )}
        {connectionOk === false && (
          <div className="alert-error">
            <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong style={{ display: 'block', marginBottom: '2px' }}>Sin conexión</strong>
              <span style={{ fontSize: '0.8rem', fontWeight: 400 }}>
                No se pudo autenticar contra Metrum. Verifica credenciales en el servidor.
              </span>
            </div>
          </div>
        )}

        {msg && msg.kind === 'success' && connectionOk === null && (
          <div className="alert-success">{msg.text}</div>
        )}
        {msg && msg.kind === 'error' && (
          <div className="alert-error">{msg.text}</div>
        )}

        <div className="glass-panel" style={{ flex: 1 }}>
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Clock size={18} style={{ color: 'var(--text-secondary)' }} />
              <h2 className="card-title">Sincronización de datos</h2>
            </div>
          </div>

          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '16px' }}>
            La sincronización lee los dispositivos visibles para el usuario en Metrum y persiste sus atributos (marca, modelo, ubicación, etc.) en Supabase.
          </p>

          <div className="table-container" style={{ marginBottom: '16px' }}>
            <table>
              <tbody>
                <tr>
                  <td style={{ width: '50%', color: 'var(--text-muted)' }}>Última actividad registrada</td>
                  <td>
                    <strong>{formatDateTime(stats?.lastSeen ?? null)}</strong>
                    {stats?.lastSeen && <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: '0.8rem' }}>({relativeTime(stats.lastSeen)})</span>}
                  </td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--text-muted)' }}>Total dispositivos</td>
                  <td><strong>{stats?.total ?? '—'}</strong></td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--text-muted)' }}>Desglose</td>
                  <td>
                    {stats
                      ? `${stats.inverters} Inversores · ${stats.meters} Medidores · ${stats.gateways} Módems`
                      : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <button className="primary-btn" onClick={handleSync} disabled={syncing} style={{ width: '100%' }}>
            <RefreshCw size={14} /> {syncing ? 'Sincronizando...' : 'Forzar sincronización manual'}
          </button>
        </div>
      </div>
    </div>
  );
}

