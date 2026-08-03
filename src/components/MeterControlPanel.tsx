'use client';

import { useEffect, useMemo, useState } from 'react';
import { classifyDevice } from '@/lib/classify-device';
import type { DeviceOption } from '@/lib/device-option';

/**
 * Panel de corte y reconexión remota de medidores.
 *
 * Se confirmó en vivo (login directo a Metrum) que cada medidor expone
 * `latch_state`/`latch_output` ("close"/"open" — el relé de corte físico,
 * protocolo DLMS/COSEM) y un atributo `command` por el que Metrum despacha
 * acciones. Lo que falta confirmar con Metrum es el string exacto de
 * comando — por eso el envío queda MOCKEADO por defecto (ver
 * src/lib/metrum-meter-control.ts): el comando se registra en auditoría
 * pero no se manda al medidor hasta que se confirme y se configuren
 * METRUM_METER_CONTROL_LIVE + METRUM_METER_DISCONNECT_COMMAND/RECONNECT_COMMAND.
 */

interface MeterCommand {
  id: string;
  casa: string;
  meter_name: string;
  action: 'disconnect' | 'reconnect';
  latch_state_at_send: string | null;
  status: 'pending' | 'sent' | 'success' | 'failed' | 'mocked';
  error_message: string | null;
  sent_by: string;
  sent_at: string;
}

export function MeterControlPanel({ devices }: { devices: DeviceOption[] }) {
  const meters = useMemo(() =>
    devices
      .filter((d) => classifyDevice(d) === 'meter')
      .sort((a, b) => (a.casa ?? '').localeCompare(b.casa ?? '')),
    [devices]);

  const [selectedMeterId, setSelectedMeterId] = useState<string>('');
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [history, setHistory] = useState<MeterCommand[]>([]);
  const [liveStatus, setLiveStatus] = useState<{ latchState: string | null; latchOutput: string | null; active: boolean | null } | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  const selectedMeter = meters.find((d) => d.id === selectedMeterId);

  const loadHistory = async () => {
    const url = selectedMeter?.casa
      ? `/api/metrum/meter-command?casa=${encodeURIComponent(selectedMeter.casa)}&limit=30`
      : '/api/metrum/meter-command?limit=30';
    const r = await fetch(url);
    const j = await r.json();
    setHistory(j.commands ?? []);
  };

  const loadLiveStatus = async () => {
    if (!selectedMeter?.metrum_id) { setLiveStatus(null); return; }
    setStatusLoading(true);
    try {
      const r = await fetch(`/api/metrum/meter-status?metrum_id=${encodeURIComponent(selectedMeter.metrum_id)}`);
      setLiveStatus(r.ok ? await r.json() : null);
    } finally {
      setStatusLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
    loadLiveStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMeterId]);

  useEffect(() => { loadHistory(); /* eslint-disable-next-line */ }, []);

  const sendCommand = async (action: 'disconnect' | 'reconnect') => {
    if (!selectedMeterId) { setMsg({ kind: 'error', text: 'Selecciona un medidor primero' }); return; }
    const label = action === 'disconnect' ? 'CORTAR' : 'RECONECTAR';
    const confirmMsg = action === 'disconnect'
      ? `⚠️ Vas a CORTAR el suministro del medidor de ${selectedMeter?.casa}. Esto es una acción real hacia el cliente.\n\nNota: si el comando de Metrum todavía no está confirmado (modo actual), queda REGISTRADO en auditoría pero NO se envía al medidor.\n\n¿Confirmas?`
      : `Vas a RECONECTAR el medidor de ${selectedMeter?.casa}.\n\nNota: si el comando de Metrum todavía no está confirmado (modo actual), queda REGISTRADO en auditoría pero NO se envía al medidor.\n\n¿Confirmas?`;
    if (!confirm(confirmMsg)) return;
    setSending(true);
    setMsg(null);
    try {
      const r = await fetch('/api/metrum/meter-command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meter_id: selectedMeterId, action, sent_by: 'manual-ui' }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Error');
      const status = j.status as string;
      setMsg({
        kind: status === 'mocked' ? 'info' : status === 'sent' ? 'success' : 'error',
        text: status === 'mocked'
          ? `📋 Comando "${label}" registrado en auditoría (status: mocked). ${j.hint ?? ''}`
          : `Comando "${label}" ${status}.`,
      });
      await loadHistory();
      await loadLiveStatus();
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Error' });
    } finally {
      setSending(false);
    }
  };

  const statusColor = (s: string) => ({ success: '#10b981', sent: '#3b82f6', mocked: '#f59e0b', failed: '#ef4444', pending: '#94a3b8' }[s] ?? '#94a3b8');
  const isConnected = liveStatus?.latchState === 'close' || liveStatus?.latchOutput === 'close';
  const isDisconnected = liveStatus?.latchState === 'open' || liveStatus?.latchOutput === 'open';

  return (
    <>
      <div className="alert-warning" style={{ fontSize: '0.85rem' }}>
        ⚠️ <strong>Modo simulación por defecto.</strong> Confirmamos que los medidores tienen un relé de corte (<code>latch_state</code>) y un atributo <code>command</code> para despachar acciones, pero todavía no se confirmó con Metrum el string exacto para corte/reconexión. Los comandos se guardan en auditoría; el envío real solo se activa configurando <code>METRUM_METER_CONTROL_LIVE=true</code> + <code>METRUM_METER_DISCONNECT_COMMAND</code> / <code>METRUM_METER_RECONNECT_COMMAND</code> en el entorno.
      </div>

      <div className="glass-panel">
        <h3 style={{ margin: 0, marginBottom: 14, fontSize: '1rem' }}>🔌 Selector de medidor</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label">Medidor a controlar</label>
            <select value={selectedMeterId} onChange={(e) => setSelectedMeterId(e.target.value)}>
              <option value="">— Selecciona un medidor —</option>
              {meters.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.casa ?? '?'} · {d.name} ({d.modelo ?? d.type ?? '?'})
                </option>
              ))}
            </select>
          </div>

          {selectedMeter && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, padding: 14, background: 'var(--bg-elevated)', borderRadius: 10 }}>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Casa</div>
                <div style={{ fontSize: '0.95rem', fontWeight: 600, marginTop: 4 }}>{selectedMeter.casa ?? '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Modelo</div>
                <div style={{ fontSize: '0.95rem', fontWeight: 600, marginTop: 4 }}>{selectedMeter.modelo ?? '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Estado del relé (en vivo)</div>
                <div style={{ fontSize: '1.05rem', fontWeight: 700, marginTop: 4, color: statusLoading ? 'var(--text-muted)' : isConnected ? '#10b981' : isDisconnected ? '#ef4444' : 'var(--text-muted)' }}>
                  {statusLoading ? 'Consultando…' : isConnected ? '🟢 Conectado (close)' : isDisconnected ? '🔴 Cortado (open)' : '—'}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button className="secondary-btn" onClick={loadLiveStatus} disabled={statusLoading} style={{ fontSize: '0.76rem', padding: '6px 10px' }}>
                  ↻ Refrescar estado
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {selectedMeter && (
        <div className="glass-panel">
          <h3 style={{ margin: 0, marginBottom: 14, fontSize: '1rem' }}>📤 Enviar comando</h3>
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={() => sendCommand('disconnect')}
              disabled={sending}
              className="primary-btn"
              style={{ background: '#ef4444', border: 'none', flex: 1, justifyContent: 'center', padding: '10px' }}
            >
              🔴 Cortar suministro
            </button>
            <button
              onClick={() => sendCommand('reconnect')}
              disabled={sending}
              className="primary-btn"
              style={{ background: '#10b981', border: 'none', flex: 1, justifyContent: 'center', padding: '10px' }}
            >
              🟢 Reconectar
            </button>
          </div>

          {msg && (
            <div className={msg.kind === 'success' ? 'alert-success' : msg.kind === 'error' ? 'alert-error' : 'alert-warning'} style={{ marginTop: 12, fontSize: '0.82rem' }}>
              {msg.text}
            </div>
          )}
        </div>
      )}

      <div className="glass-panel" style={{ padding: 0 }}>
        <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ margin: 0, fontSize: '0.95rem' }}>
            📜 Historial de comandos
            {selectedMeter?.casa && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> — {selectedMeter.casa}</span>}
            <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.78rem' }}> · {history.length} registros</span>
          </h3>
        </div>
        <div className="table-container" style={{ border: 'none', overflowX: 'auto' }}>
          <table style={{ fontSize: '0.78rem' }}>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Casa</th>
                <th>Medidor</th>
                <th>Acción</th>
                <th>Latch al enviar</th>
                <th>Estado</th>
                <th>Por</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Sin comandos enviados todavía.</td></tr>
              ) : history.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.72rem' }}>{new Date(c.sent_at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td><strong>{c.casa}</strong></td>
                  <td style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{c.meter_name}</td>
                  <td style={{ fontSize: '0.78rem' }}>{c.action === 'disconnect' ? '🔴 Cortar' : '🟢 Reconectar'}</td>
                  <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem', color: 'var(--text-muted)' }}>{c.latch_state_at_send ?? '—'}</td>
                  <td>
                    <span style={{ padding: '2px 10px', borderRadius: 12, background: statusColor(c.status) + '20', color: statusColor(c.status), fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase' }}>
                      {c.status}
                    </span>
                    {c.error_message && <div style={{ fontSize: '0.7rem', color: '#ef4444', marginTop: 2 }}>{c.error_message}</div>}
                  </td>
                  <td style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{c.sent_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
