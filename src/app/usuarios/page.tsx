'use client';

import { useEffect, useState } from 'react';
import { Users as UsersIcon, CheckCircle2, XCircle, Trash2, Clock, Plus, Mail } from 'lucide-react';

interface AllowlistRow {
  id: string;
  email: string;
  enabled: boolean;
  note: string | null;
  added_by: string | null;
  created_at: string;
  updated_at: string;
}

export default function UsuariosPage() {
  const [items, setItems] = useState<AllowlistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [newNote, setNewNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/users/allowlist');
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Error');
      setItems(j.items ?? []);
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : 'Error cargando' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggleEnabled = async (row: AllowlistRow) => {
    setMsg(null);
    const r = await fetch('/api/users/allowlist', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: row.email, enabled: !row.enabled }),
    });
    const j = await r.json();
    if (!r.ok) { setMsg({ kind: 'error', text: j.error ?? 'Error' }); return; }
    setMsg({ kind: 'success', text: `${row.email} ${!row.enabled ? 'habilitado' : 'deshabilitado'}.` });
    load();
  };

  const removeRow = async (row: AllowlistRow) => {
    if (!confirm(`¿Eliminar ${row.email} de la allowlist? Si vuelve a intentar entrar, aparecerá de nuevo como pendiente.`)) return;
    const r = await fetch(`/api/users/allowlist?email=${encodeURIComponent(row.email)}`, { method: 'DELETE' });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setMsg({ kind: 'error', text: j.error ?? 'Error eliminando' });
      return;
    }
    setMsg({ kind: 'success', text: `${row.email} eliminado.` });
    load();
  };

  const addManual = async () => {
    if (!newEmail.trim()) return;
    setSubmitting(true);
    setMsg(null);
    const r = await fetch('/api/users/allowlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: newEmail.trim(), enabled: true, note: newNote.trim() || null }),
    });
    setSubmitting(false);
    const j = await r.json();
    if (!r.ok) { setMsg({ kind: 'error', text: j.error ?? 'Error' }); return; }
    setMsg({ kind: 'success', text: `${newEmail} habilitado.` });
    setNewEmail(''); setNewNote('');
    load();
  };

  const pending = items.filter((r) => !r.enabled);
  const enabled = items.filter((r) => r.enabled);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <UsersIcon size={22} style={{ color: 'var(--accent)' }} />
        <h1 style={{ margin: 0 }}>Usuarios</h1>
      </div>
      <p style={{ color: 'var(--text-secondary)', marginTop: 4, fontSize: '0.88rem' }}>
        Allowlist de contratistas. Los correos de <strong>@gdo.com.co</strong> y <strong>@promigas.com</strong> entran automáticamente como admins. Otros emails deben estar habilitados acá para acceder al módulo de Visitas.
      </p>

      {msg && (
        <div className={msg.kind === 'success' ? 'alert-success' : 'alert-error'} style={{ marginTop: 12 }}>
          {msg.text}
        </div>
      )}

      {/* Agregar manualmente */}
      <div className="glass-panel" style={{ padding: 14, marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: '0.85rem', fontWeight: 600 }}>
          <Plus size={14} /> Agregar contratista manualmente
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1.5fr) 1fr auto', gap: 8 }}>
          <input
            type="email"
            placeholder="email@empresa.com"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            disabled={submitting}
          />
          <input
            type="text"
            placeholder="Nota (opcional): empresa, rol…"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            disabled={submitting}
          />
          <button className="primary-btn" onClick={addManual} disabled={submitting || !newEmail.trim()}>
            {submitting ? 'Agregando…' : 'Habilitar'}
          </button>
        </div>
      </div>

      {/* Pendientes (top, color naranja) */}
      <section style={{ marginTop: 18 }}>
        <h2 style={{ fontSize: '1rem', margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Clock size={16} style={{ color: '#f59e0b' }} /> Pendientes de aprobación
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 400 }}>({pending.length})</span>
        </h2>
        {loading ? (
          <div className="glass-panel" style={{ padding: 18, textAlign: 'center', color: 'var(--text-muted)' }}>Cargando…</div>
        ) : pending.length === 0 ? (
          <div className="glass-panel" style={{ padding: 14, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Sin solicitudes pendientes. Cuando un correo desconocido intente entrar, aparecerá acá.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pending.map((row) => (
              <Row key={row.id} row={row} onToggle={toggleEnabled} onRemove={removeRow} />
            ))}
          </div>
        )}
      </section>

      {/* Habilitados */}
      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: '1rem', margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <CheckCircle2 size={16} style={{ color: '#10b981' }} /> Habilitados
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 400 }}>({enabled.length})</span>
        </h2>
        {enabled.length === 0 ? (
          <div className="glass-panel" style={{ padding: 14, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Ningún contratista habilitado todavía.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {enabled.map((row) => (
              <Row key={row.id} row={row} onToggle={toggleEnabled} onRemove={removeRow} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function Row({ row, onToggle, onRemove }: {
  row: AllowlistRow;
  onToggle: (row: AllowlistRow) => void;
  onRemove: (row: AllowlistRow) => void;
}) {
  const stateColor = row.enabled ? '#10b981' : '#f59e0b';
  return (
    <div
      className="glass-panel"
      style={{
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        borderLeft: `3px solid ${stateColor}`,
        flexWrap: 'wrap',
      }}
    >
      <Mail size={14} style={{ color: 'var(--text-muted)' }} />
      <strong style={{ fontSize: '0.92rem', minWidth: 220 }}>{row.email}</strong>
      <span style={{ padding: '2px 8px', borderRadius: 10, background: stateColor + '20', color: stateColor, fontSize: '0.7rem', fontWeight: 700 }}>
        {row.enabled ? 'HABILITADO' : 'PENDIENTE'}
      </span>
      {row.note && <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{row.note}</span>}
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', fontFamily: 'ui-monospace, monospace' }}>
          {new Date(row.created_at).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: '2-digit' })}
        </span>
        <button
          onClick={() => onToggle(row)}
          className={row.enabled ? 'chip' : 'primary-btn'}
          style={{ fontSize: '0.78rem', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
          title={row.enabled ? 'Deshabilitar' : 'Habilitar'}
        >
          {row.enabled ? <><XCircle size={13} /> Deshabilitar</> : <><CheckCircle2 size={13} /> Habilitar</>}
        </button>
        <button
          onClick={() => onRemove(row)}
          style={{ padding: 6, background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer' }}
          title="Eliminar"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
