'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Server, Key, CheckCircle2, AlertCircle, Clock, RefreshCw } from 'lucide-react';
import { classifyDevice } from '@/lib/classify-device';

export default function Configuracion() {
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>Configuración del Sistema</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>
            Administración de credenciales y sincronización con la API Metrum.
          </p>
        </div>
      </div>

      <ConexionTab />
    </>
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

