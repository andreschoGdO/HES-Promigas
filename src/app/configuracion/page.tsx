'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Server, Key, CheckCircle2, AlertCircle, Clock, RefreshCw, EyeOff, Eye } from 'lucide-react';
import { classifyDevice } from '@/lib/classify-device';
import { readVisibility, writeVisibility, MENU_ITEM_CATALOG, ALWAYS_VISIBLE_IDS, type SidebarVisibility } from '@/lib/sidebar-visibility';

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
    </>
  );
}

/* ---------------- Visibility del menú lateral ---------------- */
function SidebarVisibilityCard() {
  const [vis, setVis] = useState<SidebarVisibility>({});

  useEffect(() => { setVis(readVisibility()); }, []);

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
        Oculta secciones que no usas para tener un menú más limpio. Esta preferencia se guarda en este navegador. Inicio y Configuración API siempre quedan visibles (escape hatch).
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

