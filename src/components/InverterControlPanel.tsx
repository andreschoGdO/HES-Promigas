'use client';

import { useEffect, useMemo, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { classifyDevice } from '@/lib/classify-device';
import type { DeviceOption } from '@/lib/device-option';

/**
 * Panel de control manual de inversores.
 *
 * Fuente única de verdad para el envío de comandos a inversores. Muestra
 * selector, estado instantáneo, formulario de acción e historial. La lógica
 * de envío pasa por POST /api/inverter/command, que hoy actúa como MOCK
 * cuando no hay credenciales OEM y como adaptador real (Deye / Livoltek)
 * cuando sí.
 */

interface InverterCommand {
  id: string;
  casa: string;
  inverter_name: string;
  marca: string;
  modelo: string;
  action: string;
  target_value: number;
  target_unit: string;
  cos_phi_at_send: number | null;
  status: 'pending' | 'sent' | 'success' | 'failed' | 'mocked';
  error_message: string | null;
  sent_by: string;
  sent_at: string;
  response_payload: Record<string, unknown> | null;
}

const CONTROL_ACTIONS: Array<{ key: string; label: string; unit: string; min: number; max: number; step: number; help: string }> = [
  { key: 'set_power_factor',       label: 'Ajustar cos φ',            unit: 'cos_phi',     min: 0.80, max: 1.00, step: 0.01,
    help: 'Fija el factor de potencia objetivo del inversor. Rango típico 0.90–1.00.' },
  { key: 'set_reactive_power',     label: 'Ajustar Q reactiva',       unit: 'kvar',        min: -10,  max: 10,   step: 0.5,
    help: 'Q en kvar (negativo = capacitivo, positivo = inductivo).' },
  { key: 'set_active_power_limit', label: 'Limitar P activa',         unit: 'kW',          min: 0,    max: 15,   step: 0.5,
    help: 'Cap de potencia activa exportada. Útil para cumplir setpoints del OR.' },
  { key: 'set_work_mode',          label: 'Cambiar modo de trabajo',  unit: 'mode_code',   min: 0,    max: 5,    step: 1,
    help: 'Modo de trabajo (0=self-consumption, 1=grid-tie, …). Depende del fabricante.' },
];

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export function InverterControlPanel({ devices }: { devices: DeviceOption[] }) {
  const inverters = useMemo(() =>
    devices
      .filter((d) => classifyDevice(d) === 'inverter')
      .sort((a, b) => (a.casa ?? '').localeCompare(b.casa ?? '')),
    [devices]);

  const [selectedInverterId, setSelectedInverterId] = useState<string>('');
  const [action, setAction] = useState<string>('set_power_factor');
  const [value, setValue] = useState<string>('0.95');
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [history, setHistory] = useState<InverterCommand[]>([]);
  const [instantStatus, setInstantStatus] = useState<{ cos_phi_now: number | null; power_active_w: number | null; power_reactive_var: number | null } | null>(null);

  const selectedInverter = inverters.find((d) => d.id === selectedInverterId);
  const actionMeta = CONTROL_ACTIONS.find((a) => a.key === action)!;

  const loadHistory = async () => {
    const url = selectedInverter?.casa
      ? `/api/inverter/command?casa=${encodeURIComponent(selectedInverter.casa)}&limit=30`
      : '/api/inverter/command?limit=30';
    const r = await fetch(url);
    const j = await r.json();
    setHistory(j.commands ?? []);
  };

  useEffect(() => {
    if (!selectedInverter?.casa) { setInstantStatus(null); return; }
    (async () => {
      const { data } = await supabase
        .from('instant_metrics')
        .select('cos_phi_now, power_active_w, power_reactive_var, recorded_at')
        .eq('casa', selectedInverter.casa)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      setInstantStatus(data ?? null);
    })();
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInverterId]);

  useEffect(() => { loadHistory(); /* eslint-disable-next-line */ }, []);

  const sendCommand = async () => {
    if (!selectedInverterId) { setMsg({ kind: 'error', text: 'Selecciona un inversor primero' }); return; }
    const n = Number(value);
    if (!Number.isFinite(n)) { setMsg({ kind: 'error', text: 'Valor inválido' }); return; }
    if (n < actionMeta.min || n > actionMeta.max) {
      setMsg({ kind: 'error', text: `Valor fuera de rango (${actionMeta.min} a ${actionMeta.max} ${actionMeta.unit})` });
      return;
    }
    const confirmMsg = `¿Enviar "${actionMeta.label}" con valor ${n} ${actionMeta.unit} al inversor ${selectedInverter?.name} (${selectedInverter?.casa})?\n\nNota: si el fabricante aún no tiene credenciales configuradas, el comando se REGISTRA en auditoría pero NO se envía al inversor.`;
    if (!confirm(confirmMsg)) return;
    setSending(true);
    setMsg(null);
    try {
      const r = await fetch('/api/inverter/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inverter_id: selectedInverterId, action, value: n, sent_by: 'manual-ui' }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Error');
      const status = j.status as string;
      setMsg({
        kind: status === 'mocked' ? 'info' : status === 'success' ? 'success' : 'error',
        text: status === 'mocked'
          ? `📋 Comando registrado en auditoría (status: mocked). ${j.hint ?? ''}`
          : `Comando ${status}.`,
      });
      await loadHistory();
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Error' });
    } finally {
      setSending(false);
    }
  };

  const statusColor = (s: string) => ({ success: '#10b981', sent: '#3b82f6', mocked: '#f59e0b', failed: '#ef4444', pending: '#94a3b8' }[s] ?? '#94a3b8');

  return (
    <>
      <div className="alert-warning" style={{ fontSize: '0.85rem' }}>
        ⚠️ <strong>Modo simulación por defecto.</strong> Los comandos se guardan en auditoría; solo se envían al fabricante cuando el ENV correspondiente está presente (<code>DEYE_APP_ID</code>/<code>DEYE_APP_SECRET</code> para Deye, <code>LIVOLTEK_API_KEY</code> para Livoltek). Sin ellos el status queda como <code>mocked</code>.
      </div>

      <div className="glass-panel">
        <h3 style={{ margin: 0, marginBottom: 14, fontSize: '1rem' }}>🎛️ Selector de inversor</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label">Inversor a controlar</label>
            <select value={selectedInverterId} onChange={(e) => setSelectedInverterId(e.target.value)}>
              <option value="">— Selecciona un inversor —</option>
              {inverters.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.casa ?? '?'} · {d.name} ({d.marca ?? '?'} {d.modelo ?? ''})
                </option>
              ))}
            </select>
          </div>

          {selectedInverter && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, padding: 14, background: 'var(--bg-elevated)', borderRadius: 10 }}>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Marca / Modelo</div>
                <div style={{ fontSize: '0.95rem', fontWeight: 600, marginTop: 4 }}>{selectedInverter.marca ?? '—'}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{selectedInverter.modelo ?? '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Potencia</div>
                <div style={{ fontSize: '0.95rem', fontWeight: 600, marginTop: 4 }}>{selectedInverter.potencia_kw ?? '—'} kW</div>
              </div>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>cos φ ahora</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 700, marginTop: 4, color: (instantStatus?.cos_phi_now ?? 1) < 0.9 ? '#ef4444' : 'var(--text-primary)' }}>
                  {instantStatus?.cos_phi_now != null ? instantStatus.cos_phi_now.toFixed(3) : '—'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>P activa</div>
                <div style={{ fontSize: '0.95rem', fontWeight: 600, marginTop: 4 }}>{instantStatus?.power_active_w != null ? (instantStatus.power_active_w / 1000).toFixed(2) + ' kW' : '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Q reactiva</div>
                <div style={{ fontSize: '0.95rem', fontWeight: 600, marginTop: 4 }}>{instantStatus?.power_reactive_var != null ? (instantStatus.power_reactive_var / 1000).toFixed(2) + ' kvar' : '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Estado</div>
                <div style={{ fontSize: '0.95rem', fontWeight: 600, marginTop: 4, color: selectedInverter.is_active === false ? '#ef4444' : '#10b981' }}>
                  {selectedInverter.is_active === false ? 'Sin Conexión' : 'En Línea'}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="glass-panel">
        <h3 style={{ margin: 0, marginBottom: 14, fontSize: '1rem' }}>📤 Enviar comando</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div className="input-group" style={{ marginBottom: 0, gridColumn: 'span 2' }}>
            <label className="input-label">Acción</label>
            <select value={action} onChange={(e) => { setAction(e.target.value); const a = CONTROL_ACTIONS.find((x) => x.key === e.target.value); if (a) setValue(((a.min + a.max) / 2).toFixed(2)); }}>
              {CONTROL_ACTIONS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
            <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.45 }}>💡 {actionMeta.help}</p>
          </div>
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label">Valor ({actionMeta.unit})</label>
            <input
              type="number"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              min={actionMeta.min}
              max={actionMeta.max}
              step={actionMeta.step}
              placeholder={`${actionMeta.min} a ${actionMeta.max}`}
            />
          </div>
          <div className="input-group" style={{ marginBottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
            <button className="primary-btn" onClick={sendCommand} disabled={sending || !selectedInverterId} style={{ width: '100%', justifyContent: 'center', padding: '10px' }}>
              {sending ? 'Enviando...' : '📤 Enviar comando'}
            </button>
          </div>
        </div>

        {msg && (
          <div className={msg.kind === 'success' ? 'alert-success' : msg.kind === 'error' ? 'alert-error' : 'alert-warning'} style={{ marginTop: 12, fontSize: '0.82rem' }}>
            {msg.text}
          </div>
        )}
      </div>

      <div className="glass-panel" style={{ padding: 0 }}>
        <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ margin: 0, fontSize: '0.95rem' }}>
            📜 Historial de comandos
            {selectedInverter?.casa && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> — {selectedInverter.casa}</span>}
            <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.78rem' }}> · {history.length} registros</span>
          </h3>
        </div>
        <div className="table-container" style={{ border: 'none', overflowX: 'auto' }}>
          <table style={{ fontSize: '0.78rem' }}>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Casa</th>
                <th>Inversor</th>
                <th>Acción</th>
                <th>Valor</th>
                <th>cos φ al enviar</th>
                <th>Estado</th>
                <th>Por</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Sin comandos enviados todavía.</td></tr>
              ) : history.map((c) => {
                const actMeta = CONTROL_ACTIONS.find((a) => a.key === c.action);
                return (
                  <tr key={c.id}>
                    <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.72rem' }}>{new Date(c.sent_at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td><strong>{c.casa}</strong></td>
                    <td style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{c.marca} · {c.inverter_name}</td>
                    <td style={{ fontSize: '0.78rem' }}>{actMeta?.label ?? c.action}</td>
                    <td style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{c.target_value} {c.target_unit}</td>
                    <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem', color: 'var(--text-muted)' }}>{c.cos_phi_at_send?.toFixed(3) ?? '—'}</td>
                    <td>
                      <span style={{ padding: '2px 10px', borderRadius: 12, background: statusColor(c.status) + '20', color: statusColor(c.status), fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase' }}>
                        {c.status}
                      </span>
                      {c.error_message && <div style={{ fontSize: '0.7rem', color: '#ef4444', marginTop: 2 }}>{c.error_message}</div>}
                    </td>
                    <td style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{c.sent_by}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
